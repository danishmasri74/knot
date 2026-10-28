//! Recoverable, explicit cleanup of unindexed regular files. No database writes.
use crate::storage::{now, Result, Workspace};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Serialize)]
pub struct Candidate {
    pub id: String,
    pub path: String,
    pub size: u64,
    pub digest: String,
}
#[derive(Deserialize)]
pub struct Selection {
    pub id: String,
    pub size: u64,
    pub digest: String,
}
#[derive(Serialize, Deserialize, PartialEq)]
pub struct Entry {
    pub id: String,
    pub original: String,
    pub size: u64,
    pub digest: String,
    pub created_at: i64,
}
#[derive(Serialize, Default)]
pub struct Catalog {
    pub entries: Vec<Entry>,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
pub struct Outcome {
    pub id: String,
    pub error: Option<String>,
}

fn regular(path: &Path, directory: bool) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Links and redirected folders cannot be quarantined or restored".into());
        }
    }
    if meta.file_type().is_symlink()
        || (directory && !meta.is_dir())
        || (!directory && !meta.is_file())
    {
        return Err("Expected an ordinary file or directory, not a link".into());
    }
    Ok(())
}
fn relative(value: &str) -> Result<Vec<&str>> {
    let parts: Vec<_> = value.split('/').collect();
    if parts.is_empty()
        || parts.len() > 2
        || parts.iter().any(|p| {
            p.is_empty()
                || *p == "."
                || *p == ".."
                || p.ends_with(['.', ' '])
                || p.chars()
                    .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
        })
    {
        return Err("Invalid relative asset name".into());
    }
    // Also reject Windows device aliases on every platform.
    for part in &parts {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
            || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.len() == 4
                && stem.as_bytes()[3].is_ascii_digit())
        {
            return Err("Reserved asset name".into());
        }
    }
    Ok(parts)
}
fn asset(w: &Workspace, name: &str, create_parent: bool) -> Result<PathBuf> {
    let parts = relative(name)?;
    let mut path = w.root.join("assets");
    regular(&path, true)?;
    if parts.len() == 2 {
        path.push(parts[0]);
        if create_parent && !path.try_exists()? {
            fs::create_dir(&path)?;
        }
        regular(&path, true)?;
    }
    path.push(parts.last().unwrap());
    Ok(path)
}
fn fingerprint(path: &Path) -> Result<(u64, String)> {
    regular(path, false)?;
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
        size += count as u64;
    }
    Ok((size, format!("{:x}", hash.finalize())))
}
fn id(w: &Workspace, name: &str) -> Result<String> {
    let mut hash = Sha256::new();
    hash.update(w.root.canonicalize()?.to_string_lossy().as_bytes());
    hash.update([0]);
    hash.update(name.as_bytes());
    Ok(format!("{:x}", hash.finalize()))
}
fn known(w: &Workspace) -> Result<HashSet<String>> {
    let mut check = w.db.prepare("PRAGMA integrity_check")?;
    for row in check.query_map([], |r| r.get::<_, String>(0))? {
        if row? != "ok" {
            return Err("Database integrity failed; cleanup is disabled".into());
        }
    }
    if w.db
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        return Err("Broken database relationships; cleanup is disabled".into());
    }
    let mut query = w.db.prepare("SELECT DISTINCT sha256 FROM attachments")?;
    let hashes = query
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<HashSet<_>, _>>()?;
    for hash in &hashes {
        w.asset_path(hash)?;
    }
    Ok(hashes)
}
fn asset_names(w: &Workspace) -> Result<Vec<String>> {
    let root = w.root.join("assets");
    regular(&root, true)?;
    let mut names = Vec::new();
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if regular(&entry.path(), false).is_ok() {
            names.push(name);
        } else if regular(&entry.path(), true).is_ok() {
            for child in fs::read_dir(entry.path())? {
                let child = child?;
                if regular(&child.path(), false).is_ok() {
                    if let Some(child) = child.file_name().to_str() {
                        names.push(format!("{name}/{child}"));
                    }
                }
            }
        }
    }
    names.sort();
    Ok(names)
}
pub fn preview(w: &Workspace) -> Result<Vec<Candidate>> {
    let known = known(w)?;
    let names = asset_names(w)?;
    let mut result = Vec::new();
    for name in names {
        if relative(&name).is_err() {
            continue;
        }
        if known.contains(name.rsplit('/').next().unwrap()) {
            continue;
        }
        let path = asset(w, &name, false)?;
        let (size, digest) = fingerprint(&path)?;
        if known.contains(&digest) {
            continue;
        }
        result.push(Candidate {
            id: id(w, &name)?,
            path: name,
            size,
            digest,
        });
    }
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}
fn quarantine_root(w: &Workspace, create: bool) -> Result<PathBuf> {
    let path = w.root.join("quarantine");
    if create && !path.try_exists()? {
        fs::create_dir(&path)?;
    }
    regular(&path, true)?;
    Ok(path)
}
fn entry_dir(w: &Workspace, id: &str) -> Result<PathBuf> {
    if uuid::Uuid::parse_str(id)?.to_string() != id {
        return Err("Invalid quarantine ID".into());
    }
    let path = quarantine_root(w, false)?.join(id);
    regular(&path, true)?;
    Ok(path)
}
fn read_entry(w: &Workspace, id: &str) -> Result<Entry> {
    let path = entry_dir(w, id)?;
    regular(&path.join("entry.json"), false)?;
    let entry: Entry = serde_json::from_reader(File::open(path.join("entry.json"))?)?;
    if entry.id != id {
        return Err("Quarantine metadata ID mismatch".into());
    }
    relative(&entry.original)?;
    if fingerprint(&path.join("payload"))? != (entry.size, entry.digest.clone()) {
        return Err("Quarantine payload is missing or damaged; retained for recovery".into());
    }
    Ok(entry)
}
pub fn catalog(w: &Workspace) -> Result<Catalog> {
    let mut result = Catalog::default();
    if !w.root.join("quarantine").try_exists()? {
        return Ok(result);
    }
    for dir in fs::read_dir(quarantine_root(w, false)?)? {
        let dir = dir?;
        let name = dir.file_name().to_string_lossy().to_string();
        match read_entry(w, &name) {
            Ok(entry) => result.entries.push(entry),
            Err(error) => result
                .warnings
                .push(format!("{name}: {error}. Files have been retained.")),
        }
    }
    result
        .entries
        .sort_by(|a, b| b.created_at.cmp(&a.created_at).then(a.id.cmp(&b.id)));
    result.warnings.sort();
    Ok(result)
}
// Publish a synced independent copy without ever replacing an existing path.
fn copy_new(source: &Path, dest: &Path) -> Result<()> {
    regular(source, false)?;
    let mut temp = tempfile::NamedTempFile::new_in(dest.parent().ok_or("Missing parent")?)?;
    std::io::copy(&mut File::open(source)?, temp.as_file_mut())?;
    temp.as_file().sync_all()?;
    temp.persist_noclobber(dest).map_err(|e| e.error)?;
    Ok(())
}
fn move_one(w: &Workspace, candidate: &Candidate) -> Result<()> {
    let source = asset(w, &candidate.path, false)?;
    if fingerprint(&source)? != (candidate.size, candidate.digest.clone()) {
        return Err("File changed since preview; refresh before trying again".into());
    }
    let root = quarantine_root(w, true)?;
    let entry = Entry {
        id: uuid::Uuid::new_v4().to_string(),
        original: candidate.path.clone(),
        size: candidate.size,
        digest: candidate.digest.clone(),
        created_at: now(),
    };
    let dir = root.join(&entry.id);
    fs::create_dir(&dir)?;
    // Journal is synced before copying/removing anything. Incomplete entries are
    // reported by catalog; never discard an interrupted recovery copy.
    let mut meta = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join("entry.json"))?;
    meta.write_all(&serde_json::to_vec_pretty(&entry)?)?;
    meta.sync_all()?;
    copy_new(&source, &dir.join("payload"))?;
    read_entry(w, &entry.id)?;
    if fingerprint(&asset(w, &candidate.path, false)?)?
        != (candidate.size, candidate.digest.clone())
    {
        return Err("Source changed while copying; source and recovery copy retained".into());
    }
    fs::remove_file(source)?;
    Ok(())
}
pub fn quarantine(w: &Workspace, selected: &[Selection]) -> Result<Vec<Outcome>> {
    if selected.is_empty() || selected.len() > 100 {
        return Err("Select between 1 and 100 files".into());
    }
    let candidates = preview(w)?; // Revalidates every indexed hash under workspace mutex.
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for selection in selected {
        let outcome = if !seen.insert(&selection.id) {
            Err("Duplicate selection".into())
        } else if let Some(candidate) = candidates.iter().find(|c| {
            c.id == selection.id && c.size == selection.size && c.digest == selection.digest
        }) {
            move_one(w, candidate)
        } else {
            Err("File is changed, missing, or protected by the attachment index; refresh the preview".into())
        };
        results.push(Outcome {
            id: selection.id.clone(),
            error: outcome
                .err()
                .map(|e: Box<dyn std::error::Error + Send + Sync>| e.to_string()),
        });
    }
    Ok(results)
}
pub fn restore(w: &Workspace, id: &str) -> Result<()> {
    let entry = read_entry(w, id)?;
    let target = asset(w, &entry.original, true)?;
    if fs::symlink_metadata(&target).is_ok() {
        return Err(
            "Original location already exists; nothing was overwritten. Quarantine copy retained"
                .into(),
        );
    }
    let mut query =
        w.db.prepare("SELECT DISTINCT sha256,size FROM attachments")?;
    for row in query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)))? {
        let (hash, size) = row?;
        if w.asset_path(&hash)? == target && (hash != entry.digest || size != entry.size) {
            return Err(
                "Original path is now indexed with different content; recovery copy retained"
                    .into(),
            );
        }
    }
    copy_new(&entry_dir(w, id)?.join("payload"), &target)?;
    // Recovery copy stays intact, including if final verification fails.
    if fingerprint(&target)? != (entry.size, entry.digest) {
        return Err("Restored copy verification failed; quarantine copy retained".into());
    }
    Ok(())
}

