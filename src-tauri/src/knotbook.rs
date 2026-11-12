//! `.knotbook` packages: one or more notebooks shared as a single file.
//! Format and rules: docs/NOTEBOOK-SHARING-PLAN.md ("Package format").
//! Writing (Share as file), strict reading, and importing as copies.

use crate::storage::{now, Result, Workspace};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs::File,
    io::{Read, Write},
    path::Path,
};

pub const FORMAT: &str = "knotbook";
pub const FORMAT_VERSION: u32 = 1;
/// Oldest Knot able to import this format (the release that adds import).
pub const MIN_KNOT_VERSION: &str = "0.3.0";
const MAX_NOTEBOOKS: usize = 500;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Deserialize, Clone)]
pub struct ShareEntry {
    pub id: String,
    pub role: String,
    pub parent: Option<String>,
}
#[derive(Deserialize, Serialize, Clone)]
pub struct Unshared {
    pub id: String,
    pub title: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestNotebook {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub updated_at: i64,
    pub sha256: String,
    pub role: String,
    pub parent: Option<String>,
    /// Attachment IDs this notebook owns (card attachments belong to the deck).
    #[serde(default)]
    pub attachments: Vec<String>,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct ManifestAttachment {
    pub id: String,
    pub sha256: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageManifest {
    pub format: String,
    pub format_version: u32,
    pub min_knot_version: String,
    pub created_with: String,
    pub exported_at: i64,
    pub shared_by: String,
    pub root: String,
    pub notebooks: Vec<ManifestNotebook>,
    pub attachments: Vec<ManifestAttachment>,
    pub unshared: Vec<Unshared>,
    pub cards: usize,
}

struct Notebook {
    meta: ManifestNotebook,
    collection: Vec<u8>,
    document: Vec<u8>,
}
pub struct Package {
    notebooks: Vec<Notebook>,
    attachments: Vec<ManifestAttachment>,
    cards: serde_json::Map<String, serde_json::Value>,
}
impl Package {
    /// Bytes the file holds before compression; shown in the share dialog.
    pub fn size(&self) -> u64 {
        let notebooks: u64 = self
            .notebooks
            .iter()
            .map(|n| (n.collection.len() + n.document.len()) as u64)
            .sum();
        let mut hashes = HashSet::new();
        let assets: u64 = self
            .attachments
            .iter()
            .filter(|a| hashes.insert(a.sha256.clone()))
            .map(|a| a.size.max(0) as u64)
            .sum();
        let cards = serde_json::to_vec(&self.cards).map_or(0, |c| c.len() as u64);
        notebooks + assets + cards
    }
}

/// Reads everything a share needs, refusing Trash, unknown or repeated notebooks.
pub fn collect(ws: &Workspace, entries: &[ShareEntry], card_ids: &[String]) -> Result<Package> {
    if entries.is_empty() || entries.len() > MAX_NOTEBOOKS {
        return Err("Choose between 1 and 500 notebooks to share".into());
    }
    if entries[0].role != "root" || entries.iter().skip(1).any(|e| e.role == "root") {
        return Err("A share starts from exactly one notebook".into());
    }
    let mut seen = HashSet::new();
    let mut notebooks = Vec::new();
    let mut attachment_ids = BTreeSet::new();
    for entry in entries {
        if !matches!(entry.role.as_str(), "root" | "canvas" | "linked") {
            return Err("Invalid share entry".into());
        }
        if !seen.insert(entry.id.clone()) {
            return Err("A notebook is listed twice".into());
        }
        let row = ws
            .db
            .query_row(
                "SELECT title,kind,updated_at FROM objects WHERE id=?1 AND deleted_at IS NULL",
                [&entry.id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
            )
            .optional()?
            .ok_or("A chosen notebook is in Trash or no longer exists")?;
        let snapshot = ws
            .load(&entry.id)?
            .ok_or("A chosen notebook has never been saved")?;
        let mut q = ws
            .db
            .prepare("SELECT attachment_id FROM object_attachments WHERE object_id=?1 ORDER BY attachment_id")?;
        let mut owned = Vec::new();
        for id in q.query_map([&entry.id], |r| r.get::<_, String>(0))? {
            let id = id?;
            attachment_ids.insert(id.clone());
            owned.push(id);
        }
        notebooks.push(Notebook {
            meta: ManifestNotebook {
                id: entry.id.clone(),
                title: row.0,
                kind: row.1,
                updated_at: row.2,
                sha256: format!("{:x}", Sha256::digest(&snapshot.document)),
                role: entry.role.clone(),
                parent: entry.parent.clone(),
                attachments: owned,
            },
            collection: snapshot.collection,
            document: snapshot.document,
        });
    }

    // Cards live in the workspace deck; their attachments are referenced by
    // key anywhere inside the card content (as Trash purging already assumes).
    let raw: String = ws
        .db
        .query_row("SELECT content FROM card_deck WHERE id=1", [], |r| r.get(0))?;
    let deck: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&raw)?;
    let mut cards = serde_json::Map::new();
    for id in card_ids {
        if let Some(card) = deck.get(id) {
            if card.get("deleted").and_then(|d| d.as_bool()) == Some(true) {
                continue;
            }
            let mut strings = Vec::new();
            collect_strings(card, &mut strings);
            for key in strings {
                let known: bool = ws.db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM attachments WHERE id=?1)",
                    [&key],
                    |r| r.get(0),
                )?;
                if known {
                    attachment_ids.insert(key);
                }
            }
            cards.insert(id.clone(), card.clone());
        }
    }

    let mut attachments = Vec::new();
    for id in attachment_ids {
        let row = ws
            .db
            .query_row(
                "SELECT sha256,name,mime,size FROM attachments WHERE id=?1",
                [&id],
                |r| {
                    Ok(ManifestAttachment {
                        id: id.clone(),
                        sha256: r.get(0)?,
                        name: r.get(1)?,
                        mime: r.get(2)?,
                        size: r.get(3)?,
                    })
                },
            )
            .optional()?;
        if let Some(row) = row {
            attachments.push(row);
        }
    }
    let package = Package { notebooks, attachments, cards };
    if package.size() > MAX_TOTAL_BYTES {
        return Err("This share is larger than 1 GB. Include fewer notebooks.".into());
    }
    Ok(package)
}

fn collect_strings(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => out.push(s.clone()),
        serde_json::Value::Array(items) => items.iter().for_each(|v| collect_strings(v, out)),
        serde_json::Value::Object(map) => map.values().for_each(|v| collect_strings(v, out)),
        _ => {}
    }
}

