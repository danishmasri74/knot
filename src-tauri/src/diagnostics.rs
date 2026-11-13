//! Content-free, best-effort diagnostics. Never accept arbitrary JSON for persistence.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{sync_channel, SyncSender},
        Arc,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tokio::sync::oneshot;

const LIMIT: usize = 20_000;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Composition {
    #[serde(default)] pub workspace: bool,
    #[serde(default)] pub evidence_token_upper_bound: usize,
    #[serde(default)] pub workspace_indexed: usize,
    #[serde(default)] pub workspace_total: usize,
    pub context_bytes: usize,
    pub message_bytes: usize,
    pub messages: usize,
    pub prompt_bytes: usize,
    pub history_bytes: usize,
    pub payload_bytes: usize,
    pub instructions_bytes: usize,
    pub schema_bytes: usize,
    pub image_bytes: usize,
    pub pdf_bytes: usize,
    pub text_bytes: usize,
    pub structure_bytes: usize,
    pub citation_bytes: usize,
    pub surrounding_bytes: usize,
    pub runs_bytes: usize,
    pub added_bytes: usize,
    pub blocks: usize,
    pub citations: usize,
    pub added_notes: usize,
    pub runs: usize,
    pub pdf: bool,
    pub image: bool,
}
impl Composition {
    pub fn context(context: &str) -> Self {
        let mut result = Self {
            context_bytes: context.len(),
            ..Self::default()
        };
        if context.len() > 180_000 {
            return result;
        }
        if let Ok(v) = serde_json::from_str::<Value>(context) {
            let bytes = |key: &str| {
                v.get(key)
                    .and_then(|v| serde_json::to_vec(v).ok())
                    .map_or(0, |v| v.len())
            };
            let count = |key: &str| v[key].as_array().map_or(0, Vec::len);
            result.workspace = v["sourceMode"] == "workspace";
            if result.workspace {
                result.evidence_token_upper_bound=bytes("citationSources");
                result.workspace_indexed=v["coverage"]["indexed"].as_u64().unwrap_or(0) as usize;
                result.workspace_total=v["coverage"]["total"].as_u64().unwrap_or(0) as usize;
            }
            result.text_bytes = bytes("text");
            result.structure_bytes = bytes("structure");
            result.citation_bytes = bytes("citationSources");
            result.surrounding_bytes = bytes("surroundingReadOnly");
            result.runs_bytes = bytes("runs");
            result.added_bytes = bytes("addedNotes");
            result.blocks = count("structure");
            result.citations = count("citationSources");
            result.added_notes = count("addedNotes");
            result.runs = count("runs");
            result.pdf = v["sourceType"] == "pdf";
            result.image = v.get("attachedImage").is_some();
        }
        result
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Usage {
    pub input: Option<u64>,
    pub cached: Option<u64>,
    pub cache_write: Option<u64>,
    pub cache_write_30m: Option<u64>,
    pub cache_write_12h: Option<u64>,
    pub output: Option<u64>,
    pub reasoning: Option<u64>,
    pub total: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    Retry,
    Regeneration,
    EditedPrompt,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    pub parent: uuid::Uuid,
    pub kind: LinkKind,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    AnswerDisplayed,
    ProposalValid,
    ProposalInvalid,
    Apply,
    ApplyFailed,
    Dismiss,
    Undo,
    UndoFailed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attempt {
    pub id: uuid::Uuid,
    pub model: String,
    pub operation: String,
    pub started: u64,
    pub link: Option<Link>,
    pub composition: Composition,
    pub usage: Usage,
    pub status: String,
    pub failure: Option<String>,
    pub http_status: Option<u16>,
    pub elapsed_ms: Option<u64>,
    pub first_delta_ms: Option<u64>,
    pub response_bytes: usize,
    pub pricing_version: String,
    pub cost_usd: Option<f64>,
    pub service_tier: Option<String>,
}
pub struct Measurement {
    pub attempt: Attempt,
    start: Instant,
    epoch: u64,
    enabled: bool,
}
impl Measurement {
    pub fn collecting(&self) -> bool {
        self.enabled
    }
    pub fn new(
        store: &Diagnostics,
        id: &str,
        model: &str,
        operation: &str,
        link: Option<Link>,
        composition: Composition,
    ) -> Self {
        Self {
            start: Instant::now(),
            epoch: store.epoch.load(Ordering::SeqCst),
            enabled: store.enabled.load(Ordering::SeqCst),
            attempt: Attempt {
                id: uuid::Uuid::parse_str(id).unwrap_or_else(|_| uuid::Uuid::new_v4()),
                model: if crate::ai::MODELS.contains(&model) {
                    model.into()
                } else {
                    "unknown".into()
                },
                operation: if ["ask", "auto", "rewrite", "insert", "canvas"].contains(&operation) {
                    operation.into()
                } else {
                    "unknown".into()
                },
                started: now(),
                link,
                composition,
                usage: Usage::default(),
                status: "running".into(),
                failure: None,
                http_status: None,
                elapsed_ms: None,
                first_delta_ms: None,
                response_bytes: 0,
                pricing_version: PRICING_VERSION.into(),
                cost_usd: None,
                service_tier: None,
            },
        }
    }
    pub fn frame(&mut self, frame: &[u8]) {
        if !self.enabled {
            return;
        }
        // Parse transiently; retain only allowlisted numeric fields, never provider errors/text/IDs.
        let Ok(s) = std::str::from_utf8(frame) else {
            return;
        };
        let data = s
            .lines()
            .filter_map(|l| l.strip_prefix("data:").map(str::trim_start))
            .collect::<Vec<_>>()
            .join("\n");
        let Ok(v) = serde_json::from_str::<Value>(&data) else {
            return;
        };
        if v["type"] == "response.output_text.delta" {
            if let Some(s) = v["delta"].as_str().filter(|s| !s.is_empty()) {
                self.attempt
                    .first_delta_ms
                    .get_or_insert(self.start.elapsed().as_millis() as u64);
                self.attempt.response_bytes += s.len();
            }
        }
        if let Some((usage, tier)) = usage_from(&v) {
            self.attempt.usage = usage;
            self.attempt.service_tier = tier;
        }
    }
    pub fn save(&self, store: &Diagnostics) {
        if self.enabled {
            store.record(self.epoch, self.attempt.clone());
        }
    }
    pub fn finish(&mut self, store: &Diagnostics, result: &Result<(), String>) {
        self.attempt.elapsed_ms = Some(self.start.elapsed().as_millis() as u64);
        self.attempt.status = match result {
            Ok(()) => "completed",
            Err(e) if e == "Request stopped" => "cancelled",
            _ => "failed",
        }
        .into();
        self.attempt.failure = result.as_ref().err().map(|e| {
            match e.as_str() {
                "Request stopped" => "cancelled",
                "Conversation closed" => "channel_closed",
                s if s.contains("API key") || s.contains("Credential") => "credentials",
                s if s.contains("too large")
                    || s.contains("Unsupported")
                    || s.contains("invalid") =>
                {
                    "validation"
                }
                s if s.contains("limit") => "limit_or_incomplete",
                s if s.contains("connection") || s.contains("Connection") => "connection",
                _ => "request_failed",
            }
            .into()
        });
        self.attempt.cost_usd = estimate(
            &self.attempt.model,
            &self.attempt.usage,
            self.attempt.service_tier.as_deref(),
        );
        self.save(store);
    }
}
/// Usage and service tier from a final response event (completed, failed or
/// incomplete), keeping only allowlisted numeric fields and known tier names.
pub fn usage_from(v: &Value) -> Option<(Usage, Option<String>)> {
    if !matches!(
        v["type"].as_str(),
        Some("response.completed" | "response.failed" | "response.incomplete")
    ) {
        return None;
    }
    let u = &v["response"]["usage"];
    let usage = Usage {
        input: u["input_tokens"].as_u64(),
        cached: u["input_tokens_details"]["cached_tokens"].as_u64(),
        cache_write: u["input_tokens_details"]["cache_write_tokens"].as_u64(),
        cache_write_30m: u["input_tokens_details"]["cache_write_tokens_details"]["ttl_30m_tokens"]
            .as_u64(),
        cache_write_12h: u["input_tokens_details"]["cache_write_tokens_details"]["ttl_12h_tokens"]
            .as_u64(),
        output: u["output_tokens"].as_u64(),
        reasoning: u["output_tokens_details"]["reasoning_tokens"].as_u64(),
        total: u["total_tokens"].as_u64(),
    };
    let tier = v["response"]["service_tier"].as_str().map(|s| {
        if ["default", "standard", "auto", "flex", "priority", "fast"].contains(&s) {
            s.to_owned()
        } else {
            "unknown".into()
        }
    });
    Some((usage, tier))
}
/// What one request cost, shown beside the answer in Ask Knot. `usd` is None
/// when the provider's usage or tier cannot be priced exactly.
#[derive(Clone, Debug, Serialize)]
pub struct Cost {
    pub usd: Option<f64>,
    pub input: Option<u64>,
    pub cached: Option<u64>,
    pub output: Option<u64>,
    pub reasoning: Option<u64>,
    pub tier: Option<String>,
    pub pricing: &'static str,
}
/// The cost carried by a final SSE frame, independent of diagnostics settings.
pub fn cost_from_frame(model: &str, frame: &[u8]) -> Option<Cost> {
    // Only final events carry usage; skip parsing every text delta.
    if !frame.windows(7).any(|w| w == b"\"usage\"") {
        return None;
    }
    let data = std::str::from_utf8(frame)
        .ok()?
        .lines()
        .filter_map(|l| l.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("
");
    let (usage, tier) = usage_from(&serde_json::from_str::<Value>(&data).ok()?)?;
    Some(Cost {
        usd: estimate(model, &usage, tier.as_deref()),
        input: usage.input,
        cached: usage.cached,
        output: usage.output,
        reasoning: usage.reasoning,
        tier,
        pricing: PRICING_VERSION,
    })
}
/// v3 (13 November 2026): prices re-verified against the OpenAI pricing page;
/// requests above 272K input tokens use the published long-context rates
/// (none are published for GPT-5.4 mini, so those stay unknown).
/// v2 (11 November 2026): same prices as v1; positive GPT-6 cache writes without a
/// lifetime breakdown are priced as 30-minute writes (Knot never requests 12h).
pub const PRICING_VERSION: &str = "openai-standard-2026-11-13-v3";
// Standard short-context USD per million tokens. Reasoning is included in output;
// cached tokens are a subset of input. Unknown cache breakdown/tier remains unknown.
pub fn estimate(model: &str, u: &Usage, tier: Option<&str>) -> Option<f64> {
    if !matches!(tier, Some("default" | "standard")) {
        return None;
    }
    let (i, c, o) = (u.input?, u.cached?, u.output?);
    if c > i {
        return None;
    }
    let long = i > 272_000;
    let (input, cached, output) = match (model, long) {
        ("gpt-6-luna", false) => (0.10, 0.01, 0.50),
        ("gpt-6-luna", true) => (0.20, 0.02, 0.75),
        ("gpt-6.1-terra", false) => (1.0, 0.05, 5.0),
        ("gpt-6.1-terra", true) => (2.0, 0.10, 7.50),
        ("gpt-6.1-sol", false) => (2.0, 0.10, 10.0),
        ("gpt-6.1-sol", true) => (4.0, 0.20, 15.0),
        ("gpt-6-astra", false) => (10.0, 1.0, 50.0),
        ("gpt-6-astra", true) => (20.0, 2.0, 75.0),
        ("gpt-5.4-mini", false) => (0.75, 0.075, 4.50),
        ("gpt-5.4", false) => (2.50, 0.25, 15.0),
        ("gpt-5.4", true) => (5.0, 0.50, 22.50),
        _ => return None,
    };
    let (write, w30, w12) = if model.starts_with("gpt-6") {
        let write = u.cache_write?;
        if write == 0 {
            // A reported zero total proves both nonnegative subsets are zero.
            // Preserve raw missing fields in diagnostics; only pricing derives zero.
            (
                write,
                u.cache_write_30m.unwrap_or(0),
                u.cache_write_12h.unwrap_or(0),
            )
        } else if u.cache_write_30m.is_none() && u.cache_write_12h.is_none() {
            // Requests never set a 12-hour TTL, so writes use the 30-minute default.
            // A partial breakdown is still treated as unknown.
            (write, write, 0)
        } else {
            (write, u.cache_write_30m?, u.cache_write_12h?)
        }
    } else {
        (0, 0, 0)
    };
    if w30.checked_add(w12)? != write || c.checked_add(write)? > i {
        return None;
    }
    Some(
        ((i - c - write) as f64 * input
            + c as f64 * cached
            + w30 as f64 * input * 1.25
            + w12 as f64 * input * 2.5
            + o as f64 * output)
            / 1_000_000.0,
    )
}

enum Work {
    Record(u64, Attempt),
    Outcome(u64, uuid::Uuid, Outcome),
    Control(Control, oneshot::Sender<Result<Value, String>>),
}
enum Control {
    Read,
    Enabled(bool),
    Clear,
}
pub struct Diagnostics {
    tx: SyncSender<Work>,
    enabled: Arc<AtomicBool>,
    epoch: Arc<AtomicU64>,
    dropped: Arc<AtomicU64>,
    failed: Arc<AtomicU64>,
}
impl Diagnostics {
    pub fn collecting(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }
    #[cfg(test)]
    pub(crate) fn test_enabled(&self, value: bool) {
        self.enabled.store(value, Ordering::SeqCst);
    }
    pub fn open(path: PathBuf) -> Self {
        let (tx, rx) = sync_channel::<Work>(256);
        let enabled = Arc::new(AtomicBool::new(false));
        let epoch = Arc::new(AtomicU64::new(0));
        let failed = Arc::new(AtomicU64::new(0));
        let store = Self {
            tx,
            enabled: enabled.clone(),
            epoch: epoch.clone(),
            dropped: Arc::new(AtomicU64::new(0)),
            failed: failed.clone(),
        };
        let _ = std::thread::Builder::new().name("knot-ai-diagnostics".into()).spawn(move || {
            let mut db = open_db(&path).ok();
            if let Some(db) = &db {
                enabled.store(
                    db.query_row("SELECT enabled FROM settings", [], |r| r.get(0))
                        .unwrap_or(false),
                    Ordering::SeqCst,
                );
                let _ = prune(db);
                let _ = db.execute("UPDATE attempts SET data=json_set(data,'$.status','interrupted') WHERE json_extract(data,'$.status')='running'", []);
            } else {
                failed.fetch_add(1, Ordering::Relaxed);
            }
            while let Ok(work) = rx.recv() {
                match work {
                    Work::Record(generation, attempt) => {
                        if enabled.load(Ordering::SeqCst)
                            && epoch.load(Ordering::SeqCst) == generation
                        {
                            let result = db
                                .as_ref()
                                .ok_or(())
                                .and_then(|db| write_attempt(db, &attempt).map_err(|_| ()));
                            if result.is_err() {
                                failed.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                    Work::Outcome(generation, id, outcome) => {
                        if enabled.load(Ordering::SeqCst)
                            && epoch.load(Ordering::SeqCst) == generation
                        {
                            let result = db.as_ref().ok_or(()).and_then(|db| db.execute("INSERT OR IGNORE INTO outcomes SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM attempts WHERE id=?1)", params![id.to_string(), serde_json::to_string(&outcome).unwrap_or_default().trim_matches('"'), now()]).map_err(|_| ()));
                            if result.is_err() {
                                failed.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                    Work::Control(control, reply) => {
                        if db.is_none() {
                            db = open_db(&path).ok();
                        }
                        let result = (|| -> Result<Value, String> {
                            let db = db
                                .as_ref()
                                .ok_or("Diagnostics storage is unavailable. AI is unaffected.")?;
                            match control {
                                Control::Enabled(value) => {
                                    // Invalidate in-flight observations on both transitions.
                                    epoch.fetch_add(1, Ordering::SeqCst);
                                    enabled.store(false, Ordering::SeqCst);
                                    db.execute("UPDATE settings SET enabled=?1", [value])
                                        .map_err(|_| "Could not save collection preference")?;
                                    enabled.store(value, Ordering::SeqCst);
                                }
                                Control::Clear => {
                                    epoch.fetch_add(1, Ordering::SeqCst);
                                    db.execute_batch(
                                        "DELETE FROM outcomes; DELETE FROM attempts; VACUUM;",
                                    )
                                    .map_err(|_| "Could not clear diagnostics")?;
                                }
                                Control::Read => {}
                            }
                            snapshot(db).map_err(|_| "Could not read diagnostics".into())
                        })();
                        let _ = reply.send(result);
                    }
                }
            }
        });
        store
    }
    fn record(&self, epoch: u64, attempt: Attempt) {
        if self.tx.try_send(Work::Record(epoch, attempt)).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
    async fn control(&self, control: Control) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .try_send(Work::Control(control, tx))
            .map_err(|_| "Diagnostics queue is busy; try again")?;
        let mut value = rx.await.map_err(|_| "Diagnostics worker unavailable")??;
        value["dropped"] = self.dropped.load(Ordering::Relaxed).into();
        value["write_failures"] = self.failed.load(Ordering::Relaxed).into();
        Ok(value)
    }
}
fn open_db(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let db = Connection::open(path)?;
    db.busy_timeout(std::time::Duration::from_millis(100))?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
        CREATE TABLE IF NOT EXISTS settings(enabled INTEGER NOT NULL);
        INSERT INTO settings SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM settings);
        CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, started INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS attempts_started ON attempts(started);
        CREATE TABLE IF NOT EXISTS outcomes(attempt TEXT REFERENCES attempts(id) ON DELETE CASCADE, kind TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(attempt,kind));
        PRAGMA user_version=1;")?;
    Ok(db)
}
fn prune(db: &Connection) -> rusqlite::Result<()> {
    db.execute("DELETE FROM attempts WHERE started < ?1 OR id IN (SELECT id FROM attempts ORDER BY started DESC, rowid DESC LIMIT -1 OFFSET ?2)", params![now().saturating_sub(90*86400), LIMIT])?;
    Ok(())
}
fn write_attempt(db: &Connection, attempt: &Attempt) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO attempts VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        params![
            attempt.id.to_string(),
            attempt.started,
            serde_json::to_string(attempt).unwrap()
        ],
    )?;
    prune(db)
}
fn snapshot(db: &Connection) -> rusqlite::Result<Value> {
    prune(db)?;
    let attempts = db
        .prepare("SELECT data FROM attempts ORDER BY started DESC, rowid DESC")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let outcomes = db.prepare("SELECT attempt,kind,at FROM outcomes ORDER BY at")?.query_map([], |r| Ok(serde_json::json!({"attempt":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"at":r.get::<_,u64>(2)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(
        serde_json::json!({"schema_version":1,"enabled":db.query_row("SELECT enabled FROM settings",[],|r|r.get::<_,bool>(0))?,"attempts":attempts.iter().filter_map(|s|serde_json::from_str::<Value>(s).ok()).collect::<Vec<_>>(),"outcomes":outcomes}),
    )
}
#[tauri::command]
pub async fn ai_diagnostics(state: State<'_, Diagnostics>) -> Result<Value, String> {
    state.control(Control::Read).await
}
#[tauri::command]
pub async fn ai_diagnostics_enabled(
    state: State<'_, Diagnostics>,
    enabled: bool,
) -> Result<Value, String> {
    state.control(Control::Enabled(enabled)).await
}
#[tauri::command]
pub async fn ai_diagnostics_clear(state: State<'_, Diagnostics>) -> Result<Value, String> {
    state.control(Control::Clear).await
}
#[tauri::command]
pub fn ai_diagnostics_outcome(state: State<'_, Diagnostics>, id: String, outcome: Outcome) {
    if !state.enabled.load(Ordering::SeqCst) {
        return;
    }
    if let Ok(id) = uuid::Uuid::parse_str(&id) {
        if state
            .tx
            .try_send(Work::Outcome(
                state.epoch.load(Ordering::SeqCst),
                id,
                outcome,
            ))
            .is_err()
        {
            state.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}
#[tauri::command]
pub async fn ai_diagnostics_export(state: State<'_, Diagnostics>) -> Result<bool, String> {
    let data = state.control(Control::Read).await?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("JSON", &["json"])
        .set_file_name("knot-ai-diagnostics.json")
        .save_file()
        .await
    else {
        return Ok(false);
    };
    std::fs::write(
        file.path(),
        serde_json::to_vec_pretty(&data).map_err(|_| "Could not encode diagnostics")?,
    )
    .map_err(|_| "Could not export diagnostics")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    #[test]
    fn pricing_subsets_and_unknowns() {
        let mut u = Usage {
            input: Some(1000),
            cached: Some(200),
            output: Some(100),
            reasoning: Some(70),
            total: Some(1100),
            ..Usage::default()
        };
        assert!((estimate("gpt-5.4-mini", &u, Some("default")).unwrap() - 0.001065).abs() < 1e-10);
        u.reasoning = Some(99);
        u.total = Some(9000);
        assert_eq!(
            estimate("gpt-5.4-mini", &u, Some("default")),
            Some(0.001065)
        );
        assert!(estimate("gpt-5.4-mini", &u, None).is_none());
        assert!(estimate("gpt-5.4-mini", &u, Some("priority")).is_none());
        u.cached = None;
        assert!(estimate("gpt-5.4-mini", &u, Some("default")).is_none());
        u.cached = Some(2000);
        assert!(estimate("gpt-5.4-mini", &u, Some("default")).is_none());
        let u = Usage {
            input: Some(12000),
            cached: Some(4000),
            cache_write: Some(7000),
            cache_write_30m: Some(3000),
            cache_write_12h: Some(4000),
            output: Some(100),
            ..Usage::default()
        };
        // Terra: 1000 ordinary + 4000*.05 + 3000*1.25 + 4000*2.5 + 100*5.
        assert!((estimate("gpt-6.1-terra", &u, Some("default")).unwrap() - 0.01545).abs() < 1e-10);
        assert!(estimate(
            "gpt-6.1-terra",
            &Usage {
                cache_write_12h: None,
                ..u
            },
            Some("default")
        )
        .is_none());
    }
    #[test]
    fn reported_zero_cache_writes_do_not_require_lifetime_breakdown() {
        let mut usage = Usage {
            input: Some(702),
            output: Some(13),
            cached: Some(0),
            cache_write: Some(0),
            ..Usage::default()
        };
        assert!(
            (estimate("gpt-6-luna", &usage, Some("default")).unwrap() - 0.0000767).abs() < 1e-12
        );
        usage.cache_write = None;
        assert!(estimate("gpt-6-luna", &usage, Some("default")).is_none());
        // Positive writes without any breakdown are 30-minute writes (1.25x input).
        usage.cache_write = Some(700);
        assert!(
            (estimate("gpt-6-luna", &usage, Some("default")).unwrap()
                - (2.0 * 0.10 + 700.0 * 0.10 * 1.25 + 13.0 * 0.50) / 1_000_000.0)
                .abs()
                < 1e-12
        );
        usage.cache_write = Some(703);
        assert!(estimate("gpt-6-luna", &usage, Some("default")).is_none());
        usage.cache_write = Some(0);
        usage.cache_write_30m = Some(1);
        assert!(estimate("gpt-6-luna", &usage, Some("default")).is_none());
    }
    #[test]
    fn workspace_backups_exclude_device_diagnostics() {
        let dir = tempfile::tempdir().unwrap();
        let db = open_db(&dir.path().join("ai-diagnostics.sqlite")).unwrap();
        let workspace = crate::storage::Workspace::open(dir.path().join("workspace")).unwrap();
        let archive = dir.path().join("export.knot");
        crate::backup::export(&workspace, &archive).unwrap();
        let zip = zip::ZipArchive::new(std::fs::File::open(archive).unwrap()).unwrap();
        assert!(zip.file_names().all(|name| !name.contains("diagnostic")));
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn cancelled_attempt_retains_only_reported_usage_and_link() {
        runtime().block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let store = Diagnostics::open(dir.path().join("diagnostics"));
            store.control(Control::Enabled(true)).await.unwrap();
            let parent = uuid::Uuid::new_v4();
            let mut m = Measurement::new(
                &store,
                &uuid::Uuid::new_v4().to_string(),
                "gpt-5.4",
                "ask",
                Some(Link {
                    parent,
                    kind: LinkKind::Regeneration,
                }),
                Composition::default(),
            );
            m.frame(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}");
            m.finish(&store, &Err("Request stopped".into()));
            let snapshot = store.control(Control::Read).await.unwrap();
            let a = &snapshot["attempts"][0];
            assert_eq!(a["status"], "cancelled");
            assert_eq!(a["link"]["parent"], parent.to_string());
            assert!(a["cost_usd"].is_null());
            assert!(a["usage"]["input"].is_null());
            assert_eq!(a["response_bytes"], 7);
        });
    }
    #[test]
    fn privacy_stream_usage_and_clear_inflight() {
        runtime().block_on(async {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("diagnostics.sqlite");
        let store = Diagnostics::open(path.clone()); store.control(Control::Enabled(true)).await.unwrap();
        let secret = "PRIVATE_SENTINEL sk-secret C:\\private\\note.pdf";
        let context = serde_json::json!({"title":secret,"text":secret,"structure":[{"text":secret}],"citationSources":[{"text":secret}],"addedNotes":[{"title":secret}]}).to_string();
        let mut m = Measurement::new(&store, &uuid::Uuid::new_v4().to_string(),"gpt-5.4-mini","ask",None,Composition::context(&context));
        m.save(&store);
        m.frame(format!("data: {}",serde_json::json!({"type":"response.output_text.delta","delta":secret})).as_bytes());
        m.frame(b"data: {\"type\":\"response.completed\",\"response\":{\"service_tier\":\"default\",\"usage\":{\"input_tokens\":100,\"input_tokens_details\":{\"cached_tokens\":0},\"output_tokens\":10,\"output_tokens_details\":{\"reasoning_tokens\":2},\"total_tokens\":110}}}");
        m.finish(&store, &Ok(()));
        let snapshot = store.control(Control::Read).await.unwrap();
        assert_eq!(snapshot["attempts"].as_array().unwrap().len(),1);
        assert_eq!(snapshot["attempts"][0]["usage"]["input"],100);
        assert!(!snapshot.to_string().contains("PRIVATE_SENTINEL"));
        assert!(!String::from_utf8_lossy(&std::fs::read(&path).unwrap()).contains("PRIVATE_SENTINEL"));
        store.control(Control::Clear).await.unwrap();
        m.finish(&store, &Ok(()));
        assert_eq!(store.control(Control::Read).await.unwrap()["attempts"],serde_json::json!([]));
        store.control(Control::Enabled(false)).await.unwrap();
        let mut m = Measurement::new(&store, "invalid", "secret", "secret",None,Composition::default());
        m.finish(&store, &Err(secret.into()));
        assert_eq!(store.control(Control::Read).await.unwrap()["attempts"],serde_json::json!([]));
    });
    }
    #[test]
    fn bounded_queue_and_storage_failure_never_block_ai() {
        let (tx, _rx) = sync_channel(2);
        let store = Diagnostics {
            tx,
            enabled: Arc::new(AtomicBool::new(true)),
            epoch: Arc::new(AtomicU64::new(0)),
            dropped: Arc::new(AtomicU64::new(0)),
            failed: Arc::new(AtomicU64::new(0)),
        };
        let start = Instant::now();
        for _ in 0..10000 {
            let mut m = Measurement::new(
                &store,
                "invalid",
                "gpt-5.4",
                "ask",
                None,
                Composition::default(),
            );
            m.finish(&store, &Ok(()));
        }
        assert_eq!(store.dropped.load(Ordering::Relaxed), 9998);
        assert!(
            start.elapsed().as_secs() < 3,
            "bounded nonblocking enqueue regression"
        );
        runtime().block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let store = Diagnostics::open(dir.path().to_owned()); // A directory cannot be opened as SQLite.
            assert!(store.control(Control::Read).await.is_err());
            let mut m = Measurement::new(
                &store,
                "invalid",
                "gpt-5.4",
                "ask",
                None,
                Composition::default(),
            );
            m.finish(&store, &Ok(())); // Does not propagate the storage failure.
        });
    }
    #[test]
    fn retention_outcomes_and_upsert_do_not_double_count() {
        let db = open_db(std::path::Path::new(":memory:")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let store = Diagnostics::open(dir.path().join("store"));
        let m = Measurement::new(
            &store,
            "invalid",
            "gpt-5.4",
            "ask",
            None,
            Composition::default(),
        );
        write_attempt(&db, &m.attempt).unwrap();
        write_attempt(&db, &m.attempt).unwrap();
        db.execute(
            "INSERT INTO outcomes VALUES(?1,'apply',?2)",
            params![m.attempt.id.to_string(), now()],
        )
        .unwrap();
        assert_eq!(
            snapshot(&db).unwrap()["attempts"].as_array().unwrap().len(),
            1
        );
        db.execute("UPDATE attempts SET started=?1", [now() - 91 * 86400])
            .unwrap();
        prune(&db).unwrap();
        assert_eq!(snapshot(&db).unwrap()["outcomes"], serde_json::json!([]));
        db.execute_batch("BEGIN").unwrap();
        for i in 0..20_010 {
            db.execute(
                "INSERT INTO attempts VALUES(?1,?2,'{}')",
                params![i.to_string(), now()],
            )
            .unwrap();
        }
        db.execute_batch("COMMIT").unwrap();
        prune(&db).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM attempts", [], |r| r
                .get::<_, usize>(0))
                .unwrap(),
            LIMIT
        );
    }
    #[test]
    fn cost_frames_price_short_and_long_context_from_published_rates() {
        let frame = |input: u64| format!("data: {{\"type\":\"response.completed\",\"response\":{{\"service_tier\":\"default\",\"usage\":{{\"input_tokens\":{input},\"input_tokens_details\":{{\"cached_tokens\":1000,\"cache_write_tokens\":0}},\"output_tokens\":2000,\"output_tokens_details\":{{\"reasoning_tokens\":500}},\"total_tokens\":0}}}}}}");
        let close = |a: f64, b: f64| (a - b).abs() < 1e-12;
        // Sol, short context: 9,000 input at $2, 1,000 cached at $0.10, 2,000 output at $10.
        let short = cost_from_frame("gpt-6.1-sol", frame(10_000).as_bytes()).unwrap();
        assert!(close(short.usd.unwrap(), (9_000.0 * 2.0 + 1_000.0 * 0.10 + 2_000.0 * 10.0) / 1e6));
        assert_eq!((short.reasoning, short.cached), (Some(500), Some(1000)));
        assert_eq!(short.pricing, PRICING_VERSION);
        // Above 272K input tokens the long-context rates apply.
        let long = cost_from_frame("gpt-6.1-sol", frame(300_000).as_bytes()).unwrap();
        assert!(close(long.usd.unwrap(), (299_000.0 * 4.0 + 1_000.0 * 0.20 + 2_000.0 * 15.0) / 1e6));
        // GPT-5.4 mini publishes no long-context rate: unknown, not guessed.
        assert!(cost_from_frame("gpt-5.4-mini", frame(300_000).as_bytes()).unwrap().usd.is_none());
        assert!(cost_from_frame("gpt-6.1-sol", b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"x\"}").is_none());
    }

}
