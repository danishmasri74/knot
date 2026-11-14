//! Offline OCR for workspace search (docs/WORKSPACE-OCR-PLAN.md).
//! Windows' built-in engine reads text in images on this device, one image at
//! a time on a background thread that waits for mains power and an idle user.
use crate::{topic, AppState, Reply};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    collections::{HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Condvar, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

/// One recognised line; the box is in fractions of the image.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Line {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}
/// What OCR reads: an image file (page 0) or one page of a PDF (1-based).
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Unit {
    pub key: String,
    #[serde(default)]
    pub page: u32,
}
#[derive(Debug)]
pub struct Reading {
    pub lines: Vec<Line>,
}

/// Longest side sent to the engine; larger images are downscaled first.
pub const MAX_SIDE: u32 = 2500;
/// Scanned PDF pages are drawn at about this many pixels (enough for body text).
pub const PAGE_PIXELS: f64 = 2_000_000.0;
/// Scanned pages read per PDF.
pub const MAX_PAGES: u32 = 200;
/// Images smaller than this on either side are skipped.
pub const MIN_SIDE: u32 = 64;
/// Images larger than this are not read (the PDF/asset size limit).
const MAX_BYTES: u64 = 10 * 1024 * 1024;
/// Recorded with every result; bump to read every image again after an engine change.
pub const ENGINE: &str = "windows-ocr/1";

// Pacing (docs/WORKSPACE-OCR-PLAN.md, "Resource budget"). Starting points,
// confirmed by measurement before release.
/// No keyboard or mouse input for this long before OCR runs.
const IDLE: Duration = Duration::from_secs(30);
/// A longer rest after this many images.
const BATCH: usize = 20;
const BATCH_REST: Duration = Duration::from_secs(60);
/// Shortest rest between two images; otherwise the rest equals the read time.
const MIN_REST: Duration = Duration::from_millis(500);
/// At most this many images per rolling hour.
const HOURLY: usize = 300;
/// Search results are refreshed at most this often while reading.
const FLUSH: Duration = Duration::from_secs(60);
/// Results for images no indexing pass has seen for this long are pruned.
const PRUNE_SECS: i64 = 90 * 24 * 3600;
/// A failed read is retried once; the second failure marks the image unreadable.
const MAX_FAILURES: i64 = 2;

#[cfg(windows)]
pub mod engine {
    use super::{Line, Reading};
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat,
        BitmapTransform, ColorManagementMode, ExifOrientationMode,
    };
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    fn create() -> windows::core::Result<OcrEngine> {
        OcrEngine::TryCreateFromUserProfileLanguages()
    }
    /// The language OCR would use, or None when no user language has an OCR pack.
    pub fn language() -> Option<String> {
        let engine = create().ok()?;
        engine
            .RecognizerLanguage()
            .and_then(|l| l.LanguageTag())
            .ok()
            .map(|t| t.to_string())
    }
    fn e(e: windows::core::Error) -> String {
        e.message().to_string()
    }
    fn stream_of(bytes: &[u8]) -> Result<InMemoryRandomAccessStream, String> {
        let stream = InMemoryRandomAccessStream::new().map_err(e)?;
        let writer = DataWriter::CreateDataWriter(&stream).map_err(e)?;
        writer.WriteBytes(bytes).map_err(e)?;
        writer.StoreAsync().map_err(e)?.join().map_err(e)?;
        writer.FlushAsync().map_err(e)?.join().map_err(e)?;
        writer.DetachStream().map_err(e)?;
        stream.Seek(0).map_err(e)?;
        Ok(stream)
    }
    /// Reads an image file. Must run on a thread with the WinRT apartment initialised.
    pub fn read(bytes: &[u8], max_side: u32) -> Result<Reading, String> {
        recognize(&stream_of(bytes)?, max_side)
    }
    /// Draws one page (1-based) of a PDF with Windows' PDF renderer at about
    /// `pixels` pixels, then reads it. Password-protected or damaged PDFs fail
    /// as unsupported.
    pub fn read_pdf_page(bytes: &[u8], page: u32, pixels: f64) -> Result<Reading, String> {
        use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
        let document = PdfDocument::LoadFromStreamAsync(&stream_of(bytes)?)
            .map_err(e)?
            .join()
            .map_err(|_| "unsupported".to_string())?;
        if page == 0 || page > document.PageCount().map_err(e)? {
            return Err("unsupported".into());
        }
        let pdf_page = document.GetPage(page - 1).map_err(e)?;
        let size = pdf_page.Size().map_err(e)?;
        let area = (size.Width as f64 * size.Height as f64).max(1.0);
        let scale = (pixels / area).sqrt();
        let options = PdfPageRenderOptions::new().map_err(e)?;
        options
            .SetDestinationWidth(((size.Width as f64 * scale) as u32).max(1))
            .map_err(e)?;
        options
            .SetDestinationHeight(((size.Height as f64 * scale) as u32).max(1))
            .map_err(e)?;
        let out = InMemoryRandomAccessStream::new().map_err(e)?;
        pdf_page
            .RenderWithOptionsToStreamAsync(&out, &options)
            .map_err(e)?
            .join()
            .map_err(|_| "unsupported".to_string())?;
        out.Seek(0).map_err(e)?;
        recognize(&out, super::MAX_SIDE)
    }
    fn recognize(stream: &InMemoryRandomAccessStream, max_side: u32) -> Result<Reading, String> {
        let engine = create().map_err(|_| "unavailable".to_string())?;
        let decoder = BitmapDecoder::CreateAsync(stream)
            .map_err(e)?
            .join()
            .map_err(|_| "unsupported".to_string())?;
        let (width, height) = (
            decoder.OrientedPixelWidth().map_err(e)?,
            decoder.OrientedPixelHeight().map_err(e)?,
        );
        if width == 0 || height == 0 {
            return Err("unsupported".into());
        }
        // Icons and tiny pictures hold no readable text.
        if width < super::MIN_SIDE || height < super::MIN_SIDE {
            return Err("small".into());
        }
        let limit = max_side.min(OcrEngine::MaxImageDimension().map_err(e)?);
        let scale = (limit as f64 / width.max(height) as f64).min(1.0);
        let transform = BitmapTransform::new().map_err(e)?;
        if scale < 1.0 {
            // Scaled sizes apply before orientation, so use the raw dimensions.
            let (raw_w, raw_h) = (
                decoder.PixelWidth().map_err(e)?,
                decoder.PixelHeight().map_err(e)?,
            );
            transform
                .SetScaledWidth(((raw_w as f64 * scale) as u32).max(1))
                .map_err(e)?;
            transform
                .SetScaledHeight(((raw_h as f64 * scale) as u32).max(1))
                .map_err(e)?;
            transform
                .SetInterpolationMode(BitmapInterpolationMode::Fant)
                .map_err(e)?;
        }
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Premultiplied,
                &transform,
                ExifOrientationMode::RespectExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )
            .map_err(e)?
            .join()
            .map_err(e)?;
        let (bw, bh) = (
            bitmap.PixelWidth().map_err(e)? as f32,
            bitmap.PixelHeight().map_err(e)? as f32,
        );
        let result = engine
            .RecognizeAsync(&bitmap)
            .map_err(e)?
            .join()
            .map_err(e)?;
        let mut lines = Vec::new();
        for line in result.Lines().map_err(e)? {
            let text = line.Text().map_err(e)?.to_string();
            let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, 0f32, 0f32);
            for word in line.Words().map_err(e)? {
                let r = word.BoundingRect().map_err(e)?;
                x0 = x0.min(r.X);
                y0 = y0.min(r.Y);
                x1 = x1.max(r.X + r.Width);
                y1 = y1.max(r.Y + r.Height);
            }
            if text.trim().is_empty() || x0 > x1 {
                continue;
            }
            lines.push(Line {
                text,
                x: x0 / bw,
                y: y0 / bh,
                w: (x1 - x0) / bw,
                h: (y1 - y0) / bh,
            });
        }
        Ok(Reading { lines })
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// What the queue is doing, shown in Settings.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Off,
    Unavailable,
    Paused,
    Battery,
    UserActive,
    AppBusy,
    Limit,
    Resting,
    Reading,
    Idle,
}

