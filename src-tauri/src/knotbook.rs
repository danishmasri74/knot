//! `.knotbook` packages: one or more notebooks shared as a single file.
//! Format and rules: docs/NOTEBOOK-SHARING-PLAN.md ("Package format").
//! This module writes packages; reading and importing come with the import slice.

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
            .prepare("SELECT attachment_id FROM object_attachments WHERE object_id=?1")?;
        for id in q.query_map([&entry.id], |r| r.get::<_, String>(0))? {
            attachment_ids.insert(id?);
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
}
