# Handoff: double-clicking a .knotbook doesn't open Knot

Written 12 November 2026 for the next agent. Context: [NOTEBOOK-SHARING-PLAN.md](NOTEBOOK-SHARING-PLAN.md), slices 2 (import) and 3 (double-click). Everything below is **uncommitted** on branch `codex/milestone-2-navigation`; the last commit is `78fccb7` (slice 1, Share as file).

## The problem

On this PC (Windows 11, per-user install at `%LOCALAPPDATA%\Knot`, installed version 0.3.0-rc.1):

- Double-clicking `C:\Users\Acer\Downloads\PrepToPresent.knotbook` in File Explorer shows Windows' **"Select an app to open this .knotbook file"** box. **Knot is not in that list.** Jot (another local app; see `C:\Users\Acer\Documents\DevProjects\Jot\tools\Install-Jot.ps1`) **is** listed.
- File Explorer shows a **blank icon** for `.knotbook`, not `icons/knotbook/knotbook.ico`.
- Restarting Explorer, `ie4uinit -show` and `SHChangeNotify(SHCNE_ASSOCCHANGED)` changed nothing.

## What works (verified)

- **Export** (slice 1, committed). `PrepToPresent.knotbook` was created by it and inspected: the manifest, the notebook and 39 cards are correct.
- **Import, when Knot receives the path.** Running `knot.exe "<path>.knotbook"` while Knot is open makes the second instance forward the path through `tauri-plugin-single-instance` and exit 0. The running Knot then shows the import dialog ("Import “PrepToPresent”", tag Up to date). This was confirmed through WebView2's remote debugging. The dialog, inspection and commit are covered by tests.
- **Shell APIs in a normal process see the type.** `SHGetFileInfo("x.knotbook", USEFILEATTRIBUTES)` returns type name "Knot notebook" and a specific icon index (50; an unknown extension gets 0). `AssocQueryString(ASSOCSTR_COMMAND, ".knotbook", "open")` returns `"…\knot.exe" "%1"`. `AssocQueryString` with a **NULL verb** returns `0x80070483`, but it does the same for `.txt` and `.pdf` from this test harness, so that result isn't meaningful.
- **Opening via ShellExecute doesn't reach Knot either.** `Start-Process <file>` from PowerShell starts no knot.exe and no `OpenWith.exe` process. It probably shows the same picker inside Explorer, but that isn't confirmed.

## What the installer writes (from the Knot NSIS template)

From `src-tauri/installer/knot.nsi`, via Tauri's `APP_ASSOCIATE`, with `bundle.fileAssociations` in `tauri.conf.json` (name `Knot.Notebook`, description "Knot notebook"):

```
HKCU\Software\Classes\.knotbook              (default) = Knot.Notebook, Knot.Notebook_backup = ""
HKCU\Software\Classes\Knot.Notebook          (default) = Knot notebook
  \DefaultIcon                               (default) = "C:\Users\Acer\AppData\Local\Knot\knotbook.ico"
  \shell                                     (default) = open
  \shell\open                                (default) = Open with Knot
  \shell\open\command                        (default) = "C:\Users\Acer\AppData\Local\Knot\knot.exe" "%1"
```

The installer also calls `UPDATEFILEASSOC` (`SHChangeNotify`) after associating. `knotbook.ico` is installed beside the exe: `bundle.resources` maps `icons/knotbook/knotbook.ico` to `knotbook.ico`.

## Added by hand while debugging (NOT in the installer yet)

These were written directly to HKCU to test theories. None of them fixed it. Keep them in mind; they may need to move into `knot.nsi` (with matching uninstall cleanup) or be removed:

```
HKCU\Software\Classes\.knotbook\OpenWithProgids     Knot.Notebook = (REG_NONE, empty)   [first set as REG_SZ "", then REG_NONE like Jot]
HKCU\Software\Classes\Applications\knot.exe         FriendlyAppName = Knot, AppUserModelID = com.knot.desktop
  \SupportedTypes                                   .knotbook = ""
  \DefaultIcon                                      "…\knot.exe",0
  \shell\open\command                               "…\knot.exe" "%1"
HKCU\Software\Classes\Knot.Notebook                 AppUserModelID = com.knot.desktop
HKCU\Software\Knot\Capabilities                     ApplicationName = Knot, ApplicationDescription, ApplicationIcon = "…\knot.exe",0
  \FileAssociations                                 .knotbook = Knot.Notebook
HKCU\Software\RegisteredApplications                Knot = Software\Knot\Capabilities
HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\knot.exe   (default) = …\knot.exe
```

Current Explorer state: `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.knotbook` has an empty `OpenWithList` and `OpenWithProgids` (`Knot.Notebook`, REG_NONE). There is **no** `UserChoice` and no `UserChoiceLatest`. The `OpenWithList` was probably created when the file was first double-clicked, before Knot registered anything.

## Differences from Jot that haven't been ruled out

- **Install location:** Jot lives in `%LOCALAPPDATA%\Programs\Jot\Jot.exe`; Knot in `%LOCALAPPDATA%\Knot\knot.exe`, which is Tauri's default for `installMode: currentUser`.
- **App ID:** Knot's Start-menu shortcut has an explicit AppUserModelID `com.knot.desktop`, set by Tauri's `SetLnkAppUserModelId`. Jot has no Start-menu shortcut. Setting `AppUserModelID` on the ProgID didn't help, but it hasn't been tried with the running process's AUMID or with the shortcut's AUMID removed.
- **Exe name case:** `knot.exe` (lower case) vs `Jot.exe`.
- **Jot's associations were written long ago.** Knot's are minutes old, but restarting Explorer didn't help.
- **The ProgID `Knot.Notebook` has `shell` (default) = `open` and `shell\open` (default) = "Open with Knot"; `Jot.Text` has neither.

