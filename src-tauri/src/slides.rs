//! Slide decks (.pptx) get a PDF copy so the PDF reader, highlights, search
//! and Ask Knot work on them unchanged. Conversion uses the person's own
//! PowerPoint, then LibreOffice; Knot ships neither and never uploads decks.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

/// Longest a converter may run before Knot stops waiting for it.
const TIMEOUT: Duration = Duration::from_secs(120);
const MAX_PDF_BYTES: u64 = 100 * 1024 * 1024;
/// One conversion at a time: two automation sessions in one PowerPoint, or
/// two LibreOffice processes, interfere with each other.
static QUEUE: Mutex<()> = Mutex::new(());

#[derive(Debug, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Outcome {
    Converted {
        pdf: Vec<u8>,
        converter: &'static str,
    },
    /// Neither PowerPoint nor LibreOffice is installed.
    Missing,
    Failed {
        reason: String,
    },
}

enum Attempt {
    Missing,
    Failed(String),
    Done(PathBuf),
}

/// A deck Knot is willing to hand to a converter: a real .pptx package with
/// no macros (.pptm content is refused, never run).
pub fn validate(bytes: &[u8]) -> Result<(), String> {
    // A password-protected .pptx is an encrypted compound file, not a zip.
    if bytes.starts_with(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1") {
        return Err("This deck is password-protected.".into());
    }
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("This file isn't a PowerPoint deck.".into());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "This deck is damaged.".to_string())?;
    if zip.len() > 50_000 {
        return Err("This deck has too many parts.".into());
    }
    let mut presentation = false;
    for i in 0..zip.len() {
        let entry = zip
            .by_index_raw(i)
            .map_err(|_| "This deck is damaged.".to_string())?;
        let name = entry.name().to_ascii_lowercase();
        if name.ends_with("vbaproject.bin") {
            return Err("This deck contains macros.".into());
        }
        presentation |= name == "ppt/presentation.xml";
    }
    if presentation {
        Ok(())
    } else {
        Err("This file isn't a PowerPoint deck.".into())
    }
}