/// Device conditions checked before every image.
#[derive(Clone, Copy, Debug)]
pub struct Conditions {
    pub on_mains: bool,
    pub battery_saver: bool,
    pub idle: Duration,
    pub app_busy: bool,
    pub read_last_hour: usize,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Config {
    pub enabled: bool,
    pub battery: bool,
    pub paused: bool,
}

/// The pacing rules as one pure decision: run now, or wait (why, and how long).
pub fn decide(config: Config, available: bool, c: Conditions) -> Result<(), (Phase, Duration)> {
    if !config.enabled {
        return Err((Phase::Off, Duration::from_secs(60)));
    }
    if !available {
        return Err((Phase::Unavailable, Duration::from_secs(300)));
    }
    if config.paused {
        return Err((Phase::Paused, Duration::from_secs(60)));
    }
    if !config.battery && (!c.on_mains || c.battery_saver) {
        return Err((Phase::Battery, Duration::from_secs(30)));
    }
    if c.idle < IDLE {
        return Err((Phase::UserActive, IDLE - c.idle + Duration::from_secs(1)));
    }
    if c.app_busy {
        return Err((Phase::AppBusy, Duration::from_secs(5)));
    }
    if c.read_last_hour >= HOURLY {
        return Err((Phase::Limit, Duration::from_secs(60)));
    }
    Ok(())
}

/// Rest after one image that took `took`; `count` images read since OCR started.
pub fn rest(took: Duration, count: usize) -> Duration {
    if count > 0 && count.is_multiple_of(BATCH) {
        BATCH_REST
    } else {
        took.max(MIN_REST)
    }
}

/// Whether recognised text is worth indexing. Windows gives no confidence,
/// so photos that produce a few stray characters are dropped here.
pub fn usable(lines: &[Line]) -> bool {
    let text = lines
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let words = text
        .split_whitespace()
        .filter(|w| w.chars().filter(|c| c.is_alphabetic()).count() >= 2)
        .count();
    let visible = text.chars().filter(|c| !c.is_whitespace()).count();
    let letters = text.chars().filter(|c| c.is_alphanumeric()).count();
    words >= 3 && visible > 0 && letters * 2 >= visible
}

#[derive(Default)]
struct Shared {
    config: Config,
    /// The renderer is indexing text; OCR waits.
    hold: bool,
    phase: Option<Phase>,
    language: Option<(Instant, Option<String>)>,
}
pub struct OcrState {
    path: PathBuf,
    shared: Mutex<Shared>,
    wake: Condvar,
    /// Ask Knot requests in flight; OCR waits while any run.
    ai: AtomicUsize,
}
/// Decrements the in-flight Ask Knot count when the request ends.
pub struct Busy<'a>(&'a AtomicUsize);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
impl OcrState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            shared: Mutex::new(Shared::default()),
            wake: Condvar::new(),
            ai: AtomicUsize::new(0),
        }
    }
    pub fn busy(&self) -> Busy<'_> {
        self.ai.fetch_add(1, Ordering::SeqCst);
        Busy(&self.ai)
    }
    fn config(&self) -> Config {
        self.shared.lock().map(|s| s.config).unwrap_or_default()
    }
    pub fn enabled(&self) -> bool {
        self.config().enabled
    }
    /// The OCR language, refreshed every few minutes (language packs can change).
    fn language(&self) -> Option<String> {
        let mut shared = self.shared.lock().ok()?;
        if let Some((at, language)) = &shared.language {
            if at.elapsed() < Duration::from_secs(300) {
                return language.clone();
            }
        }
        #[cfg(windows)]
        let language = engine::language();
        #[cfg(not(windows))]
        let language = None;
        shared.language = Some((Instant::now(), language.clone()));
        language
    }
    fn open(&self) -> Result<Connection, String> {
        open(&self.path)
    }
    /// Stored lines for an image or PDF page read with the current engine and language.
    fn reading(&self, db: &Connection, sha256: &str, page: u32) -> Option<Vec<Line>> {
        let language = self.language()?;
        let lines: Option<String> = db
            .query_row(
                "SELECT lines FROM results WHERE sha256=?1 AND page=?2 AND engine=?3 AND language=?4 AND state='read'",
                params![sha256, page, ENGINE, language],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        lines.and_then(|l| serde_json::from_str(&l).ok())
    }
}

