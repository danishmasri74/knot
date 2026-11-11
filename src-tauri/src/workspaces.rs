use crate::storage::{Result, Workspace};
use serde::{Deserialize, Serialize};
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
    pub warning: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct External {
    id: String,
    path: PathBuf,
}

fn externals(base: &Path) -> Result<Vec<External>> {
    match fs::read(base.join("external-workspaces.json")) {
        Ok(bytes) => {
            let entries: Vec<External> = serde_json::from_slice(&bytes)?;
            let mut ids = std::collections::HashSet::new();
            for entry in &entries {
                if !entry.id.starts_with("external-")
                    || !valid_id(&entry.id)
                    || !entry.path.is_absolute()
                    || !ids.insert(&entry.id)
                {
                    return Err("Invalid external workspace catalog".into());
                }
            }
            Ok(entries)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

fn write_atomic(base: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    let tmp = base.join(format!("selection-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, base.join(name))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn require_existing(root: &Path) -> Result<()> {
    if !root.join("workspace.json").is_file() || !root.join("knot.db").is_file() {
        return Err("Choose an existing Knot workspace folder containing workspace.json and knot.db. No replacement was created.".into());
    }
    Ok(())
}

fn same_root(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
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
    if id.starts_with("external-") {
        let entry = externals(base)?
            .into_iter()
            .find(|e| e.id == id)
            .ok_or("Unknown external workspace")?;
        require_existing(&entry.path)?;
        return Ok(entry.path);
    }
    let root = base.join(id);
    if !crate::paths::is_direct_child(&root, base)?
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
        if !id.starts_with("external-") && existing_root(base, &id).is_ok() {
            entries.push(Entry {
                id,
                path: entry.path().display().to_string(),
            });
        }
    }
    // Missing/offline external locations remain visible and can be retried.
    // A damaged registry must not prevent recovery to a managed workspace.
    let external = externals(base);
    let warning = external.as_ref().err().map(|e| {
        format!("External workspace list could not load: {e}. Managed workspaces remain available.")
    });
    for entry in external.unwrap_or_default() {
        entries.push(Entry {
            id: entry.id,
            path: entry.path.display().to_string(),
        });
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    let active = current.as_ref().ok().and_then(|w| {
        entries
            .iter()
            .find(|e| same_root(&w.root, Path::new(&e.path)))
            .map(|e| e.id.clone())
    });
    Ok(Catalog {
        active,
        warning,
        entries,
    })
}

pub fn persist_selection(base: &Path, id: &str) -> Result<()> {
    existing_root(base, id)?;
    write_atomic(base, "active-workspace.txt", id.as_bytes())
}

pub fn switch(
    base: &Path,
    current: &mut std::result::Result<Workspace, String>,
    id: &str,
) -> Result<()> {
    let root = existing_root(base, id)?;
    if current.as_ref().is_ok_and(|w| same_root(&w.root, &root)) {
        return Ok(());
    }
    // Keep the old workspace and its lock until both opening and persistence succeed.
    let next = Workspace::open(root)?;
    persist_selection(base, id)?;
    *current = Ok(next);
    Ok(())
}

// Paths enter here only from the Rust native folder dialog, never from IPC arguments.
pub fn open_external(
    base: &Path,
    current: &mut std::result::Result<Workspace, String>,
    path: &Path,
) -> Result<()> {
    require_existing(path)?;
    let root = path.canonicalize()?;
    if let Some(entry) = catalog(base, current)?
        .entries
        .iter()
        .find(|e| same_root(Path::new(&e.path), &root))
    {
        return switch(base, current, &entry.id);
    }
    let next = Workspace::open(root.clone())?;
    let mut entries = externals(base)?;
    let id = format!("external-{}", uuid::Uuid::new_v4());
    entries.push(External {
        id: id.clone(),
        path: root,
    });
    write_atomic(
        base,
        "external-workspaces.json",
        &serde_json::to_vec_pretty(&entries)?,
    )?;
    persist_selection(base, &id)?;
    *current = Ok(next);
    Ok(())
}

pub fn relocate(
    base: &Path,
    current: &mut std::result::Result<Workspace, String>,
    parent: &Path,
) -> Result<PathBuf> {
    let ws = current.as_ref().map_err(|e| e.clone())?;
    let parent = parent.canonicalize()?;
    if !parent.is_dir() || parent.starts_with(ws.root.canonicalize()?) {
        return Err("Choose a destination folder outside the current workspace".into());
    }
    let archive = parent.join(format!("relocation-{}.knot", uuid::Uuid::new_v4()));
    let result = (|| -> Result<PathBuf> {
        crate::backup::export(ws, &archive)?;
        crate::backup::restore(&archive, &parent)
    })();
    let _ = fs::remove_file(&archive);
    let root = result?;
    // Retain the validated copy on selection failure; the original is never removed.
    open_external(base, current, &root).map_err(|e| {
        format!(
            "Copy saved at {} but could not open: {e}. The current workspace is unchanged.",
            root.display()
        )
    })?;
    Ok(root)
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
            Ok(ws)
        }
        Err(error) => Err(error.into()),
    }
}