pub fn convert(bytes: &[u8]) -> Outcome {
    if let Err(reason) = validate(bytes) {
        return Outcome::Failed { reason };
    }
    let _turn = QUEUE.lock().unwrap_or_else(|e| e.into_inner());
    let dir = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(e) => {
            return Outcome::Failed {
                reason: e.to_string(),
            }
        }
    };
    let input = dir.path().join("deck.pptx");
    if let Err(e) = std::fs::write(&input, bytes) {
        return Outcome::Failed {
            reason: e.to_string(),
        };
    }
    let converters: [(&'static str, fn(&Path, &Path) -> Attempt); 2] =
        [("powerpoint", powerpoint), ("libreoffice", libreoffice)];
    let mut failure = None;
    for (name, attempt) in converters {
        let work = dir.path().join(name);
        if let Err(e) = std::fs::create_dir_all(&work) {
            return Outcome::Failed {
                reason: e.to_string(),
            };
        }
        match attempt(&input, &work) {
            Attempt::Missing => {}
            Attempt::Failed(reason) => {
                failure.get_or_insert(reason);
            }
            Attempt::Done(path) => match read_pdf(&path) {
                Ok(pdf) => {
                    return Outcome::Converted {
                        pdf,
                        converter: name,
                    }
                }
                Err(reason) => {
                    failure.get_or_insert(reason);
                }
            },
        }
    }
    match failure {
        Some(reason) => Outcome::Failed { reason },
        None => Outcome::Missing,
    }
}

fn read_pdf(path: &Path) -> Result<Vec<u8>, String> {
    let size = std::fs::metadata(path)
        .map_err(|_| "The converter didn't produce a PDF.".to_string())?
        .len();
    if size > MAX_PDF_BYTES {
        return Err("The converted PDF is larger than 100 MiB.".into());
    }
    let pdf = std::fs::read(path).map_err(|e| e.to_string())?;
    if !pdf.starts_with(b"%PDF-") {
        return Err("The converter didn't produce a PDF.".into());
    }
    Ok(pdf)
}

/// Run a converter without a console window, stopping it after `TIMEOUT`.
/// Only Knot's own child process is ever stopped.
fn run(mut command: Command) -> Result<Result<(), String>, std::io::Error> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn()?;
    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            let output = child.wait_with_output()?;
            return Ok(if output.status.success() {
                Ok(())
            } else {
                let message = String::from_utf8_lossy(&output.stderr);
                let message = message.trim();
                Err(match output.status.code() {
                    Some(code) if message.is_empty() => format!("exit code {code}"),
                    _ => message.chars().take(300).collect(),
                })
            });
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(Err("The converter took too long.".into()));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// PowerPoint, through its automation interface. The deck opens read-only
/// and windowless. A fake password makes a protected deck fail at once
/// instead of waiting on a password prompt. Hidden slides are shown in
/// memory only, so the PDF keeps PowerPoint's slide numbering. PowerPoint is
/// closed only if Knot started it and nothing else is open in it.
#[cfg(windows)]
fn powerpoint(input: &Path, work: &Path) -> Attempt {
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try { $app = New-Object -ComObject PowerPoint.Application } catch { exit 3 }
$code = 0
$deck = $null
try {
  $deck = $app.Presentations.Open($env:KNOT_SLIDES_IN + '::knot-no-password::', -1, 0, 0)
  foreach ($slide in $deck.Slides) { $slide.SlideShowTransition.Hidden = 0 }
  $deck.SaveAs($env:KNOT_SLIDES_OUT, 32)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  $code = 4
} finally {
  if ($deck) { $deck.Close() }
  if ($app.Presentations.Count -eq 0 -and $app.Visible -ne -1) { $app.Quit() }
}
exit $code
"#;
    use base64::Engine;
    let script: Vec<u8> = SCRIPT
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect();
    let output = work.join("deck.pdf");
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
        ])
        .arg(base64::engine::general_purpose::STANDARD.encode(script))
        .env("KNOT_SLIDES_IN", input)
        .env("KNOT_SLIDES_OUT", &output);
    match run(command) {
        Err(_) => Attempt::Missing,
        Ok(Ok(())) => Attempt::Done(output),
        Ok(Err(reason)) if reason == "exit code 3" => Attempt::Missing,
        Ok(Err(reason)) => Attempt::Failed(reason),
    }
}
#[cfg(not(windows))]
fn powerpoint(_: &Path, _: &Path) -> Attempt {
    Attempt::Missing
}

/// Where LibreOffice is installed, if it is.
fn soffice() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(dir) = std::env::var_os(var) {
            candidates.push(PathBuf::from(dir).join(r"LibreOffice\program\soffice.exe"));
        }
    }
    candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".into());
    let names: &[&str] = if cfg!(windows) {
        &["soffice.exe"]
    } else {
        &["soffice", "libreoffice"]
    };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.extend(names.iter().map(|name| dir.join(name)));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// A `file://` URL for LibreOffice's -env option.
fn file_url(path: &Path) -> String {
    let path = path.to_string_lossy().replace('\\', "/");
    let mut url = String::from(if path.starts_with('/') {
        "file://"
    } else {
        "file:///"
    });
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b':' | b'-' | b'_' | b'.' | b'~' => {
                url.push(byte as char)
            }
            _ => url.push_str(&format!("%{byte:02X}")),
        }
    }
    url
}

/// LibreOffice in headless mode, with a throwaway profile so it never
/// touches (or waits on) a LibreOffice window the person has open.
fn libreoffice(input: &Path, work: &Path) -> Attempt {
    let Some(soffice) = soffice() else {
        return Attempt::Missing;
    };
    let profile = file_url(&work.join("profile"));
    let output = work.join("deck.pdf");
    // Keep hidden slides so slide numbers match PowerPoint. LibreOffice
    // before 7.4 doesn't understand the options; then convert without them.
    let filters = [
        r#"pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}"#,
        "pdf",
    ];
    let mut failure = String::from("LibreOffice didn't produce a PDF.");
    for filter in filters {
        let mut command = Command::new(&soffice);
        command
            .args(["--headless", "--invisible", "--norestore", "--nolockcheck"])
            .args(["--nologo", "--nodefault", "--nofirststartwizard"])
            .arg(format!("-env:UserInstallation={profile}"))
            .args(["--convert-to", filter, "--outdir"])
            .arg(work)
            .arg(input);
        match run(command) {
            Err(_) => return Attempt::Missing,
            Ok(Err(reason)) => failure = reason,
            Ok(Ok(())) if output.is_file() => return Attempt::Done(output),
            Ok(Ok(())) => {}
        }
    }
    Attempt::Failed(failure)
}

