use crate::{
    backup,
    storage::{Result, Workspace},
    workspaces,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
pub struct Entry {
    pub id: String,
    pub size: u64,
    pub modified: u64,
}

fn directory(base: &Path) -> Result<PathBuf> {
    let dir = base.join("Backups");
    fs::create_dir_all(&dir)?;
    if dir.canonicalize()?.parent() != Some(base.canonicalize()?.as_path()) {
        return Err("Backup folder is outside managed storage".into());
    }
    Ok(dir)
}

pub fn resolve(base: &Path, id: &str) -> Result<PathBuf> {
    if !id.ends_with(".knot")
        || !id[..id.len() - 5]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid backup ID".into());
    }
    let dir = directory(base)?;
    let path = dir.join(id);
    if !fs::symlink_metadata(&path)?.is_file()
        || path.canonicalize()?.parent() != Some(dir.canonicalize()?.as_path())
    {
        return Err("Backup is missing or outside managed storage".into());
    }
    Ok(path)
}

pub fn list(base: &Path) -> Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for item in fs::read_dir(directory(base)?)? {
        let item = item?;
        let id = item.file_name().to_string_lossy().to_string();
        if let Ok(path) = resolve(base, &id) {
            let meta = fs::metadata(path)?;
            entries.push(Entry {
                id,
                size: meta.len(),
                modified: meta.modified()?.duration_since(UNIX_EPOCH)?.as_millis() as u64,
            });
        }
    }
    entries.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.id.cmp(&b.id)));
    Ok(entries)
}

pub fn create(base: &Path, ws: &Workspace) -> Result<String> {
    let source: String = ws
        .root
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("Workspace")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .take(48)
        .collect();
    let id = format!(
        "{}-{}-{}.knot",
        source,
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis(),
        uuid::Uuid::new_v4()
    );
    backup::export(ws, &directory(base)?.join(&id))?;
    Ok(id)
}

pub fn delete(base: &Path, id: &str) -> Result<()> {
    fs::remove_file(resolve(base, id)?)?;
    Ok(())
}

pub fn validate(base: &Path, id: &str) -> Result<()> {
    let archive = resolve(base, id)?;
    // Exercise the complete restore validator without adding a workspace to the picker.
    let scratch = directory(base)?.join(format!("verify-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&scratch)?;
    let result = backup::restore(&archive, &scratch).map(|_| ());
    let cleanup = fs::remove_dir_all(&scratch);
    result?;
    cleanup?;
    Ok(())
}

pub fn restore(
    base: &Path,
    current: &mut std::result::Result<Workspace, String>,
    id: &str,
) -> Result<String> {
    let root = backup::restore(&resolve(base, id)?, base)?;
    let next_id = root
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Invalid restored workspace")?;
    workspaces::switch(base, current, next_id)?;
    Ok(root.display().to_string())
}
