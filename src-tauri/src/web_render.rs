//! Rendered fallback for website sources that need JavaScript.
//!
//! The page loads in a hidden, throwaway WebView2 child with its own InPrivate
//! profile: no cookies or storage from the mini browser or the shell, no IPC
//! capability (every command checks the caller is the trusted shell), app
//! resources blocked, and no popups, downloads or permissions. Knot reads the
//! rendered HTML once the text stops changing, closes the view and deletes its
//! profile. The HTML then goes through the same non-rendering extraction as a
//! normal fetch.
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State, WebviewUrl};
use tokio::sync::Notify;

const DEADLINE: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(400);
/// Text that has not changed for this long is treated as rendered.
const SETTLED: Duration = Duration::from_millis(1200);
/// Pages with less readable text than this keep waiting until the deadline.
const MIN_TEXT: usize = 200;
const MAX_HTML: usize = 4 * 1024 * 1024;
const PROFILE_PREFIX: &str = "knot-capture-";

#[derive(Default)]
pub struct Renders {
    active: Mutex<HashMap<String, Arc<Notify>>>,
    turn: tokio::sync::Mutex<()>,
}
impl Renders {
    pub fn cancel(&self, id: &str) {
        if let Ok(active) = self.active.lock() {
            if let Some(cancel) = active.get(id) {
                cancel.notify_one();
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    final_url: String,
    body: String,
    content_type: &'static str,
    fetched_at: String,
}

/// Dialogs would stall the page while nobody can see them.
const POLICY: &str = "(() => { window.alert = () => {}; window.confirm = () => false; window.prompt = () => null; window.print = () => {}; })();";
const PROBE: &str = "[document.readyState, location.href, document.body ? document.body.innerText.length : 0]";
/// A copy without scripts, styles and form fields; metadata stays for Readability.
const SNAPSHOT: &str = "(() => { const root = document.documentElement.cloneNode(true); root.querySelectorAll('script,style,noscript,template,svg,canvas,iframe,object,embed,link,input,textarea,select,button').forEach((n) => n.remove()); return [location.href, '<!doctype html>' + root.outerHTML]; })()";

fn allowed(url: &tauri::Url) -> bool {
    crate::browser::remote(url)
        && url
            .host_str()
            .map(|h| h.trim_matches(['[', ']']))
            .and_then(|h| h.parse::<std::net::IpAddr>().ok())
            .is_none_or(crate::web_sources::public_ip)
}

async fn eval(view: &tauri::Webview, script: &str) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    view.eval_with_callback(script, move |json| {
        if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
            let _ = tx.send(json);
        }
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|_| "The rendered page stopped responding.".to_string())?
        .map_err(|_| "The rendered page closed.".to_string())
}

async fn settle_and_read(view: &tauri::Webview) -> Result<(String, String), String> {
    let started = Instant::now();
    let mut last = usize::MAX;
    let mut since = Instant::now();
    loop {
        tokio::time::sleep(POLL).await;
        let probe = eval(view, PROBE).await.ok();
        let (state, href, length) = probe
            .and_then(|json| serde_json::from_str::<(String, String, usize)>(&json).ok())
            .unwrap_or_default();
        let loaded = state == "complete" && href.starts_with("http");
        if length != last {
            last = length;
            since = Instant::now();
        }
        let settled = loaded && since.elapsed() >= SETTLED;
        if (settled && length >= MIN_TEXT)
            || (settled && since.elapsed() >= SETTLED * 3)
            || started.elapsed() + POLL * 4 >= DEADLINE
        {
            break;
        }
    }
    let json = eval(view, SNAPSHOT).await?;
    if json.len() > MAX_HTML * 2 {
        return Err("The rendered page exceeds the 4 MiB capture limit.".into());
    }
    let (href, html) = serde_json::from_str::<(String, String)>(&json)
        .map_err(|_| "The rendered page could not be read.".to_string())?;
    if html.len() > MAX_HTML {
        return Err("The rendered page exceeds the 4 MiB capture limit.".into());
    }
    Ok((href, html))
}

/// WebView2 holds files briefly after close; retry for a few seconds.
fn remove_profile(profile: std::path::PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..20 {
            match std::fs::remove_dir_all(&profile) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    std::thread::sleep(Duration::from_millis(250))
                }
                _ => break,
            }
        }
    });
}
/// Profiles left by an app that closed mid-render. Renders run one at a time,
/// so none of these is in use when the next one starts.
async fn remove_stale_profiles(temp: std::path::PathBuf) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        for entry in std::fs::read_dir(&temp).into_iter().flatten().flatten() {
            if entry.file_name().to_string_lossy().starts_with(PROFILE_PREFIX) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    })
    .await;
}

