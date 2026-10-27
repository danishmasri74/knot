mod backup;
mod storage;
#[cfg(test)]
mod tests;
use std::sync::Mutex;
use storage::{Object, Snapshot, Workspace};
use tauri::{Manager, State};
struct AppState {
    workspace: Mutex<Result<Workspace, String>>,
    base: std::path::PathBuf,
}
type Reply<T> = Result<T, String>;
fn with<T>(
    state: &State<AppState>,
    f: impl FnOnce(&mut Workspace) -> storage::Result<T>,
) -> Reply<T> {
    let mut guard = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    let ws = guard.as_mut().map_err(|error| error.clone())?;
    f(ws).map_err(|e| e.to_string())
}
#[tauri::command]
async fn list_objects(
    state: State<'_, AppState>,
    search: String,
    offset: i64,
) -> Reply<Vec<Object>> {
    with(&state, |w| w.list(&search, offset))
}
#[tauri::command]
async fn create_object(state: State<'_, AppState>, kind: String) -> Reply<String> {
    with(&state, |w| w.create(&kind))
}
#[tauri::command]
async fn rename_object(state: State<'_, AppState>, id: String, title: String) -> Reply<()> {
    with(&state, |w| w.rename(&id, &title))
}
#[tauri::command]
async fn delete_object(state: State<'_, AppState>, id: String) -> Reply<()> {
    with(&state, |w| w.delete(&id))
}
#[tauri::command]
async fn load_document(state: State<'_, AppState>, id: String) -> Reply<Option<Snapshot>> {
    with(&state, |w| w.load(&id))
}
#[tauri::command]
async fn save_document(state: State<'_, AppState>, id: String, snapshot: Snapshot) -> Reply<()> {
    with(&state, |w| w.save(&id, &snapshot))
}
#[tauri::command]
async fn put_blob(
    state: State<'_, AppState>,
    object: String,
    key: String,
    bytes: Vec<u8>,
    name: String,
    mime: String,
) -> Reply<String> {
    with(&state, |w| w.put_blob(&object, &key, &bytes, &name, &mime))
}
#[tauri::command]
async fn get_blob(state: State<'_, AppState>, key: String) -> Reply<Vec<u8>> {
    with(&state, |w| w.get_blob(&key))
}
#[tauri::command]
async fn list_blobs(state: State<'_, AppState>, object: String) -> Reply<Vec<String>> {
    with(&state, |w| w.blobs(&object))
}
#[tauri::command]
async fn check_workspace(state: State<'_, AppState>) -> Reply<storage::IntegrityReport> {
    with(&state, |w| w.integrity())
}
#[tauri::command]
async fn export_backup(state: State<'_, AppState>) -> Reply<Option<String>> {
    let path = rfd::AsyncFileDialog::new()
        .add_filter("Knot workspace", &["knot"])
        .set_file_name("Workspace.knot")
        .save_file()
        .await;
    match path {
        Some(p) => with(&state, |w| {
            backup::export(w, p.path())?;
            Ok(Some(p.path().display().to_string()))
        }),
        None => Ok(None),
    }
}
#[tauri::command]
async fn restore_backup(state: State<'_, AppState>) -> Reply<Option<String>> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("Knot workspace", &["knot"])
        .pick_file()
        .await;
    match file {
        Some(p) => {
            let mut guard = state
                .workspace
                .lock()
                .map_err(|_| "Workspace lock unavailable")?;
            let result = (|| -> storage::Result<String> {
                let root = backup::restore(p.path(), &state.base)?;
                let next = Workspace::open(root.clone())?;
                let selection_tmp = state.base.join("active-workspace.tmp");
                std::fs::write(
                    &selection_tmp,
                    root.file_name()
                        .ok_or("Missing folder name")?
                        .to_string_lossy()
                        .as_bytes(),
                )?;
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(&selection_tmp)?
                    .sync_all()?;
                std::fs::rename(selection_tmp, state.base.join("active-workspace.txt"))?;
                *guard = Ok(next);
                Ok(root.display().to_string())
            })();
            result.map(Some).map_err(|e| e.to_string())
        }
        None => Ok(None),
    }
}
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let base = app.path().app_local_data_dir()?;
            // Debug-only isolation for native acceptance tests. Release builds
            // always use the managed application data directory.
            #[cfg(debug_assertions)]
            let base = std::env::var_os("KNOT_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(base);
            std::fs::create_dir_all(&base)?;
            let workspace = (|| -> storage::Result<Workspace> {
                let selected = match std::fs::read_to_string(base.join("active-workspace.txt")) {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        "Workspace".into()
                    }
                    Err(error) => return Err(error.into()),
                };
                if selected.is_empty()
                    || !selected
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                {
                    return Err("Invalid workspace selection. Restore a backup to recover.".into());
                }
                let root = base.join(selected);
                let first_launch = !root.join("workspace.json").exists();
                let ws = Workspace::open(root)?;
                if first_launch {
                    let id = ws.create("note")?;
                    ws.rename(&id, "Welcome to Knot")?;
                }
                Ok(ws)
            })()
            .map_err(|error| {
                format!("Workspace could not open: {error}. Existing data has been preserved.")
            });
            app.manage(AppState {
                workspace: Mutex::new(workspace),
                base,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_objects,
            create_object,
            rename_object,
            delete_object,
            load_document,
            save_document,
            put_blob,
            get_blob,
            list_blobs,
            check_workspace,
            export_backup,
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("Knot could not start; workspace was not reset");
}
