# Mini browser v1

Implemented 6 November 2026. A single native child WebView2 page shares Knot's contextual tool slot with PDF and Ask Knot. The trusted shell owns its address field, navigation controls, resizing, expansion and close action. Page and Canvas keep their editor mounted. Opening links does not create saved sources, notes, attachments or AI context.

Use **Browser** in the document toolbar or Read & export menu. External web-link Open actions default to Knot; General settings can select the default browser instead. The explicit **Open in default browser** control always overrides that preference. Enter a URL or bare hostname; the address field is not a search engine. Internal references and PDF citations retain their existing routes. Attachment blob opens and embedded YouTube players are unchanged. Account/API-key setup continues through its existing external flow.

## Native feasibility and isolation gate

The locked versions are Tauri 2.12.5, tauri-runtime-wry 2.12.3, Wry 0.57.1 and webview2-com 0.39.1. Tauri's `unstable` feature enables `Window::add_child`. Windows acceptance ran against an actual rebuilt executable with production assets and CSP, using disposable workspaces and separate shell/remote debugging endpoints. The shell CSP was not loosened.

`browser.rs` owns the fixed `mini-browser` label. Every registered application command, including read/write/storage/AI commands, checks the actual native caller's webview label and trusted shell URL. Core capabilities target `webviews: ["main"]`, replacing the former window-wide grant. The remote child has no capability, remote origin grant or workspace handle. Requests for app-protocol resources receive an empty 403 response, including fetches and subframes. Top-level navigation and redirects reject privileged/local app origins, Knot's reserved internal namespace, credentials and non-HTTP(S) schemes. Native user-initiated new-window links navigate the existing child; unsolicited popups are denied. Browser events used for focus are sent only to the trusted `main` webview. No private app data is broadcast.

The Windows service reads actual WebView2 URL, title and Back/Forward availability. Navigation IDs guard completion/error updates; browser history includes same-document navigation. COM operations run on the UI thread and return through asynchronous channels, avoiding UI-thread waits. Session commands are serialized. Geometry uses physical pixels derived from CSS bounds and `devicePixelRatio`; bounds are finite and limited. Menus, dialogs, search and visible popovers hide and mute the child. Closing or switching contextual tools hides/mutes it without destroying history or scroll. Website activity and timers can continue while hidden; hiding is not a promise to pause a website.

F6 and Ctrl+L are native accelerators that move to the trusted address field. F6 was checked with actual Windows input while the child owned focus. Website keyboard events do not bubble to Knot. Knot shortcuts such as Ctrl+K/Ctrl+S should be used after returning to the shell; normal note autosaving continues while reading. A visible Back to note action remains outside remote content.

## Session storage and lifecycle

The remote child uses a unique temporary WebView2 data directory and InPrivate mode, separate from the shell and regular browser. Password saving and autofill are disabled. Cookies/localStorage remain available during the current workspace session. Successful workspace switching, relocation and backup restoration close the child and remove its directory. A failed workspace operation leaves the browser intact. App close first flushes notes, then disposes the browser before destroying the window. Cache removal waits for WebView2 to release files and reports a failure after a bounded retry rather than claiming success. The directory is outside workspaces and backups. `WEBVIEW2_USER_DATA_FOLDER` overrides are rejected for browser creation because they would defeat the separate-directory policy.

Normal disposal and recreation were verified to remove cookies/localStorage and delete the temporary directory. Unexpected process/OS termination can leave temporary runtime cache files; this feature is not a private-browsing or forensic-erasure guarantee. No URL, page history, session cookie or automatic reopen state is persisted by Knot. Only link preference and panel width are saved.

## Limits and fallback