/// A filename for the copy handed to PowerPoint: the deck's own name,
/// without anything a shell or file system could misread.
fn safe_name(name: &str) -> String {
    let stem = name
        .trim()
        .strip_suffix(".pptx")
        .or_else(|| name.trim().strip_suffix(".PPTX"))
        .unwrap_or(name.trim());
    let clean: String = stem
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '(' | ')' | '.' | ','))
        .take(80)
        .collect();
    let clean = clean.trim().trim_matches('.').trim();
    format!("{}.pptx", if clean.is_empty() { "Slides" } else { clean })
}

/// Open the original deck in the app the person uses for .pptx files. Knot
/// writes a temporary copy, since decks live inside the workspace.
pub fn open_original(bytes: &[u8], name: &str) -> Result<(), String> {
    validate(bytes)?;
    let base = std::env::temp_dir().join("Knot").join("open-slides");
    // Copies older than a day were opened long ago; tidy them up.
    if let Ok(entries) = std::fs::read_dir(&base) {
        let day = Duration::from_secs(24 * 60 * 60);
        for entry in entries.flatten() {
            let old = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| SystemTime::now().duration_since(t).ok())
                .is_some_and(|age| age > day);
            if old && entry.file_type().is_ok_and(|t| t.is_dir()) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    let dir = base.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe_name(name));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("explorer.exe")
            .raw_arg(format!("\"{}\"", path.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn package(names: &[&str]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for name in names {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"<x/>").unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn accepts_decks_and_refuses_everything_else() {
        assert!(validate(&package(&["[Content_Types].xml", "ppt/presentation.xml"])).is_ok());
        assert!(validate(b"%PDF-1.7").is_err());
        assert_eq!(
            validate(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1....").unwrap_err(),
            "This deck is password-protected."
        );
        assert!(validate(&package(&["word/document.xml"])).is_err());
        let macros = package(&["ppt/presentation.xml", "ppt/vbaProject.bin"]);
        assert_eq!(validate(&macros).unwrap_err(), "This deck contains macros.");
        assert!(validate(b"PK\x03\x04 not really a zip").is_err());
        assert!(matches!(convert(b"nope"), Outcome::Failed { .. }));
    }

    #[test]
    fn copies_keep_a_plain_pptx_name() {
        assert_eq!(safe_name("Q3 review.pptx"), "Q3 review.pptx");
        assert_eq!(safe_name("..\\..\\evil\".pptx"), "evil.pptx");
        assert_eq!(safe_name("  .pptx"), "Slides.pptx");
        assert_eq!(safe_name("a|b<c>.PPTX"), "abc.pptx");
    }

    #[test]
    fn profile_urls_are_escaped() {
        assert_eq!(
            file_url(Path::new(r"C:\Users\A B\tmp")),
            "file:///C:/Users/A%20B/tmp"
        );
        assert_eq!(file_url(Path::new("/tmp/x y")), "file:///tmp/x%20y");
    }

    /// Converts with whatever is installed on this machine.
    #[test]
    #[ignore = "Needs PowerPoint or LibreOffice and a deck in KNOT_TEST_PPTX"]
    fn converts_with_installed_app() {
        let deck = std::fs::read(std::env::var_os("KNOT_TEST_PPTX").unwrap()).unwrap();
        match convert(&deck) {
            Outcome::Converted { pdf, converter } => {
                assert!(pdf.starts_with(b"%PDF-"));
                println!("{converter}: {} bytes", pdf.len());
            }
            other => panic!("{other:?}"),
        }
    }
}