/// Version of `ocr.sqlite`; another version is discarded and rebuilt.
const CACHE_FORMAT: i64 = 2;
const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS results(sha256 TEXT NOT NULL,page INTEGER NOT NULL,engine TEXT NOT NULL,language TEXT NOT NULL,state TEXT NOT NULL,lines TEXT NOT NULL,failures INTEGER NOT NULL,seen INTEGER NOT NULL,PRIMARY KEY(sha256,page,engine,language));
     CREATE TABLE IF NOT EXISTS workspaces(identity TEXT PRIMARY KEY,since INTEGER NOT NULL,backlog INTEGER NOT NULL);
     PRAGMA user_version=2;";
fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let init = || -> rusqlite::Result<Connection> {
        let db = Connection::open(path)?;
        db.busy_timeout(Duration::from_secs(2))?;
        let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version != 0 && version != CACHE_FORMAT {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let check: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(rusqlite::Error::InvalidQuery);
        }
        db.execute_batch(SCHEMA)?;
        Ok(db)
    };
    match init() {
        Ok(db) => Ok(db),
        Err(_) => {
            // A damaged OCR cache is disposable: images are read again.
            if path.exists() {
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
            init().map_err(|e| e.to_string())
        }
    }
}

/// Images of the active workspace and where each stands.
#[derive(Serialize, Default, Debug, Clone)]
pub struct Survey {
    pub read: usize,
    pub unreadable: usize,
    /// New images waiting to be read.
    pub waiting: usize,
    /// Images that were in the workspace before OCR; read only after Read now.
    pub backlog: usize,
    #[serde(skip)]
    next: Option<Next>,
}
/// The next image or page to read.
#[derive(Debug, Clone)]
struct Next {
    sha256: String,
    page: u32,
    path: PathBuf,
    language: String,
}

