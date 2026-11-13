mod ai;
mod ai_chats;
mod ai_context;
mod topic;
mod backup;
mod browser;
mod canvas_previews;
mod collections;
mod diagnostics;
mod exports;
mod knotbook;
mod getting_started;
mod managed_backups;
mod migrations;
mod mcq;
mod paths;
mod quarantine;
mod storage;
#[cfg(test)]
mod tests;
mod ui_preferences;
mod workspaces;
mod web_sources;
mod web_render;
use std::sync::Mutex;
use storage::{Object, Snapshot, Workspace};
use tauri::{Manager, State};
struct AppState {
    workspace: Mutex<Result<Workspace, String>>,
    base: std::path::PathBuf,
}
type Reply<T> = Result<T, String>;
/// The last .knotbook this session saved, so "Show in folder" never needs a
/// path from the interface.
struct LastShare(Mutex<Option<std::path::PathBuf>>);
/// .knotbook files waiting to be imported. The interface only ever sees an
/// opaque token, never a path (docs/NOTEBOOK-SHARING-PLAN.md, "Import").
#[derive(Default)]
struct KnotbookFiles {
    files: Mutex<std::collections::HashMap<String, std::path::PathBuf>>,
    /// A file Knot was launched with, waiting for the interface to be ready.
    pending: Mutex<Option<String>>,
}
fn knotbook_arg<I: IntoIterator<Item = S>, S: AsRef<std::ffi::OsStr>>(args: I) -> Option<std::path::PathBuf> {
    args.into_iter().skip(1).find_map(|arg| {
        let path = std::path::PathBuf::from(arg.as_ref());
        let is_knotbook = path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("knotbook"));
        (is_knotbook && path.is_file()).then_some(path)
    })
}
fn register_knotbook(files: &KnotbookFiles, path: std::path::PathBuf) -> String {
    let token = uuid::Uuid::new_v4().to_string();
    if let Ok(mut map) = files.files.lock() {
        map.insert(token.clone(), path);
    }
    token
}
fn knotbook_path(files: &KnotbookFiles, token: &str) -> Reply<std::path::PathBuf> {
    files
        .files
        .lock()
        .map_err(|_| "Import state unavailable")?
        .get(token)
        .cloned()
        .ok_or_else(|| "This file is no longer available. Open it again.".into())
}
#[tauri::command]
async fn unshared_references(state: State<'_, AppState>) -> Reply<Vec<knotbook::Unshared>> {
    with(&state, |w| knotbook::unshared(w))
}
#[tauri::command]
async fn choose_knotbook(files: State<'_, KnotbookFiles>) -> Reply<Option<String>> {
    let file = rfd::AsyncFileDialog::new()
        .set_title("Import notebook")
        .add_filter("Knot notebook", &["knotbook"])
        .pick_file()
        .await;
    Ok(file.map(|f| register_knotbook(&files, f.path().to_path_buf())))
}
#[tauri::command]
async fn pending_knotbook(files: State<'_, KnotbookFiles>) -> Reply<Option<String>> {
    Ok(files.pending.lock().map_err(|_| "Import state unavailable")?.take())
}
#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum InspectReply {
    Ready { package: knotbook::Inspected },
    Blocked { reason: knotbook::Blocked },
}
#[tauri::command]
async fn inspect_knotbook(
    state: State<'_, AppState>,
    files: State<'_, KnotbookFiles>,
    token: String,
) -> Reply<InspectReply> {
    let path = knotbook_path(&files, &token)?;
    with(&state, |w| {
        Ok(match knotbook::inspect(w, &path) {
            Ok(package) => InspectReply::Ready { package },
            Err(reason) => InspectReply::Blocked { reason },
        })
    })
}
#[tauri::command]
async fn import_knotbook(
    state: State<'_, AppState>,
    files: State<'_, KnotbookFiles>,
    token: String,
    plan: knotbook::ImportPlan,
) -> Reply<Vec<String>> {
    let path = knotbook_path(&files, &token)?;
    let written = with(&state, |w| knotbook::import(w, &state.base, &path, &plan))?;
    if let Ok(mut map) = files.files.lock() {
        map.remove(&token);
    }
    Ok(written)
}
#[tauri::command]
async fn knotbook_size(
    state: State<'_, AppState>,
    entries: Vec<knotbook::ShareEntry>,
    cards: Vec<String>,
) -> Reply<u64> {
    with(&state, |w| Ok(knotbook::collect(w, &entries, &cards)?.size()))
}
#[tauri::command]
async fn export_knotbook(
    state: State<'_, AppState>,
    last: State<'_, LastShare>,
    title: String,
    entries: Vec<knotbook::ShareEntry>,
    cards: Vec<String>,
    unshared: Vec<knotbook::Unshared>,
    shared_by: String,
) -> Reply<Option<String>> {
    knotbook::validate_shared_by(&shared_by).map_err(|e| e.to_string())?;
    let file = rfd::AsyncFileDialog::new()
        .set_title("Share notebook")
        .add_filter("Knot notebook", &["knotbook"])
        .set_file_name(knotbook::filename(&title))
        .save_file()
        .await;
    let Some(file) = file else {
        return Ok(None);
    };
    let mut path = file.path().to_path_buf();
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("knotbook"))
    {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(".knotbook");
        path.set_file_name(name);
    }
    with(&state, |w| {
        let package = knotbook::collect(w, &entries, &cards)?;
        knotbook::write(w, &path, &package, &unshared, &shared_by)
    })?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    *last.0.lock().map_err(|_| "Share state unavailable")? = Some(path);
    Ok(Some(name))
}
#[tauri::command]
async fn show_last_share(last: State<'_, LastShare>) -> Reply<()> {
    let path = last
        .0
        .lock()
        .map_err(|_| "Share state unavailable")?
        .clone()
        .ok_or("Nothing has been shared yet")?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}
