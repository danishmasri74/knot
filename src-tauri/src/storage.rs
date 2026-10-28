use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Manifest {
    pub id: String,
    pub format_version: u32,
}
#[derive(Serialize)]
pub struct Object {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub updated_at: i64,
}
#[derive(Serialize)]
pub struct TrashedObject {
    #[serde(flatten)]
    pub object: Object,
    pub deleted_at: i64,
}
#[derive(Serialize, Deserialize)]
pub struct Snapshot {
    pub collection: Vec<u8>,
    pub document: Vec<u8>,
    #[serde(default)]
    pub title: Option<String>,
}
#[derive(Deserialize)]
pub struct DocumentWrite {
    pub id: String,
    pub snapshot: Snapshot,
    pub create: bool,
}
#[derive(Serialize, Default)]
pub struct IntegrityReport {
    pub document_snapshots: Vec<AuditDocument>,
    pub checked_at: i64,
    pub database_issues: Vec<String>,
    pub affected_attachments: Vec<AffectedAttachment>,
    pub checked: usize,
    pub missing: Vec<String>,
    pub corrupt: Vec<String>,
    pub orphan_files: Vec<String>,
}
#[derive(Serialize)]
pub struct AuditDocument {
    pub id: String,
    pub title: String,
    pub deleted: bool,
    pub snapshot: Option<Snapshot>,
}
#[derive(Serialize)]
pub struct AffectedAttachment {
    pub hash: String,
    pub key: String,
    pub name: String,
    pub documents: Vec<AffectedDocument>,
}
#[derive(Serialize)]
pub struct AffectedDocument {
    pub id: String,
    pub title: String,
    pub deleted: bool,
}
pub struct Workspace {
    pub root: PathBuf,
    pub db: Connection,
    // OS releases this lock even after abnormal process termination.
    _lock: File,
}
impl Workspace {
    /// Read-only audit. Never removes assets, including interrupted imports.
    pub fn integrity(&self) -> Result<IntegrityReport> {
        let mut report = IntegrityReport {
            checked_at: now(),
            ..Default::default()
        };
        let mut check = self.db.prepare("PRAGMA integrity_check")?;
        for result in check.query_map([], |row| row.get::<_, String>(0))? {
            let result = result?;
            if result != "ok" {
                report.database_issues.push(result);
            }
        }
        let mut check = self.db.prepare("PRAGMA foreign_key_check")?;
        for result in check.query_map([], |row| {
            Ok(format!(
                "Broken relationship in {} (row {:?}) to {}",
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, String>(2)?
            ))
        })? {
            report.database_issues.push(result?);
        }
        let mut known = std::collections::HashSet::new();
        let mut query = self
            .db
            .prepare("SELECT DISTINCT sha256,size FROM attachments")?;
        for row in query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })? {
            let (hash, size) = row?;
            let path = self.asset_path(&hash)?;
            known.insert(hash.clone());
            report.checked += 1;
            if !path.is_file() {
                report.missing.push(hash);
            } else if fs::metadata(&path)?.len() != size || hash_file(&path)? != hash {
                report.corrupt.push(hash);
            }
        }
        for directory in fs::read_dir(self.root.join("assets"))? {
            let directory = directory?;
            if !directory.file_type()?.is_dir() {
                if directory.file_type()?.is_file() {
                    report
                        .orphan_files
                        .push(directory.file_name().to_string_lossy().to_string());
                }
                continue;
            }
            for entry in fs::read_dir(directory.path())? {
                let entry = entry?;
                if entry.file_type()?.is_file()
                    && !(known.contains(&entry.file_name().to_string_lossy().to_string())
                        && self.asset_path(&entry.file_name().to_string_lossy())? == entry.path())
                {
                    report.orphan_files.push(format!(
                        "{}/{}",
                        directory.file_name().to_string_lossy(),
                        entry.file_name().to_string_lossy()
                    ));
                }
            }
        }
        report.missing.sort();
        report.missing.dedup();
        report.corrupt.sort();
        report.corrupt.dedup();
        report.orphan_files.sort();
        let mut attachments = self
            .db
            .prepare("SELECT id,name,sha256 FROM attachments ORDER BY sha256,id")?;
        let mut documents = self.db.prepare("SELECT o.id,o.title,o.deleted_at IS NOT NULL FROM objects o JOIN object_attachments a ON a.object_id=o.id WHERE a.attachment_id=?1 ORDER BY o.id")?;
        for row in attachments.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })? {
            let (key, name, hash) = row?;
            if report.missing.contains(&hash) || report.corrupt.contains(&hash) {
                let documents = documents
                    .query_map([&key], |row| {
                        Ok(AffectedDocument {
                            id: row.get(0)?,
                            title: row.get(1)?,
                            deleted: row.get(2)?,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                report.affected_attachments.push(AffectedAttachment {
                    hash,
                    key,
                    name,
                    documents,
                });
            }
        }
        let mut query = self
            .db
            .prepare("SELECT id,title,deleted_at IS NOT NULL FROM objects ORDER BY id")?;
        for row in query.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
            ))
        })? {
            let (id, title, deleted) = row?;
            let snapshot = self.load(&id)?;
            report.document_snapshots.push(AuditDocument {
                id,
                title,
                deleted,
                snapshot,
            });
        }
        Ok(report)
    }
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root)?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(root.join("workspace.lock"))?;
        lock.try_lock()
            .map_err(|_| "This workspace is already open in another Knot process")?;
        let manifest = root.join("workspace.json");
        if manifest.exists() {
            if !root.join("knot.db").is_file() {
                return Err("Workspace database is missing. Restore a backup; no replacement database was created".into());
            }
            let m: Manifest = serde_json::from_slice(&fs::read(&manifest)?)?;
            if m.format_version != 1 {
                return Err("Unsupported workspace format".into());
            }
        } else {
            if root.join("knot.db").exists() {
                return Err("Workspace manifest missing; refusing to reset existing data".into());
            }
            let m = Manifest {
                id: uuid::Uuid::new_v4().to_string(),
                format_version: 1,
            };
            let mut file = File::create(&manifest)?;
            file.write_all(&serde_json::to_vec_pretty(&m)?)?;
            file.sync_all()?;
        }
        for dir in ["assets", "cache/thumbnails", "cache/previews", "backups"] {
            fs::create_dir_all(root.join(dir))?;
        }
        let db = Connection::open(root.join("knot.db"))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;")?;
        let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > 2 {
            return Err("Database is newer than this Knot version".into());
        }
        if version == 0 {
            db.execute_batch("BEGIN IMMEDIATE;")?;
            db.execute_batch(include_str!("../migrations/001_initial.sql"))?;
            db.execute_batch("PRAGMA user_version=1; COMMIT;")?;
        }
        if version < 2 {
            db.execute_batch("BEGIN IMMEDIATE;")?;
            db.execute_batch(include_str!("../migrations/002_organization.sql"))?;
            db.execute_batch("PRAGMA user_version=2; COMMIT;")?;
        }
        let check: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err("Workspace database failed integrity check".into());
        }
        Ok(Self {
            root,
            db,
            _lock: lock,
        })
    }
    pub fn list(&self, search: &str, offset: i64) -> Result<Vec<Object>> {
        self.filtered_list(search, offset, None, None)
    }
    pub fn create(&self, kind: &str) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.db.execute(
            "INSERT INTO objects(id,title,kind,updated_at) VALUES(?1,?2,?3,?4)",
            params![
                id,
                if kind == "whiteboard" {
                    "Untitled whiteboard"
                } else {
                    "Untitled note"
                },
                kind,
                now()
            ],
        )?;
        Ok(id)
    }
    pub fn rename(&self, id: &str, title: &str) -> Result<()> {
        let title = title.trim();
        if title.is_empty() || title.len() > 500 {
            return Err("Title must contain 1–500 bytes".into());
        }
        self.db.execute(
            "UPDATE objects SET title=?2,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL",
            params![id, title, now()],
        )?;
        Ok(())
    }
    pub fn delete(&self, id: &str) -> Result<()> {
        self.db.execute(
            "UPDATE objects SET deleted_at=?2 WHERE id=?1 AND deleted_at IS NULL",
            params![id, now()],
        )?;
        Ok(())
    }
    pub fn trash(&self, search: &str, offset: i64) -> Result<Vec<TrashedObject>> {
        if offset < 0 {
            return Err("Invalid trash offset".into());
        }
        let mut query = self.db.prepare(
            "SELECT id,title,kind,updated_at,deleted_at FROM objects
             WHERE deleted_at IS NOT NULL AND instr(lower(title),lower(?1))>0
             ORDER BY deleted_at DESC,id LIMIT 100 OFFSET ?2",
        )?;
        let rows = query.query_map(params![search, offset], |r| {
            Ok(TrashedObject {
                object: Object {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    kind: r.get(2)?,
                    updated_at: r.get(3)?,
                },
                deleted_at: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn restore_object(&self, id: &str) -> Result<()> {
        let changed = self.db.execute(
            "UPDATE objects SET deleted_at=NULL WHERE id=?1 AND deleted_at IS NOT NULL",
            [id],
        )?;
        if changed != 1 {
            return Err("Document is not in Trash. Refresh and try again.".into());
        }
        Ok(())
    }
    pub fn load(&self, id: &str) -> Result<Option<Snapshot>> {
        Ok(self
            .db
            .query_row(
                "SELECT collection_state,document_state FROM documents WHERE object_id=?1",
                [id],
                |r| {
                    Ok(Snapshot {
                        collection: r.get(0)?,
                        document: r.get(1)?,
                        title: None,
                    })
                },
            )
            .optional()?)
    }
    pub fn save(&mut self, id: &str, s: &Snapshot) -> Result<()> {
        let tx = self.db.transaction()?;
        Self::write_snapshot(&tx, id, s)?;
        tx.commit()?;
        Ok(())
    }
    pub fn save_documents(&mut self, documents: &[DocumentWrite]) -> Result<()> {
        let tx = self.db.transaction()?;
        for entry in documents {
            if entry.create {
                tx.execute("INSERT OR IGNORE INTO objects(id,title,kind,updated_at) VALUES(?1,'Untitled note','note',?2)", params![entry.id, now()])?;
            }
            Self::write_snapshot(&tx, &entry.id, &entry.snapshot)?;
        }
        tx.commit()?;
        Ok(())
    }
    fn write_snapshot(tx: &rusqlite::Transaction<'_>, id: &str, s: &Snapshot) -> Result<()> {
        if s.collection.is_empty()
            || s.document.is_empty()
            || s.collection.len() + s.document.len() > 64 * 1024 * 1024
        {
            return Err("Invalid or oversized document snapshot".into());
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM objects WHERE id=?1 AND deleted_at IS NULL)",
            [id],
            |r| r.get(0),
        )?;
        if !exists {
            return Err("Document no longer exists".into());
        }
        tx.execute("INSERT INTO documents VALUES(?1,?2,?3,1) ON CONFLICT(object_id) DO UPDATE SET collection_state=excluded.collection_state,document_state=excluded.document_state,revision=revision+1",params![id,s.collection,s.document])?;
        tx.execute(
            "UPDATE objects SET updated_at=?2,title=coalesce(?3,title) WHERE id=?1",
            params![
                id,
                now(),
                s.title
                    .as_ref()
                    .map(|t| t.chars().take(500).collect::<String>())
            ],
        )?;
        Ok(())
    }
    pub fn asset_path(&self, hash: &str) -> Result<PathBuf> {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("Invalid asset hash".into());
        }
        Ok(self.root.join("assets").join(&hash[..2]).join(hash))
    }
    pub fn put_blob(
        &mut self,
        object: &str,
        key: &str,
        bytes: &[u8],
        name: &str,
        mime: &str,
    ) -> Result<String> {
        if bytes.len() > 100 * 1024 * 1024 {
            return Err("Attachment exceeds the 100 MiB import limit".into());
        }
        let hash = format!("{:x}", Sha256::digest(bytes));
        let path = self.asset_path(&hash)?;
        if path.exists() {
            if hash_file(&path)? != hash {
                return Err("Existing attachment failed integrity check".into());
            }
        } else {
            fs::create_dir_all(path.parent().ok_or("Invalid asset path")?)?;
            let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
            let mut f = File::create(&tmp)?;
            f.write_all(bytes)?;
            f.sync_all()?;
            if hash_file(&tmp)? != hash {
                return Err("Import hash verification failed".into());
            }
            fs::rename(tmp, &path)?;
        }
        let tx = self.db.transaction()?;
        let previous: Option<String> = tx
            .query_row("SELECT sha256 FROM attachments WHERE id=?1", [key], |r| {
                r.get(0)
            })
            .optional()?;
        if previous.is_some_and(|h| h != hash) {
            return Err("Attachment identifier collision".into());
        }
        tx.execute(
            "INSERT OR IGNORE INTO attachments VALUES(?1,?2,?3,?4,?5)",
            params![key, hash, name, mime, bytes.len() as i64],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO object_attachments VALUES(?1,?2)",
            params![object, key],
        )?;
        tx.commit()?;
        Ok(key.to_string())
    }
    pub fn get_blob(&self, key: &str) -> Result<Vec<u8>> {
        let hash: String =
            self.db
                .query_row("SELECT sha256 FROM attachments WHERE id=?1", [key], |r| {
                    r.get(0)
                })?;
        let path = self.asset_path(&hash)?;
        let data = fs::read(path).map_err(|_| "Attachment file is missing or unreadable")?;
        if format!("{:x}", Sha256::digest(&data)) != hash {
            return Err("Attachment failed integrity check".into());
        }
        Ok(data)
    }
    pub fn blobs(&self, object: &str) -> Result<Vec<String>> {
        let mut q = self
            .db
            .prepare("SELECT attachment_id FROM object_attachments WHERE object_id=?1")?;
        let rows = q.query_map([object], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
}
pub fn hash_file(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
