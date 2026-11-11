//! Rust owns the single remote child. No workspace state crosses this boundary.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{Manager, Webview, WebviewUrl};
#[cfg(windows)]
#[path = "browser_windows.rs"]
mod platform;
pub const LABEL: &str = "mini-browser";
type Reply<T> = Result<T, String>;

pub fn trusted(view: &Webview) -> bool {
    view.label() == "main"
        && view.url().is_ok_and(|u| {
            (u.scheme() == "tauri" && u.host_str() == Some("localhost"))
                || (u.scheme() == "http" && u.host_str() == Some("tauri.localhost"))
                || (cfg!(debug_assertions)
                    && u.scheme() == "http"
                    && matches!(u.host_str(), Some("localhost" | "127.0.0.1"))
                    && u.port() == Some(1420))
        })
}
fn remote(u: &tauri::Url) -> bool {
    matches!(u.scheme(), "http" | "https")
        && u.host_str().is_some_and(|h| {
            let h = h.trim_end_matches('.');
            h != "knot.invalid"
                && !h.ends_with(".knot.invalid")
                && h != "localhost"
                && !h.ends_with(".localhost")
                && !(matches!(h, "127.0.0.1" | "[::1]") && u.port() == Some(1420))
        })
        && u.username().is_empty()
        && u.password().is_none()
}
fn address(value: &str) -> Reply<tauri::Url> {
    if value.len() > 8192 {
        return Err("Web address is too long".into());
    }
    let url = tauri::Url::parse(value).map_err(|_| "Enter an HTTP or HTTPS address")?;
    if !remote(&url) {
        return Err("This address cannot open in Knot".into());
    }
    Ok(url)
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    session: String,
    url: String,
    title: String,
    back: bool,
    forward: bool,
    loading: bool,
    error: Option<String>,
    external_url: Option<String>,
    #[serde(skip)]
    navigation: u64,
    #[serde(skip)]
    stopped: bool,
}
struct Session {
    profile: std::path::PathBuf,
    status: Arc<Mutex<Status>>,
}
#[derive(Default)]
pub struct Browser {
    session: tokio::sync::Mutex<Option<Session>>,
    pending_cleanup: Mutex<Vec<std::path::PathBuf>>,
}
#[derive(Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Bounds {
    fn validate(&self) -> Reply<()> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|v| !v.is_finite() || *v < 0. || *v > 32768.)
            || self.width < 1.
            || self.height < 1.
        {
            return Err("Invalid browser bounds".into());
        }
        Ok(())
    }
}
fn error(status: &Arc<Mutex<Status>>, message: &str) {
    if let Ok(mut s) = status.lock() {
        s.error = Some(message.into());
        s.external_url = None;
    }
}
#[tauri::command]
pub async fn browser_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, Browser>,
    url: String,
    bounds: Bounds,
) -> Reply<String> {
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return Err("The WebView2 profile override prevents an isolated browser session. Remove WEBVIEW2_USER_DATA_FOLDER and restart Knot, or use your default browser.".into());
    }
    bounds.validate()?;
    let url = address(&url)?;
    let mut guard = state.session.lock().await;
    if guard.is_some() {
        return Err("Browser already exists".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let profile = app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join(format!("knot-browser-{id}"));
    let status = Arc::new(Mutex::new(Status {
        session: id.clone(),
        url: url.to_string(),
        loading: true,
        ..Status::default()
    }));
    let nav = status.clone();
    let download = status.clone();
    let permission = status.clone();
    let builder = tauri::webview::WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .data_directory(profile.clone()).incognito(true).focused(false)
        .initialization_script_for_all_frames(include_str!("browser-file-policy.js"))
        .on_navigation(move |u| { let allowed = remote(u); if !allowed { error(&nav, "This navigation is unsupported. Use Open in default browser for this site."); } allowed })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_permission_request(move |_, _| { error(&permission, "Site permissions are unavailable here. Use Open in default browser."); tauri::webview::PermissionResponse::Deny })
        .on_download(move |_, event| {
            if let tauri::webview::DownloadEvent::Requested { url, .. } = event {
                error(&download, "Downloads are unavailable here. Use Open in default browser to download this file.");
                if remote(&url) { if let Ok(mut s) = download.lock() { s.external_url = Some(url.to_string()); } }
            }
            false
        })
        .on_web_resource_request(|_, response| {
            // Covers the app protocol, including subframes and fetch requests.
            *response.status_mut() = tauri::http::StatusCode::FORBIDDEN;
            *response.body_mut() = std::borrow::Cow::Borrowed(b"");
        });
    #[cfg(debug_assertions)]
    let builder = if let Ok(args) = std::env::var("KNOT_TEST_REMOTE_ARGS") {
        builder.additional_browser_args(&args)
    } else {
        builder
    };
    let view = app
        .get_window("main")
        .ok_or("Missing shell window")?
        .add_child(
            builder,
            tauri::PhysicalPosition::new(bounds.x, bounds.y),
            tauri::PhysicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;
    *guard = Some(Session {
        profile,
        status: status.clone(),
    });
    #[cfg(windows)]
    if let Err(e) = platform::install(&view, status, app.clone()).await {
        drop(guard);
        dispose(&app).await?;
        return Err(format!("Browser isolation setup failed: {e}"));
    }
    Ok(id)
}
#[tauri::command]
pub async fn browser_bounds(
    app: tauri::AppHandle,
    state: tauri::State<'_, Browser>,
    bounds: Bounds,
    visible: bool,
) -> Reply<()> {
    bounds.validate()?;
    let guard = state.session.lock().await;
    if guard.is_none() {
        return Ok(());
    }
    let view = app.get_webview(LABEL).ok_or("Browser is closed")?;
    view.hide().map_err(|e| e.to_string())?;
    view.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    view.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    platform::mute(&view, !visible).await?;
    if visible {
        view.show().map_err(|e| e.to_string())?;
    } else if let Some(shell) = app.get_webview("main") {
        // A hidden child must not retain native keyboard focus.
        shell.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn browser_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Browser>,
) -> Reply<Option<Status>> {
    let guard = state.session.lock().await;
    let Some(session) = guard.as_ref() else {
        return Ok(None);
    };
    #[cfg(windows)]
    if let Some(view) = app.get_webview(LABEL) {
        platform::snapshot(&view, session.status.clone()).await?;
    }
    let value = session
        .status
        .lock()
        .map_err(|_| "Browser status unavailable")?
        .clone();
    Ok(Some(value))
}
#[tauri::command]
pub async fn browser_navigate(
    app: tauri::AppHandle,
    state: tauri::State<'_, Browser>,
    url: String,
) -> Reply<()> {
    let url = address(&url)?;
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("Browser is closed")?;
    {
        let mut status = session
            .status
            .lock()
            .map_err(|_| "Browser status unavailable")?;
        status.error = None;
    }
    app.get_webview(LABEL)
        .ok_or("Browser is closed")?
        .navigate(url)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn browser_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, Browser>,
    action: String,
) -> Reply<()> {
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("Browser is closed")?;
    {
        let mut status = session
            .status
            .lock()
            .map_err(|_| "Browser status unavailable")?;
        if action != "focus" {
            status.error = None;
        }
        if action == "stop" {
            status.loading = false;
            status.stopped = true;
        }
    }
    #[cfg(windows)]
    return platform::action(&app.get_webview(LABEL).ok_or("Browser is closed")?, action).await;
    #[cfg(not(windows))]
    Err("Mini browser currently requires Windows".into())
}
#[tauri::command]
pub async fn browser_open_external(url: String) -> Reply<()> {
    let url = address(&url)?;
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("KNOT_TEST_EXTERNAL_LOG") {
        use std::io::Write;
        let mut log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        writeln!(log, "{}", url.as_str()).map_err(|e| e.to_string())?;
        return Ok(());
    }
    webbrowser::open(url.as_str()).map_err(|e| e.to_string())
}
pub async fn dispose(app: &tauri::AppHandle) -> Reply<()> {
    let state = app.state::<Browser>();
    let mut guard = state.session.lock().await;
    if let Some(view) = app.get_webview(LABEL) {
        let _ = view.hide();
        view.close().map_err(|e| e.to_string())?;
    }
    if let Some(session) = guard.take() {
        state
            .pending_cleanup
            .lock()
            .map_err(|_| "Browser cleanup lock unavailable")?
            .push(session.profile);
    }
    let mut profiles = std::mem::take(
        &mut *state
            .pending_cleanup
            .lock()
            .map_err(|_| "Browser cleanup lock unavailable")?,
    );
    if profiles.is_empty() {
        return Ok(());
    }
    // Keep failed cache deletion separate from the live page. A completed
    // workspace switch must never look like a failed switch to the editor.
    profiles = tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..40 {
            profiles.retain(|profile| match std::fs::remove_dir_all(profile) {
                Ok(()) => false,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
                Err(_) => true,
            });
            if profiles.is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        profiles
    })
    .await
    .map_err(|e| e.to_string())?;
    if profiles.is_empty() {
        return Ok(());
    }
    let message = format!("Browser closed, but its temporary cache could not be removed: {}. Close other Knot test instances and retry.", profiles[0].display());
    state
        .pending_cleanup
        .lock()
        .map_err(|_| "Browser cleanup lock unavailable")?
        .extend(profiles);
    Err(message)
}
pub async fn after_transition(app: &tauri::AppHandle) {
    if let Err(message) = dispose(app).await {
        // Even a native close failure cannot expose the previous session in a
        // new workspace. Keep its directory queued for a later cleanup retry.
        let state = app.state::<Browser>();
        if let Some(session) = state.session.lock().await.take() {
            if let Ok(mut pending) = state.pending_cleanup.lock() {
                pending.push(session.profile);
            }
        }
        use tauri::Emitter;
        let _ = app.emit_to(
            tauri::EventTarget::webview("main"),
            "browser-cleanup-error",
            message,
        );
    }
}
pub fn shell_loading(app: &tauri::AppHandle) {
    // Native siblings outlive a reload of the trusted DOM. Hide immediately
    // until React mounts a new measured browser placeholder.
    if let Some(view) = app.get_webview(LABEL) {
        let _ = view.hide();
        if let Some(shell) = app.get_webview("main") {
            let _ = shell.set_focus();
        }
        #[cfg(windows)]
        tauri::async_runtime::spawn(async move {
            let _ = platform::mute(&view, true).await;
        });
    }
}
#[tauri::command]
pub async fn browser_dispose(app: tauri::AppHandle) -> Reply<()> {
    dispose(&app).await
}
// A real-window acceptance harness, deliberately absent from release builds.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn browser_test_window(
    app: tauri::AppHandle,
    action: String,
    width: Option<f64>,
    height: Option<f64>,
) -> Reply<serde_json::Value> {
    let window = app.get_window("main").ok_or("Missing test window")?;
    match action.as_str() {
        "size" => {
            let width = width.ok_or("Missing width")?;
            let height = height.ok_or("Missing height")?;
            if !width.is_finite()
                || !height.is_finite()
                || !(760.0..=2000.0).contains(&width)
                || !(540.0..=1500.0).contains(&height)
            {
                return Err("Invalid test size".into());
            }
            window
                .set_size(tauri::LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
        }
        "move" => window
            .set_position(tauri::LogicalPosition::new(80., 80.))
            .map_err(|e| e.to_string())?,
        "minimize" => window.minimize().map_err(|e| e.to_string())?,
        "restore" => {
            window.unminimize().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
        "inspect" => (),
        _ => return Err("Unsupported test action".into()),
    }
    let child = if let Some(view) = app.get_webview(LABEL) {
        let position = view.position().map_err(|e| e.to_string())?;
        let size = view.size().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let (visible, muted) = platform::probe(&view).await?;
        #[cfg(not(windows))]
        let (visible, muted) = (false, false);
        Some(
            serde_json::json!({"x":position.x,"y":position.y,"width":size.width,"height":size.height,"visible":visible,"muted":muted}),
        )
    } else {
        None
    };
    Ok(
        serde_json::json!({"browser":child,"scale":window.scale_factor().map_err(|e| e.to_string())?}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_boundary() {
        for good in ["https://example.com/a#b", "http://127.0.0.1:9444/fixture"] {
            assert!(address(good).is_ok(), "{good}");
        }
        for bad in [
            "javascript:alert(1)",
            "data:text/html,test",
            "file:///C:/notes",
            "blob:https://example.com/x",
            "tauri://localhost/",
            "http://tauri.localhost/",
            "http://ipc.localhost/",
            "https://knot.invalid/pdf",
            "https://knot.invalid./oops",
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "https://user:secret@example.com",
            "not a URL",
        ] {
            assert!(address(bad).is_err(), "{bad}");
        }
    }
    #[test]
    fn bounded_geometry() {
        assert!(Bounds {
            x: f64::NAN,
            y: 0.,
            width: 100.,
            height: 100.
        }
        .validate()
        .is_err());
        assert!(Bounds {
            x: 0.,
            y: 0.,
            width: 0.,
            height: 100.
        }
        .validate()
        .is_err());
        assert!(Bounds {
            x: 0.,
            y: 0.,
            width: 100.,
            height: 100.
        }
        .validate()
        .is_ok());
    }
}
