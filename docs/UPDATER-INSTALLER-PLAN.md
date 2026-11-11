# Updater and installer plan

Status: planned on 11 November 2026. Slice 1 (release tooling) and slice 2 (installer, section 3) are done. Slice 3 (in-app updater) is done and verified end to end: 0.2.0-rc.2 updated itself to 0.2.0-rc.3 from `knot-desktop/knot-releases` (see the verification under section 2). Slice 4 (release 0.2.0 and the first share) is next. Distribution goes through a public, code-free GitHub releases repository. Notebook sharing is planned separately.

## Principles

The installer and updater are part of Knot, not generic Windows chrome. They follow [IDENTITY.md](IDENTITY.md) and the shell rules in `AGENTS.md`:

- **Calm and quiet.** No modal interruptions, nagging or countdowns. An available update is a short notice and a page in Settings, never a blocking dialog.
- **Ink and paper.** Charcoal `#242423` and warm white `#FAF9F6`, flat fills, the Linked K mark with its crossing gaps intact. No gradients, shadows, green tints or stock Windows installer art.
- **The user's data comes first.** No step may lose an acknowledged edit or delete a workspace. Installing an update uses the normal close-and-flush path, never a forced exit. Uninstalling never removes notes.
- **Local and honest.** The only network request is a version check to GitHub, sent with nothing but standard HTTP headers. Knot says this plainly. Every failure leaves the current version running and explains what happened in one sentence.
- **Shared components.** Use `ShellIcon`, `Notice`, the `settings-page`/`settings-row` layout, shell tokens (`--shell-*`) and `src/styles/dropdowns.css` for any menu. No updater-specific skins.

## 1. Versions and releases

### Version policy

- One version number, kept in sync across `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`. The release script refuses to run if they differ.
- Stay on `0.x` until sharing is stable. Bump the **minor** version (0.2 → 0.3) for any release that raises `CURRENT_SCHEMA` (currently 10) or the workspace/archive format, because older builds reject newer databases. Bump the **patch** version for everything else.
- The first shared release is **0.2.0**, the first build with the updater. Installed 0.1.0 copies cannot update themselves, so the friend's first install, and yours, comes from the 0.2.0 installer.

### Signing key

- Generate once with `pnpm tauri signer generate -w %USERPROFILE%\.knot\knot-updater.key`, protected by a password.
- The public key goes into `tauri.conf.json` (`plugins.updater.pubkey`). The private key never enters the repo, and `.gitignore` gets a guard pattern for it.
- Keep an offline backup of the key file and its password. If the key is lost, installed copies can no longer accept updates and everyone has to reinstall by hand.

### Releases repository

- A free GitHub organization (name to be decided, e.g. `knot-app`) owns a public repo `knot-releases` containing only a README. Issues, Wiki, Discussions and Projects are disabled. Commits use GitHub's `noreply` email.
- The Knot source repository never gets this as a remote. Publishing uses `gh release create`, which uploads files without pushing code.
- Fixed endpoint built into Knot:
  `https://github.com/<org>/knot-releases/releases/latest/download/latest.json`

### Release script: `pnpm release <version>`

`scripts/release.ps1`, run from the Knot repo:

1. **Preflight:** clean working tree on the intended commit, the three version fields match `<version>`, a tag of that name doesn't exist yet, `gh auth status` is fine, and the signing key and password are present in the environment (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
2. **Checks:** `pnpm check`, `pnpm lint`, `pnpm test`, `cargo test`, `cargo clippy`.
3. **Build:** `pnpm tauri build --config <generated file>`. The script writes that file for each release with `bundle.createUpdaterArtifacts` and the `plugins.updater` section (public key read from `knot-updater.key.pub`, endpoint, passive install mode). Tauri needs that section to sign at all. Generating it from the key pair actually used means the embedded key always matches the signing key, and `pnpm update:running` keeps building without any key. The build produces `Knot_<v>_x64-setup.exe` and its `.sig`.
4. **Manifest:** write `latest.json` (version, short notes, publish date, `windows-x86_64` URL and signature). Release notes come from a `docs/releases/<version>.md` file of at most about 8 short lines. The same text appears in Knot.
5. **Publish:** `gh release create v<version> --repo <org>/knot-releases` with the installer, the `.sig` and `latest.json`. The release title is `Knot <version>`.
6. **Verify:** download `latest.json` through the fixed endpoint, check the version and signature, and check that the installer URL resolves and the downloaded file matches the local hash.
7. Then run `pnpm update:running` as usual so this PC runs the released build.

`pnpm update:running` stays as the local development path. It replaces the exe directly, so the Windows "Apps" list may show a stale version between releases. That's cosmetic.

## 2. Updater

### Native setup