/// Looks at the active workspace's registered images. Holds the workspace lock
/// only while resolving asset paths, never while reading files.
fn survey(app: &AppHandle, state: &OcrState, blocking: bool) -> Result<Option<Survey>, String> {
    let app_state = app.state::<AppState>();
    let cache = app.state::<topic::TopicCache>();
    let language = state.language();
    let (identity, units): (String, Vec<(String, u32, PathBuf)>) = {
        let g = if blocking {
            app_state
                .workspace
                .lock()
                .map_err(|_| "Workspace lock unavailable")?
        } else {
            match app_state.workspace.try_lock() {
                Ok(g) => g,
                // A backup, restore or switch holds the workspace: wait.
                Err(_) => return Ok(None),
            }
        };
        let Ok(w) = g.as_ref() else {
            return Ok(Some(Survey::default()));
        };
        let identity = topic::identity(w)?;
        let db = topic::open(&topic::cache_path(&cache, &identity))?;
        let mut stmt = db
            .prepare("SELECT DISTINCT sha256,page FROM images ORDER BY page,sha256")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let units = rows
            .into_iter()
            .filter_map(|(hash, page)| {
                w.asset_path(&hash).ok().map(|path| (hash, page, path))
            })
            .collect();
        (identity, units)
    };
    let db = state.open()?;
    db.execute(
        "INSERT OR IGNORE INTO workspaces VALUES(?1,?2,0)",
        params![identity, now()],
    )
    .map_err(|e| e.to_string())?;
    let (since, backlog): (i64, bool) = db
        .query_row(
            "SELECT since,backlog FROM workspaces WHERE identity=?1",
            [&identity],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .map_err(|e| e.to_string())?;
    let mut survey = Survey::default();
    let Some(language) = language else {
        return Ok(Some(survey));
    };
    let mut done = std::collections::HashMap::new();
    {
        let mut stmt = db
            .prepare("SELECT sha256,page,state,failures FROM results WHERE engine=?1 AND language=?2")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![ENGINE, language], |r| {
                Ok((
                    (r.get::<_, String>(0)?, r.get::<_, u32>(1)?),
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            done.insert(row.0, (row.1, row.2));
        }
    }
    let mut created_at = std::collections::HashMap::new();
    for (hash, page, path) in units {
        match done.get(&(hash.clone(), page)) {
            Some((s, _)) if s == "read" => survey.read += 1,
            Some((s, f)) if s == "unreadable" || *f >= MAX_FAILURES => survey.unreadable += 1,
            _ => {
                // Assets added after OCR first saw this workspace are new;
                // older ones (and restored copies) wait for Read now.
                let created = *created_at.entry(hash.clone()).or_insert_with(|| {
                    std::fs::metadata(&path)
                        .and_then(|m| m.created())
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                });
                let Some(created) = created else {
                    continue;
                };
                if backlog || created >= since {
                    survey.waiting += 1;
                    if survey.next.is_none() {
                        survey.next = Some(Next {
                            sha256: hash,
                            page,
                            path,
                            language: language.clone(),
                        });
                    }
                } else {
                    survey.backlog += 1;
                }
            }
        }
    }
    Ok(Some(survey))
}

fn store(
    db: &Connection,
    sha256: &str,
    page: u32,
    language: &str,
    outcome: Result<Vec<Line>, String>,
) -> Result<(), String> {
    let previous: i64 = db
        .query_row(
            "SELECT failures FROM results WHERE sha256=?1 AND page=?2 AND engine=?3 AND language=?4",
            params![sha256, page, ENGINE, language],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);
    let (state, lines, failures) = match outcome {
        Ok(lines) if usable(&lines) => ("read", lines, previous),
        Ok(_) => ("unreadable", vec![], previous),
        Err(e) if e == "unsupported" || e == "small" || e == "too-large" => {
            ("unreadable", vec![], previous)
        }
        Err(_) if previous + 1 >= MAX_FAILURES => ("unreadable", vec![], previous + 1),
        Err(_) => ("failed", vec![], previous + 1),
    };
    db.execute(
        "INSERT OR REPLACE INTO results VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            sha256,
            page,
            ENGINE,
            language,
            state,
            serde_json::to_string(&lines).map_err(|e| e.to_string())?,
            failures,
            now()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Lets the search index pick up new readings: sources holding these images
/// are re-indexed on the renderer's next pass.
fn flush(app: &AppHandle, hashes: &mut HashSet<String>) {
    if hashes.is_empty() {
        return;
    }
    let app_state = app.state::<AppState>();
    let cache = app.state::<topic::TopicCache>();
    if let Ok(g) = app_state.workspace.lock() {
        if let Ok(w) = g.as_ref() {
            if let Ok(identity) = topic::identity(w) {
                if let Ok(db) = topic::open(&topic::cache_path(&cache, &identity)) {
                    for hash in hashes.iter() {
                        let _ = db.execute(
                            "DELETE FROM sources WHERE id IN (SELECT source FROM images WHERE sha256=?1)",
                            [hash],
                        );
                    }
                }
            }
        }
    }
    hashes.clear();
    let _ = app.emit("ocr-read", ());
}

#[cfg(windows)]
fn conditions(state: &OcrState, hold: bool, read_last_hour: usize) -> Conditions {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut power = SYSTEM_POWER_STATUS::default();
    // Unknown power status (255) counts as mains: desktops report no battery.
    let (on_mains, battery_saver) = if unsafe { GetSystemPowerStatus(&mut power) }.is_ok() {
        (power.ACLineStatus != 0, power.SystemStatusFlag == 1)
    } else {
        (true, false)
    };
    let mut input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // System-wide input: OCR also waits while the user works in other apps.
    let idle = if unsafe { GetLastInputInfo(&mut input) }.as_bool() {
        Duration::from_millis(unsafe { GetTickCount() }.wrapping_sub(input.dwTime) as u64)
    } else {
        Duration::ZERO
    };
    Conditions {
        on_mains,
        battery_saver,
        idle,
        app_busy: hold || state.ai.load(Ordering::SeqCst) > 0,
        read_last_hour,
    }
}
#[cfg(not(windows))]
fn conditions(state: &OcrState, hold: bool, read_last_hour: usize) -> Conditions {
    Conditions {
        on_mains: true,
        battery_saver: false,
        idle: Duration::MAX,
        app_busy: hold || state.ai.load(Ordering::SeqCst) > 0,
        read_last_hour,
    }
}

/// Lowest CPU and I/O priority, and Windows' efficiency mode (EcoQoS).
#[cfg(windows)]
fn background_thread() {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadInformation, SetThreadPriority, ThreadPowerThrottling,
        THREAD_MODE_BACKGROUND_BEGIN, THREAD_POWER_THROTTLING_CURRENT_VERSION,
        THREAD_POWER_THROTTLING_EXECUTION_SPEED, THREAD_POWER_THROTTLING_STATE,
    };
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
        let thread = GetCurrentThread();
        let _ = SetThreadPriority(thread, THREAD_MODE_BACKGROUND_BEGIN);
        let throttle = THREAD_POWER_THROTTLING_STATE {
            Version: THREAD_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: THREAD_POWER_THROTTLING_EXECUTION_SPEED,
            StateMask: THREAD_POWER_THROTTLING_EXECUTION_SPEED,
        };
        let _ = SetThreadInformation(
            thread,
            ThreadPowerThrottling,
            &throttle as *const _ as *const _,
            std::mem::size_of::<THREAD_POWER_THROTTLING_STATE>() as u32,
        );
    }
}

/// Reads an image (page 0) or one PDF page. The last file's bytes are kept,
/// so a scanned PDF isn't read from disk again for every page.
fn read_unit(path: &Path, page: u32, last: &mut Option<(PathBuf, Vec<u8>)>) -> Result<Vec<Line>, String> {
    if page > MAX_PAGES {
        return Err("too-large".into());
    }
    if last.as_ref().is_none_or(|(p, _)| p != path) {
        let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        if size > MAX_BYTES {
            return Err("too-large".into());
        }
        *last = Some((path.to_path_buf(), std::fs::read(path).map_err(|e| e.to_string())?));
    }
    let bytes = &last.as_ref().map(|(_, b)| b.as_slice()).unwrap_or_default();
    #[cfg(windows)]
    return if page == 0 {
        engine::read(bytes, MAX_SIDE)
    } else {
        engine::read_pdf_page(bytes, page, PAGE_PIXELS)
    }
    .map(|r| r.lines);
    #[cfg(not(windows))]
    {
        let _ = bytes;
        Err("unavailable".into())
    }
}

/// Pacing state of the background reader.
#[derive(Default)]
struct Pace {
    hour: VecDeque<Instant>,
    count: usize,
    stale: HashSet<String>,
    flushed: Option<Instant>,
    last_file: Option<(PathBuf, Vec<u8>)>,
    /// End of the current rest. Wake-ups (setting changes, the renderer's
    /// indexing hold) don't shorten it.
    rest_until: Option<Instant>,
}
impl Pace {
    fn flush(&mut self, app: &AppHandle) {
        flush(app, &mut self.stale);
        self.flushed = Some(Instant::now());
    }
    fn due(&self) -> bool {
        self.flushed.is_none_or(|t| t.elapsed() > FLUSH)
    }
}

/// One turn of the background reader; returns how long to wait before the next.
fn turn(app: &AppHandle, state: &OcrState, pace: &mut Pace) -> Duration {
    while pace
        .hour
        .front()
        .is_some_and(|t| t.elapsed() > Duration::from_secs(3600))
    {
        pace.hour.pop_front();
    }
    let Ok((config, hold)) = state.shared.lock().map(|s| (s.config, s.hold)) else {
        return Duration::from_secs(60);
    };
    // Workspace search off (or AI off) means no OCR either.
    let searching = app
        .state::<topic::TopicCache>()
        .1
        .lock()
        .map(|e| *e)
        .unwrap_or(false);
    let config = Config {
        enabled: config.enabled && searching,
        ..config
    };
    let available = !config.enabled || state.language().is_some();
    let set = |phase| {
        if let Ok(mut s) = state.shared.lock() {
            s.phase = Some(phase);
        }
    };
    let now = conditions(state, hold, pace.hour.len());
    if let Err((phase, wait)) = decide(config, available, now) {
        // Re-indexing costs the window some work: start it only while the
        // user is still away, never as they come back.
        if now.idle >= IDLE && !now.app_busy {
            pace.flush(app);
        }
        set(phase);
        return wait;
    }
    if let Some(until) = pace.rest_until {
        let left = until.saturating_duration_since(Instant::now());
        if !left.is_zero() {
            set(Phase::Resting);
            return left;
        }
    }
    let survey = match survey(app, state, false) {
        Ok(Some(s)) => s,
        Ok(None) => {
            set(Phase::AppBusy);
            return Duration::from_secs(5);
        }
        Err(_) => return Duration::from_secs(60),
    };
    let Some(next) = survey.next else {
        pace.last_file = None;
        pace.flush(app);
        set(Phase::Idle);
        return Duration::from_secs(30);
    };
    set(Phase::Reading);
    let started = Instant::now();
    let outcome = read_unit(&next.path, next.page, &mut pace.last_file);
    let took = started.elapsed();
    pace.hour.push_back(Instant::now());
    pace.count += 1;
    let read = outcome.as_ref().is_ok_and(|l| usable(l));
    if let Ok(db) = state.open() {
        if store(&db, &next.sha256, next.page, &next.language, outcome).is_ok() && read {
            pace.stale.insert(next.sha256);
        }
    }
    if pace.count.is_multiple_of(BATCH) || pace.due() {
        pace.flush(app);
    }
    set(Phase::Resting);
    let wait = rest(took, pace.count);
    pace.rest_until = Some(Instant::now() + wait);
    wait
}

/// Starts the background reader. One image at a time, paced by `decide` and `rest`.
pub fn spawn(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("knot-ocr".into())
        .spawn(move || {
            #[cfg(windows)]
            background_thread();
            let state = app.state::<OcrState>();
            if let Ok(db) = state.open() {
                let _ = db.execute("DELETE FROM results WHERE seen<?1", [now() - PRUNE_SECS]);
            }
            let mut pace = Pace::default();
            loop {
                let wait = turn(&app, &state, &mut pace);
                if let Ok(guard) = state.shared.lock() {
                    let _ = state.wake.wait_timeout(guard, wait);
                }
            }
        });
}

/// Asset hashes for images and PDF pages, as (unit, sha256).
pub fn hashes(w: &crate::storage::Workspace, units: &[Unit]) -> Vec<(Unit, String)> {
    units
        .iter()
        .filter(|u| u.page <= MAX_PAGES)
        .filter_map(|unit| {
            w.db.query_row("SELECT sha256 FROM attachments WHERE id=?1", [&unit.key], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .map(|hash| (unit.clone(), hash))
        })
        .collect()
}

/// Whether any of these units has a reading the caller didn't include.
pub fn missing_readings(state: &OcrState, hashes: &[(Unit, String)], included: &[Unit]) -> bool {
    if !state.enabled() {
        return false;
    }
    let Ok(db) = state.open() else {
        return false;
    };
    hashes.iter().any(|(unit, hash)| {
        !included.contains(unit) && state.reading(&db, hash, unit.page).is_some()
    })
}

#[tauri::command]
pub fn ocr_configure(
    app: AppHandle,
    state: State<'_, OcrState>,
    enabled: bool,
    battery: bool,
    paused: bool,
) -> Reply<()> {
    let changed = {
        let mut s = state.shared.lock().map_err(|_| "OCR state unavailable")?;
        let changed = s.config.enabled != enabled;
        s.config = Config {
            enabled,
            battery,
            paused,
        };
        changed
    };
    state.wake.notify_all();
    if changed {
        // Re-index every source with images so readings are added or removed.
        let app_state = app.state::<AppState>();
        let cache = app.state::<topic::TopicCache>();
        {
            let g = app_state
                .workspace
                .lock()
                .map_err(|_| "Workspace lock unavailable")?;
            if let Ok(w) = g.as_ref() {
                let db = topic::open(&topic::cache_path(&cache, &topic::identity(w)?))?;
                db.execute(
                    "DELETE FROM sources WHERE id IN (SELECT source FROM images)",
                    [],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        let _ = app.emit("ocr-read", ());
    }
    Ok(())
}

/// The renderer holds OCR while it indexes text.
#[tauri::command]
pub fn ocr_hold(state: State<'_, OcrState>, hold: bool) -> Reply<()> {
    state.shared.lock().map_err(|_| "OCR state unavailable")?.hold = hold;
    state.wake.notify_all();
    Ok(())
}

/// Readings for images and PDF pages of the active workspace (None: not read yet, or OCR is off).
#[tauri::command]
pub fn ocr_lookup(
    app_state: State<'_, AppState>,
    state: State<'_, OcrState>,
    activation: String,
    units: Vec<Unit>,
) -> Reply<Vec<Option<Vec<Line>>>> {
    if !state.enabled() || units.len() > 4096 {
        return Ok(vec![None; units.len()]);
    }
    let pairs = {
        let g = topic::guard(&app_state, &activation)?;
        let w = g.as_ref().map_err(Clone::clone)?;
        hashes(w, &units)
    };
    let db = state.open()?;
    Ok(units
        .iter()
        .map(|unit| {
            let hash = &pairs.iter().find(|(u, _)| u == unit)?.1;
            let lines = state.reading(&db, hash, unit.page)?;
            let _ = db.execute(
                "UPDATE results SET seen=?2 WHERE sha256=?1",
                params![hash, now()],
            );
            Some(lines)
        })
        .collect())
}

/// A Library search match in text OCR read from an image or a scanned page.
#[derive(Serialize, Debug)]
pub struct OcrMatch {
    document: String,
    key: String,
    page: u32,
    block: String,
    /// The attachment's file name.
    name: String,
    excerpt: String,
    /// Boxes of the matching lines, as image or page fractions.
    rects: Vec<[f32; 4]>,
}
/// Matches for `query` (case-insensitive, like Library search) in saved OCR
/// text of the active workspace's images and scanned pages. Nothing is read.
#[tauri::command]
pub fn ocr_search(
    app: AppHandle,
    state: State<'_, OcrState>,
    activation: String,
    query: String,
) -> Reply<Vec<OcrMatch>> {
    let needle = query.trim().to_lowercase();
    if !state.enabled() || needle.is_empty() || needle.chars().count() > 200 {
        return Ok(vec![]);
    }
    let app_state = app.state::<AppState>();
    let cache = app.state::<topic::TopicCache>();
    let rows: Vec<(String, String, u32, String, String, String)> = {
        let g = topic::guard(&app_state, &activation)?;
        let w = g.as_ref().map_err(Clone::clone)?;
        let db = topic::open(&topic::cache_path(&cache, &topic::identity(w)?))?;
        let mut stmt = db
            .prepare("SELECT source,key,page,sha256,block FROM images ORDER BY source,page")
            .map_err(|e| e.to_string())?;
        let found = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, u32>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        found
            .into_iter()
            .map(|(source, key, page, sha, block)| {
                let name = w
                    .db
                    .query_row("SELECT name FROM attachments WHERE id=?1", [&key], |r| r.get(0))
                    .unwrap_or_default();
                (source, key, page, sha, block, name)
            })
            .collect()
    };
    let db = state.open()?;
    let mut matches = Vec::new();
    for (document, key, page, sha, block, name) in rows {
        let Some(lines) = state.reading(&db, &sha, page) else {
            continue;
        };
        let hits: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.text.to_lowercase().contains(&needle))
            .map(|(i, _)| i)
            .collect();
        let Some(&first) = hits.first() else {
            continue;
        };
        // The first matching line with its neighbours, about 220 characters.
        let excerpt = lines[first.saturating_sub(1)..(first + 2).min(lines.len())]
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join(" · ")
            .chars()
            .take(220)
            .collect();
        let rects = hits
            .iter()
            .take(100)
            .map(|&i| {
                let l = &lines[i];
                let (x, y) = (l.x.clamp(0.0, 1.0), l.y.clamp(0.0, 1.0));
                [x, y, l.w.min(1.0 - x), l.h.min(1.0 - y)]
            })
            .filter(|r| r[2] > 0.0 && r[3] > 0.0)
            .collect();
        matches.push(OcrMatch {
            document,
            key,
            page,
            block,
            name,
            excerpt,
            rects,
        });
        if matches.len() >= 50 {
            break;
        }
    }
    Ok(matches)
}

/// Read images that were in the workspace before OCR (Settings → Read now).
#[tauri::command]
pub fn ocr_read_backlog(
    app_state: State<'_, AppState>,
    state: State<'_, OcrState>,
    activation: String,
) -> Reply<()> {
    let identity = {
        let g = topic::guard(&app_state, &activation)?;
        topic::identity(g.as_ref().map_err(Clone::clone)?)?
    };
    state
        .open()?
        .execute(
            "INSERT INTO workspaces VALUES(?1,?2,1) ON CONFLICT(identity) DO UPDATE SET backlog=1",
            params![identity, now()],
        )
        .map_err(|e| e.to_string())?;
    state.wake.notify_all();
    Ok(())
}

#[derive(Serialize)]
pub struct Status {
    phase: Phase,
    language: Option<String>,
    #[serde(flatten)]
    survey: Survey,
}
#[tauri::command]
pub async fn ocr_status(app: AppHandle) -> Reply<Status> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<OcrState>();
        let survey = survey(&app, &state, true)?.unwrap_or_default();
        let phase = state
            .shared
            .lock()
            .ok()
            .and_then(|s| s.phase)
            .unwrap_or(Phase::Idle);
        Ok(Status {
            phase: if state.enabled() { phase } else { Phase::Off },
            language: state.language(),
            survey,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod rules {
    use super::*;
    fn ok() -> Conditions {
        Conditions {
            on_mains: true,
            battery_saver: false,
            idle: Duration::from_secs(120),
            app_busy: false,
            read_last_hour: 0,
        }
    }
    const ON: Config = Config {
        enabled: true,
        battery: false,
        paused: false,
    };
    fn phase(config: Config, c: Conditions) -> Option<Phase> {
        decide(config, true, c).err().map(|e| e.0)
    }
    #[test]
    fn runs_only_when_every_rule_allows() {
        assert_eq!(phase(ON, ok()), None);
        assert_eq!(phase(Config::default(), ok()), Some(Phase::Off));
        assert_eq!(
            decide(ON, false, ok()).err().map(|e| e.0),
            Some(Phase::Unavailable)
        );
        assert_eq!(phase(Config { paused: true, ..ON }, ok()), Some(Phase::Paused));
    }
    #[test]
    fn waits_on_battery_unless_allowed() {
        let battery = Conditions { on_mains: false, ..ok() };
        let saver = Conditions { battery_saver: true, ..ok() };
        assert_eq!(phase(ON, battery), Some(Phase::Battery));
        assert_eq!(phase(ON, saver), Some(Phase::Battery));
        assert_eq!(phase(Config { battery: true, ..ON }, battery), None);
    }
    #[test]
    fn waits_for_an_idle_user_and_a_quiet_app() {
        let typing = Conditions { idle: Duration::from_secs(4), ..ok() };
        let (p, wait) = decide(ON, true, typing).unwrap_err();
        assert_eq!(p, Phase::UserActive);
        assert_eq!(wait, Duration::from_secs(27));
        assert_eq!(phase(ON, Conditions { idle: IDLE, ..ok() }), None);
        assert_eq!(phase(ON, Conditions { app_busy: true, ..ok() }), Some(Phase::AppBusy));
    }
    #[test]
    fn honours_the_hourly_ceiling() {
        assert_eq!(phase(ON, Conditions { read_last_hour: HOURLY - 1, ..ok() }), None);
        assert_eq!(phase(ON, Conditions { read_last_hour: HOURLY, ..ok() }), Some(Phase::Limit));
    }
    #[test]
    fn rests_as_long_as_it_worked_and_longer_every_batch() {
        assert_eq!(rest(Duration::from_millis(80), 1), MIN_REST);
        assert_eq!(rest(Duration::from_secs(2), 3), Duration::from_secs(2));
        assert_eq!(rest(Duration::from_millis(80), BATCH), BATCH_REST);
    }
    #[test]
    fn keeps_only_useful_text() {
        let line = |t: &str| Line { text: t.into(), x: 0.0, y: 0.0, w: 1.0, h: 0.1 };
        assert!(usable(&[line("Photosynthesis needs chlorophyll")]));
        assert!(!usable(&[line("a | ~ ;")]));
        assert!(!usable(&[line("Exit")]));
        assert!(!usable(&[line("%%% ### *** ok ok ok")]));
    }
    #[test]
    fn records_failures_then_gives_up() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SCHEMA).unwrap();
        let state = |db: &Connection| -> String {
            db.query_row("SELECT state FROM results", [], |r| r.get(0)).unwrap()
        };
        store(&db, "h", 0, "en", Err("engine error".into())).unwrap();
        assert_eq!(state(&db), "failed");
        store(&db, "h", 0, "en", Err("engine error".into())).unwrap();
        assert_eq!(state(&db), "unreadable");
        store(&db, "s", 0, "en", Err("small".into())).unwrap();
        // Pages of one PDF are separate results.
        store(&db, "p", 2, "en", Err("engine error".into())).unwrap();
        store(&db, "p", 3, "en", Err("engine error".into())).unwrap();
        let pages: i64 = db
            .query_row("SELECT count(*) FROM results WHERE sha256='p' AND state='failed'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pages, 2);
        let small: String = db
            .query_row("SELECT state FROM results WHERE sha256='s'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(small, "unreadable");
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../tests/fixtures")
                .join(name),
        )
        .unwrap()
    }
    fn mta() {
        unsafe {
            let _ = windows::Win32::System::WinRT::RoInitialize(
                windows::Win32::System::WinRT::RO_INIT_MULTITHREADED,
            );
        }
    }
    #[test]
    fn reads_printed_text() {
        mta();
        if engine::language().is_none() {
            eprintln!("skipped: no Windows OCR language pack on this machine");
            return;
        }
        let reading = engine::read(&fixture("ocr-text.png"), MAX_SIDE).unwrap();
        let text = reading
            .lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.contains("Photosynthesis"), "{text}");
        assert!(text.contains("chlorophyll"), "{text}");
        assert!(reading.lines.iter().all(|l| l.x >= 0.0 && l.x + l.w <= 1.01));
        let blank = engine::read(&fixture("ocr-blank.png"), MAX_SIDE).unwrap();
        assert!(blank.lines.is_empty());
        assert_eq!(
            engine::read(b"not an image", MAX_SIDE).unwrap_err(),
            "unsupported"
        );
    }
    #[test]
    fn reads_a_scanned_pdf_page() {
        mta();
        if engine::language().is_none() {
            eprintln!("skipped: no Windows OCR language pack on this machine");
            return;
        }
        let pdf = fixture("ocr-scan.pdf");
        let page = engine::read_pdf_page(&pdf, 2, PAGE_PIXELS).unwrap();
        let text = page
            .lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.contains("Ribosomes"), "{text}");
        // Boxes are page fractions: the image sits in the top part of the page.
        assert!(page.lines.iter().all(|l| l.y < 0.5 && l.x > 0.0));
        assert_eq!(
            engine::read_pdf_page(&pdf, 3, PAGE_PIXELS).unwrap_err(),
            "unsupported"
        );
        assert_eq!(
            engine::read_pdf_page(b"%PDF-broken", 1, PAGE_PIXELS).unwrap_err(),
            "unsupported"
        );
    }
}