async fn render(app: &tauri::AppHandle, url: tauri::Url) -> Result<Rendered, String> {
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return Err("Rendered capture needs an isolated WebView2 profile. Remove WEBVIEW2_USER_DATA_FOLDER and restart Knot.".into());
    }
    let temp = app.path().temp_dir().map_err(|e| e.to_string())?;
    remove_stale_profiles(temp.clone()).await;
    let id = uuid::Uuid::new_v4().to_string();
    let profile = temp.join(format!("{PROFILE_PREFIX}{id}"));
    let builder = tauri::webview::WebviewBuilder::new(
        format!("web-capture-{id}"),
        WebviewUrl::External(url),
    )
    .data_directory(profile.clone())
    .incognito(true)
    .focused(false)
    .initialization_script_for_all_frames(POLICY)
    .on_navigation(allowed)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny)
    .on_download(|_, _| false)
    .on_web_resource_request(|_, response| {
        // Covers the app protocol, including subframes and fetch requests.
        *response.status_mut() = tauri::http::StatusCode::FORBIDDEN;
        *response.body_mut() = std::borrow::Cow::Borrowed(b"");
    });
    // Laid out at a normal desktop size but placed outside the window, so
    // pages render as usual while nothing appears on screen.
    let view = app
        .get_window("main")
        .ok_or("Missing shell window")?
        .add_child(
            builder,
            tauri::PhysicalPosition::new(-30_000, -30_000),
            tauri::PhysicalSize::new(1280, 900),
        )
        .map_err(|e| e.to_string())?;
    // Closes the page and removes its profile even when the capture is
    // stopped mid-render.
    struct Close(tauri::Webview, std::path::PathBuf);
    impl Drop for Close {
        fn drop(&mut self) {
            let _ = self.0.close();
            remove_profile(self.1.clone());
        }
    }
    let view = Close(view, profile);
    #[cfg(windows)]
    let _ = crate::browser::platform::mute(&view.0, true).await;
    let result = settle_and_read(&view.0).await;
    drop(view);
    let (href, body) = result?;
    let final_url = crate::web_sources::validate_public_url(&href)?;
    if !allowed(&final_url) {
        return Err("The page moved to an address that cannot be captured.".into());
    }
    Ok(Rendered {
        final_url: final_url.to_string(),
        body,
        content_type: "text/html",
        fetched_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string(),
    })
}

#[tauri::command]
pub async fn web_sources_render(
    app: tauri::AppHandle,
    state: State<'_, Renders>,
    id: String,
    url: String,
) -> Result<Rendered, String> {
    if id.is_empty() || id.len() > 80 {
        return Err("Invalid render request.".into());
    }
    let url = crate::web_sources::check_public(&url).await?;
    let cancel = Arc::new(Notify::new());
    state
        .active
        .lock()
        .map_err(|_| "Render lock unavailable")?
        .insert(id.clone(), cancel.clone());
    let work = async {
        // One hidden page at a time keeps memory and network use bounded.
        let _turn = state.turn.lock().await;
        tokio::time::timeout(DEADLINE + Duration::from_secs(5), render(&app, url))
            .await
            .unwrap_or_else(|_| Err("Rendering exceeded its deadline.".into()))
    };
    let result = tokio::select! {
        _ = cancel.notified() => Err("Capture stopped".into()),
        result = work => result,
    };
    if let Ok(mut active) = state.active.lock() {
        if active.get(&id).is_some_and(|c| Arc::ptr_eq(c, &cancel)) {
            active.remove(&id);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_policy() {
        let ok = |u: &str| allowed(&tauri::Url::parse(u).unwrap());
        assert!(ok("https://example.com/app#/route"));
        assert!(ok("https://93.184.216.34/"));
        assert!(!ok("http://192.168.1.10/"));
        assert!(!ok("http://[::1]/"));
        assert!(!ok("http://localhost:3000/"));
        assert!(!ok("https://knot.invalid/pdf"));
        assert!(!ok("file:///C:/Windows"));
        assert!(!ok("https://user:pw@example.com/"));
    }
}