- Add `tauri-plugin-updater` (Rust) and `@tauri-apps/plugin-updater` (JS), plus the `updater:default` capability in `src-tauri/capabilities/main.json`.
- `plugins.updater`: `endpoints` = the fixed URL above, `pubkey`, and `windows.installMode: "passive"` (installs with a small progress window and no questions, then relaunches Knot).
- The request is made from Rust, so the WebView CSP doesn't change.
- Use the split API: `check()` → `update.download(onProgress)` → Knot's own save-and-close preparation → `update.install()`. Never call `downloadAndInstall()`, because on Windows the install step exits the app, so the flush must already have happened.

### When Knot checks

- **Automatic (default on):** once per launch, about 30 seconds after the workspace finishes opening and while Knot is idle, and at most once every 24 hours. It never runs during the launch splash, a backup or restore, or a workspace switch.
- **Manual:** a **Check for updates** button in Settings → Updates. This ignores the 24-hour limit.
- **Setting:** `Check for updates automatically`, a per-device preference stored alongside the existing device preferences. Turning it off means Knot makes no network requests unless the user clicks the button or uses Ask Knot.
- Automatic checks that fail (offline, GitHub unreachable, malformed manifest) are silent. A manual check shows the failure inline.

### Settings → Updates page

A new item in the Settings sidebar under **Preferences**, after AI: `Updates`, using `ShellIcon` `refresh`.

```
Updates
Keep Knot current. Your notes stay on this device.

[Knot mark]  Knot 0.2.0
             Up to date · Checked 4 minutes ago            [Check for updates]

Check for updates automatically                               [ on ]
Knot checks GitHub once a day. Only the version number is requested;
no notes or personal data are sent.
```

States, shown in the same identity block (one line of status and one action):

| State | Status line | Action |
|---|---|---|
| Up to date | `Up to date · Checked <relative time>` | Check for updates |
| Checking | `Checking for updates…` | (disabled) |
| Available | `Knot 0.3.0 is available` + release notes below | Download update · Skip this version |
| Downloading | `Downloading 0.3.0 · 42 MB of 98 MB` + thin bar | Cancel |
| Ready | `Knot 0.3.0 is ready to install` | Restart to update |
| Preparing | `Saving your work…` | (disabled) |
| Failed | One sentence explaining the cause, e.g. `The update couldn't be verified, so it wasn't installed.` | Try again |

- Release notes appear as a plain list under the status line, using the page's body styling, with no markdown rendering beyond simple bullets.
- The progress bar is 2px, uses `--shell-accent` on `--shell-border`, has no animation beyond its width, and is announced through `role="progressbar"` with values.
- "Skip this version" hides the notice for that version only. A later version shows the notice again.

### Notice when an update is found

- One `Notice` per version, shown after an automatic check: `Knot 0.3.0 is available.` with a **View** button that opens Settings → Updates. It dismisses after the standard duration and isn't shown again for that version.
- A 6px dot on the sidebar Settings item, using `--shell-accent`, persists until the user opens Updates, skips the version, or installs it. No badge counts and no colored accents.
- Nothing downloads without a click. A ~100 MB download is the user's choice.

### Install flow ("Restart to update")

1. Refuse with the existing message if an operation is in progress (`locked`), the same as closing the window.
2. Status `Saving your work…`: run the same steps as `onCloseRequested`: `flushMcqDraft`, `session.flush()`, `browserApi.dispose()`. Factor these into one shared `prepareToClose()` used by both. If a save fails, stop and keep the normal save-error UI. The update stays "Ready".
3. **Pre-update backup:** create a managed backup through the existing `create_backup` path. It appears in Settings → Backups with its normal timestamped name. Proposed default: always on, because every schema bump is one-way.
4. `update.install()` hands over to the NSIS installer in passive mode. Knot exits through the installer's normal close, and the installer relaunches Knot when it's done.
5. If the install is cancelled or fails, the old version is unchanged, and on next launch Knot shows `The update to 0.3.0 didn't finish. Knot 0.2.0 is still installed.`

### After an update

- On launch, compare the running version with the last-run version stored per device. If it's newer, show one `Notice`: `Knot is now 0.3.0.` with a **What's new** button that opens Settings → Updates showing that release's notes.
- Schema migrations already keep a verified pre-migration archive. Together with the pre-update backup, a failed upgrade can be restored from Settings → Backups.
- No downgrades. The updater only installs versions newer than the running one, which matches the rule that older builds reject newer databases.

### Failure messages

| Cause | Message |
|---|---|
| Offline / unreachable (manual check) | `Couldn't reach GitHub. Check your connection and try again.` |
| Signature mismatch | `The update couldn't be verified, so it wasn't installed.` |
| Download interrupted | `The download stopped. Try again to resume from the start.` |
| Not enough disk space | `There isn't enough free space to download the update.` |
| Save failed during preparation | Existing save-error UI; the update waits. |

