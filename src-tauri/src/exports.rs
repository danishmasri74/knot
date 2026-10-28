use crate::storage::Result;
use serde::Deserialize;
use std::{io::Write, path::Path};

const LIMIT: usize = 100 * 1024 * 1024;
#[derive(Deserialize)]
pub struct ExportFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

pub fn validate(format: &str, files: &[ExportFile]) -> Result<&'static str> {
    if files.is_empty() || files.len() > 10000 {
        return Err("Invalid export file count".into());
    }
    let mut total = 0usize;
    let mut names = std::collections::HashSet::new();
    for file in files {
        total = total
            .checked_add(file.bytes.len())
            .ok_or("Export too large")?;
        if total > LIMIT {
            return Err("Export exceeds 100 MiB".into());
        }
        if !names.insert(file.name.to_lowercase()) {
            return Err("Duplicate export filename".into());
        }
        if file.name != "index.md" && file.name != "document.png" && file.name != "document.pdf" {
            let Some(name) = file.name.strip_prefix("assets/") else {
                return Err("Invalid export filename".into());
            };
            if name.is_empty()
                || name == "."
                || name == ".."
                || name
                    .chars()
                    .any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
            {
                return Err("Unsafe export asset filename".into());
            }
        }
    }
    match format {
        "markdown"
            if files[0].name == "index.md"
                && files.iter().skip(1).all(|f| f.name.starts_with("assets/")) =>
        {
            std::str::from_utf8(&files[0].bytes)?;
            Ok(if files.len() == 1 { "md" } else { "zip" })
        }
        "png"
            if files.len() == 1
                && files[0].name == "document.png"
                && files[0].bytes.starts_with(b"\x89PNG\r\n\x1a\n") =>
        {
            Ok("png")
        }
        "pdf"
            if files.len() == 1
                && files[0].name == "document.pdf"
                && files[0].bytes.starts_with(b"%PDF-") =>
        {
            Ok("pdf")
        }
        _ => Err("Invalid export format or content".into()),
    }
}

pub fn filename(title: &str, extension: &str) -> String {
    let title: String = title
        .chars()
        .take(80)
        .map(|c| {
            if c.is_control() || "/\\:<>\"|?*".contains(c) {
                '-'
            } else {
                c
            }
        })
        .collect();
    let title = title.trim().trim_end_matches('.');
    // Prefix also avoids Windows reserved device filenames.
    format!(
        "Knot-{}.{}",
        if title.is_empty() { "Untitled" } else { title },
        extension
    )
}

pub fn write(dest: &Path, format: &str, files: &[ExportFile]) -> Result<()> {
    let extension = validate(format, files)?;
    if dest.exists() {
        return Err("Choose a new filename; existing files are never overwritten".into());
    }
    let parent = dest.parent().ok_or("Invalid export destination")?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".knot-export-")
        .suffix(".partial")
        .tempfile_in(parent)?;
    if extension == "zip" {
        let mut zip = zip::ZipWriter::new(temporary.as_file_mut());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for file in files {
            zip.start_file(&file.name, options)?;
            zip.write_all(&file.bytes)?;
        }
        zip.finish()?;
    } else {
        temporary.write_all(&files[0].bytes)?;
    }
    temporary.as_file().sync_all()?;
    // tempfile uses no-replace publication (MoveFileExW on Windows), retaining
    // overwrite protection without requiring NTFS hard-link support.
    temporary
        .persist_noclobber(dest)
        .map_err(|error| error.error)?;
    Ok(())
}
