mod backup;
mod organization;
mod storage;
#[cfg(test)]
mod tests;
mod workspaces;
use std::sync::Mutex;
use storage::{Object, Snapshot, Workspace};
use tauri::{Manager, State};
struct AppState {
    workspace: Mutex<Result<Workspace, String>>,
    base: std::path::PathBuf,
}
type Reply<T> = Result<T, String>;
#[tauri::command]
async fn workspace_catalog(state: State<'_, AppState>) -> Reply<workspaces::Catalog> {
    let guard = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    workspaces::catalog(&state.base, &guard).map_err(|e| e.to_string())
}
#[tauri::command]
async fn switch_workspace(state: State<'_, AppState>, id: String) -> Reply<()> {
    let mut guard = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    workspaces::switch(&state.base, &mut guard, &id).map_err(|e| e.to_string())
}
#[tauri::command]
async fn organization_catalog(state: State<'_, AppState>) -> Reply<organization::Catalog> {
    with(&state, |w| w.catalog())
}
#[tauri::command]
async fn create_label(state: State<'_, AppState>, kind: String, name: String) -> Reply<String> {
    with(&state, |w| w.create_label(&kind, &name))
}
#[tauri::command]
async fn rename_label(
    state: State<'_, AppState>,
    kind: String,
    id: String,
    name: String,
) -> Reply<()> {
    with(&state, |w| w.rename_label(&kind, &id, &name))
}
#[tauri::command]
async fn delete_label(state: State<'_, AppState>, kind: String, id: String) -> Reply<()> {
    with(&state, |w| w.delete_label(&kind, &id))
}
#[tauri::command]
async fn get_organization(
    state: State<'_, AppState>,
    id: String,
) -> Reply<organization::Organization> {
    with(&state, |w| w.organization(&id))
}
#[tauri::command]
async fn organize_object(
    state: State<'_, AppState>,
    id: String,
    value: organization::Organization,
) -> Reply<()> {
    with(&state, |w| w.organize(&id, &value))
}
#[tauri::command]
async fn filter_objects(
    state: State<'_, AppState>,
    search: String,
    offset: i64,
    folder: Option<String>,
    tag: Option<String>,
) -> Reply<Vec<Object>> {
    with(&state, |w| {
        w.filtered_list(&search, offset, folder.as_deref(), tag.as_deref())
    })
}
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
async fn list_trash(
    state: State<'_, AppState>,
    search: String,
    offset: i64,
) -> Reply<Vec<storage::TrashedObject>> {
    with(&state, |w| w.trash(&search, offset))
}
#[tauri::command]
async fn restore_object(state: State<'_, AppState>, id: String) -> Reply<()> {
    with(&state, |w| w.restore_object(&id))
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
async fn save_documents(
    state: State<'_, AppState>,
    documents: Vec<storage::DocumentWrite>,
) -> Reply<()> {
    with(&state, |w| w.save_documents(&documents))
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
                workspaces::persist_selection(
                    &state.base,
                    root.file_name()
                        .and_then(|name| name.to_str())
                        .ok_or("Invalid workspace name")?,
                )?;
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
            let workspace = workspaces::startup(&base).map_err(|error| {
                format!("Workspace could not open: {error}. Existing data has been preserved.")
            });
            app.manage(AppState {
                workspace: Mutex::new(workspace),
                base,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_catalog,
            switch_workspace,
            organization_catalog,
            create_label,
            rename_label,
            delete_label,
            get_organization,
            organize_object,
            filter_objects,
            list_objects,
            create_object,
            rename_object,
            delete_object,
            list_trash,
            restore_object,
            load_document,
            save_document,
            save_documents,
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