### As built and verified (11 November 2026)

- **Code:**
  - `src/services/updater.ts`: state machine, per-device preferences, plain-language errors, and a launch report;
  - `src/app/UpdatesSettings.tsx`: Settings → Updates;
  - `App.tsx`: the daily check, the notices and the Settings dot;
  - a shared save step (`flushPendingWork`, `prepareToClose`) used by both closing Knot and installing an update;
  - `tauri-plugin-updater` 2.14 with the committed public key, the endpoint, and passive install mode.
  - Unit tests are in `tests/updater.test.ts`.
- **Plugin behaviour on Windows:** it downloads to a temp file (no SmartScreen prompt), then runs the installer with `/P /UPDATE /R`, which relaunches Knot, and exits Knot with `exit(0)`. Knot saves and backs up before calling install.
- **Differences from the mockups:**
  - Downloading has no **Cancel**, because the plugin can't abort a download.
  - The failed state's detail line says the installed version is unchanged.
- **End-to-end test:** 0.2.0-rc.2 (installed with the Knot installer) checked GitHub and found 0.2.0-rc.3 (published with `pnpm release 0.2.0-rc.3 -TestLatest -SkipLocalUpdate`). It showed the release notes, downloaded, and on **Restart to update** saved and created a managed backup. The backup contains `knot.db` and all 17 attachments, the same count as the live workspace. Knot then closed, the passive installer ran, and Knot reopened on 0.2.0-rc.3 about 13 seconds later.

## 3. Installer (NSIS)

### Configuration (as built)

- `bundle.windows.nsis`:
  - `template: installer/knot.nsi`;
  - `installMode: currentUser`, so there's no admin prompt and Knot installs to `%LOCALAPPDATA%\Knot`;
  - `installerIcon`/`uninstallerIcon: icons/icon.ico`;
  - `headerImage`/`uninstallerHeaderImage: installer/header.bmp`, `sidebarImage: installer/sidebar.bmp`;
  - `compression: lzma`, no language selector.
- `bundle.windows.allowDowngrades: false` and `webviewInstallMode: embedBootstrapper` (adds about 1.8 MB, so Windows 10 PCs without WebView2 can install).
- `bundle.publisher: "Knot"`, `copyright`, `homepage` (the releases repo). The Apps list shows Knot / Knot / version / homepage.

### Artwork (as built)

`node scripts/create-installer-art.mjs` renders the Linked K paths from `assets/knot-mark.svg` in headless Edge and writes 24-bit BMPs to `src-tauri/installer/`. They're rendered at 2× (328×628 and 300×114) and NSIS scales them to the control, which keeps them sharp from 100% to 200% display scaling.

- **Sidebar (Welcome and Finish):** flat paper `#FAF9F6`, the charcoal mark in the upper third with the wordmark below, and a hairline on the right edge.
- **Header (inner pages):** paper, with a small mark on the right.
- `MUI_BGCOLOR FAF9F6` / `MUI_TEXTCOLOR 242423` give the header strip and the Welcome/Finish pages the paper palette.
- Windows draws the inner page body, the bottom bar, buttons, checkboxes and the progress bar (green on Windows 11), and these can't be restyled. NSIS doesn't follow dark mode. No mascot art is used.

### Pages (as built)

`src-tauri/installer/knot.nsi` is Tauri 2.12.4's template (the untouched copy is `tauri-2.12.4-installer.nsi.orig`) with every change marked `KNOT:`. English copy is in `LangString knot*` entries at the end of the language section.

1. **Welcome:**
   - `Install Knot` / `A local home for connected ideas.` / the account-only note;
   - `Installs to <path>` and a **Change location…** link below the text;
   - the main button reads **Install**.
   - The directory page appears only after the link is used.
2. **Installing:**
   - `Installing Knot` / `This takes less than a minute.`, with details hidden behind a button;
   - it moves on to Finish by itself;
   - on failure: `Knot wasn't installed` / `Your notes weren't changed.`
3. **Finish:** `Knot is ready.` / `Find it in the Start menu any time.`, with **Open Knot** and **Add a desktop shortcut** both ticked, and **Done**.

Other behaviour:

- **No reinstall/uninstall page.** An existing copy is replaced in place, as updates do.
- **Newer copy:** if the installed version is newer, the installer shows `Knot X is already installed, which is newer than this installer…`, quits, and changes nothing. Passive and silent runs are refused too (`allowDowngrades: false`).
- **Knot open, interactive install:** Tauri's default force-closes the app, which would skip Knot's save-on-close. Knot's template asks `Knot is open. Close it from its window so your work is saved, then click Retry.` Cancel leaves everything as it was.
- **Knot open, passive or silent run:** the installer waits up to 60 seconds for Knot to close by itself. If it hasn't, the installer exits with code 2 without replacing anything.
- **Updates (`/P /UPDATE`):** only the progress page shows, titled `Updating Knot` / `Updating Knot to <version>` / `Your notes aren't touched while Knot updates.` Whether Knot relaunches depends on the arguments the updater passes, and is checked in slice 3.