/// "Physics" → "Physics.knotbook", safe on Windows.
pub fn filename(title: &str) -> String {
    let clean: String = title
        .chars()
        .take(80)
        .map(|c| if c.is_control() || "/\\:<>\"|?*".contains(c) { '-' } else { c })
        .collect();
    let clean = clean.trim().trim_end_matches(['.', ' ']);
    let stem = if clean.is_empty() { "Untitled" } else { clean };
    let device = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((device.starts_with("COM") || device.starts_with("LPT"))
            && device.len() == 4
            && device.as_bytes()[3].is_ascii_digit());
    if reserved {
        format!("Knot {stem}.knotbook")
    } else {
        format!("{stem}.knotbook")
    }
}

pub fn validate_shared_by(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Enter your name (up to 80 characters)".into());
    }
    Ok(name.to_string())
}

/// Writes the package next to `dest` and publishes it without replacing
/// anything, like document exports. Asset bytes are re-hashed while copied.
pub fn write(
    ws: &Workspace,
    dest: &Path,
    package: &Package,
    unshared: &[Unshared],
    shared_by: &str,
) -> Result<()> {
    let shared_by = validate_shared_by(shared_by)?;
    if dest.exists() {
        return Err("Choose a new filename; existing files are never overwritten".into());
    }
    let parent = dest.parent().ok_or("Invalid destination")?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".knot-share-")
        .suffix(".partial")
        .tempfile_in(parent)?;
    let chosen: HashSet<&str> = package.notebooks.iter().map(|n| n.meta.id.as_str()).collect();
    let manifest = PackageManifest {
        format: FORMAT.into(),
        format_version: FORMAT_VERSION,
        min_knot_version: MIN_KNOT_VERSION.into(),
        created_with: env!("CARGO_PKG_VERSION").into(),
        exported_at: now(),
        shared_by,
        root: package.notebooks[0].meta.id.clone(),
        notebooks: package
            .notebooks
            .iter()
            .map(|n| ManifestNotebook {
                id: n.meta.id.clone(),
                title: n.meta.title.clone(),
                kind: n.meta.kind.clone(),
                updated_at: n.meta.updated_at,
                sha256: n.meta.sha256.clone(),
                role: n.meta.role.clone(),
                parent: n.meta.parent.clone(),
                attachments: n.meta.attachments.clone(),
            })
            .collect(),
        attachments: package.attachments.clone(),
        unshared: unshared
            .iter()
            .filter(|u| !chosen.contains(u.id.as_str()))
            .cloned()
            .collect(),
        cards: package.cards.len(),
    };
    {
        let mut zip = zip::ZipWriter::new(temporary.as_file_mut());
        let deflate = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("manifest.json", deflate)?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
        for notebook in &package.notebooks {
            zip.start_file(format!("notebooks/{}/collection.bin", notebook.meta.id), deflate)?;
            zip.write_all(&notebook.collection)?;
            zip.start_file(format!("notebooks/{}/document.bin", notebook.meta.id), deflate)?;
            zip.write_all(&notebook.document)?;
        }
        let ordered: BTreeMap<&str, ()> = package.cards.keys().map(|k| (k.as_str(), ())).collect();
        let cards: serde_json::Map<String, serde_json::Value> = ordered
            .keys()
            .map(|k| ((*k).to_string(), package.cards[*k].clone()))
            .collect();
        zip.start_file("cards.json", deflate)?;
        zip.write_all(&serde_json::to_vec(&cards)?)?;
        let mut written = HashSet::new();
        for attachment in &package.attachments {
            if !written.insert(attachment.sha256.clone()) {
                continue;
            }
            let path = ws.asset_path(&attachment.sha256)?;
            let mut file =
                File::open(&path).map_err(|_| "An attachment file is missing; check Workspace health")?;
            zip.start_file(format!("assets/{}", attachment.sha256), stored)?;
            let mut hasher = Sha256::new();
            let mut buffer = vec![0u8; 1 << 16];
            loop {
                let n = file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
                zip.write_all(&buffer[..n])?;
            }
            if format!("{:x}", hasher.finalize()) != attachment.sha256 {
                return Err("An attachment failed its integrity check; check Workspace health".into());
            }
        }
        zip.finish()?;
    }
    temporary.as_file().sync_all()?;
    temporary.persist_noclobber(dest).map_err(|e| e.error)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Reading and importing (NOTEBOOK-SHARING-PLAN.md, "Import").

