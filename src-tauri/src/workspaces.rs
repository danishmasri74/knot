use crate::storage::{Result, Workspace};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
pub struct Entry {
    pub id: String,
    pub path: String,
}
#[derive(Serialize)]
pub struct Catalog {
    pub active: Option<String>,
    pub entries: Vec<Entry>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

// Selection is restricted to existing direct children of the managed base.
// Canonical parents also exclude symlinks/junctions pointing outside it.
fn existing_root(base: &Path, id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err("Invalid workspace selection".into());
    }
    let root = base.join(id);
    let canonical = root.canonicalize()?;
    if canonical.parent() != Some(base.canonicalize()?.as_path())
        || !root.join("workspace.json").is_file()
        || !root.join("knot.db").is_file()
    {
        return Err("Workspace is missing or outside the managed workspace folder".into());
    }
    Ok(root)
}

pub fn catalog(base: &Path, current: &std::result::Result<Workspace, String>) -> Result<Catalog> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(base)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().to_string();
        if existing_root(base, &id).is_ok() {
            entries.push(Entry {
                id,
                path: entry.path().display().to_string(),
            });
        }
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Catalog {
        active: current
            .as_ref()
            .ok()
            .and_then(|w| w.root.file_name())
            .map(|name| name.to_string_lossy().to_string()),
        entries,
    })
}

pub fn persist_selection(base: &Path, id: &str) -> Result<()> {
    existing_root(base, id)?;
    let tmp = base.join(format!("selection-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(id.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, base.join("active-workspace.txt"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

pub fn switch(
    base: &Path,
    current: &mut std::result::Result<Workspace, String>,
    id: &str,
) -> Result<()> {
    let root = existing_root(base, id)?;
    if current.as_ref().is_ok_and(|w| w.root == root) {
        return Ok(());
    }
    // Keep the old workspace and its lock until both opening and persistence succeed.
    let next = Workspace::open(root)?;
    persist_selection(base, id)?;
    *current = Ok(next);
    Ok(())
}

pub fn startup(base: &Path) -> Result<Workspace> {
    match fs::read_to_string(base.join("active-workspace.txt")) {
        Ok(id) => Workspace::open(existing_root(base, &id)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let root = base.join("Workspace");
            let first_launch = !root.exists();
            let ws = if first_launch {
                Workspace::open(root)?
            } else {
                Workspace::open(existing_root(base, "Workspace")?)?
            };
            if first_launch {
                let id = ws.create("note")?;
                ws.rename(&id, "Welcome to Knot")?;
            }
            Ok(ws)
        }
        Err(error) => Err(error.into()),
    }
}