The release script warns when the Tauri CLI version differs from the version the template was copied from.

### Uninstaller: never delete notes (as built)

Knot stores workspaces, managed backups and AI diagnostics in `%LOCALAPPDATA%\com.knot.desktop` (`app_local_data_dir`). Tauri's default uninstaller offers **"Delete the application data"**, which would remove that whole folder. Knot's template removes both the checkbox and the deletion code.

- **Confirm page:** `Uninstall Knot` / `This removes the app and its shortcuts.` / `Your notes and backups stay in <folder>. Install Knot again and it opens them automatically.`
- **Finish page:** `Knot was removed` / `Your notes and backups are kept.`
- The uninstaller removes the exe, uninstaller, shortcuts and the Apps entry. Everything under `com.knot.desktop` stays, caches included. Removing user data is never part of uninstalling.
- The planned **Open folder** link was dropped, because the folder path is shown in the text.

### Verification (11 November 2026, this PC, 125% scaling)

- Your notes and backups (55 files under `Workspace` and `Backups`) were fingerprinted before testing and compared after each step. They were byte-identical throughout, including after uninstall.
- **Interactive install while Knot was open:** the close prompt appeared. The user closed Knot normally and clicked Retry, the install completed, and **Open Knot** on Finish launched it.
- **Passive update with Knot closed:** completed with exit code 0 and the "Updating Knot to …" header.
- **Passive update with Knot open:** waited, then gave up. Knot kept running in the same process and was never killed. This led to the change to exit by itself instead of stopping on a failure page.
- **Newer-version guard:** with the Apps entry temporarily set to 9.9.9, the message appeared, the installer quit, and nothing changed.
- **Uninstall:** the app, Start menu shortcut and Apps entry were removed, and the data folder was unchanged.
- **Reinstall:** Welcome → Change location… → location page → Install → Finish → Open Knot.
- Not yet covered: a clean Windows account and a second PC (SmartScreen, Windows 10 WebView2 bootstrap).

Found while testing, and fixed in `App.tsx`: when Knot's browser pane webview was broken, closing Knot failed with "failed to send message to the webview" after saving, so the window couldn't close and an update couldn't proceed. Browser-pane cleanup during close is now best-effort. The window is destroyed anyway, and edits are flushed before that step. The pane broke in a Knot launched minimized by the test harness; the root cause of that is not investigated.

### Unsigned builds

- Without a code-signing certificate Windows SmartScreen shows "Windows protected your PC" on first install. The share message for friends explains **More info → Run anyway** in one line.
- Passive-mode updates are verified by the updater signature, and in practice they don't show SmartScreen again for the same publisher path. This needs checking on a second PC.
- A certificate (e.g. Azure Trusted Signing) is a later, paid option and isn't part of this plan.

### Size

The installer is about 101 MB because `public/models` (130 MB, multilingual-e5-small) and `public/onnx` (21 MB) are embedded in the exe. Every update downloads the full installer. A separate, optional slice could move the model out of the exe and download it once on first use. It's tracked as a follow-up and doesn't block 0.2.0.

## 4. Slices and acceptance

1. **Release plumbing:** version sync, signing key, releases repo, `pnpm release`, `latest.json`. *Done when* a test release (`0.2.0-rc.1`) is downloadable through the fixed endpoint with a valid signature.
2. **Installer:** artwork script, trimmed template, copy, uninstaller data protection, config. *Done when* a clean install, reinstall over 0.1.0, passive update and uninstall all work on this PC and on a second Windows account. The workspace and backups survive uninstall, and the Apps list shows the icon, name, publisher and version.
3. **Updater:** plugin, shared `prepareToClose()`, Settings → Updates, notice, sidebar dot, pre-update backup, post-update notice. *Done when*:
   - 0.2.0 updates to a 0.2.1 test release end to end.
   - A pending edit made just before **Restart to update** survives.
   - A simulated save failure blocks the install.
   - A tampered `.sig` is rejected with the verification message.
   - Offline launch shows nothing, and a manual check offline shows the connection message.
   - Turning off automatic checks results in no requests (checked with network logging).
   - Light and dark themes, keyboard-only use, and screen-reader names for status and progress all work.
4. **First share:** release 0.2.0, send the installer and the one-line SmartScreen note, confirm she installs it and later receives 0.2.1 through the updater.

## 5. Open decisions

- GitHub organization name for the releases repo.
- Pre-update backup: always (proposed) or a setting.
- Whether to keep a directory choice at all, or always install to `%LOCALAPPDATA%\Knot`.
- Whether to schedule moving the model out of the exe before or after the first share.