const MAX_ENTRIES: usize = 2 + MAX_NOTEBOOKS * 2 + 20_000;
const MAX_ASSET_BYTES: u64 = 100 * 1024 * 1024;

/// Why a file can't be imported; shown as one plain sentence by the interface.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Blocked {
    /// Made by a newer Knot or format.
    #[serde(rename_all = "camelCase")]
    Newer { needed: String, current: String },
    /// A full workspace backup (.knot) renamed or opened by mistake.
    Backup,
    /// Damaged, incomplete or not a .knotbook.
    Invalid { reason: String },
}

#[derive(Serialize)]
pub struct InspectedNotebook {
    pub id: String,
    pub collection: Vec<u8>,
    pub document: Vec<u8>,
    /// "new", "library" (already here, different) or "current" (identical).
    pub status: String,
    /// The existing notebook's title when it's already in the Library.
    pub existing_title: Option<String>,
}
#[derive(Serialize)]
pub struct Inspected {
    pub manifest: PackageManifest,
    pub notebooks: Vec<InspectedNotebook>,
    pub cards: serde_json::Map<String, serde_json::Value>,
    pub size: u64,
}

fn version_core(version: &str) -> Option<(u64, u64, u64)> {
    let core = version.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}
fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn invalid(reason: impl Into<String>) -> Blocked {
    Blocked::Invalid { reason: reason.into() }
}

struct Reader {
    archive: zip::ZipArchive<File>,
}
impl Reader {
    fn bytes(&mut self, name: &str, limit: u64) -> std::result::Result<Vec<u8>, Blocked> {
        let entry = self
            .archive
            .by_name(name)
            .map_err(|_| invalid(format!("{name} is missing")))?;
        if entry.size() > limit {
            return Err(invalid(format!("{name} is too large")));
        }
        let mut data = Vec::with_capacity(entry.size() as usize);
        entry
            .take(limit + 1)
            .read_to_end(&mut data)
            .map_err(|_| invalid(format!("{name} is damaged")))?;
        if data.len() as u64 > limit {
            return Err(invalid(format!("{name} is too large")));
        }
        Ok(data)
    }
}

