//! Regenerable canvas card thumbnails under `cache/previews/<document>/`.
//!
//! Each file is named `<note>.<fingerprint>.img`. The fingerprint is computed
//! by the editor from everything that affects the card's pixels, so a lookup
//! either returns an exact match or nothing. Losing this directory only costs
//! one slower canvas open; backups and relocation intentionally skip it.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;
const MAX_KEYS: usize = 10_000;
const SUFFIX: &str = ".img";

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_fingerprint(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn document_dir(root: &Path, document: &str) -> Result<PathBuf, String> {
    if !valid_id(document) {
        return Err("Invalid preview document".into());
    }
    Ok(root.join("cache").join("previews").join(document))
}

fn entry_name(note: &str, fingerprint: &str) -> Result<String, String> {
    if !valid_id(note) || !valid_fingerprint(fingerprint) {
        return Err("Invalid preview key".into());
    }
    Ok(format!("{note}.{fingerprint}{SUFFIX}"))
}

/// Note id encoded in a cache file name, if the name is one of ours.
fn note_of(name: &str) -> Option<&str> {
    let stem = name.strip_suffix(SUFFIX)?;
    let (note, fingerprint) = stem.rsplit_once('.')?;
    (valid_id(note) && valid_fingerprint(fingerprint)).then_some(note)
}

/// Returns each requested entry as a little-endian u32 length followed by its
/// bytes, in request order. Misses (and unreadable files) have length zero.
pub fn load(root: &Path, document: &str, keys: &[(String, String)]) -> Result<Vec<u8>, String> {
    if keys.len() > MAX_KEYS {
        return Err("Too many preview keys".into());
    }
    let dir = document_dir(root, document)?;
    let mut out = Vec::new();
    for (note, fingerprint) in keys {
        let bytes = entry_name(note, fingerprint)
            .ok()
            .and_then(|name| fs::read(dir.join(name)).ok())
            .filter(|bytes| bytes.len() <= MAX_ENTRY_BYTES)
            .unwrap_or_default();
        out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(&bytes);
    }
    Ok(out)
}

/// Writes one card's image and removes that card's older fingerprints.
pub fn save(root: &Path, document: &str, note: &str, fingerprint: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_ENTRY_BYTES {
        return Err("Invalid preview size".into());
    }
    let name = entry_name(note, fingerprint)?;
    let dir = document_dir(root, document)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(&name);
    // Write beside the target, then rename, so a crash never leaves a
    // truncated image under a valid name.
    let temporary = dir.join(format!("{name}.{}.tmp", uuid::Uuid::new_v4()));
    let written = (|| {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        fs::rename(&temporary, &target)
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let file = entry.file_name();
        let Some(file) = file.to_str() else { continue };
        if file != name && note_of(file) == Some(note) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Removes entries for cards no longer in the document, plus stray temp files.
pub fn prune(root: &Path, document: &str, keep: &[String]) -> Result<usize, String> {
    let dir = document_dir(root, document)?;
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(0) };
    let mut removed = 0;
    for entry in entries.flatten() {
        let file = entry.file_name();
        let Some(file) = file.to_str() else { continue };
        let stale = match note_of(file) {
            Some(note) => !keep.iter().any(|kept| kept == note),
            None => file.ends_with(".tmp"),
        };
        if stale && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Drops a permanently deleted document's cache. Missing directories are fine.
pub fn remove_document(root: &Path, document: &str) {
    if let Ok(dir) = document_dir(root, document) {
        let _ = fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(c: char) -> String {
        c.to_string().repeat(64)
    }
    fn unpack(mut data: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        while !data.is_empty() {
            let len = u32::from_le_bytes(data[..4].try_into().unwrap()) as usize;
            out.push(data[4..4 + len].to_vec());
            data = &data[4 + len..];
        }
        out
    }

    #[test]
    fn saves_loads_replaces_and_prunes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        save(root, "doc-1", "note_a", &fp('a'), b"first").unwrap();
        save(root, "doc-1", "note_b", &fp('b'), b"second").unwrap();
        let loaded = load(
            root,
            "doc-1",
            &[
                ("note_a".into(), fp('a')),
                ("note_b".into(), fp('c')),
                ("missing".into(), fp('a')),
            ],
        )
        .unwrap();
        assert_eq!(unpack(&loaded), vec![b"first".to_vec(), vec![], vec![]]);

        // A new fingerprint replaces the card's previous image.
        save(root, "doc-1", "note_a", &fp('d'), b"updated").unwrap();
        let dir = root.join("cache/previews/doc-1");
        assert!(!dir.join(format!("note_a.{}.img", fp('a'))).exists());
        assert!(dir.join(format!("note_a.{}.img", fp('d'))).exists());

        fs::write(dir.join("leftover.tmp"), b"x").unwrap();
        assert_eq!(prune(root, "doc-1", &["note_a".into()]).unwrap(), 2);
        assert!(dir.join(format!("note_a.{}.img", fp('d'))).exists());
        assert!(!dir.join(format!("note_b.{}.img", fp('b'))).exists());

        remove_document(root, "doc-1");
        assert!(!dir.exists());
        assert_eq!(prune(root, "doc-1", &[]).unwrap(), 0);
    }

    #[test]
    fn rejects_unsafe_keys_and_sizes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        assert!(save(root, "../escape", "note", &fp('a'), b"x").is_err());
        assert!(save(root, "doc", "a/b", &fp('a'), b"x").is_err());
        assert!(save(root, "doc", "note", "ABC", b"x").is_err());
        assert!(save(root, "doc", "note", &fp('a'), b"").is_err());
        assert!(save(root, "doc", "note", &fp('a'), &vec![0; MAX_ENTRY_BYTES + 1]).is_err());
        assert!(load(root, "..", &[]).is_err());
        // Invalid individual keys are misses, not failures.
        let loaded = load(root, "doc", &[("../x".into(), fp('a'))]).unwrap();
        assert_eq!(loaded, 0u32.to_le_bytes());
    }
}