## Suggested next steps

1. Test with a **fresh extension**, e.g. `.knottest` with its own ProgID pointing at `knot.exe`, on a file that was never double-clicked. That shows whether the stale `FileExts\.knotbook\OpenWithList` matters.
2. Check Windows' association logs or Procmon on `explorer.exe` while double-clicking, to see which keys it reads for `.knotbook`.
3. Compare with Tauri issues about `fileAssociations` and per-user NSIS installs on Windows 11.
4. Whatever fixes it belongs in `src-tauri/installer/knot.nsi` (marked `KNOT:`), with uninstall cleanup, and then a reinstall from the built installer. `pnpm update:running` replaces only the exe, so it never re-registers associations.

## Uncommitted work (slices 2–3), all tests passing

- **Rust:**
  - `src-tauri/src/knotbook.rs`: strict reader (`inspect`), `import`, a per-notebook `attachments` field in the manifest, and tests;
  - `src-tauri/src/lib.rs`: `choose_knotbook`, `pending_knotbook`, `inspect_knotbook`, `import_knotbook`, the single-instance plugin first, and launch-argument handling;
  - `migrations/011_sharing.sql` with `CURRENT_SCHEMA = 11`, plus updated old-schema fixtures in `mcq.rs`, `getting_started.rs` and `tests.rs`;
  - `Cargo.toml` adds `tauri-plugin-single-instance`.
- **Frontend:**
  - `src/services/knotbook-import.ts` (Keep both re-IDs, reference and card remapping) with `tests/knotbook-import.test.ts`;
  - `src/app/ImportNotebookDialog.tsx`;
  - App wiring for the `knotbook-open` event and the pending file;
  - Library **Import…** button;
  - `import` ShellIcon and styles.
- **Installer and config:** `fileAssociations` and `resources` in `tauri.conf.json`; the `knot.nsi` association icon (`$INSTDIR\\{{ext}}.ico`) and `UPDATEFILEASSOC`.
- **Version:** 0.3.0-rc.1 (`pnpm version:set`), so 0.3.0 packages pass the version check.
- **Assets:** `src-tauri/icons/knotbook/` (the user's icon set) is still untracked.
- **Data:** the installed Knot migrated the user's workspace to schema 11. The pre-migration archive is `%LOCALAPPDATA%\com.knot.desktop\Workspace\backups\pre-migration-schema-10-*.knot`.

Checks at handoff: `pnpm check`, `pnpm lint`, 129 frontend tests, 107 Rust tests, and Clippy (no new warnings) all pass.

## Separate bug found during this session

A **minimized** Knot ignores close requests (`WM_CLOSE` via `CloseMainWindow`, likely also the taskbar's Close window). After restoring the window, the same request closes it normally. This probably comes from WebView2 pausing the page's scripts while minimized, so `onCloseRequested` in `App.tsx` doesn't run. It matters for updates and for the installer's wait-for-close: `KnotWaitForClose` would wait and then give up. It's unrelated to the association problem.

## Resolution, 12 November 2026

The actual desktop user's registry did **not** contain `.knotbook`,
`Knot.Notebook`, or the hand-added application/capability entries. Both a direct
probe and a limited, interactive-user scheduled task confirmed this. The desktop
uninstall registration still said **0.1.0**, although the executable had been
updated to **0.3.0-rc.1**. Explorer therefore had no usable association. The earlier
registry observations above were not evidence of registration in Explorer's
desktop context. Codex has a private MSIX registry hive, so packaged-process
registry probes should not be used as the acceptance test; the precise origin of
the earlier differing registry view was not established.

Running the rebuilt NSIS installer under the normal desktop user registered the
type and fixed both the icon and direct opening. There was no need to change the
installation directory, executable case, shortcut AppUserModelID, or import code.

Installer changes (all marked `KNOT:`):

- Retain the extension default, `Knot.Notebook` ProgID, quoted open command, and
  shipped `knotbook.ico` resource. Use an explicit `,0` icon index and notify the
  shell after install/uninstall.
- Add `.knotbook\OpenWithProgids\Knot.Notebook` for Open With discovery. An empty
  `REG_SZ` is supported; `REG_NONE` is not necessary. See Microsoft's
  [Open With registration instructions](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-include-an-application-on-the-open-with-dialog-box).
- Remove the redundant hand-added `Applications\knot.exe`, ProgID
  `AppUserModelID`, `Software\Knot\Capabilities`, `RegisteredApplications\Knot`,
  and `App Paths\knot.exe` registrations during install and uninstall, with
  ownership checks. Leave Windows-managed `Explorer\FileExts` history and
  `UserChoice` alone.
- Preserve the original association backup across reinstall (Tauri's stock
  macro otherwise backs up `Knot.Notebook` over itself). Uninstall removes our
  Open With registration and restores the predecessor only if our ProgID is
  still the extension default. It leaves another installation's command alone.

The close fix is a native `CloseRequested` handler for the main window. If it is
minimized, restore it so the existing frontend save/cleanup handler can run. It
does not destroy the window, bypass the pending-operation guard, or force-kill
anything. The old installed build reproduced the failure: `CloseMainWindow()`
returned true but the process remained alive after ten seconds.

Installer acceptance must run the built
`src-tauri/target/release/bundle/nsis/Knot_0.3.0-rc.1_x64-setup.exe` as the desktop
user, with Knot closed normally first. An executable-only update cannot test
this. When verifying payload hashes, account for Tauri replacing the executable's
`__TAURI_BUNDLE_TYPE_VAR_UNK__` marker with `__TAURI_BUNDLE_TYPE_VAR_NSS__` inside
the NSIS payload, then restoring the build output. These three bytes are expected
to differ; the icon must match its source byte for byte.