/// Opens and fully checks a package: allowed paths only, sizes, manifest,
/// every notebook present, every asset matching its hash. Nothing is written.
fn open(path: &Path) -> std::result::Result<(Reader, PackageManifest), Blocked> {
    let file = File::open(path).map_err(|_| invalid("the file can't be read"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| invalid("not a .knotbook file"))?;
    if archive.len() > MAX_ENTRIES {
        return Err(invalid("too many entries"));
    }
    let mut names = HashSet::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| invalid("damaged entry"))?;
        let name = entry.name().to_string();
        let mode = entry.unix_mode().unwrap_or(0);
        if entry.is_dir() || mode & 0o170000 == 0o120000 {
            return Err(invalid("unexpected folder or link"));
        }
        total = total.saturating_add(entry.size());
        if total > MAX_TOTAL_BYTES + 64 * 1024 * 1024 {
            return Err(invalid("larger than 1 GB"));
        }
        if !names.insert(name.clone()) {
            return Err(invalid("duplicate entry"));
        }
    }
    if names.contains("workspace.json") && names.contains("knot.db") {
        return Err(Blocked::Backup);
    }
    for name in &names {
        let allowed = name == "manifest.json"
            || name == "cards.json"
            || name
                .strip_prefix("assets/")
                .is_some_and(is_hash)
            || name.strip_prefix("notebooks/").is_some_and(|rest| {
                let mut parts = rest.split('/');
                matches!(
                    (parts.next(), parts.next(), parts.next()),
                    (Some(id), Some("collection.bin" | "document.bin"), None) if safe_id(id)
                )
            });
        if !allowed {
            return Err(invalid("unexpected contents"));
        }
    }
    let mut reader = Reader { archive };
    let manifest: serde_json::Value = serde_json::from_slice(&reader.bytes("manifest.json", 16 * 1024 * 1024)?)
        .map_err(|_| invalid("unreadable manifest"))?;
    if manifest.get("format").and_then(|f| f.as_str()) != Some(FORMAT) {
        return Err(invalid("not a .knotbook file"));
    }
    let current = env!("CARGO_PKG_VERSION").to_string();
    let format_version = manifest.get("formatVersion").and_then(|v| v.as_u64()).unwrap_or(0);
    let needed = manifest
        .get("minKnotVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if format_version > FORMAT_VERSION as u64
        || version_core(&needed).zip(version_core(&current)).is_some_and(|(n, c)| n > c)
    {
        return Err(Blocked::Newer { needed, current });
    }
    let manifest: PackageManifest =
        serde_json::from_value(manifest).map_err(|_| invalid("unreadable manifest"))?;
    if format_version != FORMAT_VERSION as u64 || version_core(&manifest.min_knot_version).is_none() {
        return Err(invalid("unsupported format"));
    }
    validate_shared_by(&manifest.shared_by).map_err(|_| invalid("missing sender name"))?;
    if manifest.notebooks.is_empty() || manifest.notebooks.len() > MAX_NOTEBOOKS {
        return Err(invalid("no notebooks"));
    }
    let mut ids = HashSet::new();
    for notebook in &manifest.notebooks {
        if !safe_id(&notebook.id) || !ids.insert(notebook.id.as_str()) {
            return Err(invalid("bad notebook id"));
        }
        if !matches!(notebook.kind.as_str(), "note" | "whiteboard") || !is_hash(&notebook.sha256) {
            return Err(invalid("bad notebook entry"));
        }
        for part in ["collection.bin", "document.bin"] {
            if !names.contains(&format!("notebooks/{}/{part}", notebook.id)) {
                return Err(invalid("a notebook is incomplete"));
            }
        }
    }
    if !ids.contains(manifest.root.as_str()) {
        return Err(invalid("missing root notebook"));
    }
    let listed_notebooks = names.iter().filter(|n| n.starts_with("notebooks/")).count();
    if listed_notebooks != manifest.notebooks.len() * 2 {
        return Err(invalid("unlisted notebook files"));
    }
    let mut attachment_ids = HashSet::new();
    let mut hashes = HashSet::new();
    for attachment in &manifest.attachments {
        if attachment.id.is_empty()
            || attachment.id.len() > 256
            || attachment.id.chars().any(char::is_control)
            || !attachment_ids.insert(attachment.id.as_str())
            || !is_hash(&attachment.sha256)
            || attachment.size < 0
            || attachment.size as u64 > MAX_ASSET_BYTES
        {
            return Err(invalid("bad attachment entry"));
        }
        if !names.contains(&format!("assets/{}", attachment.sha256)) {
            return Err(invalid("an attachment is missing"));
        }
        hashes.insert(attachment.sha256.clone());
    }
    for notebook in &manifest.notebooks {
        if notebook.attachments.iter().any(|a| !attachment_ids.contains(a.as_str())) {
            return Err(invalid("a notebook lists an unknown attachment"));
        }
    }
    let assets: Vec<String> = names
        .iter()
        .filter_map(|n| n.strip_prefix("assets/").map(String::from))
        .collect();
    if assets.len() != hashes.len() || assets.iter().any(|h| !hashes.contains(h)) {
        return Err(invalid("unlisted attachment files"));
    }
    for hash in assets {
        let mut entry = reader
            .archive
            .by_name(&format!("assets/{hash}"))
            .map_err(|_| invalid("an attachment is missing"))?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 1 << 16];
        let mut read = 0u64;
        loop {
            let n = entry.read(&mut buffer).map_err(|_| invalid("an attachment is damaged"))?;
            if n == 0 {
                break;
            }
            read += n as u64;
            if read > MAX_ASSET_BYTES {
                return Err(invalid("an attachment is too large"));
            }
            hasher.update(&buffer[..n]);
        }
        if format!("{:x}", hasher.finalize()) != hash {
            return Err(invalid("an attachment is damaged"));
        }
    }
    Ok((reader, manifest))
}

/// Everything the import dialog needs, or why the file can't be imported.
pub fn inspect(ws: &Workspace, path: &Path) -> std::result::Result<Inspected, Blocked> {
    let (mut reader, manifest) = open(path)?;
    let cards: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&reader.bytes("cards.json", 256 * 1024 * 1024)?)
            .map_err(|_| invalid("unreadable cards"))?;
    let mut notebooks = Vec::new();
    let mut size = serde_json::to_vec(&cards).map_or(0, |c| c.len() as u64);
    for notebook in &manifest.notebooks {
        let collection = reader.bytes(&format!("notebooks/{}/collection.bin", notebook.id), 64 * 1024 * 1024)?;
        let document = reader.bytes(&format!("notebooks/{}/document.bin", notebook.id), 64 * 1024 * 1024)?;
        if collection.is_empty() || document.is_empty() {
            return Err(invalid("a notebook is empty"));
        }
        if format!("{:x}", Sha256::digest(&document)) != notebook.sha256 {
            return Err(invalid("a notebook is damaged"));
        }
        size += (collection.len() + document.len()) as u64;
        let existing = ws
            .db
            .query_row(
                "SELECT o.title, o.deleted_at IS NULL, d.document_state FROM objects o LEFT JOIN documents d ON d.object_id=o.id WHERE o.id=?1",
                [&notebook.id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?, r.get::<_, Option<Vec<u8>>>(2)?)),
            )
            .optional()
            .map_err(|_| invalid("the workspace can't be read"))?;
        let (status, existing_title) = match existing {
            None => ("new", None),
            Some((title, live, body)) => {
                let same = live
                    && title == notebook.title
                    && body.is_some_and(|b| format!("{:x}", Sha256::digest(&b)) == notebook.sha256);
                (if same { "current" } else { "library" }, Some(title))
            }
        };
        notebooks.push(InspectedNotebook {
            id: notebook.id.clone(),
            collection,
            document,
            status: status.into(),
            existing_title,
        });
    }
    let mut hashes = HashSet::new();
    size += manifest
        .attachments
        .iter()
        .filter(|a| hashes.insert(a.sha256.clone()))
        .map(|a| a.size as u64)
        .sum::<u64>();
    Ok(Inspected { manifest, notebooks, cards, size })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub source_id: String,
    pub target_id: String,
    /// "new" (a fresh object, original or new ID) or "replace" (overwrite mine).
    pub mode: String,
    pub title: String,
    pub collection: Vec<u8>,
    pub document: Vec<u8>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlan {
    pub items: Vec<ImportItem>,
    /// Card-deck entries to write, already given new IDs where needed.
    pub cards: serde_json::Map<String, serde_json::Value>,
    pub collection: Option<String>,
}