// Delete only the explicitly reviewed payload. Never traverse or remove a tree.
// Metadata cleanup failures are warnings after the irreversible payload removal.
pub fn dispose(w: &Workspace, expected: &Entry) -> Result<Option<String>> {
    let entry = read_entry(w, &expected.id)?;
    if &entry != expected {
        return Err("Recovery copy changed; refresh before permanently deleting it".into());
    }
    let hashes = known(w)?;
    if hashes.contains(&entry.digest) || hashes.contains(entry.original.rsplit('/').next().unwrap())
    {
        return Err(
            "Recovery copy is protected by the attachment index; retained for recovery".into(),
        );
    }
    let dir = entry_dir(w, &entry.id)?;
    // Unexpected files may be recovery material. Leave the entire entry alone.
    for child in fs::read_dir(&dir)? {
        let child = child?;
        if child.file_name() != "entry.json" && child.file_name() != "payload" {
            return Err(
                "Recovery folder contains unexpected files; retained for inspection".into(),
            );
        }
    }
    if read_entry(w, &entry.id)? != entry {
        return Err("Recovery copy changed during validation; retained".into());
    }
    fs::remove_file(dir.join("payload"))?;
    let cleanup = fs::remove_file(dir.join("entry.json")).and_then(|()| fs::remove_dir(&dir));
    Ok(cleanup
        .err()
        .map(|e| format!("Payload permanently deleted, but recovery metadata cleanup failed: {e}")))
}

