//! Disposable retrieval cache. No workspace data is ever written through this module.
use crate::{storage::Workspace, AppState, Reply};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;
const FORMAT: i64 = 3;
pub struct TopicCache(
    pub PathBuf,
    pub Mutex<bool>,
    pub Mutex<std::collections::HashMap<String, std::sync::Arc<tokio::sync::Notify>>>,
);
impl TopicCache {
    pub fn register(&self, id: &str, cancel: std::sync::Arc<tokio::sync::Notify>) -> Reply<()> {
        let enabled = self.1.lock().map_err(|_| "Search state unavailable")?;
        if !*enabled {
            return Err("Workspace search is disabled".into());
        }
        self.2
            .lock()
            .map_err(|_| "Search requests unavailable")?
            .insert(id.into(), cancel);
        Ok(())
    }
    pub fn unregister(&self, id: &str) {
        if let Ok(mut pending) = self.2.lock() {
            pending.remove(id);
        }
    }
    fn enabled(&self, value: bool) -> Reply<()> {
        let mut enabled = self.1.lock().map_err(|_| "Search state unavailable")?;
        *enabled = value;
        if !value {
            for cancel in self
                .2
                .lock()
                .map_err(|_| "Search requests unavailable")?
                .values()
            {
                cancel.notify_one();
            }
        }
        Ok(())
    }
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Source {
    pub id: String,
    pub title: String,
    pub revision: String,
}
#[derive(Serialize)]
pub struct Catalog {
    pub activation: String,
    pub workspace: String,
    pub sources: Vec<Source>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Passage {
    pub document: String,
    pub id: String,
    pub title: String,
    pub text: String,
    pub revision: String,
    #[serde(default)]
    pub vector: Vec<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<String>,
}
#[derive(Serialize)]
pub struct Search {
    pub passages: Vec<Passage>,
    pub indexed: usize,
    pub total: usize,
    pub failed: usize,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn identity(w: &Workspace) -> Result<String, String> {
    let path = w.root.canonicalize().map_err(|e| e.to_string())?;
    let manifest = std::fs::read(w.root.join("workspace.json")).map_err(|e| e.to_string())?;
    let created = std::fs::metadata(w.root.join("knot.db"))
        .ok()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|t| t.as_nanos())
        .unwrap_or(0);
    Ok(hash(
        format!("{}:{}:{created}", path.display(), hash(&manifest)).as_bytes(),
    ))
}
fn catalog(w: &Workspace) -> Result<Vec<Source>, String> {
    let mut stmt = w.db.prepare("SELECT o.id,o.title,CAST(coalesce(d.revision,0) AS TEXT)||':'||CAST(o.updated_at AS TEXT) FROM objects o LEFT JOIN documents d ON d.object_id=o.id WHERE o.deleted_at IS NULL ORDER BY o.id").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Source {
                id: r.get(0)?,
                title: r.get(1)?,
                revision: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut sources = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let data = deck(w)?;
    for (id, card) in data.as_object().ok_or("Invalid deck")? {
        if card["deleted"] == true {
            continue;
        }
        sources.push(Source {
            id: format!("deck:{id}"),
            title: "Card Deck".into(),
            revision: deck_revision(card, &data),
        });
    }
    sources.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(sources)
}
fn deck(w: &Workspace) -> Result<serde_json::Value, String> {
    let text: String =
        w.db.query_row("SELECT content FROM card_deck WHERE id=1", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}
fn referenced_questions(card: &serde_json::Value, data: &serde_json::Value) -> serde_json::Value {
    fn collect(
        nodes: &serde_json::Value,
        data: &serde_json::Value,
        questions: &mut serde_json::Map<String, serde_json::Value>,
    ) {
        if let Some(nodes) = nodes.as_array() {
            for node in nodes {
                if node["props"]["sys:flavour"]["value"] == "knot:mcq-reference" {
                    if let Some(id) = node["props"]["prop:cardId"]["value"].as_str() {
                        if let Some(card) = data.get(id) {
                            if card["deleted"] != true {
                                questions.insert(id.to_owned(), card.clone());
                            }
                        }
                    }
                }
                collect(&node["children"], data, questions);
            }
        }
    }
    let mut questions = serde_json::Map::new();
    collect(&card["nodes"], data, &mut questions);
    serde_json::Value::Object(questions)
}
fn deck_revision(card: &serde_json::Value, data: &serde_json::Value) -> String {
    let questions = referenced_questions(card, data);
    hash(format!("mcq:1:{card}:{questions}").as_bytes())
}
fn source(w: &Workspace, id: &str) -> Result<Option<Source>, String> {
    if let Some(card_id) = id.strip_prefix("deck:") {
        let data = deck(w)?;
        let card = &data[card_id];
        return Ok(if card.is_null() || card["deleted"] == true {
            None
        } else {
            Some(Source {
                id: id.into(),
                title: "Card Deck".into(),
                revision: deck_revision(card, &data),
            })
        });
    }
    w.db.query_row("SELECT o.id,o.title,CAST(coalesce(d.revision,0) AS TEXT)||':'||CAST(o.updated_at AS TEXT) FROM objects o LEFT JOIN documents d ON d.object_id=o.id WHERE o.id=?1 AND o.deleted_at IS NULL",[id],|r|Ok(Source{id:r.get(0)?,title:r.get(1)?,revision:r.get(2)?})).optional().map_err(|e|e.to_string())
}
fn open(path: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(path.parent().ok_or("Invalid cache path")?)
        .map_err(|e| e.to_string())?;
    let init = || -> rusqlite::Result<Connection> {
        let db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        let v: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if v != 0 && v != FORMAT {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let check: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(rusqlite::Error::InvalidQuery);
        }
        db.execute_batch("CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,revision TEXT NOT NULL,error INTEGER NOT NULL,failure TEXT); CREATE TABLE IF NOT EXISTS passages(source TEXT NOT NULL,ordinal INTEGER NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(source,ordinal)); CREATE TABLE IF NOT EXISTS representations(digest TEXT PRIMARY KEY,model TEXT NOT NULL,vector TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS lexical USING fts5(source UNINDEXED,ordinal UNINDEXED,title,body,tokenize='unicode61'); PRAGMA user_version=3;")?;
        Ok(db)
    };
    match init() {
        Ok(db) => Ok(db),
        Err(_) => {
            // Only a disposable, explicitly named cache file is replaced.
            if path.exists() {
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
            init().map_err(|e| e.to_string())
        }
    }
}
fn cache_path(cache: &TopicCache, workspace: &str) -> PathBuf {
    cache.0.join(format!("{workspace}.sqlite"))
}
fn guard<'a>(
    state: &'a AppState,
    activation: &str,
) -> Reply<std::sync::MutexGuard<'a, Result<Workspace, String>>> {
    let g = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    if g.as_ref().map_err(Clone::clone)?.activation != activation {
        return Err("Workspace changed; search cancelled".into());
    }
    Ok(g)
}
#[tauri::command]
pub fn topic_catalog(state: State<'_, AppState>) -> Reply<Catalog> {
    let g = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    let w = g.as_ref().map_err(Clone::clone)?;
    Ok(Catalog {
        activation: w.activation.clone(),
        workspace: identity(w)?,
        sources: catalog(w)?,
    })
}
#[tauri::command]
pub fn topic_pending(
    state: State<'_, AppState>,
    cache: State<'_, TopicCache>,
    activation: String,
    after: Option<String>,
    retry_failures: Option<bool>,
) -> Reply<Vec<Source>> {
    let (key, sources) = {
        let g = guard(&state, &activation)?;
        let w = g.as_ref().map_err(Clone::clone)?;
        (identity(w)?, catalog(w)?)
    };
    let mut db = open(&cache_path(&cache, &key))?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let existing: Vec<String> = tx
        .prepare("SELECT id FROM sources")
        .map_err(|e| e.to_string())?
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let eligible_ids: std::collections::HashSet<_> =
        sources.iter().map(|s| s.id.as_str()).collect();
    for id in existing {
        if !eligible_ids.contains(id.as_str()) {
            for table in ["sources", "passages", "lexical"] {
                let column = if table == "sources" { "id" } else { "source" };
                tx.execute(&format!("DELETE FROM {table} WHERE {column}=?1"), [&id])
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.execute(
        "DELETE FROM representations WHERE digest NOT IN (SELECT digest FROM passages)",
        [],
    )
    .map_err(|e| e.to_string())?;
    let mut pending = Vec::new();
    for s in sources {
        let revision: Option<String> = tx
            .query_row(
                "SELECT revision FROM sources WHERE id=?1 AND (?2=0 OR error=0)",
                params![s.id, retry_failures.unwrap_or(false)],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if revision.as_deref() != Some(&s.revision) {
            pending.push(s);
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(pending
        .into_iter()
        .filter(|s| after.as_ref().is_none_or(|a| s.id > *a))
        .take(100)
        .collect())
}
#[tauri::command]
pub fn topic_load(
    state: State<'_, AppState>,
    activation: String,
    id: String,
    revision: String,
) -> Reply<serde_json::Value> {
    let g = guard(&state, &activation)?;
    let w = g.as_ref().map_err(Clone::clone)?;
    if source(w, &id)?.is_none_or(|s| s.revision != revision) {
        return Err("Source changed".into());
    }
    if let Some(card) = id.strip_prefix("deck:") {
        let data = deck(w)?;
        return Ok(serde_json::json!({
            "card": data[card],
            "questions": referenced_questions(&data[card], &data),
        }));
    }
    serde_json::to_value(w.load(&id).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn topic_replace(
    state: State<'_, AppState>,
    cache: State<'_, TopicCache>,
    activation: String,
    id: String,
    revision: String,
    passages: Vec<Passage>,
    failed: bool,
    failure: Option<String>,
) -> Reply<()> {
    if passages.len() > 4096
        || passages.iter().any(|p| {
            p.document != id
                || p.revision != revision
                || p.text.len() > 12000
                || (!p.vector.is_empty()
                    && (p.vector.len() != 384
                        || (p.vector.iter().map(|v| v * v).sum::<f32>() - 1.0).abs() > 0.02))
                || p.vector.iter().any(|v| !v.is_finite())
        })
    {
        return Err("Invalid passage batch".into());
    }
    // Short transaction, no extraction/inference/network while the workspace is locked.
    let g = guard(&state, &activation)?;
    let w = g.as_ref().map_err(Clone::clone)?;
    if source(w, &id)?.is_none_or(|s| s.revision != revision) {
        return Err("Source changed".into());
    }
    let mut db = open(&cache_path(&cache, &identity(w)?))?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for table in ["passages", "lexical"] {
        tx.execute(&format!("DELETE FROM {table} WHERE source=?1"), [&id])
            .map_err(|e| e.to_string())?;
    }
    for (n, p) in passages.iter().enumerate() {
        let digest = hash(
            format!(
                "multilingual-e5-small/761b726d/q8/mean/l2:passage: {}",
                p.text
            )
            .as_bytes(),
        );
        let mut payload = p.clone();
        payload.vector.clear();
        if p.vector.len() == 384 {
            tx.execute("INSERT OR REPLACE INTO representations VALUES(?1,'multilingual-e5-small/761b726d/q8/mean/l2',?2)",params![digest,serde_json::to_string(&p.vector).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        }
        tx.execute(
            "INSERT INTO passages VALUES(?1,?2,?3,?4)",
            params![
                id,
                n,
                serde_json::to_string(&payload).map_err(|e| e.to_string())?,
                digest
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO lexical(source,ordinal,title,body) VALUES(?1,?2,?3,?4)",
            params![id, n, p.title, p.text],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO sources VALUES(?1,?2,?3,?4)",
        params![
            id,
            revision,
            failed,
            failure.filter(
                |s| ["unreadable-source", "partial-pdf", "model-unavailable"].contains(&s.as_str())
            )
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
fn fts(query: &str) -> String {
    query
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
        .filter(|w| {
            w.chars().count() > 1
                && ![
                    "what", "how", "do", "my", "notes", "say", "about", "the", "is", "are", "and",
                    "of", "in", "to", "can", "you", "does", "me", "tell", "for", "with", "be",
                    "by", "on", "as", "at", "from", "it", "its", "that", "this",
                ]
                .contains(&w.to_lowercase().as_str())
        })
        .take(64)
        .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != 384 || b.len() != 384 {
        return -1.0;
    }
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
#[tauri::command]
pub async fn topic_search(
    state: State<'_, AppState>,
    cache: State<'_, TopicCache>,
    activation: String,
    query: String,
    vector: Vec<f32>,
    omit: Vec<String>,
) -> Reply<Search> {
    if query.len() > 8000 || vector.len() > 384 || vector.iter().any(|v| !v.is_finite()) {
        return Err("Invalid search".into());
    }
    let (key, current) = {
        let g = guard(&state, &activation)?;
        let w = g.as_ref().map_err(Clone::clone)?;
        (identity(w)?, catalog(w)?)
    };
    let db = open(&cache_path(&cache, &key))?;
    let current_by_id: std::collections::HashMap<_, _> =
        current.iter().map(|s| (&s.id, &s.revision)).collect();
    let eligible = |p: &Passage| {
        !omit.contains(&p.document)
            && current_by_id
                .get(&p.document)
                .is_some_and(|r| **r == p.revision)
    };
    let mut lexical = Vec::<(String, i64)>::new();
    let terms = fts(&query);
    if !terms.is_empty() {
        lexical=db.prepare("SELECT source,ordinal FROM lexical WHERE lexical MATCH ?1 ORDER BY bm25(lexical,0,0,3,1),source,ordinal LIMIT 40").map_err(|e|e.to_string())?.query_map([terms],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    }
    let mut all = Vec::<((String, i64), Passage, f32)>::new();
    let mut stmt=db.prepare("SELECT p.source,p.ordinal,p.payload,r.vector FROM passages p LEFT JOIN representations r ON r.digest=p.digest ORDER BY p.source,p.ordinal").map_err(|e|e.to_string())?;
    for row in stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
    {
        let (id, n, payload, vector_json) = row.map_err(|e| e.to_string())?;
        let mut p: Passage = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
        p.vector = vector_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if eligible(&p) {
            let similarity = cosine(&vector, &p.vector);
            if similarity >= 0.80 || lexical.contains(&(id.clone(), n)) {
                all.push(((id, n), p, similarity));
            }
            if all.len() > 80 {
                all.sort_by(|a, b| {
                    let al = lexical.contains(&a.0);
                    let bl = lexical.contains(&b.0);
                    bl.cmp(&al).then(b.2.total_cmp(&a.2)).then(a.0.cmp(&b.0))
                });
                all.truncate(80);
            }
        }
    }
    let mut semantic: Vec<_> = all
        .iter()
        .filter(|(_, _, s)| *s >= 0.80)
        .map(|(k, _, s)| (k.clone(), *s))
        .collect();
    semantic.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    semantic.truncate(40);
    let identifiers: Vec<_> = query
        .split_whitespace()
        .filter(|w| w.chars().any(|c| c.is_ascii_digit()) && w.chars().any(|c| c.is_alphabetic()))
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
        })
        .collect();
    let mut ranked: Vec<_> = all
        .into_iter()
        .filter_map(|(k, p, _)| {
            if !identifiers.is_empty()
                && !identifiers.iter().any(|id| {
                    p.text.to_lowercase().contains(id) || p.title.to_lowercase().contains(id)
                })
            {
                return None;
            }
            let l = lexical.iter().position(|v| *v == k);
            let s = semantic.iter().position(|(v, _)| *v == k);
            if l.is_none() && s.is_none() {
                return None;
            }
            let score =
                l.map_or(0.0, |r| 1.0 / (60 + r) as f32) + s.map_or(0.0, |r| 1.0 / (60 + r) as f32);
            Some((p, score, k))
        })
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.2.cmp(&b.2)));
    let passages = ranked
        .into_iter()
        .take(80)
        .map(|(mut p, _, _)| {
            p.vector.clear();
            p
        })
        .collect();
    let indexed = current
        .iter()
        .filter(|s| {
            db.query_row(
                "SELECT EXISTS(SELECT 1 FROM sources WHERE id=?1 AND revision=?2 AND error=0)",
                params![s.id, s.revision],
                |r| r.get::<_, bool>(0),
            )
            .unwrap_or(false)
        })
        .count();
    Ok(Search {
        passages,
        indexed,
        total: current.len(),
        failed: current.len() - indexed,
    })
}
#[tauri::command]
pub fn topic_enabled(cache: State<'_, TopicCache>, enabled: bool) -> Reply<()> {
    cache.enabled(enabled)
}
/// Called again at the native dispatch boundary; cache entries never grant eligibility.
pub fn validate(state: &AppState, context: &str) -> Reply<()> {
    let value: serde_json::Value = serde_json::from_str(context).map_err(|_| "Invalid context")?;
    if value["sourceMode"] != "workspace" {
        return Ok(());
    }
    let activation = value["activation"]
        .as_str()
        .ok_or("Missing workspace activation")?;
    let g = guard(state, activation)?;
    let w = g.as_ref().map_err(Clone::clone)?;
    for p in value["citationSources"]
        .as_array()
        .ok_or("Missing evidence table")?
    {
        let id = p["document"].as_str().ok_or("Missing source")?;
        if source(w, id)?.is_none_or(|s| Some(s.revision.as_str()) != p["revision"].as_str()) {
            return Err("Workspace evidence changed; search again".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn disabling_search_cancels_queued_automatic_requests() {
        let temp = tempfile::tempdir().unwrap();
        let cache = TopicCache(
            temp.path().into(),
            Mutex::new(true),
            Mutex::new(std::collections::HashMap::new()),
        );
        let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
        cache.register("automatic", cancel.clone()).unwrap();
        cache.enabled(false).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), cancel.notified())
            .await
            .unwrap();
        assert!(cache.register("late", cancel).is_err());
    }
    #[test]
    fn eligibility_activation_revisions_and_workspace_copies() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("original");
        let mut w = Workspace::open(root.clone()).unwrap();
        let id = w.create("note").unwrap();
        let snapshot = crate::storage::Snapshot {
            collection: vec![1],
            document: vec![2],
            title: None,
        };
        w.save(&id, &snapshot).unwrap();
        let old = source(&w, &id).unwrap().unwrap();
        let activation = w.activation.clone();
        let key = identity(&w).unwrap();
        w.save(&id, &snapshot).unwrap();
        assert_ne!(old.revision, source(&w, &id).unwrap().unwrap().revision);
        w.delete(&id).unwrap();
        assert!(source(&w, &id).unwrap().is_none());
        w.restore_object(&id).unwrap();
        assert!(source(&w, &id).unwrap().is_some());
        drop(w);
        let w = Workspace::open(root).unwrap();
        assert_ne!(activation, w.activation);
        assert_eq!(key, identity(&w).unwrap());
        let other = Workspace::open(t.path().join("copy")).unwrap();
        assert_ne!(key, identity(&other).unwrap());
        let state = AppState {
            workspace: Mutex::new(Ok(w)),
            base: t.path().to_owned(),
        };
        assert!(guard(&state, &activation).is_err());
    }
    #[test]
    fn bundled_fts_and_cache_recovery() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("cache.sqlite");
        let db = open(&p).unwrap();
        db.execute(
            "INSERT INTO lexical VALUES('closed',0,'Fixture','unique retrieval phrase')",
            [],
        )
        .unwrap();
        assert_eq!(
            db.query_row(
                "SELECT source FROM lexical WHERE lexical MATCH ?1",
                [fts("retrieval")],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "closed"
        );
        drop(db);
        std::fs::write(&p, b"corrupt").unwrap();
        assert!(open(&p).is_ok());
    }
    #[test]
    fn query_operators_are_data() {
        assert_eq!(
            fts("a OR \"x-y\" NEAR (42)"),
            "\"OR\" OR \"x-y\" OR \"NEAR\" OR \"42\""
        );
    }
    #[test]
    fn semantic_scan_accepts_zero_lexical_overlap() {
        let mut a = vec![0.0; 384];
        a[0] = 1.0;
        assert_eq!(cosine(&a, &a), 1.0);
        assert_eq!(cosine(&a, &[]), -1.0);
    }
}
