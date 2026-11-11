use super::*;
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::core::{Interface, PWSTR};

// Queue COM work on the UI thread; await completion on the async runtime.
async fn native<T: Send + 'static>(
    view: &Webview,
    f: impl FnOnce(tauri::webview::PlatformWebview) -> windows::core::Result<T> + Send + 'static,
) -> Reply<T> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |p| {
        let _ = tx.send(f(p).map_err(|e| e.to_string()));
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "Browser callback was cancelled")?
}
unsafe fn read(core: &ICoreWebView2, status: &Arc<Mutex<Status>>) -> windows::core::Result<()> {
    let mut url = PWSTR::null();
    core.Source(&mut url)?;
    let url = take_pwstr(url);
    let mut title = PWSTR::null();
    core.DocumentTitle(&mut title)?;
    let title = take_pwstr(title);
    let mut back = false.into();
    let mut forward = false.into();
    core.CanGoBack(&mut back)?;
    core.CanGoForward(&mut forward)?;
    if let Ok(mut s) = status.lock() {
        s.url = url;
        s.title = title;
        s.back = back.as_bool();
        s.forward = forward.as_bool();
    }
    Ok(())
}
pub async fn snapshot(view: &Webview, status: Arc<Mutex<Status>>) -> Reply<()> {
    native(view, move |p| unsafe {
        read(&p.controller().CoreWebView2()?, &status)
    })
    .await
}
pub async fn mute(view: &Webview, muted: bool) -> Reply<()> {
    native(view, move |p| unsafe {
        p.controller()
            .CoreWebView2()?
            .cast::<ICoreWebView2_8>()?
            .SetIsMuted(muted)
    })
    .await
}
#[cfg(debug_assertions)]
pub async fn probe(view: &Webview) -> Reply<(bool, bool)> {
    native(view, move |p| unsafe {
        let mut visible = false.into();
        let mut muted = false.into();
        p.controller().IsVisible(&mut visible)?;
        p.controller()
            .CoreWebView2()?
            .cast::<ICoreWebView2_8>()?
            .IsMuted(&mut muted)?;
        Ok((visible.as_bool(), muted.as_bool()))
    })
    .await
}
pub async fn action(view: &Webview, action: String) -> Reply<()> {
    native(view, move |p| unsafe {
        let core = p.controller().CoreWebView2()?;
        match action.as_str() {
            "back" => core.GoBack(),
            "forward" => core.GoForward(),
            "reload" => core.Reload(),
            "stop" => core.Stop(),
            "focus" => {
                p.controller().SetIsVisible(true)?;
                p.controller()
                    .MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_NEXT)
            }
            _ => Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x80070057u32 as i32,
            ))),
        }
    })
    .await
}
pub async fn install(
    view: &Webview,
    status: Arc<Mutex<Status>>,
    app: tauri::AppHandle,
) -> Reply<()> {
    native(view, move |p| unsafe {
        p.controller().cast::<ICoreWebView2Controller4>()?.SetAllowExternalDrop(false)?;
        let core = p.controller().CoreWebView2()?;
        let settings = core.Settings()?;
        settings.SetAreDefaultContextMenusEnabled(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        #[cfg(not(debug_assertions))]
        settings.SetAreDevToolsEnabled(false)?;
        let settings4 = settings.cast::<ICoreWebView2Settings4>()?;
        settings4.SetIsPasswordAutosaveEnabled(false)?;
        settings4.SetIsGeneralAutofillEnabled(false)?;
        let mut token = 0;
        let uploads = status.clone();
        core.add_WebMessageReceived(&WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut message = PWSTR::null();
                if args.TryGetWebMessageAsString(&mut message).is_ok() && take_pwstr(message) == "knot:uploads-unavailable" {
                    error(&uploads, "File uploads are unavailable here. Use Open in default browser.");
                }
            }
            Ok(())
        })), &mut token)?;
        p.controller().add_AcceleratorKeyPressed(&AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut key = 0; args.VirtualKey(&mut key)?;
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN; args.KeyEventKind(&mut kind)?;
                let control = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(0x11) < 0;
                if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && (key == 0x75 || (control && key == 0x4c)) {
                    args.SetHandled(true)?;
                    if let Some(shell) = app.get_webview("main") { let _ = shell.set_focus(); }
                    use tauri::Emitter;
                    let _ = app.emit_to(tauri::EventTarget::webview("main"), "browser-focus-address", ());
                }
            }
            Ok(())
        })), &mut token)?;
        let starting = status.clone();
        core.add_NavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut uri = PWSTR::null(); args.Uri(&mut uri)?;
                if address(&take_pwstr(uri)).is_err() {
                    args.SetCancel(true)?;
                    error(&starting, "This navigation is unsupported. Use Open in default browser for this site.");
                    if let Ok(mut s) = starting.lock() { s.loading = false; }
                    return Ok(());
                }
                let mut id = 0; args.NavigationId(&mut id)?;
                if let Ok(mut s) = starting.lock() { s.navigation = id; s.loading = true; s.stopped = false; s.error = None; s.external_url = None; }
            }
            Ok(())
        })), &mut token)?;
        let completed = status.clone();
        core.add_NavigationCompleted(&NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut id = 0; args.NavigationId(&mut id)?;
                let mut success = false.into(); args.IsSuccess(&mut success)?;
                if let Ok(mut s) = completed.lock() {
                    if s.navigation == 0 || s.navigation == id {
                        s.loading = false;
                        if !success.as_bool() && !s.stopped { s.error = Some("The page could not load. Check the address or connection, retry, or open it in your default browser.".into()); }
                    }
                }
            }
            Ok(())
        })), &mut token)?;
        let popup = status.clone();
        core.add_NewWindowRequested(&NewWindowRequestedEventHandler::create(Box::new(move |sender, args| {
            if let Some(args) = args {
                args.SetHandled(true)?;
                let mut user = false.into(); args.IsUserInitiated(&mut user)?;
                let mut uri = PWSTR::null(); args.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                if user.as_bool() && address(&uri).is_ok() {
                    if let Some(sender) = sender { sender.Navigate(&windows::core::HSTRING::from(uri))?; }
                } else { error(&popup, "A popup was blocked. For sign-in flows, use Open in default browser."); }
            }
            Ok(())
        })), &mut token)?;
        // Handlers are owned by this COM webview and released on close. They
        // never access workspace state or broadcast to untrusted webviews.
        read(&core, &status)
    }).await
}