#[tauri::command]
async fn getting_started_status(state: State<'_, AppState>) -> Reply<getting_started::Status> {
    with(&state, |w| w.getting_started_status())
}
#[tauri::command]
async fn install_getting_started(
    state: State<'_, AppState>,
    tour: getting_started::Tour,
    fresh: bool,
) -> Reply<String> {
    with(&state, |w| w.install_getting_started(tour, fresh))
}
#[tauri::command]
async fn export_document(
    title: String,
    format: String,
    files: Vec<exports::ExportFile>,
) -> Reply<Option<String>> {
    let extension = exports::validate(&format, &files).map_err(|e| e.to_string())?;
    let file = rfd::AsyncFileDialog::new()
        .set_title("Export document — choose a new filename")
        .add_filter("Document export", &[extension])
        .set_file_name(exports::filename(&title, extension))
        .save_file()
        .await;
    let Some(file) = file else {
        return Ok(None);
    };
    exports::write(file.path(), &format, &files).map_err(|e| e.to_string())?;
    Ok(Some(file.path().display().to_string()))
}
#[tauri::command]
async fn read_ui_preferences(state: State<'_, AppState>) -> Reply<Option<String>> {
    ui_preferences::read(&state.base).map_err(|e| e.to_string())
}
#[tauri::command]
async fn write_ui_preferences(state: State<'_, AppState>, json: String) -> Reply<()> {
    ui_preferences::write(&state.base, &json).map_err(|e| e.to_string())
}
#[tauri::command]
async fn list_backups(state: State<'_, AppState>) -> Reply<Vec<managed_backups::Entry>> {
    let _guard = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    managed_backups::list(&state.base).map_err(|e| e.to_string())
}
#[tauri::command]
async fn create_backup(state: State<'_, AppState>) -> Reply<String> {
    with(&state, |w| managed_backups::create(&state.base, w))
}
#[tauri::command]
async fn validate_backup(state: State<'_, AppState>, id: String) -> Reply<()> {
    let _guard = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    managed_backups::validate(&state.base, &id).map_err(|e| e.to_string())
}
#[tauri::command]
async fn delete_backup(state: State<'_, AppState>, id: String) -> Reply<()> {
    let _guard = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    managed_backups::delete(&state.base, &id).map_err(|e| e.to_string())
}
#[tauri::command]
async fn restore_managed_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Reply<String> {
    let restored = {
        let mut guard = state
            .workspace
            .lock()
            .map_err(|_| "Workspace lock unavailable")?;
        managed_backups::restore(&state.base, &mut guard, &id).map_err(|e| e.to_string())?
    };
    browser::after_transition(&app).await;
    Ok(restored)
}
#[tauri::command]
async fn workspace_catalog(state: State<'_, AppState>) -> Reply<workspaces::Catalog> {
    let guard = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    workspaces::catalog(&state.base, &guard).map_err(|e| e.to_string())
}
#[tauri::command]
async fn switch_workspace(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Reply<()> {
    {
        let mut guard = state
            .workspace
            .lock()
            .map_err(|_| "Workspace lock unavailable")?;
        workspaces::switch(&state.base, &mut guard, &id).map_err(|e| e.to_string())?;
    }
    browser::after_transition(&app).await;
    Ok(())
}
#[tauri::command]
async fn open_external_workspace(app: tauri::AppHandle, state: State<'_, AppState>) -> Reply<bool> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Open existing Knot workspace folder")
        .pick_folder()
        .await;
    let Some(folder) = folder else {
        return Ok(false);
    };
    {
        let mut guard = state
            .workspace
            .lock()
            .map_err(|_| "Workspace lock unavailable")?;
        workspaces::open_external(&state.base, &mut guard, folder.path())
            .map_err(|e| e.to_string())?;
    }
    browser::after_transition(&app).await;
    Ok(true)
}
#[tauri::command]
async fn relocate_workspace(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Reply<Option<String>> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Choose destination parent folder — source copy will be kept")
        .pick_folder()
        .await;
    let Some(folder) = folder else {
        return Ok(None);
    };
    let relocated = {
        let mut guard = state
            .workspace
            .lock()
            .map_err(|_| "Workspace lock unavailable")?;
        workspaces::relocate(&state.base, &mut guard, folder.path())
            .map(|p| Some(p.display().to_string()))
            .map_err(|e| e.to_string())?
    };
    browser::after_transition(&app).await;
    Ok(relocated)
}
/// Runs `f` only if `workspace` is still the active one, so a chat save queued
/// before a workspace switch can never land in the newly opened workspace.
fn with_active<T>(
    state: &State<AppState>,
    workspace: &str,
    f: impl FnOnce(&mut Workspace) -> storage::Result<T>,
) -> Reply<T> {
    let mut guard = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock unavailable")?;
    let active = workspaces::catalog(&state.base, &guard)
        .map_err(|e| e.to_string())?
        .active;
    if active.as_deref() != Some(workspace) {
        return Err("The workspace changed. This chat was not saved.".into());
    }
    let ws = guard.as_mut().map_err(|error| error.clone())?;
    f(ws).map_err(|e| e.to_string())
}
#[tauri::command]
async fn ai_chats_list(state: State<'_, AppState>, workspace: String) -> Reply<Vec<String>> {
    with_active(&state, &workspace, |w| w.ai_chats())
}
#[tauri::command]
async fn ai_chat_save(
    state: State<'_, AppState>,
    workspace: String,
    id: String,
    data: String,
) -> Reply<()> {
    with_active(&state, &workspace, |w| w.save_ai_chat(&id, &data))
}
#[tauri::command]
async fn ai_chat_delete(state: State<'_, AppState>, workspace: String, id: String) -> Reply<()> {
    with_active(&state, &workspace, |w| w.delete_ai_chat(&id))
}
#[tauri::command]
async fn set_favorite(state: State<'_, AppState>, id: String, favorite: bool) -> Reply<()> {
    with(&state, |w| w.set_favorite(&id, favorite))
}
#[tauri::command]
async fn collection_catalog(state: State<'_, AppState>) -> Reply<collections::Catalog> {
    with(&state, |w| w.catalog())
}
#[tauri::command]
async fn create_collection(
    state: State<'_, AppState>,
    name: String,
    object: Option<String>,
) -> Reply<String> {
    with(&state, |w| w.create_collection(&name, object.as_deref()))
}
#[tauri::command]
async fn rename_collection(state: State<'_, AppState>, id: String, name: String) -> Reply<()> {
    with(&state, |w| w.rename_collection(&id, &name))
}
#[tauri::command]
async fn reorder_collections(state: State<'_, AppState>, ids: Vec<String>) -> Reply<()> {
    with(&state, |w| w.reorder_collections(ids))
}
#[tauri::command]
async fn delete_collection(state: State<'_, AppState>, id: String) -> Reply<()> {
    with(&state, |w| w.delete_collection(&id))
}
#[tauri::command]
async fn get_membership(state: State<'_, AppState>, id: String) -> Reply<collections::Membership> {
    with(&state, |w| w.membership(&id))
}
#[tauri::command]
async fn set_membership(
    state: State<'_, AppState>,
    id: String,
    value: collections::Membership,
) -> Reply<()> {
    with(&state, |w| w.set_membership(&id, &value))
}
#[tauri::command]
async fn filter_objects(
    state: State<'_, AppState>,
    search: String,
    offset: i64,
    collection: Option<String>,
) -> Reply<Vec<Object>> {
    with(&state, |w| {
        w.filtered_list(&search, offset, collection.as_deref())
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
async fn library_page(
    state: State<'_, AppState>,
    search: String,
    collection: Option<String>,
    created: bool,
    offset: i64,
) -> Reply<collections::LibraryPage> {
    with(&state, |w| {
        w.library_page(&search, collection.as_deref(), created, offset)
    })
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
    with(&state, |w| {
        if offset == 0 {
            w.clear_expired_trash(storage::now())?;
        }
        w.trash(&search, offset)
    })
}
#[tauri::command]
async fn clear_expired_trash(state: State<'_, AppState>) -> Reply<usize> {
    with(&state, |w| w.clear_expired_trash(storage::now()))
}
#[tauri::command]
async fn purge_trash(state: State<'_, AppState>, ids: Vec<String>) -> Reply<usize> {
    with(&state, |w| w.purge_trash(&ids))
}
#[tauri::command]
async fn restore_object(state: State<'_, AppState>, id: String) -> Reply<()> {
    with(&state, |w| w.restore_object(&id))
}
#[tauri::command]
async fn load_card_deck(state: State<'_, AppState>) -> Reply<String> {
    with(&state, |w| {
        Ok(w.db.query_row("SELECT content FROM card_deck WHERE id=1", [], |r| r.get(0))?)
    })
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
    deck: Option<String>,
    quiz: Option<Vec<mcq::Mutation>>,
    published_draft: Option<String>,
) -> Reply<()> {
    with(&state, |w| {
        w.save_documents_with_mcq(&documents, deck.as_deref(), quiz.as_deref().unwrap_or_default(), published_draft.as_deref())
    })
}
#[tauri::command]
async fn load_mcq_progress(state: State<'_, AppState>, notebook: String) -> Reply<Vec<mcq::Progress>> {
    with(&state, |w| mcq::load(w, &notebook))
}
#[tauri::command]
async fn reset_mcq_progress(state: State<'_, AppState>, notebook: String) -> Reply<()> {
    with(&state, |w| mcq::reset(w, &notebook))
}
#[tauri::command]
async fn load_mcq_draft(state: State<'_, AppState>, id: String) -> Reply<Option<String>> {
    use rusqlite::OptionalExtension;
    with(&state, |w| Ok(w.db.query_row("SELECT content FROM mcq_drafts WHERE id=?1", [&id], |r| r.get(0)).optional()?))
}
#[tauri::command]
async fn save_mcq_draft(state: State<'_, AppState>, id: String, content: Option<String>) -> Reply<()> {
    with(&state, |w| {
        if id.len() > 160 { return Err("Invalid draft ID".into()); }
        if let Some(content) = content {
            if content.len() > 65_536 { return Err("Draft is too large".into()); }
            let _: serde_json::Value = serde_json::from_str(&content)?;
            w.db.execute("INSERT INTO mcq_drafts VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET content=excluded.content", rusqlite::params![id, content])?;
        } else {
            w.db.execute("DELETE FROM mcq_drafts WHERE id=?1", [&id])?;
        }
        Ok(())
    })
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
/// Clone the active workspace root so cache file IO never holds the lock.
fn workspace_root(state: &State<AppState>) -> Reply<std::path::PathBuf> {
    with(state, |w| Ok(w.root.clone()))
}
#[tauri::command]
async fn canvas_preview_load(
    state: State<'_, AppState>,
    document: String,
    keys: Vec<(String, String)>,
) -> Reply<tauri::ipc::Response> {
    let root = workspace_root(&state)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || canvas_previews::load(&root, &document, &keys))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
async fn canvas_preview_save(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Reply<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected preview bytes".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
            .ok_or_else(|| "Missing preview key".to_string())
    };
    let (document, note, fingerprint) = (header("knot-document")?, header("knot-note")?, header("knot-fingerprint")?);
    let root = workspace_root(&state)?;
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || canvas_previews::save(&root, &document, &note, &fingerprint, &bytes))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn canvas_preview_prune(state: State<'_, AppState>, document: String, keep: Vec<String>) -> Reply<usize> {
    let root = workspace_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || canvas_previews::prune(&root, &document, &keep))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn check_workspace(state: State<'_, AppState>) -> Reply<storage::IntegrityReport> {
    with(&state, |w| w.integrity())
}
#[tauri::command]
async fn preview_orphans(state: State<'_, AppState>) -> Reply<Vec<quarantine::Candidate>> {
    with(&state, |w| quarantine::preview(w))
}
#[tauri::command]
async fn quarantine_catalog(state: State<'_, AppState>) -> Reply<quarantine::Catalog> {
    with(&state, |w| quarantine::catalog(w))
}
#[tauri::command]
async fn quarantine_orphans(
    state: State<'_, AppState>,
    selected: Vec<quarantine::Selection>,
) -> Reply<Vec<quarantine::Outcome>> {
    with(&state, |w| quarantine::quarantine(w, &selected))
}
#[tauri::command]
async fn restore_quarantined(state: State<'_, AppState>, id: String) -> Reply<()> {
    with(&state, |w| quarantine::restore(w, &id))
}
#[tauri::command]
async fn dispose_quarantined(
    state: State<'_, AppState>,
    entry: quarantine::Entry,
) -> Reply<Option<String>> {
    with(&state, |w| quarantine::dispose(w, &entry))
}
#[tauri::command]
async fn recover_missing_attachment(state: State<'_, AppState>, hash: String) -> Reply<String> {
    with(&state, |w| quarantine::recover_missing(w, &hash))
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
async fn restore_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Reply<Option<String>> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("Knot workspace", &["knot"])
        .pick_file()
        .await;
    match file {
        Some(p) => {
            let result = {
                let mut guard = state
                    .workspace
                    .lock()
                    .map_err(|_| "Workspace lock unavailable")?;
                (|| -> storage::Result<String> {
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
                })()
            };
            let restored = result.map_err(|e| e.to_string())?;
            browser::after_transition(&app).await;
            Ok(Some(restored))
        }
        None => Ok(None),
    }
}
pub fn run() {
    let mut context = tauri::generate_context!();
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("KNOT_TEST_DATA_DIR") {
        let _ = root;
        // Config dataDirectory accepts relative paths only. Build the isolated
        // test shell explicitly so its absolute profile cannot be ignored.
        context.config_mut().app.windows[0].create = false;
    }
    // Isolated native test runs (debug only) must not hand off to an
    // installed Knot that is already open.
    #[cfg(debug_assertions)]
    let isolated = std::env::var_os("KNOT_TEST_DATA_DIR").is_some();
    #[cfg(not(debug_assertions))]
    let isolated = false;
    let builder = tauri::Builder::default();
    let builder = if isolated { builder } else { builder
        // Must be first: a second launch (double-clicking a .knotbook while Knot
        // is open) hands its file to this instance instead of failing on the
        // workspace lock, and brings the window forward.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = knotbook_arg(&args) {
                let token = register_knotbook(&app.state::<KnotbookFiles>(), path);
                let _ = tauri::Emitter::emit(app, "knotbook-open", token);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })) };
    builder
        // Signed updates from the releases repository; see docs/UPDATER-INSTALLER-PLAN.md.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Launched by double-clicking a .knotbook: keep it for the interface.
            if let Some(path) = knotbook_arg(std::env::args_os()) {
                let files = app.state::<KnotbookFiles>();
                let token = register_knotbook(&files, path);
                if let Ok(mut pending) = files.pending.lock() {
                    *pending = Some(token);
                };
            }
            #[cfg(debug_assertions)]
            if let Some(root) = std::env::var_os("KNOT_TEST_DATA_DIR") {
                let mut builder = tauri::WebviewWindowBuilder::from_config(
                    app.handle(),
                    &app.config().app.windows[0],
                )?
                .data_directory(std::path::PathBuf::from(root).join("shell-webview"));
                if let Ok(args) = std::env::var("KNOT_TEST_SHELL_ARGS") {
                    builder = builder.additional_browser_args(&args);
                }
                builder.build()?;
            }
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
            app.manage(diagnostics::Diagnostics::open(
                base.join("ai-diagnostics.sqlite"),
            ));
            app.manage(topic::TopicCache(app.path().app_cache_dir()?.join("topic-v1"), Mutex::new(true), Mutex::new(std::collections::HashMap::new())));
            app.manage(AppState {
                workspace: Mutex::new(workspace),
                base,
            });
            Ok(())
        })
        .manage(ai::Requests::default())
        .manage(LastShare(Mutex::new(None)))
        .manage(KnotbookFiles::default())
        .manage(web_sources::Requests::default())
        .manage(web_render::Renders::default())
        .manage(browser::Browser::default())
        .on_window_event(|window, event| {
            // WebView2 can defer the JS close listener while minimized. Wake
            // the main window from the native close event so App.tsx can run
            // its usual save/cleanup flow (and show any error). Do not destroy
            // the window here or bypass the frontend's pending-operation guard.
            #[cfg(windows)]
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && window.is_minimized().unwrap_or(false)
            {
                let _ = window.unminimize();
            }
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                browser::shell_loading(webview.app_handle());
            }
        })
        .invoke_handler(|invoke| {
            // Registered app commands default to available in Tauri. Check the
            // actual native caller for ALL commands, including storage and AI.
            if !browser::trusted(invoke.message.webview_ref()) {
                invoke.resolver.reject("Untrusted webview");
                return true;
            }
            #[cfg(debug_assertions)]
            if invoke.message.command() == "browser_test_window" {
                let handler: fn(tauri::ipc::Invoke) -> bool =
                    tauri::generate_handler![browser::browser_test_window];
                return handler(invoke);
            }
            let handler: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
                browser::browser_create,
                browser::browser_bounds,
                browser::browser_dispose,
                browser::browser_navigate,
                browser::browser_action,
                browser::browser_status,
                browser::browser_open_external,
                ai::ai_open_api_keys,
                ai::ai_connected,
                ai::ai_connect,
                ai::ai_disconnect,
                ai::ai_models,
                ai::ai_respond,
                topic::topic_enabled, topic::topic_catalog, topic::topic_pending, topic::topic_load, topic::topic_replace, topic::topic_search,
                ai::ai_cancel,
                web_sources::web_sources_fetch,
                web_sources::web_sources_cancel,
                web_render::web_sources_render,
                diagnostics::ai_diagnostics,
                diagnostics::ai_diagnostics_enabled,
                diagnostics::ai_diagnostics_clear,
                diagnostics::ai_diagnostics_outcome,
                diagnostics::ai_diagnostics_export,
                export_document,
                knotbook_size,
                export_knotbook,
                show_last_share,
                choose_knotbook,
                unshared_references,
                pending_knotbook,
                inspect_knotbook,
                import_knotbook,
                list_backups,
                create_backup,
                validate_backup,
                delete_backup,
                restore_managed_backup,
                workspace_catalog,
                switch_workspace,
                open_external_workspace,
                relocate_workspace,
                collection_catalog,
                set_favorite,
                ai_chats_list,
                ai_chat_save,
                ai_chat_delete,
                create_collection,
                getting_started_status,
                install_getting_started,
                rename_collection,
                delete_collection,
                reorder_collections,
                get_membership,
                set_membership,
                filter_objects,
                library_page,
                list_objects,
                create_object,
                rename_object,
                delete_object,
                list_trash,
                purge_trash,
                read_ui_preferences,
                write_ui_preferences,
                clear_expired_trash,
                restore_object,
                load_card_deck,
                load_mcq_progress,
                reset_mcq_progress,
                load_mcq_draft,
                save_mcq_draft,
                load_document,
                save_document,
                save_documents,
                put_blob,
                get_blob,
                list_blobs,
                canvas_preview_load,
                canvas_preview_save,
                canvas_preview_prune,
                check_workspace,
                preview_orphans,
                quarantine_catalog,
                quarantine_orphans,
                restore_quarantined,
                dispose_quarantined,
                recover_missing_attachment,
                export_backup,
                restore_backup
            ];
            handler(invoke)
        })
        .run(context)
        .expect("Knot could not start; workspace was not reset");
}