- One page, no tabs, saved source model, extraction, citations or automatic AI access.
- Downloads are denied. The external control targets the rejected file URL so it can be downloaded in the system browser; no file is automatically imported.
- Sensitive site permissions are denied. External file drops are disabled natively. An initialization policy in every frame blocks ordinary file-input activation and `showPicker`, with a visible system-browser fallback. Uploads and complex authentication popup flows are outside v1; no account authentication was performed during verification.
- HTTP failures and certificate errors retain the address and expose Retry/external controls. Certificates are never bypassed. Self-signed local fixtures and an expired public certificate were rejected.
- At narrow work-area sizes the browser takes the full tool area with Back to note; the editor remains mounted. Normal split sizing keeps a minimum editor width, and expansion restores the stored split.
- Native rendering was checked at the machine's actual Windows scale (125%), with actual window resize/move/minimize/restore, including 760 × 540. An earlier isolated proof also ran at 100%. Moving a live session between monitors with different DPI scales still needs hardware acceptance; emulated device metrics are not a substitute for that check.
- Public article/documentation/video/login-page loads are smoke tests, not universal compatibility or proof that all playback, DRM, logins or third-party popup flows work.

## Verification

`node tests/native/browser-gate.mjs` checks the real child, command/core-event denial, app-resource blocking, navigation/history, hide/show and cookie/storage isolation. `node tests/native/browser-v1.mjs` checks Page/Canvas Open actions, native geometry, real history, redirects, invalid addresses, editor continuity, contextual tools, mute state, minimum window size, lifecycle, blocked uploads/downloads/popups, network errors and untrusted TLS. The fixture PEM key/certificate are test-only and never installed in a trust store. The debug window-inspection command and external-opener sink do not exist in release builds (the external sink branch is compiled out).

Optional `KNOT_BROWSER_PUBLIC_SMOKE=1` adds public-site loads; `KNOT_BROWSER_INSPECT=1` briefly holds the isolated app for Windows inspection. External routing tests use an explicit debug sink to verify exactly one native dispatch and its URL without touching the user's system-browser profile.

On 6 November 2026 the public smoke loaded Hypertext on Wikipedia, HTTP on MDN, Me at the zoo on YouTube, and GitHub's sign-in page. No credentials were entered. `expired.badssl.com` produced a Privacy error and a native failed-load status. Detailed run evidence is under `test-results/browser-gate-*` and `test-results/browser-v1-*`.

API references: [Tauri child webviews](https://v2.tauri.app/reference/javascript/api/namespacewebview/), [Rust WebviewBuilder](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewBuilder.html), [Tauri capabilities](https://v2.tauri.app/security/capabilities/). Locked local runtime source was also reviewed during the gate.

### Check results and outstanding regression findings

TypeScript, lint, all 58 frontend tests and all 69 enabled Rust tests passed (four existing opt-in Rust tests skipped). The native gate, expanded browser suite and current settings suite passed. The browser suite includes internal PDF dispatch and preserves the normal PDF tool slot.

Two broader legacy suites did not pass: `panels.mjs` assumes a directly available Switch workspace action and sidebar interaction while the current workspace modal is open; `pdf-highlights.mjs` fails its undo snapshot because an orphaned `knot:cited-excerpt` block remains after undo. Their existing expectations/implementation were not rewritten as part of the browser feature. These results must not be represented as a clean run of every native regression suite.

Failed/early feasibility test processes left isolated runtime caches in Windows Temp. Automatic approval review blocked an attempted cleanup outside the repository with “blocked by policy.” Those test caches remain. Normal service disposal was independently verified to remove its active session directory.

The trusted Focus page control also provides keyboard entry into the native child. Hidden views explicitly return native focus to the shell. The attempted legacy `editor.mjs` suite additionally times out trying to edit beneath the initial Canvas note mask; it did not provide a clean editor regression result. Browser-specific editor continuity and Page/Canvas routing assertions passed independently.

Cache-cleanup failures are tracked separately from live sessions. After a committed workspace change, the previous page metadata is cleared and the frontend always reloads the selected workspace; a trusted warning reports any cache still awaiting removal. A real Windows SQLite file lock in the session cache verifies that backup restoration remains successful during cleanup failure, and that cleanup retries after the lock is released. A reload of the trusted shell immediately hides/mutes its native sibling; the same workspace session resumes only after explicitly reopening Browser.

The final native browser run also checks Canvas center/zoom across opening and closing the panel. TypeScript, lint and the complete frontend/Rust suites were rerun after lifecycle changes. Latest successful focused evidence: `test-results/browser-v1-1793933115445`, `test-results/browser-gate-1793933069809`, `test-results/settings-1793933078767`, `test-results/browser-frontend-tests.log`, and `test-results/browser-rust-tests.log`.