/// Restore only absent indexed assets from exact local copies. No index writes.
pub fn recover_missing(w: &Workspace, hash: &str) -> Result<String> {
    let target = w.asset_path(hash)?;
    if !known(w)?.contains(hash) {
        return Err("Attachment is no longer indexed; refresh the integrity report".into());
    }
    let sizes =
        w.db.prepare("SELECT DISTINCT size FROM attachments WHERE sha256=?1")?
            .query_map([hash], |r| r.get::<_, u64>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
    if sizes.len() != 1 {
        return Err("Attachment index has conflicting sizes; no files changed".into());
    }
    let expected = (sizes[0], hash.to_string());
    // asset() checks every parent, including Windows redirects.
    let relative_target = format!("{}/{hash}", &hash[..2]);
    asset(w, &relative_target, true)?;
    match fs::symlink_metadata(&target) {
        Ok(_) => {
            return Err("Attachment destination already exists; nothing was overwritten".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e.into()),
    }
    let mut sources = Vec::new();
    for name in asset_names(w)? {
        if let Ok(path) = asset(w, &name, false) {
            if fingerprint(&path).is_ok_and(|value| value == expected) {
                sources.push((path, format!("assets/{name}")));
            }
        }
    }
    for entry in catalog(w)?.entries {
        if (entry.size, entry.digest) == expected {
            sources.push((
                entry_dir(w, &entry.id)?.join("payload"),
                format!("quarantine/{}", entry.id),
            ));
        }
    }
    let (source, label) = sources.first().ok_or("No exact local recovery copy found. Restore a known backup into a separate workspace to inspect it.")?;
    regular(source, false)?;
    let mut temp = tempfile::NamedTempFile::new_in(target.parent().ok_or("Missing parent")?)?;
    std::io::copy(&mut File::open(source)?, temp.as_file_mut())?;
    temp.as_file().sync_all()?;
    if fingerprint(temp.path())? != expected {
        return Err("Recovery source changed while copying; no attachment was published".into());
    }
    temp.persist_noclobber(&target).map_err(|e| e.error)?;
    Ok(label.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Snapshot;
    fn select(c: &Candidate) -> Selection {
        Selection {
            id: c.id.clone(),
            size: c.size,
            digest: c.digest.clone(),
        }
    }
    #[test]
    fn missing_attachment_recovery_preserves_shared_trash_and_source() {
        let tmp = tempfile::tempdir().unwrap();
        let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
        let a = w.create("note").unwrap();
        let b = w.create("whiteboard").unwrap();
        for doc in [&a, &b] {
            w.put_blob(doc, "shared", b"original", "asset", "text/plain")
                .unwrap();
        }
        w.delete(&b).unwrap();
        let hash = format!("{:x}", Sha256::digest(b"original"));
        let target = w.asset_path(&hash).unwrap();
        fs::remove_file(&target).unwrap();
        assert!(recover_missing(&w, &hash).is_err());
        let source = file(&w, "misplaced", b"original");
        w.db.execute_batch("PRAGMA query_only=ON").unwrap();
        assert_eq!(recover_missing(&w, &hash).unwrap(), "assets/misplaced");
        assert_eq!(w.get_blob("shared").unwrap(), b"original");
        assert_eq!(fs::read(&source).unwrap(), b"original");
        assert_eq!(w.blobs(&a).unwrap(), vec!["shared"]);
        assert_eq!(w.blobs(&b).unwrap(), vec!["shared"]);
        assert_eq!(w.trash("", 0).unwrap()[0].object.id, b);
        assert!(recover_missing(&w, &hash).is_err());
        fs::write(&target, b"damaged").unwrap();
        assert!(recover_missing(&w, &hash).is_err());
        assert_eq!(fs::read(target).unwrap(), b"damaged");
        assert!(recover_missing(&w, "../escape").is_err());
        assert!(recover_missing(&w, &"a".repeat(64)).is_err());
    }
    #[test]
    fn missing_attachment_recovers_quarantine_but_refuses_inconsistent_index() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("workspace");
        let mut w = Workspace::open(root.clone()).unwrap();
        file(&w, "orphan", b"recovery bytes");
        quarantine(&w, &[select(&preview(&w).unwrap()[0])]).unwrap();
        let entry = catalog(&w).unwrap().entries.remove(0);
        let doc = w.create("note").unwrap();
        w.put_blob(&doc, "key", b"recovery bytes", "asset", "text/plain")
            .unwrap();
        fs::remove_file(w.asset_path(&entry.digest).unwrap()).unwrap();
        w.db.execute(
            "INSERT INTO attachments VALUES ('conflict',?1,'bad','text/plain',1)",
            [&entry.digest],
        )
        .unwrap();
        assert!(recover_missing(&w, &entry.digest).is_err());
        w.db.execute("DELETE FROM attachments WHERE id='conflict'", [])
            .unwrap();
        let payload = entry_dir(&w, &entry.id).unwrap().join("payload");
        fs::write(&payload, b"damaged").unwrap();
        assert!(recover_missing(&w, &entry.digest).is_err());
        fs::write(&payload, b"recovery bytes").unwrap();
        assert_eq!(
            recover_missing(&w, &entry.digest).unwrap(),
            format!("quarantine/{}", entry.id)
        );
        assert_eq!(fs::read(payload).unwrap(), b"recovery bytes");
        drop(w);
        let w = Workspace::open(root).unwrap();
        assert_eq!(w.get_blob("key").unwrap(), b"recovery bytes");
        assert_eq!(catalog(&w).unwrap().entries.len(), 1);
    }
    #[test]
    fn disposal_revalidates_and_preserves_restored_files_and_database() {
        let tmp = tempfile::tempdir().unwrap();
        let w = Workspace::open(tmp.path().join("workspace")).unwrap();
        let source = file(&w, "orphan", b"recover me");
        quarantine(&w, &[select(&preview(&w).unwrap()[0])]).unwrap();
        let mut entry = catalog(&w).unwrap().entries.remove(0);
        entry.size += 1;
        assert!(dispose(&w, &entry).is_err());
        entry.size -= 1;
        let dir = entry_dir(&w, &entry.id).unwrap();
        fs::write(dir.join("extra"), b"retain").unwrap();
        assert!(dispose(&w, &entry).is_err());
        fs::remove_file(dir.join("extra")).unwrap();
        restore(&w, &entry.id).unwrap();
        w.db.execute_batch("PRAGMA query_only=ON").unwrap();
        assert!(dispose(&w, &entry).unwrap().is_none());
        assert!(!dir.exists());
        assert_eq!(fs::read(source).unwrap(), b"recover me");
        assert!(catalog(&w).unwrap().entries.is_empty());
        assert!(dispose(&w, &entry).is_err());
        entry.id = "../outside".into();
        assert!(dispose(&w, &entry).is_err());
    }
    #[test]
    fn disposal_protects_new_index_trash_corruption_and_broken_relationships() {
        let tmp = tempfile::tempdir().unwrap();
        let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
        file(&w, "orphan", b"indexed later");
        quarantine(&w, &[select(&preview(&w).unwrap()[0])]).unwrap();
        let entry = catalog(&w).unwrap().entries.remove(0);
        let doc = w.create("note").unwrap();
        w.put_blob(&doc, "key", b"indexed later", "asset", "text/plain")
            .unwrap();
        w.delete(&doc).unwrap();
        // Even a missing indexed asset must not allow destroying its recovery copy.
        fs::remove_file(w.asset_path(&entry.digest).unwrap()).unwrap();
        assert!(dispose(&w, &entry)
            .unwrap_err()
            .to_string()
            .contains("protected"));
        let dir = entry_dir(&w, &entry.id).unwrap();
        assert_eq!(fs::read(dir.join("payload")).unwrap(), b"indexed later");
        w.db.execute_batch("DELETE FROM object_attachments; DELETE FROM attachments;")
            .unwrap();
        fs::write(dir.join("payload"), b"damaged").unwrap();
        assert!(dispose(&w, &entry).is_err());
        fs::write(dir.join("payload"), b"indexed later").unwrap();
        w.db.execute_batch(
            "PRAGMA foreign_keys=OFF; INSERT INTO object_attachments VALUES ('missing','missing')",
        )
        .unwrap();
        assert!(dispose(&w, &entry).is_err());
        assert!(dir.join("payload").exists());
    }
    #[test]
    fn restore_protects_a_newly_indexed_original_path() {
        let tmp = tempfile::tempdir().unwrap();
        let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
        let bytes = b"new indexed bytes";
        let hash = format!("{:x}", Sha256::digest(bytes));
        let name = format!("{}/{hash}", &hash[..2]);
        let source = file(&w, &name, b"old unindexed bytes");
        let c = preview(&w).unwrap().remove(0);
        quarantine(&w, &[select(&c)]).unwrap();
        let entry = catalog(&w).unwrap().entries.remove(0);
        let doc = w.create("note").unwrap();
        w.put_blob(&doc, "new", bytes, "new", "text/plain").unwrap();
        fs::remove_file(&source).unwrap();
        assert!(restore(&w, &entry.id)
            .unwrap_err()
            .to_string()
            .contains("now indexed"));
        assert!(!source.exists());
        assert_eq!(catalog(&w).unwrap().entries.len(), 1);
    }
    fn file(w: &Workspace, name: &str, bytes: &[u8]) -> PathBuf {
        let p = w.root.join("assets").join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, bytes).unwrap();
        p
    }
    #[test]
    fn quarantine_roundtrip_retains_identity_index_trash_and_recovery_copies() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("workspace");
        let mut w = Workspace::open(root.clone()).unwrap();
        let a = w.create("note").unwrap();
        let b = w.create("whiteboard").unwrap();
        w.save(
            &a,
            &Snapshot {
                title: None,
                collection: vec![1],
                document: b.as_bytes().to_vec(),
            },
        )
        .unwrap();
        w.put_blob(&a, "shared", b"indexed", "image.png", "image/png")
            .unwrap();
        w.put_blob(&b, "shared", b"indexed", "image.png", "image/png")
            .unwrap();
        w.delete(&b).unwrap();
        let hash: String =
            w.db.query_row("SELECT sha256 FROM attachments", [], |r| r.get(0))
                .unwrap();
        file(&w, "aa/duplicate", b"indexed"); // Content protection, even wrong name.
        file(&w, &format!("wrong/{hash}"), b"different"); // Indexed filename protection.
        let source = file(&w, "aa/interrupted.tmp", b"recover me");
        let candidates = preview(&w).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].size, 10);
        w.db.execute_batch("PRAGMA query_only=ON").unwrap();
        assert!(quarantine(&w, &[select(&candidates[0])]).unwrap()[0]
            .error
            .is_none());
        assert!(!source.exists());
        assert_eq!(w.get_blob("shared").unwrap(), b"indexed");
        assert_eq!(w.load(&a).unwrap().unwrap().document, b.as_bytes());
        assert_eq!(w.trash("", 0).unwrap()[0].object.id, b);
        drop(w);
        let w = Workspace::open(root).unwrap();
        let entries = catalog(&w).unwrap().entries;
        assert_eq!(entries.len(), 1);
        restore(&w, &entries[0].id).unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"recover me");
        assert_eq!(catalog(&w).unwrap().entries.len(), 1);
        fs::write(&source, b"new content").unwrap();
        assert!(restore(&w, &entries[0].id).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"new content");
        assert_eq!(
            read_entry(&w, &entries[0].id).unwrap().digest,
            entries[0].digest
        );
    }
    #[test]
    fn quarantine_revalidates_changes_new_index_and_workspace_scope() {
        let tmp = tempfile::tempdir().unwrap();
        let mut w = Workspace::open(tmp.path().join("one")).unwrap();
        let path = file(&w, "candidate", b"original");
        let c = preview(&w).unwrap().remove(0);
        fs::write(&path, b"modified").unwrap();
        assert!(quarantine(&w, &[select(&c)]).unwrap()[0].error.is_some());
        fs::write(&path, b"original").unwrap();
        let other = Workspace::open(tmp.path().join("two")).unwrap();
        file(&other, "candidate", b"original");
        assert!(quarantine(&other, &[select(&c)]).unwrap()[0]
            .error
            .is_some());
        let doc = w.create("note").unwrap();
        w.put_blob(&doc, "new-index", b"original", "file", "text/plain")
            .unwrap();
        assert!(quarantine(&w, &[select(&c)]).unwrap()[0].error.is_some());
        assert!(path.exists());
        assert!(catalog(&w).unwrap().entries.is_empty());
        w.db.execute_batch("PRAGMA foreign_keys=OFF; INSERT INTO object_attachments VALUES ('missing','new-index')").unwrap();
        assert!(preview(&w).is_err());
        assert!(quarantine(&w, &[select(&c)]).is_err());
    }
    #[test]
    fn quarantine_partial_results_and_interrupted_entries_remain_recoverable() {
        let tmp = tempfile::tempdir().unwrap();
        let w = Workspace::open(tmp.path().join("workspace")).unwrap();
        file(&w, "first", b"first");
        let second = file(&w, "second", b"second");
        let c = preview(&w).unwrap();
        fs::remove_file(second).unwrap();
        let results = quarantine(&w, &[select(&c[0]), select(&c[1])]).unwrap();
        assert!(results[0].error.is_none());
        assert!(results[1].error.is_some());
        let entry = catalog(&w).unwrap().entries.remove(0);
        let dir = entry_dir(&w, &entry.id).unwrap();
        fs::write(dir.join("payload"), b"damaged").unwrap();
        assert!(restore(&w, &entry.id).is_err());
        let report = catalog(&w).unwrap();
        assert_eq!(report.warnings.len(), 1);
        assert!(report.entries.is_empty());
        assert!(dir.join("payload").exists());
        let incomplete = quarantine_root(&w, false)
            .unwrap()
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&incomplete).unwrap();
        assert_eq!(catalog(&w).unwrap().warnings.len(), 2);
        assert!(incomplete.exists());
    }
    #[test]
    fn quarantine_rejects_unsafe_names_metadata_and_destinations() {
        let tmp = tempfile::tempdir().unwrap();
        let w = Workspace::open(tmp.path().join("workspace")).unwrap();
        file(&w, "aa/asset", b"recover");
        let c = preview(&w).unwrap().remove(0);
        quarantine(&w, &[select(&c)]).unwrap();
        let entry = catalog(&w).unwrap().entries.remove(0);
        for id in ["../outside", "C:/outside", "", "..\\outside"] {
            assert!(restore(&w, id).is_err());
        }
        for value in [
            "../outside",
            "a/../../outside",
            "C:/outside",
            "a\\outside",
            "file:stream",
            "CON",
            "a/..",
        ] {
            assert!(relative(value).is_err());
        }
        let dir = entry_dir(&w, &entry.id).unwrap();
        let mut tampered: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("entry.json")).unwrap()).unwrap();
        tampered["original"] = "../outside".into();
        fs::write(
            dir.join("entry.json"),
            serde_json::to_vec(&tampered).unwrap(),
        )
        .unwrap();
        assert!(restore(&w, &entry.id).is_err());
        assert!(!w.root.join("outside").exists());
        tampered["original"] = "aa/asset".into();
        fs::write(
            dir.join("entry.json"),
            serde_json::to_vec(&tampered).unwrap(),
        )
        .unwrap();
        fs::create_dir(w.root.join("assets/aa/asset")).unwrap();
        assert!(restore(&w, &entry.id).is_err());
        assert!(w.root.join("assets/aa/asset").is_dir());
    }
}
