//! A durable copy of Knot's UI preferences (theme, editor settings, sidebar
//! recents and pins, layouts). The WebView keeps them in localStorage, which
//! can be reset as a whole; the frontend restores from this file when that
//! happens. Lives beside the workspaces, outside any workspace or backup.
use crate::storage::Result;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const FILE: &str = "ui-preferences.json";
const MAX_BYTES: usize = 2 * 1024 * 1024;

fn path(base: &Path) -> PathBuf {
    base.join(FILE)
}

/// The stored JSON object, or None if there is no usable copy.
pub fn read(base: &Path) -> Result<Option<String>> {
    let text = match fs::read_to_string(path(base)) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    // A damaged copy is ignored rather than blocking startup.
    Ok(match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(_)) => Some(text),
        _ => None,
    })
}

/// Replaces the stored copy atomically: a crash leaves the old or the new file.
pub fn write(base: &Path, json: &str) -> Result<()> {
    if json.len() > MAX_BYTES {
        return Err("Preferences are too large to save".into());
    }
    let value: serde_json::Value = serde_json::from_str(json)?;
    let map = value.as_object().ok_or("Preferences must be an object")?;
    if !map.values().all(|v| v.is_string()) {
        return Err("Preference values must be text".into());
    }
    fs::create_dir_all(base)?;
    let tmp = base.join(format!("{FILE}.{}.partial", uuid::Uuid::new_v4()));
    let outcome = (|| -> Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(json.as_bytes())?;
        file.sync_all()?;
        fs::rename(&tmp, path(base))?;
        Ok(())
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_replaces_and_rejects_bad_input() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path()).unwrap(), None);
        write(dir.path(), r#"{"knot.appearance":"dark"}"#).unwrap();
        write(dir.path(), r#"{"knot.appearance":"light"}"#).unwrap();
        assert_eq!(
            read(dir.path()).unwrap().as_deref(),
            Some(r#"{"knot.appearance":"light"}"#)
        );
        assert!(write(dir.path(), "[1]").is_err());
        assert!(write(dir.path(), r#"{"a":1}"#).is_err());
        assert!(write(dir.path(), "not json").is_err());
        let leftovers = fs::read_dir(dir.path())
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name() != FILE)
            .count();
        assert_eq!(leftovers, 0);
        fs::write(path(dir.path()), "{broken").unwrap();
        assert_eq!(read(dir.path()).unwrap(), None);
    }
}