/// Imports in one transaction after staging attachments. "Replace" makes a
/// managed backup first. Returns the IDs written, in plan order.
pub fn import(
    ws: &mut Workspace,
    backups: &Path,
    path: &Path,
    plan: &ImportPlan,
) -> Result<Vec<String>> {
    let (mut reader, manifest) = open(path).map_err(|b| format!("This file can't be imported: {b:?}"))?;
    if plan.items.is_empty() || plan.items.len() > manifest.notebooks.len() {
        return Err("Choose at least one notebook to import".into());
    }
    let by_id: BTreeMap<&str, &ManifestNotebook> =
        manifest.notebooks.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut sources = HashSet::new();
    let mut targets = HashSet::new();
    for item in &plan.items {
        if !by_id.contains_key(item.source_id.as_str())
            || !sources.insert(item.source_id.as_str())
            || !safe_id(&item.target_id)
            || !targets.insert(item.target_id.as_str())
        {
            return Err("Invalid import selection".into());
        }
        let title = item.title.trim();
        if title.is_empty() || title.chars().count() > 300 {
            return Err("Invalid notebook title".into());
        }
        let exists: bool = ws.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM objects WHERE id=?1)",
            [&item.target_id],
            |r| r.get(0),
        )?;
        match item.mode.as_str() {
            "new" if !exists => {}
            "replace" if exists && item.target_id == item.source_id => {}
            "new" => return Err("A notebook with this ID already exists; refresh and try again".into()),
            _ => return Err("Invalid import selection".into()),
        }
    }
    if let Some(collection) = &plan.collection {
        let live: bool = ws.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM collections WHERE id=?1 AND deleted_at IS NULL)",
            [collection],
            |r| r.get(0),
        )?;
        if !live {
            return Err("That collection no longer exists".into());
        }
    }
    if plan.items.iter().any(|i| i.mode == "replace") {
        crate::managed_backups::create(backups, ws)
            .map_err(|e| format!("Nothing was imported: the backup before replacing failed. {e}"))?;
    }

    // Attachments the chosen notebooks and cards use.
    let attachments: BTreeMap<&str, &ManifestAttachment> =
        manifest.attachments.iter().map(|a| (a.id.as_str(), a)).collect();
    let mut needed: BTreeSet<&str> = BTreeSet::new();
    for item in &plan.items {
        for id in &by_id[item.source_id.as_str()].attachments {
            needed.insert(id.as_str());
        }
    }
    let mut card_strings = Vec::new();
    for card in plan.cards.values() {
        collect_strings(card, &mut card_strings);
    }
    for key in &card_strings {
        if let Some((id, _)) = attachments.get_key_value(key.as_str()) {
            needed.insert(id);
        }
    }
    let mut staged = HashSet::new();
    for id in &needed {
        let attachment = attachments[id];
        if !staged.insert(attachment.sha256.clone()) {
            continue;
        }
        let bytes = reader
            .bytes(&format!("assets/{}", attachment.sha256), MAX_ASSET_BYTES)
            .map_err(|b| format!("This file can't be imported: {b:?}"))?;
        if ws.stage_blob(&bytes)? != attachment.sha256 {
            return Err("An attachment failed its integrity check".into());
        }
    }

    let shared_by = validate_shared_by(&manifest.shared_by)?;
    let imported_at = now();
    let tx = ws.db.transaction()?;
    for id in &needed {
        let a = attachments[id];
        let previous: Option<String> = tx
            .query_row("SELECT sha256 FROM attachments WHERE id=?1", [a.id.as_str()], |r| r.get(0))
            .optional()?;
        if previous.as_deref().is_some_and(|h| h != a.sha256) {
            return Err("An attachment in this file conflicts with one in your workspace".into());
        }
        tx.execute(
            "INSERT OR IGNORE INTO attachments VALUES(?1,?2,?3,?4,?5)",
            rusqlite::params![a.id, a.sha256, a.name, a.mime, a.size],
        )?;
    }
    for item in &plan.items {
        let source = by_id[item.source_id.as_str()];
        let title = item.title.trim();
        if item.mode == "new" {
            tx.execute(
                "INSERT INTO objects(id,title,kind,updated_at,created_at) VALUES(?1,?2,?3,?4,?4)",
                rusqlite::params![item.target_id, title, source.kind, imported_at],
            )?;
        } else {
            tx.execute(
                "UPDATE objects SET title=?2, kind=?3, deleted_at=NULL, updated_at=?4 WHERE id=?1",
                rusqlite::params![item.target_id, title, source.kind, imported_at],
            )?;
        }
        Workspace::write_snapshot(
            &tx,
            &item.target_id,
            &crate::storage::Snapshot {
                collection: item.collection.clone(),
                document: item.document.clone(),
                title: Some(title.to_string()),
            },
        )?;
        for attachment in &source.attachments {
            tx.execute(
                "INSERT OR IGNORE INTO object_attachments VALUES(?1,?2)",
                rusqlite::params![item.target_id, attachment],
            )?;
        }
        if let Some(collection) = &plan.collection {
            tx.execute(
                "INSERT OR IGNORE INTO collection_objects(object_id, collection_id) VALUES(?1,?2)",
                rusqlite::params![item.target_id, collection],
            )?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO notebook_origins VALUES(?1,?2,?3,?4)",
            rusqlite::params![item.target_id, shared_by, imported_at, item.source_id],
        )?;
        tx.execute("DELETE FROM unshared_references WHERE object_id=?1", [&item.target_id])?;
    }
    if !plan.cards.is_empty() {
        let raw: String = tx.query_row("SELECT content FROM card_deck WHERE id=1", [], |r| r.get(0))?;
        let mut deck: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&raw)?;
        for (id, card) in &plan.cards {
            if id.is_empty() || id.len() > 128 || !card.is_object() {
                return Err("Invalid card in this file".into());
            }
            deck.insert(id.clone(), card.clone());
        }
        tx.execute(
            "UPDATE card_deck SET content=?1 WHERE id=1",
            [serde_json::to_string(&deck)?],
        )?;
    }
    for missing in &manifest.unshared {
        tx.execute(
            "INSERT OR IGNORE INTO unshared_references SELECT ?1,?2,?3 WHERE NOT EXISTS(SELECT 1 FROM objects WHERE id=?1)",
            rusqlite::params![missing.id, missing.title, shared_by],
        )?;
    }
    tx.commit()?;
    for item in plan.items.iter().filter(|i| i.mode == "replace") {
        crate::canvas_previews::remove_document(&ws.root, &item.target_id);
    }
    Ok(plan.items.iter().map(|i| i.target_id.clone()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Snapshot;

    fn note(w: &mut Workspace, document: &[u8]) -> String {
        let id = w.create("note").unwrap();
        w.save(&id, &Snapshot { title: None, collection: vec![7], document: document.to_vec() })
            .unwrap();
        id
    }
    fn entry(id: &str, role: &str, parent: Option<&str>) -> ShareEntry {
        ShareEntry { id: id.into(), role: role.into(), parent: parent.map(Into::into) }
    }

    #[test]
    fn writes_notebooks_cards_and_each_attachment_once() {
        let tmp = tempfile::tempdir().unwrap();
        let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
        let physics = note(&mut w, b"physics-body");
        let waves = note(&mut w, b"waves-body");
        w.put_blob(&physics, "img-a", b"same bytes", "a.png", "image/png").unwrap();
        w.put_blob(&waves, "img-b", b"same bytes", "b.png", "image/png").unwrap();
        w.put_blob(&physics, "card-img", b"card picture", "c.png", "image/png").unwrap();
        w.db.execute(
            "UPDATE card_deck SET content=?1 WHERE id=1",
            [r#"{"card-1":{"title":"Wave","image":"card-img"},"card-2":{"deleted":true}}"#],
        )
        .unwrap();

        let entries = [entry(&physics, "root", None), entry(&waves, "canvas", Some(&physics))];
        let package = collect(&w, &entries, &["card-1".into(), "card-2".into(), "missing".into()]).unwrap();
        let dest = tmp.path().join(filename("Physics"));
        let unshared = [Unshared { id: "elsewhere".into(), title: "Exam timetable".into() }];
        write(&w, &dest, &package, &unshared, " Danish ").unwrap();

        let mut archive = zip::ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let mut names: Vec<String> = archive.file_names().map(String::from).collect();
        names.sort();
        let same = format!("{:x}", Sha256::digest(b"same bytes"));
        let card = format!("{:x}", Sha256::digest(b"card picture"));
        let mut expected = vec![
            format!("assets/{same}"),
            format!("assets/{card}"),
            "cards.json".to_string(),
            "manifest.json".to_string(),
            format!("notebooks/{physics}/collection.bin"),
            format!("notebooks/{physics}/document.bin"),
            format!("notebooks/{waves}/collection.bin"),
            format!("notebooks/{waves}/document.bin"),
        ];
        expected.sort();
        assert_eq!(names, expected);

        let mut text = String::new();
        archive.by_name("manifest.json").unwrap().read_to_string(&mut text).unwrap();
        let manifest: PackageManifest = serde_json::from_str(&text).unwrap();
        assert_eq!(manifest.format, "knotbook");
        assert_eq!(manifest.root, physics);
        assert_eq!(manifest.shared_by, "Danish");
        assert_eq!(manifest.cards, 1);
        assert_eq!(manifest.attachments.len(), 3);
        assert_eq!(manifest.unshared.len(), 1);
        assert_eq!(manifest.notebooks[1].role, "canvas");
        assert_eq!(
            manifest.notebooks[0].sha256,
            format!("{:x}", Sha256::digest(b"physics-body"))
        );
        let mut cards = String::new();
        archive.by_name("cards.json").unwrap().read_to_string(&mut cards).unwrap();
        assert!(cards.contains("card-1") && !cards.contains("card-2"));
    }

    #[test]
    fn refuses_trash_duplicates_and_existing_files() {
        let tmp = tempfile::tempdir().unwrap();
        let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
        let a = note(&mut w, b"a");
        let b = note(&mut w, b"b");
        assert!(collect(&w, &[entry(&a, "root", None), entry(&a, "canvas", None)], &[]).is_err());
        assert!(collect(&w, &[entry(&a, "canvas", None)], &[]).is_err());
        w.delete(&b).unwrap();
        assert!(collect(&w, &[entry(&a, "root", None), entry(&b, "linked", Some(&a))], &[]).is_err());

        let package = collect(&w, &[entry(&a, "root", None)], &[]).unwrap();
        let dest = tmp.path().join("taken.knotbook");
        std::fs::write(&dest, b"keep me").unwrap();
        assert!(write(&w, &dest, &package, &[], "Danish").is_err());
        assert_eq!(std::fs::read(&dest).unwrap(), b"keep me");
        assert!(write(&w, &tmp.path().join("new.knotbook"), &package, &[], "  ").is_err());
    }

    #[test]
    fn filenames_are_safe_on_windows() {
        assert_eq!(filename("Physics"), "Physics.knotbook");
        assert_eq!(filename("a/b:c"), "a-b-c.knotbook");
        assert_eq!(filename("  "), "Untitled.knotbook");
        assert_eq!(filename("CON"), "Knot CON.knotbook");
        assert_eq!(filename("Notes."), "Notes.knotbook");
    }

    #[test]
    fn unshared_never_lists_included_notebooks() {
        let tmp = tempfile::tempdir().unwrap();
        let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
        let a = note(&mut w, b"a");
        let package = collect(&w, &[entry(&a, "root", None)], &[]).unwrap();
        let dest = tmp.path().join("one.knotbook");
        write(&w, &dest, &package, &[Unshared { id: a.clone(), title: "Self".into() }], "Danish").unwrap();
        let mut archive = zip::ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let mut text = String::new();
        archive.by_name("manifest.json").unwrap().read_to_string(&mut text).unwrap();
        let manifest: PackageManifest = serde_json::from_str(&text).unwrap();
        assert!(manifest.unshared.is_empty());
    }

    fn share(w: &Workspace, dir: &Path, entries: &[ShareEntry], cards: &[String], unshared: &[Unshared]) -> std::path::PathBuf {
        let package = collect(w, entries, cards).unwrap();
        let dest = dir.join(format!("{}.knotbook", uuid::Uuid::new_v4()));
        write(w, &dest, &package, unshared, "Danish").unwrap();
        dest
    }
    fn item(inspected: &Inspected, source: &str, target: &str, mode: &str, title: &str) -> ImportItem {
        let n = inspected.notebooks.iter().find(|n| n.id == source).unwrap();
        ImportItem {
            source_id: source.into(),
            target_id: target.into(),
            mode: mode.into(),
            title: title.into(),
            collection: n.collection.clone(),
            document: n.document.clone(),
        }
    }

    #[test]
    fn imports_into_another_workspace_with_cards_attachments_and_origins() {
        let tmp = tempfile::tempdir().unwrap();
        let mut a = Workspace::open(tmp.path().join("a")).unwrap();
        let physics = note(&mut a, b"physics");
        a.rename(&physics, "Physics").unwrap();
        a.put_blob(&physics, "img", b"picture", "p.png", "image/png").unwrap();
        a.put_blob(&physics, "card-img", b"card picture", "c.png", "image/png").unwrap();
        a.db.execute("UPDATE card_deck SET content=?1 WHERE id=1", [r#"{"card-1":{"image":"card-img"}}"#]).unwrap();
        let file = share(&a, tmp.path(), &[entry(&physics, "root", None)], &["card-1".into()],
            &[Unshared { id: "gone".into(), title: "Exam timetable".into() }]);

        let mut b = Workspace::open(tmp.path().join("b")).unwrap();
        let collection = b.create_collection("UniKL", None).unwrap();
        let inspected = inspect(&b, &file).unwrap();
        assert_eq!(inspected.notebooks[0].status, "new");
        let plan = ImportPlan {
            items: vec![item(&inspected, &physics, &physics, "new", "Physics")],
            cards: inspected.cards.clone(),
            collection: Some(collection.clone()),
        };
        let written = import(&mut b, &tmp.path().join("backups-b"), &file, &plan).unwrap();
        assert_eq!(written, vec![physics.clone()]);
        assert_eq!(b.load(&physics).unwrap().unwrap().document, b"physics");
        assert_eq!(b.get_blob("img").unwrap(), b"picture");
        assert_eq!(b.get_blob("card-img").unwrap(), b"card picture");
        let deck: String = b.db.query_row("SELECT content FROM card_deck WHERE id=1", [], |r| r.get(0)).unwrap();
        assert!(deck.contains("card-1"));
        let (by, source): (String, String) = b.db.query_row(
            "SELECT shared_by, source_id FROM notebook_origins WHERE object_id=?1", [&physics],
            |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((by.as_str(), source.as_str()), ("Danish", physics.as_str()));
        let in_collection: bool = b.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM collection_objects WHERE object_id=?1 AND collection_id=?2)",
            [&physics, &collection], |r| r.get(0)).unwrap();
        assert!(in_collection);
        let placeholder: String = b.db.query_row(
            "SELECT title FROM unshared_references WHERE object_id='gone'", [], |r| r.get(0)).unwrap();
        assert_eq!(placeholder, "Exam timetable");

        // The same file again: identical notebooks are "current".
        assert_eq!(inspect(&b, &file).unwrap().notebooks[0].status, "current");
        // A second "new" with the same ID is refused; nothing changes.
        assert!(import(&mut b, &tmp.path().join("backups-b"), &file, &plan).is_err());
    }

    #[test]
    fn keep_both_writes_a_new_id_and_replace_backs_up_first() {
        let tmp = tempfile::tempdir().unwrap();
        let mut a = Workspace::open(tmp.path().join("a")).unwrap();
        let waves = note(&mut a, b"shared waves");
        let file = share(&a, tmp.path(), &[entry(&waves, "root", None)], &[], &[]);

        let mut b = Workspace::open(tmp.path().join("b")).unwrap();
        b.db.execute("INSERT INTO objects(id,title,kind,updated_at) VALUES(?1,'Waves','note',1)", [&waves]).unwrap();
        b.save(&waves, &Snapshot { title: None, collection: vec![7], document: b"her waves".to_vec() }).unwrap();
        let inspected = inspect(&b, &file).unwrap();
        assert_eq!(inspected.notebooks[0].status, "library");
        assert_eq!(inspected.notebooks[0].existing_title.as_deref(), Some("Waves"));

        let copy = uuid::Uuid::new_v4().to_string();
        let keep = ImportPlan {
            items: vec![item(&inspected, &waves, &copy, "new", "Waves 2")],
            cards: Default::default(),
            collection: None,
        };
        import(&mut b, &tmp.path().join("backups"), &file, &keep).unwrap();
        assert_eq!(b.load(&waves).unwrap().unwrap().document, b"her waves");
        assert_eq!(b.load(&copy).unwrap().unwrap().document, b"shared waves");

        let backups = tmp.path().join("backups");
        let before = std::fs::read_dir(&backups).map(|d| d.count()).unwrap_or(0);
        let replace = ImportPlan {
            items: vec![item(&inspected, &waves, &waves, "replace", "Waves")],
            cards: Default::default(),
            collection: None,
        };
        import(&mut b, &backups, &file, &replace).unwrap();
        assert_eq!(b.load(&waves).unwrap().unwrap().document, b"shared waves");
        assert_eq!(std::fs::read_dir(&backups).unwrap().count(), before + 1);

        // Replace must target the same ID.
        let wrong = ImportPlan {
            items: vec![item(&inspected, &waves, &copy, "replace", "Waves")],
            cards: Default::default(),
            collection: None,
        };
        assert!(import(&mut b, &backups, &file, &wrong).is_err());
    }

    fn raw_zip(path: &Path, entries: &[(String, Vec<u8>)]) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, bytes) in entries {
            zip.start_file(name.as_str(), zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }
    fn entries_of(path: &Path) -> Vec<(String, Vec<u8>)> {
        let mut source = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        (0..source.len())
            .map(|i| {
                let mut e = source.by_index(i).unwrap();
                let mut data = Vec::new();
                e.read_to_end(&mut data).unwrap();
                (e.name().to_string(), data)
            })
            .collect()
    }

    #[test]
    fn refuses_newer_backups_traversal_and_damage() {
        let tmp = tempfile::tempdir().unwrap();
        let mut w = Workspace::open(tmp.path().join("w")).unwrap();
        let id = note(&mut w, b"body");
        w.put_blob(&id, "img", b"picture", "p.png", "image/png").unwrap();
        let good = share(&w, tmp.path(), &[entry(&id, "root", None)], &[], &[]);
        assert!(inspect(&w, &good).is_ok());

        let mut newer = entries_of(&good);
        for (name, data) in newer.iter_mut() {
            if name == "manifest.json" {
                let text = String::from_utf8(data.clone()).unwrap().replace(
                    &format!("\"minKnotVersion\": \"{MIN_KNOT_VERSION}\""),
                    "\"minKnotVersion\": \"9.0.0\"",
                );
                *data = text.into_bytes();
            }
        }
        let path = tmp.path().join("newer.knotbook");
        raw_zip(&path, &newer);
        assert!(matches!(inspect(&w, &path), Err(Blocked::Newer { needed, .. }) if needed == "9.0.0"));

        let mut traversal = entries_of(&good);
        traversal.push(("../evil.txt".into(), b"x".to_vec()));
        let path = tmp.path().join("traversal.knotbook");
        raw_zip(&path, &traversal);
        assert!(matches!(inspect(&w, &path), Err(Blocked::Invalid { .. })));

        let mut damaged = entries_of(&good);
        for (name, data) in damaged.iter_mut() {
            if name.starts_with("assets/") {
                *data = b"tampered".to_vec();
            }
        }
        let path = tmp.path().join("damaged.knotbook");
        raw_zip(&path, &damaged);
        assert!(matches!(inspect(&w, &path), Err(Blocked::Invalid { .. })));

        let path = tmp.path().join("backup.knotbook");
        raw_zip(&path, &[("workspace.json".into(), b"{}".to_vec()), ("knot.db".into(), b"x".to_vec())]);
        assert_eq!(inspect(&w, &path).err(), Some(Blocked::Backup));

        let path = tmp.path().join("notes.knotbook");
        std::fs::write(&path, b"just text").unwrap();
        assert!(matches!(inspect(&w, &path), Err(Blocked::Invalid { .. })));
    }
}
