# Verification

Current scope update — 30 October 2026: Jot capture has been removed at the user’s request, including its UI, adapter API, validation, styles and dedicated tests. Existing captured notes remain ordinary editable document blocks. References to Jot below are historical implementation/verification records, not current functionality.

Removal checks: TypeScript, ESLint and all 28 remaining frontend tests passed. Native shell acceptance (including save-failure navigation), accessibility and notebook navigation passed against the updated debug build. Evidence: `test-results/shell-1793346737497/`, `test-results/accessibility-1793346751064/` and `test-results/bundles-1793346754843/`. No storage migration or content deletion was required.

## Milestone 5 final consistency and native scaling — 29 October 2026

Milestone 5 is complete under its documented acceptance scope on 29 October 2026. All four slices passed, including final consistency cleanup, native Windows
scaling and release/NSIS builds. This entry supersedes the earlier in-progress
audit and scaling blocker below. All prior uncommitted work is retained.

- Removed duplicate legacy close buttons from references, exports, readers,
  organization, search/backlinks and workspace management. ToolSurface owns the
  single labeled header close and Escape/focus return. Removed repeated management
  headings. Jot keeps its independent protected draft/discard controls.
- Updated native workflow selectors to the shared header controls. The panel
  suite now asserts exactly one close action per open tool surface.
- TypeScript, ESLint, all 29 frontend tests, production frontend and debug build
  passed: `test-results/m5-consistency-{check,lint,tests,debug}.log`.
  Final test-source lint passed in `m5-final-lint.log`. Rust/Clippy and the full
  regression evidence from the preceding audit remain applicable; no Rust or
  persistence implementation changed in this cleanup.
- All 15 affected native suites passed against the rebuilt debug executable:
  accessibility, panels, organization, search, backups, Office preview, PDF
  highlights, Trash, quarantine, reference recovery, workspaces, external
  workspaces, integrity, shell and Jot. See `m5-consistency-native-summary.log`
  and `m5-consistency-<suite>.log` for evidence locations.
- Windows Settings initially repeated its targetable-window failure. The user
  opened Display Settings manually; Computer Use then changed the actual scale
  from the original 125% to 100% and 150% on the 1920×1080 display. The original
  125% was restored and visually confirmed after testing.
- `node tests/native/scaling.mjs 1` and `node tests/native/scaling.mjs 1.5`
  passed without viewport/device-metrics emulation. Tauri monitor scale and
  WebView devicePixelRatio agreed at 1 and 1.5. At 100%, the native client was
  1280×850 physical/CSS pixels; at 150%, 1920×1050 physical / 1280×700 CSS pixels.
  Evidence: `scaling-1793274024096/` and `scaling-1793274100616/`, including
  `metrics.json`; logs: `m5-scaling-100.log` and `m5-scaling-150.log`.
- Inspected native Page, Canvas, inspector, library, Jot, empty Trash and empty
  reader screenshots. A first inspector screenshot caught toolbar resize in
  flight; waiting for the native transition showed the correct Previous/Next
  paging controls, with no clipping. The diagnostic now waits before capture.
  Populated PDF and Office screenshots were inspected in
  `pdf-highlights-1793273995419/selected.png` and
  `office-preview-1793273971822/preview.png`; startup error in
  `workspaces-1793274050006/startup-recovery.png`.
- Narrower-window fallback remains covered at 850×640 and 760×540 CSS pixels by
  the accessibility suite. These are separate from the actual OS scaling checks.
  Bounds are the tested desktop layouts, not universal responsive or upstream
  screen-reader certification. Clean-machine installation and physical-failure
  tests remain outside this milestone's scope.

Release evidence:

- `pnpm tauri build` passed, including production frontend, optimized Windows
  executable and x64 NSIS installer (`test-results/m5-release.log`). The existing
  frontend large-chunk warning remains non-fatal.
- The accessibility diagnostic passed against the final release executable,
  including keyboard disclosure, topmost Escape, Jot focus/draft protection and
  narrow non-overlapping tools. Log: `m5-release-smoke.log`; screenshots:
  `accessibility-1793287034105/`. It used an isolated workspace, no dev server.
- SHA-256 for `src-tauri/target/release/knot.exe`:
  `18A1347E4EF39610745309A55A37FD425AEECF5847118C1FF02EE8A00362818F`.
- SHA-256 for `src-tauri/target/release/notebook/nsis/Knot_0.1.0_x64-setup.exe`:
  `201526BD8DF469529D0A5DB9D718977CD7065DE93572D584CA41E56964289AC9`.
  Hash log: `test-results/m5-release-hashes.log`. Installer build is verified;
  installation/uninstallation on a clean Windows machine is not claimed.

## Milestone 5 fourth slice: accessibility and consistency audit — 29 October 2026

In progress; this is not a Milestone 5 closure declaration. Existing uncommitted
slices one through three are preserved. No Rust application, schema, workspace
format, attachment identity or Yjs-body changes were made.

Implemented:

- Shell disclosures are mutually exclusive. Escape respects already-handled
  events and open dialogs; dismissing a shell menu leaves an underlying panel open.
- Jot retains its actual opening button across asynchronous loading, closes its
  native dialog before restoring focus, and wraps Tab/Shift+Tab within enabled
  controls. Escape dismisses an empty draft only; nonempty and submitted drafts
  retain their explicit discard/retry semantics. The real failed-save regression
  now checks Escape cannot dismiss or duplicate a submitted capture.
- Shared secondary text and control boundaries have stronger contrast; focus
  rings also cover textareas and disclosures. Current document/view selection
  has a non-color marker. Save feedback is announced politely and the notification
  dismissal has a descriptive accessible name.
- At window widths of 850 CSS pixels and below, contextual tools occupy the
  content area. The editor stays mounted with its geometry retained but is hidden
  and excluded from keyboard navigation while the tool is open. Management views
  also hide the editor. Desktop side-by-side layout remains above this threshold.

`tests/native/accessibility.mjs` checks keyboard menu activation and dismissal,
topmost shell Escape, Jot focus return and draft protection, both Tab directions,
shared palette contrast (4.5:1 text, 3:1 control borders), and panel bounds at
1920×1080, 1280×720, 850×640 and 760×540 CSS viewports. Palette checks are bounded
to the shell tokens; they do not certify arbitrary user-authored canvas colors or
every upstream BlockSuite popover. Native OS confirmation/file dialogs retain
their existing behavior.

The audit caught Jot focus loss after asynchronous loading and WebView Tab escape;
both were fixed and rerun. A strict panel-edge comparison also encountered subpixel
rounding; geometry assertions allow one CSS pixel. Shared action-button styling
was corrected after screenshot review found the older pale action color.

Verification for this audit:

- TypeScript, ESLint, 29 frontend tests, 41 Rust tests (two opt-in tests ignored)
  and all-target Clippy with warnings denied passed. Logs are
  `test-results/m5-audit-{check,lint,tests,rust,clippy}.log`.
- Production frontend and standalone debug desktop builds passed; logs are
  `m5-audit-build.log` and `m5-audit-debug.log`. The existing large-chunk warning
  remains. Release/NSIS rebuilding is deferred until the remaining acceptance
  audit is complete; those artifacts still represent Milestone 4.
- The full existing workflow regression set, legacy-reference preservation,
  shell and panels passed (`m5-audit-native-summary.log`, per-suite
  `m5-audit-<suite>.log`). Tests use disposable native workspaces. The initial
  editor run passed its UI interactions but could not reconnect after restart;
  `m5-audit-editor.log` retains that failure. A fresh complete final editor run
  passed, including restart, in `editor-1793272340183/`.
- The final build includes two last presentation corrections: action-button
  text color and an accessible notification dismissal name. Accessibility,
  editor, panel, reader, Jot and shell suites are rerun against that build in
  `m5-audit-final-<suite>.log`; the summary is `m5-audit-final-summary.log`.
- Before images were inspected from `panels-1793268638127/`,
  `editor-1793268277360/`, `pdf-highlights-1793250103716/`,
  `office-preview-1793249849778/` and `workspaces-1793249938960/`.
  After images include Page/Canvas/inspector in `editor-1793272340183/`,
  narrow Page/inspector and protected Jot in `accessibility-1793272334886/`,
  library/search and empty/restored Trash in `panels-1793272052267/`, and
  startup error recovery in `workspaces-1793272135791/`. Populated reader
  screenshots are retained with the final PDF/Office suites.
- The native exports suite retains the known non-fatal Yjs event-handler warning.
  Native file dialogs were not manually repeated, and no clean-machine install,
  physical-failure test or arbitrary content-color accessibility claim is made.
  Remaining closure gate: actual Windows display scaling at 100% and 150%.
  Computer Use could not obtain a targetable Windows Settings window: launching
  `SystemSettings.exe` returned “launched app did not expose a targetable window”,
  and refreshing the window inventory still found no Settings window. No display
  setting was changed. CSS viewport tests must not be described as native scaling
  verification. Full upstream menu/screen-reader certification and clean-machine
  installation are not claimed. Further consistency review of retained duplicate
  legacy close actions remains before declaring this slice complete.

## Milestone 5 third slice: Page and Canvas refinement — 29 October 2026

Implemented and verified under the slice-three acceptance scope. Page uses an
800-pixel outer reading column, 16-pixel body type and a 32-pixel title. Canvas
uses a neutral background and a 44-pixel native toolbar with compact labels in
place of decorative illustrations. Native menus, responsive tool paging,
selection actions and user content styling remain. The existing uncommitted
shell/panel work was preserved. No Rust, schema, workspace-format or Yjs body
conversion was introduced.

The installed BlockSuite 0.19.5 extension-point inspection, chosen integration,
selectors and upgrade contract are in [EDITOR-PRESENTATION.md](EDITOR-PRESENTATION.md).
Page uses theme variables; version-specific shadow presentation and keyboard
handling are isolated in `presentation.ts`. Native handlers remain authoritative.

- TypeScript, ESLint and all 29 frontend tests passed. Logs:
  `test-results/m5-editor-{typescript,lint,tests}.log`.
- Production frontend and standalone debug desktop builds passed. Logs:
  `m5-editor-build.log` and `m5-editor-native-build.log`. Native build used
  `cargo build --manifest-path src-tauri/Cargo.toml --bins --features tauri/custom-protocol --offline`.
  The existing Vite chunk-size warning remains. Release/NSIS builds remain at
  Milestone 4 until slice-four closure. Rust application code is unchanged;
  the prior 41-test/Clippy results remain the latest backend checks.
- `tests/native/editor.mjs` passed on the final build. It uses actual pointer
  and keyboard input for Page typing/bold, slash Heading 2 insertion, the Attach
  entry point (supplying the chooser result), shapes, freehand, note cards,
  canvas text, connectors, selection/movement, Undo/Redo, zoom/fit and hand pan.
  It checks Tab traversal, Enter/Space activation, keyboard tool paging with a
  narrow right panel, shared-card Open → Open this doc and Back navigation.
  Model access is read-only assertion instrumentation, not creation/navigation.
- Opening/closing Properties and collapsing/expanding navigation preserve the
  canvas center, zoom, document identity and block JSON exactly. Page/Canvas
  identity and native restart persistence pass. Restart compares all fields
  exactly except native edgeless-text bounds, where subpixel measurement may
  vary by less than 0.001 model pixels; IDs, content and references stay exact.
- Empty/populated Page and Canvas, selected shapes, and Canvas with Properties
  were captured and inspected. Final editor evidence uses 1440×900, 1280×720
  (panel/paged tools), and 1920×1080 CSS viewports. Final panel/shell regressions
  also cover 1280×720 and 1920×1080. These are viewport checks, not Windows
  display-scaling certification.
- All six focused native suites below passed on the final debug build. Existing
  acceptance includes real SQLite save rejection, navigation gating/retry,
  image/PDF imports, offline saves and forced-termination recovery. Shared-note
  and export suites retain their stable-ID/content/attachment checks.

| Native suite | Evidence under `test-results/` | Passing log                        |
| ------------ | ------------------------------ | ---------------------------------- |
| editor       | `editor-1793268277360/`        | `m5-editor-final-editor.log`       |
| panels       | `panels-1793268298846/`        | `m5-editor-final-panels.log`       |
| acceptance   | `acceptance-1793268349536/`    | `m5-editor-final-acceptance.log`   |
| shared-notes | `shared-notes-1793268363905/`  | `m5-editor-final-shared-notes.log` |
| exports      | `exports-1793268377032/`       | `m5-editor-final-exports.log`      |
| shell        | `shell-1793268392303/`         | `m5-editor-final-shell.log`        |

Verification found and corrected Page line-height leaking into Canvas card
measurement; typography is now scoped to Page and the unchanged panel
preservation test passes. Native canvas Tab handling initially trapped toolbar
focus; the bridge now allows normal browser Tab traversal. Zoom popup wrappers
are included in the scoped observer. Test development corrected ambiguous slash
and Open selectors, waited for the native text-menu entrance animation, used the
card's visible Open action, and reopened the narrow zoom popup after activation.
The first final-build acceptance attempt stopped during Windows `taskkill`
because child processes had already exited; a fresh complete run passed. Its
unsuccessful log is retained as `m5-editor-final-acceptance-first.log`. Exports
still emit the previously recorded non-fatal Yjs event-handler warning.

Limits: the full 19-suite regression set, backend checks, release/installer
rebuild, 100%/150% Windows display scaling, and exhaustive menu/dialog
accessibility/contrast audit remain slice-four closure work. Native File Open
and Save As dialogs were not manually exercised here; attachment selection and
export handoffs are automated. Native advanced menus and user-selected card
styles remain upstream behavior, not a new exhaustive fidelity guarantee.
This closes slice three only; Milestone 5 remains in progress.

## Milestone 5 second slice: contextual panels and management surfaces — 29 October 2026

Implemented and verified under the slice-two acceptance scope. A single surface now owns document tools, library search/filters/organization, or workspace maintenance. Contextual panels resize by pointer or keyboard, Close/Escape restores focus, and the editor remains mounted. Document/workspace transitions clear context; closed reports cannot trigger later recovery scans. PDF pages fit panel width, with the same normalized source locations and failed-save highlight identity retained through resizing. Jot's protected submitted draft remains in its existing modal. Existing uncommitted shell work and prior functionality were preserved. No Rust application, schema, workspace format, stored Yjs format or attachment identity changes.

- Passed TypeScript (`m5-panels-typescript.log`), ESLint (`m5-panels-lint.log`), all 29 frontend tests (`m5-panels-frontend-tests.log`), 41 Rust tests with two opt-in tests ignored (`m5-panels-rust-tests.log`), and all-target Clippy with warnings denied (`m5-panels-clippy.log`). Logs are under `test-results/`.
- Production frontend and standalone debug desktop builds passed: `m5-panels-build.log` and `m5-panels-native-build.log`. Desktop build used `cargo build --manifest-path src-tauri/Cargo.toml --bins --features tauri/custom-protocol --offline` with the freshly built frontend. The existing Vite large-chunk warning remains. Release/NSIS artifacts remain at Milestone 4, pending milestone closure.
- All 19 automated native suites below have passing runs on the final debug build: the 17 existing workflow regressions, shell acceptance, and the new panel suite. Coverage includes save-failure navigation/retry, title/body search freshness and combined filters, folder/tag assignments and management, reference insertion, PDF selection/source reopening/undo/retry, supported and unsupported Office input, exports, Trash and backup recovery, workspace switching, integrity/quarantine recovery, offline use, restart and data preservation. PDF acceptance now resizes a failed-save highlight draft before retrying, then verifies no duplicate card.
- `panels.mjs` checks one active surface, pointer and keyboard resize, Close/Escape focus return, header/editor adjacency, unchanged document identity and block JSON, empty readers/search/Trash, document-transition clearing, and Trash restoration after a closed integrity report. Page and Canvas with Properties open were captured at 1280×720 and 1920×1080 CSS viewport sizes. The final shell suite also covers long/empty libraries and real SQLite save rejection.
- Native `external-workspaces.mjs --dialogs` also passed in `external-workspaces-1793250140118/` (`m5-panels-dialogs.log`). Computer Use operated the actual Open workspace folder and relocation destination pickers. The suite verified save-before-relocation, matching source/destination document rows, retention of the source copy, persisted selection after restart, and unavailable-location recovery. Initial 14-pixel parent-window captures/input-geometry errors were resolved by raising the dialog and using its actual captured surface; no fallback system automation was used.
- Native screenshots were visually inspected for Page/Canvas with Properties, library/search, PDF selection, Office text preview, maintenance/Trash and startup recovery. Final panel screenshots are under `panels-1793249823925/`; startup recovery is `workspaces-1793249938960/startup-recovery.png`. The reader screenshots from the immediately preceding build were also reviewed; final passing reader suites retain fresh captures.
- Verification found and fixed PDF clipping at the old fixed render width and retained inactive integrity state. Native tests were updated to explicitly close/reopen tools that previously remained stacked above the editor, including backup editing, export after document navigation, and reader-to-backup transitions. An initial resize test incorrectly assumed the session width reset between viewports; it now checks the actual prior width. Exports retain the previously observed non-fatal Yjs warning.
- Initial final-build PDF attempts ended in Windows `taskkill` status 128, masking the earlier outcome; the PDF test now reports the original error separately from final cleanup. One concurrent backlinks/Jot run failed during native restart. Fresh serial backlinks/Jot runs and a complete PDF diagnostic run passed without application changes. Those unsuccessful logs remain available (`m5-panels-final-{pdf-highlights,backlinks,jot}.log` and `m5-panels-serial-pdf-highlights.log`); they are not counted as passing runs.

| Native suite        | Evidence under `test-results/`       | Passing log under `test-results/`         |
| ------------------- | ------------------------------------ | ----------------------------------------- |
| panels              | `panels-1793249823925/`              | `m5-panels-final-panels.log`              |
| shell               | `shell-1793250029713/`               | `m5-panels-final-shell.log`               |
| acceptance          | `acceptance-1793249998491/`          | `m5-panels-final-acceptance.log`          |
| organization        | `organization-1793249990859/`        | `m5-panels-final-organization.log`        |
| shared-notes        | `shared-notes-1793249978321/`        | `m5-panels-final-shared-notes.log`        |
| trash               | `trash-1793249930070/`               | `m5-panels-final-trash.log`               |
| workspaces          | `workspaces-1793249938960/`          | `m5-panels-final-workspaces.log`          |
| backups             | `backups-1793249865166/`             | `m5-panels-final-backups.log`             |
| external-workspaces | `external-workspaces-1793249959174/` | `m5-panels-final-external-workspaces.log` |
| exports             | `exports-1793249872634/`             | `m5-panels-final-exports.log`             |
| integrity           | `integrity-1793249907313/`           | `m5-panels-final-integrity.log`           |
| quarantine          | `quarantine-1793249911382/`          | `m5-panels-final-quarantine.log`          |
| reference-recovery  | `reference-recovery-1793249921497/`  | `m5-panels-final-reference-recovery.log`  |
| migrations          | `migrations-1793250010968/`          | `m5-panels-final-migrations.log`          |
| backlinks           | `backlinks-1793250062216/`           | `m5-panels-serial-backlinks.log`          |
| pdf-highlights      | `pdf-highlights-1793250103716/`      | `m5-panels-pdf-diagnostic.log`            |
| office-preview      | `office-preview-1793249849778/`      | `m5-panels-final-office-preview.log`      |
| search              | `search-1793249823924/`              | `m5-panels-final-search.log`              |
| jot                 | `jot-1793250076742/`                 | `m5-panels-serial-jot.log`                |

Limits: native viewport checks do not certify Windows display scaling at 150% or universal narrow-window behavior. The CSS fallback exists but the full keyboard/dialog/contrast and display-scaling audit remains slice four. The illustrated Canvas toolbar and editor styling remain slice three. External archive Save/Open dialogs, clean-machine installation, opt-in benchmarks, physical failures and exhaustive content fidelity were not rerun; prior evidence and bounded-format limits remain applicable. Export native save handoffs are captured by the regression, not interactive Save As completion. This closes only slice two, not Milestone 5.

## Milestone 5 first slice: workspace shell and navigation — 29 October 2026

The first bounded slice is implemented; Milestone 5 remains in progress. The sidebar is compact and collapsible, its library scrolls independently, workspace actions remain pinned, and the default editor begins immediately below one 56-pixel header. Document actions and Library options are labeled disclosures; Properties is opt-in. Shared shell tokens and line icons establish the visual foundation. See [ACTION-INVENTORY.md](ACTION-INVENTORY.md) and the updated README for action locations. Existing reader/management surfaces and the native illustrated canvas toolbar remain for later slices. No Rust application, schema, workspace format, Yjs body or attachment identity changes.

- Passed TypeScript, ESLint, all 29 frontend tests, 41 Rust tests (two opt-in tests ignored), and all-target Clippy with warnings denied. Logs: `test-results/m5-{typescript,lint,frontend-tests,rust-tests,clippy}.log`.
- Production frontend and standalone debug desktop builds passed. Final logs: `test-results/m5-shell-frontend-build.log` and `test-results/m5-shell-final-native-build.log`. After an interrupted packaging attempt, the final desktop build used `cargo build --manifest-path src-tauri/Cargo.toml --bins --features tauri/custom-protocol --offline` with the freshly built frontend, matching Tauri's native build flags. The existing Vite large-chunk warning remains. Release/NSIS artifacts remain at Milestone 4, as planned until milestone closure.
- `node tests/native/shell.mjs` passed against the final debug executable. Real WebView2 checks cover Page/Canvas at 1280×720 and 1920×1080 CSS viewport sizes, no horizontal shell overflow, editor/header adjacency, long titles, a 24-document scrolling library with pinned workspace actions, an empty filtered library and a truly empty workspace, create/open/rename/soft-delete, Back/Forward, sidebar collapse without document replacement, keyboard disclosure opening and Escape/focus restoration, Jot submission failure/retry, and a real SQLite rejection blocking document navigation followed by successful retry. Evidence: `test-results/shell-1793231990121/`; log `test-results/m5-shell-final-native.log`.
- Before screenshots: `test-results/shell-1793190310094/before-{1280,1920}.png`. After Page/Canvas, empty/long library and error captures are in the final shell directory. Before/after native screenshots were visually inspected, including the final document/workspace menus and long-library hover state. At 1280×720 the default editor's top moved from about 162 pixels to 56 pixels, and the sidebar no longer scrolls as a whole. Visual review caught and corrected a primary-button hover contrast conflict.
- All 17 existing native regression suites passed through the new entry points: acceptance, organization, shared-notes, trash, workspaces, backups, external-workspaces, exports, integrity, quarantine, reference-recovery, migrations, backlinks, pdf-highlights, office-preview, search and jot. Logs are `test-results/m5-<suite>-native.log`, each recording its isolated evidence directory. These cover editing/attachments, stable references, save-before-navigation, recovery, undo/redo, offline use, restart and backup preservation. Tests now share `shell-navigation.mjs` to open visible disclosures; the editing acceptance test also waits for the target document ID rather than an already-existing paragraph. Exports retain the previously observed non-fatal Yjs warning. The final CSS-only hover correction was followed by rebuild and a fresh shell run; the workflow regressions passed on the immediately preceding build.

Limits: viewport checks use CDP-configured CSS sizes in native WebView2; they do not certify Windows display scaling at 150%, narrower-window behavior or universal responsiveness. Full focus/dialog/contrast auditing, mutually exclusive/resizable contextual panels and canvas tool refinement remain later slices. Native file/folder dialogs, the legacy-fixture diagnostic, opt-in benchmarks, physical failure scenarios and clean-machine installation were not rerun. An initial shell assertion incorrectly expected an already-cleared error banner; it was corrected before passing. Existing README/roadmap planning edits were preserved. This evidence closes only the shell slice.

## Milestone 4 closure and release — 28 October 2026

Milestone 4 is complete under ROADMAP.md's bounded acceptance criteria: PDF text highlight cards, read-only DOCX body previews, on-demand backlinks, explicit title/body search and user-confirmed in-app Jot capture. This record supersedes historical slice statements that closure was pending or release artifacts were still at Milestone 3. Workspace format remains 1 and database schema remains 2; Rust application code and stored Yjs formats are unchanged. Milestone 3's explicit recovery deferrals remain deferred.

- Passed TypeScript, ESLint, all 29 frontend tests, all 41 default Rust tests (two opt-in tests ignored), and all-target Clippy with warnings denied. Logs: `test-results/milestone-4-closure-{typescript,lint,frontend,rust,clippy}.log`.
- Passed production frontend, standalone debug desktop, optimized release desktop and x64 NSIS installer builds. Logs: `test-results/milestone-4-closure-debug-build.log` and `test-results/milestone-4-closure-release-build.log`. The existing Vite chunk-size warning remains non-fatal.
- All 17 native suites passed against the rebuilt debug executable using isolated workspaces and real WebView2/Rust/SQLite. Per-suite logs use `test-results/milestone-4-closure-<suite>.log`; evidence is listed below. Exports emitted the previously observed non-fatal Yjs event-handler warning. The first reference-recovery attempt ended with a Windows taskkill cleanup error (status 128), which can mask an earlier failure; its log is retained as `milestone-4-closure-reference-recovery-first.log`. A fresh complete run passed without code changes.

| Native suite                                     | Evidence under `test-results/`       |
| ------------------------------------------------ | ------------------------------------ |
| Editing, attachments, retry, offline and restart | `acceptance-1793188492421/`          |
| Organization                                     | `organization-1793188506859/`        |
| Shared notes and references                      | `shared-notes-1793188515681/`        |
| Trash                                            | `trash-1793188529383/`               |
| Managed workspaces                               | `workspaces-1793188540134/`          |
| Managed backups                                  | `backups-1793188558194/`             |
| External workspaces (seeded catalog)             | `external-workspaces-1793188567862/` |
| Exports (captured Save As handoff)               | `exports-1793188586371/`             |
| Integrity                                        | `integrity-1793188603746/`           |
| Quarantine, disposal and attachment recovery     | `quarantine-1793188609064/`          |
| Guided reference recovery                        | `reference-recovery-1793188674953/`  |
| Migration safeguards                             | `migrations-1793188685936/`          |
| Backlinks                                        | `backlinks-1793188701858/`           |
| PDF highlight cards                              | `pdf-highlights-1793188714345/`      |
| Office preview                                   | `office-preview-1793188738388/`      |
| Advanced search                                  | `search-1793188752530/`              |
| Jot capture                                      | `jot-1793188763047/`                 |

Release artifacts (version 0.1.0):

- `src-tauri/target/release/knot.exe` — 19,444,736 bytes; SHA-256 `8ada98786878e063f2fabe672abe673ee3823a15eeaf286062342840fcd1f576`.
- `src-tauri/target/release/notebook/nsis/Knot_0.1.0_x64-setup.exe` — 9,842,129 bytes; SHA-256 `643d2889e51321fd6faed5bf1a9f28b4b1f9f526082ce49079dc02c6629047ce`.
- `src-tauri/target/debug/knot.exe` is current. Native automation exercised the debug executable, not an installed release instance; release builds omit the test-workspace override.

No installer execution or clean-machine installation/uninstallation is claimed. Native file/folder dialogs, benchmarks, legacy-fixture diagnostics and opt-in Rust tests were not rerun; earlier evidence and limitations remain applicable. Physical disk-full/power-loss, very large libraries, external-writer races, complex Office/PDF fidelity and worker-timeout injection remain untested. Office stays DOCX main-body text only; search uses an explicitly refreshed bounded scan; Jot drafts remain memory-only until submitted. No scope expansion, custom Office editor, second canvas engine or Yjs conversion was introduced during closure.

## Milestone 4 in-app Jot capture — 28 October 2026

- Implemented the user-confirmed workflow: choose an existing destination, append plain text using native blocks, and retry failed saves. Passed TypeScript, ESLint, the existing 28 frontend tests and the new Jot boundary/preservation test (29 total). Production frontend and standalone debug desktop builds passed. Build log: `test-results/milestone-4-jot-build.log`; existing Vite chunk warning remains. Rust remains unchanged; 41 Rust tests and Clippy from Milestone 3 remain the latest backend checks.
- `node tests/native/jot.mjs` passed against the final debug build. It checks explicit capture into a different stable-ID destination, default destination, empty-input gating and the input cap, Unicode/newline/HTML-like plain text, offline capture, native Page/Canvas content, single undo/redo, and a real SQLite rejection after insertion. Retry retains disabled text/destination fields and the same block ID, then commits exactly one copy. Original source snapshot, destination references, attachment records/associations and asset bytes remain intact. Captures are searchable and survive restart plus verified managed-backup restore.
- Final evidence: `test-results/jot-1793185393931/`; retry dialog and the preceding passing run's Page screenshot (`test-results/jot-1793185268824/captured.png`) were visually inspected. Log: `test-results/milestone-4-jot-native.log`. Initial native run used an incorrect undecorated Page button selector; it was fixed before passing. Visual review prompted explicit modal centering/height and input borders, followed by rebuild and another passing native run.
- Focused search regression passed after Jot integration: `test-results/search-1793185283873/`; log `test-results/milestone-4-jot-search-regression.log`. Office native regression passed during the preceding search slice. Full milestone regression was not run.
- Jot is in-app plain-text capture only (10,000 characters), with no global hotkey, background service or separate inbox. Unsubmitted drafts are memory-only; failed inserted captures retain normal unsaved-editor durability until retry succeeds. Large destination catalogs, abrupt termination during submission and physical disk failure were not separately tested. Workspace format 1/schema 2 remain unchanged; no Yjs conversion or second canvas engine. All five bounded slices now have focused evidence, but Milestone 4 remains open for closure checks. Release executable/NSIS installer remain at Milestone 3 and clean-machine installation is untested.

## Milestone 4 bounded advanced search — 28 October 2026

- Passed TypeScript, ESLint, all 28 frontend tests, production frontend and standalone debug desktop builds. Five new frontend tests cover supported/excluded text, Unicode/literal matching, deterministic deduplication, immutable input, corrupt/incomplete/mismatched snapshots, per-body and aggregate limits, 200-document pagination bounds, freshness and storage-error propagation. Rust is unchanged; the previous 41 Rust tests and Clippy remain the latest backend checks. Build log: `test-results/milestone-4-search-build.log`; existing Vite chunk warning remains.
- `node tests/native/search.mjs` passed in real WebView2/Rust/SQLite: body/title search, combined folder/tag filtering, shared-body non-duplication, source-ID navigation/Back, offline operation, exact database/asset preservation, real save rejection/retry, refresh after insertion/removal, corrupt-body partial warnings without rewriting bytes, Trash exclusion, restart and backup/workspace reset. Evidence: `test-results/search-1793184807388/`; `search.png` visually inspected. Log: `test-results/milestone-4-search-native.log`.
- Office preview native regression passed against the same build: `test-results/office-preview-1793184844235/`; log `test-results/milestone-4-search-office-regression.log`. Existing uncommitted Office changes remain intact. Native test helper lint was corrected by removing an unused copied helper; the final lint passed.
- Search is explicitly refreshed, not a persistent index. Decoding bounds are 200 filtered documents, 1 MiB per snapshot pair, 16 MiB aggregate and 100,000 characters; whole snapshot IPC precedes byte checks. No attachment extraction, canvas-only text, tables, stemming, regex or transcluded-text indexing. Large-library timing, worker-timeout injection and external-writer races remain untested. Workspace format 1/schema 2 and stored bodies are unchanged. Full regression/release/NSIS rebuilds remain reserved for closure; release artifacts remain at Milestone 3 and clean-machine installation is untested.

## Milestone 4 read-only Office preview — 28 October 2026

- Passed TypeScript, ESLint, all 23 frontend tests, production frontend and standalone debug desktop builds. Three new frontend tests cover selected XML extraction with unchanged input bytes, skipped media, format/corrupt/missing-part rejection and compressed/expanded size bounds. Rust code, workspace format 1 and database schema 2 are unchanged; the previous 41 Rust tests and Clippy remain the latest backend checks. Build log: `test-results/milestone-4-office-build.log`; the existing Vite chunk-size warning remains.
- `node tests/native/office-preview.mjs` passed against the final compiled Windows app with real Rust/SQLite storage. A generated transitional OOXML DOCX fixture verifies Unicode, tabs/breaks, table text, escaped HTML-like text and offline loading. Opening/closing preserves exact document/catalog rows, attachment rows/associations and bytes. A real rejected SQLite save blocks opening until retry; document navigation clears the panel. The source ID/body and attachment bytes survive restart and managed backup verification/restore; restore clears the old preview. A missing asset produces an error and loads successfully after the file returns and Retry is clicked.
- Native error coverage includes unsupported legacy Word, invalid ZIP, malformed XML, DTD/entity rejection, 5 MiB file/1 MiB XML limits, 100,000-character/5,000-paragraph limits and empty body text. Switching back from errors to the valid file succeeds. Evidence: `test-results/office-preview-1793184398337/`; `preview.png` was visually inspected. Log: `test-results/milestone-4-office-native.log`.
- Existing shared-note native regression passed: `test-results/shared-notes-1793184276120/`, covering authoritative bodies, restart, source navigation, cycles, placement removal, native-created linked documents and soft deletion. Log: `test-results/milestone-4-office-shared-notes.log`. The initial Office launch accidentally used the previous executable before build completion and blocked its replacement; the sequential rebuild passed. Subsequent test corrections used real keyboard editing, decorated library selectors and explicit source selection after restart/restore. Final native checks passed without further application changes.
- This is a body-text preview, not Office page rendering or editing. Only UTF-8 transitional OOXML `.docx` is supported; other Office formats, encrypted files and strict OOXML are unsupported. Layout, formatting, images, headers/footers, comments and embedded objects are omitted, and tracked changes are not interpreted. Real Microsoft Office/LibreOffice-produced complex-document fidelity, encrypted fixtures, worker-timeout injection and large-library performance were not tested. No remote Office service, custom editor, second canvas engine or Yjs conversion is introduced.
- Focused slice verification only: full milestone regression and release/NSIS rebuilding remain reserved for closure. Release executable/installer remain at Milestone 3, and clean-machine installation remains untested. Milestone 4 remains open for advanced search and Jot integration; the Jot workflow must be confirmed before implementation.

## Milestone 4 PDF text highlight cards — 28 October 2026

- Passed TypeScript, ESLint, all 20 frontend tests, production frontend and standalone debug desktop builds. Three new frontend tests cover source-key/document-ID/page/rectangle round trips, Unicode filenames, source URL recognition, invalid coordinates/pages/identities, quote bounds and stable retry IDs. Rust application code and schema are unchanged; the Milestone 3 Rust/Clippy checks remain the latest backend results. Build log: `test-results/milestone-4-pdf-build.log`; the existing Vite chunk-size warning remains.
- `node tests/native/pdf-highlights.mjs` passed against the final debug build with actual mouse-drag selection in WebView2 and real Rust/SQLite storage. It selects text on page two, retains one card through a real rejected SQLite save and retry, verifies single-step undo/redo, opens the source page with marked rectangles, handles a blank page without selectable text, and runs the reader while WebView networking is offline. Card content/source locations survive restart and managed archive verification/restore. Restore while the reader is open clears the old reader. Missing/corrupt assets, a valid imported oversized attachment and an indexed malformed PDF produce explicit reader errors without removing the card.
- Original attachment blocks and preexisting content were preserved on insertion, apart from adding the new note to the page's children. Native Page/Canvas rendering subsequently adjusts note layout normally; the test waits for its saved layout before restart comparisons. Original/restored attachment rows, associations and exact PDF bytes match. No duplicate PDF is imported for a card. Evidence: `test-results/pdf-highlights-1793183232429/`; final selection screenshot and the preceding passing run's source-location/canvas screenshots (`pdf-highlights-1793183064381/`) were visually inspected. Log: `test-results/milestone-4-pdf-native.log`.
- Existing native editing/attachment/retry/offline/restart acceptance passed (`acceptance-1793183301431/`), shared references passed (`shared-notes-1793183232430/`), exports passed (`exports-1793183311051/`), and backlinks passed (`backlinks-1793183321708/`). Logs use the `test-results/milestone-4-pdf-` prefix. Exports emitted the previously recorded non-fatal Yjs event-handler warning. The first concurrent acceptance run stopped on a Windows `taskkill` child-process race; its independent rerun passed. Early PDF runs caught detached-text initialization and overlapping card placement; both were corrected before final verification. The oversized fixture was corrected to use a valid indexed import rather than trigger the backend hash check.
- Limits: single-page text selections, 10 MiB files, 4 megapixels/8,000-pixel page height, 4,000 characters/100 rectangles per selection. No OCR, cross-page selection or PDF-byte editing. Password rejection is implemented but was not exercised with an encrypted fixture; complex/rotated/multilingual PDF fidelity and large-document stress remain unverified. The test covers basic Latin text with standard fonts and a blank page. Source links are workspace-local and not portable annotations. Workspace format 1/schema 2 remain unchanged; no Yjs conversion. Release executable and NSIS installer remain at Milestone 3; no clean-machine installation was performed. Milestone 4 remains open.

## Milestone 4 on-demand backlinks — 28 October 2026

- Passed TypeScript, ESLint, all 17 frontend tests, production frontend and standalone debug desktop builds. Four new tests cover shared/link cards and inline attributes, source deduplication, deterministic ordering, self exclusion, null snapshots, invalid identity/root, corrupt/incomplete updates, unchanged input bytes and propagated storage failures. Rust code is unchanged; the Milestone 3 Rust/Clippy results remain the latest backend checks.
- `node tests/native/backlinks.mjs` passed against real WebView2/Rust/SQLite: duplicate shared/link placements yield one source, source navigation and Back retain identities, explicit refresh reflects rename/link removal/Trash, inline-only references are found, Trash restoration restores backlinks, and live/trashed states survive restart. A real SQLite trigger blocks save-before-scan, clears stale results and permits retry; an injected corrupt source yields an explicit partial-results warning without changing its bytes.
- Scan/refresh preserved exact document and catalog rows, attachment metadata/associations and asset bytes. The source-edit/deletion checks also retained attachment records and bytes. Evidence: `test-results/backlinks-1793181568527/`. The panel screenshot from the initial passing run (`test-results/backlinks-1793181513946/backlinks.png`) was visually inspected.
- Existing shared-note native regression passed: `test-results/shared-notes-1793181528482/`, including authoritative source content, restart, card navigation, cycles, placement removal, native-created linked notes and soft deletion. Build log: `test-results/milestone-4-backlinks-build.log`; regression log: `test-results/milestone-4-shared-notes.log`. The existing Vite chunk-size warning remains.
- Backlinks are an explicit whole-library scan, not a continuously maintained index. Large-library performance/cancellation, external-writer races and workspace transitions with this panel open were not native-tested; workspace reset clears the panel in the shell. Snapshot validation is structural, not exhaustive block/rendering validation. No Rust/schema/workspace-format change or Yjs body conversion. Release executable and NSIS installer remain at Milestone 3; only the debug executable was refreshed for this slice. No clean-machine installation was performed. Milestone 4 is not complete.

## Milestone 3 closure and release — 28 October 2026

Milestone 3 is complete under the explicit acceptance criteria in ROADMAP.md. Advanced damaged-data repair, exhaustive block-schema/rendering validation and future format conversions are deferred rather than claimed as implemented. This release record supersedes the older executable/installer status in the historical slice reports below. Application code is commit `e71645d`; closure changes only documentation. Workspace format remains 1 and database schema remains 2, with no Yjs body conversion.

- Passed: TypeScript, ESLint, all 13 frontend tests, all 41 default Rust tests (two opt-in tests excluded), and Clippy for all targets with warnings denied.
- Passed: production frontend, standalone debug desktop, optimized release desktop and x64 NSIS installer builds. Build logs: `test-results/milestone-3-debug-build.log` and `test-results/milestone-3-release-build.log`. Vite retains its existing large-chunk warning; it did not fail either build.
- All 12 automated native suites passed against the freshly rebuilt debug executable using isolated workspaces and real WebView2/Rust/SQLite. Logs are `test-results/milestone-3-<suite>.log`; evidence directories are listed below. Recovery-success screenshot inspected. The exports suite emitted the previously observed non-fatal Yjs event-handler warning; its assertions passed.

| Native suite                                                            | Evidence under `test-results/`       |
| ----------------------------------------------------------------------- | ------------------------------------ |
| Editing, attachments, failed-save retry, offline and restart acceptance | `acceptance-1793180841505/`          |
| Organization                                                            | `organization-1793180853473/`        |
| Shared notes and references                                             | `shared-notes-1793180860977/`        |
| Trash                                                                   | `trash-1793180870578/`               |
| Managed workspaces                                                      | `workspaces-1793180879724/`          |
| Backup management                                                       | `backups-1793180894438/`             |
| External workspaces (seeded catalog, non-interactive)                   | `external-workspaces-1793180902774/` |
| Exports (captured Save As handoff)                                      | `exports-1793180919169/`             |
| Integrity                                                               | `integrity-1793180940737/`           |
| Quarantine, disposal and missing-attachment recovery                    | `quarantine-1793180946535/`          |
| Guided reference recovery                                               | `reference-recovery-1793180960536/`  |
| Migration rollback/retry and recovery archives                          | `migrations-1793180979272/`          |

Release artifacts (version 0.1.0):

- `src-tauri/target/release/knot.exe` — 16,970,752 bytes; SHA-256 `17dea48e778fd36678a13f46268d862ce65403109c769535bdb324cbd83873bb`.
- `src-tauri/target/release/notebook/nsis/Knot_0.1.0_x64-setup.exe` — 7,357,336 bytes; SHA-256 `3940ae314c1640a34944e9c5b78e8bb57d454a2dba1984a6debffecd87927105`.
- `src-tauri/target/debug/knot.exe` is also current. Release builds omit the test-workspace environment override; native automation exercised the debug build, not an installed release instance.

No installer execution or clean-machine installation/uninstallation is claimed in this pass. Native file/folder dialogs were not rerun; their prior evidence and limits below remain applicable. The external-workspace run used the seeded catalog; exports intercepted the dialog handoff while Rust tests exercised safe output writing. Physical disk-full/power-loss, cross-drive/removable/network storage, very large libraries and exhaustive content/rendering fidelity remain follow-up hardening. Benchmark, legacy-fixture and opt-in archive diagnostics were not rerun. Completion does not remove these limitations or promise arbitrary damaged-document repair.

## Milestone 3 local missing-attachment recovery — 28 October 2026

- TypeScript, ESLint, 13 frontend tests, 41 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend and standalone debug desktop builds passed. Release executable and installer remain at the icon refresh.
- Rust coverage verifies exact recovery from misplaced assets and retained quarantine payloads, shared/live/Trash associations, query-only database operation, restart persistence, absent-copy errors, malformed/unindexed hashes, occupied and corrupt destination refusal, conflicting index sizes and damaged recovery-copy rejection. Recovery verifies the synced temporary copy before no-replace publication.
- Extended `node tests/native/quarantine.mjs` passed with real SQLite/filesystem fixtures: no-copy guidance, stale-report rejection after a destination becomes occupied, actual save-failure blocking and retry, exact recovered/source bytes, unchanged database rows, editor/shared-content refresh, and existing quarantine/disposal/backup-switch checks. Evidence: `test-results/quarantine-1793180354801/`; recovery success screenshot inspected. The initial test expected no copy while its earlier duplicate-attachment fixture still existed; recovery correctly found that duplicate. The no-copy fixture was corrected before the passing run.
- Native integrity regression passed: `test-results/integrity-1793180286952/`. No new dialogs were introduced. Quarantine-source recovery and persistence after restart are covered by Rust; the new native recovery path uses a misplaced ordinary asset file.
- This slice restores only missing indexed attachment files from exact local copies. It retains sources and refuses occupied/corrupt destinations; external-file/archive recovery and damaged-body repair remain future work. Scans are synchronous, unpaginated and limited to ordinary asset files directly in assets or one subfolder deep plus complete quarantine entries. Large-library performance, cancellation, hostile external writers, physical disk failure and publication-time fault injection are not acceptance-tested. Workspace format 1/database schema 2 and Yjs bodies remain unchanged.

## Milestone 3 permanent orphan disposal — 28 October 2026

- TypeScript, ESLint, 13 frontend tests, 39 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend and standalone debug desktop builds passed. Release executable and installer remain at the icon refresh.
- Rust coverage verifies stale metadata rejection, unexpected-file retention, exact restored-original preservation, disposal under SQLite query-only mode, repeated/unsafe-ID rejection, newly indexed content protection even for a missing Trash asset, corrupt-payload retention and broken-relationship refusal. Existing quarantine coverage retains filename/hash protection and redirect validation.
- Extended `node tests/native/quarantine.mjs` passed against the compiled Windows app: disposal cancellation, actual SQLite save-failure blocking and retry, successful removal of only the selected recovery entry, unchanged database rows and exact restored-original bytes. The existing shared/Trash, junction, restart, no-overwrite and backup-switch checks also passed. Evidence: `test-results/quarantine-1793179919946/`; disposal success screenshot inspected.
- Disposal is individual and permanent, available only for complete validated quarantine copies. It does not delete documents, indexed attachments or restored originals. Damaged/incomplete copies and unexpected directory contents require future recovery tooling. No bulk deletion, secure erasure, physical free-space measurement, process interruption during disposal, metadata-cleanup fault injection, hostile external-writer race or physical disk-failure acceptance is claimed. Metadata cleanup failures after payload deletion are reported separately as success warnings; residual metadata remains visible in the catalog. Workspace format 1/database schema 2 and Yjs bodies are unchanged.

## Milestone 3 database migration safeguards — 28 October 2026

- TypeScript, ESLint, 13 frontend tests, production frontend and standalone debug desktop builds passed. Rust migration coverage verifies retained schema-1 archives, exact document/attachment/association rows and revisions, unchanged manifests and Trash, successful archive restore into schema 2, no repeated archive on current-schema reopen, real SQL rollback and retry, missing/corrupt assets, invalid history, broken relationships, unavailable backup storage, empty initialization and refusal of unknown/populated unversioned databases. All 37 Rust tests passed (two opt-in tests excluded), and Clippy passed with warnings denied. Release executable and installer remain at the icon refresh.
- `node tests/native/migrations.mjs` passed using actual native-generated shared-note/board Yjs snapshots, an imported image and a trashed document in a reconstructed schema-1 fixture. An injected SQL migration failure retained schema 1 and every original row; retry retained two independent archives, upgraded to schema 2, preserved exact stored rows/manifest/attachment bytes and rendered shared references after restart. Evidence: `test-results/migrations-1793179516866/`; the recovery-archive report screenshot was inspected. The first run hit a Node SQLite shared-memory I/O error immediately after force-stop; allowing Windows to release handles fixed the fixture timing before the passing run.
- Existing native integrity and managed-backup suites passed: `test-results/integrity-1793179556614/` and `test-results/backups-1793179556602/`. Recovery-archive restoration is covered by Rust; the native file picker was not retested.
- This hardens the supported schema 1→2 migration, without introducing a new workspace format or converting Yjs bodies. Recovery archives include indexed content only, require extra disk space, remain local and are excluded from regular backups/relocation. Large-library migration performance, physical power loss/full disk, hostile external writers and automatic recovery-archive retention/deletion remain outside this slice. A schema migration failure can recur when restoring an archive containing the same underlying schema problem; restoration is not a database repair engine.

## Milestone 3 guided reference recovery — 28 October 2026

- TypeScript, ESLint, 13 frontend tests, production frontend and standalone debug desktop builds passed. Rust storage is unchanged; the previous 32-test Rust result remains the latest full backend run. Release executable and installer remain at the icon refresh.
- Frontend coverage checks one action per target, distinct referring-document counts including trashed sources, exclusion of missing/damaged snapshots, removal of actions after restoration and unchanged input bytes.
- `node tests/native/reference-recovery.mjs` passed against the Windows app: changed snapshots invalidate old actions, real SQLite save and restore failures block mutation, retry retains exact document rows/IDs/metadata (except the deletion flag), attachment rows/associations/bytes remain unchanged, shared previews recover immediately, the report refreshes and content survives restart. Ordinary Trash restoration into an empty library also passed. Evidence: `test-results/reference-recovery-1793178915044/`; recovery-action screenshot inspected. Initial test runs exposed a CDP page-startup race and a Node SQLite null-prototype assertion mismatch; both test issues were corrected before the passing run.
- Existing native integrity and Trash regressions passed: `test-results/integrity-1793178933614/` and `test-results/trash-1793178933591/`.
- This is explicit restoration of existing Trash targets, not missing-document reconstruction or damaged-body repair. Snapshot checks remain structural, not complete schema/rendering validation. No format migration, new native dialog, installer test or physical disk-failure test was performed. Recovery revalidation still reads all snapshots and has no external-writer race guarantee.

## Milestone 3 document and shared-reference integrity — 28 October 2026

- TypeScript, ESLint, 12 frontend tests, 32 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend and standalone debug desktop builds passed. The extended Rust query-only audit test passed again after adding snapshot assertions. Release executable and installer remain at the icon refresh.
- Frontend coverage includes valid cycles/self references, card and inline targets, missing/trashed/unreadable targets, trashed sources, corrupt updates, incomplete Yjs dependencies, mismatched identity metadata, absent snapshots and empty bodies. Input snapshot bytes remain unchanged. Rust verifies live/Trash snapshot transport under SQLite query-only mode.
- Extended `node tests/native/integrity.mjs` passed: actual BlockSuite snapshots produce zero findings when healthy; injected missing/trashed/unreadable reference targets are distinguished; refresh preserves exact stored document rows, attachment diagnostics and recovery navigation. Evidence: `test-results/integrity-1793178450656/`; screenshot inspected. An initial run hit an ambiguous test text locator because the same Trash title now appears in both report sections; the locator was narrowed before the passing run.
- `node tests/native/shared-notes.mjs` passed again: two-board source consistency, restart, navigation, reciprocal references, placement removal, native-created linked documents and retained deleted sources. Evidence: `test-results/shared-notes-1793178460231/`.
- This slice performs no repair, migration or rewrite. Checks cover Yjs decoding/dependencies, collection identity, page-root count and target availability, not all block schemas, rendering, or attachment use inside bodies. Missing snapshots may be never-opened objects. All snapshot bytes cross IPC together and decoding is synchronous; large-library memory, cancellation and pagination remain untested/unimplemented. No new native dialogs, installer or physical disk-failure testing was performed.

## Milestone 3 recoverable orphan quarantine — 28 October 2026

- TypeScript, ESLint, eight frontend tests, 32 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend and standalone debug desktop builds passed. After the final restore-conflict guard, the five quarantine Rust tests and Clippy passed again. The debug executable includes quarantine; release executable and installer remain at the icon refresh.
- Rust coverage verifies exact-byte restoration after reopen, retained recovery copies, unchanged document snapshots and Trash/shared attachment associations under SQLite query-only mode, content/name index protection, changed previews, newly indexed content, workspace-scoped selections, broken-relationship rejection, partial batch outcomes, damaged/incomplete metadata and payload handling, traversal/device-name rejection, destination conflicts and protection when the original path becomes indexed with different bytes.
- `node tests/native/quarantine.mjs` passed against the compiled Windows app and real SQLite/filesystem: explicit preview/selection, cancellation, real save-failure blocking/retry, changed/newly indexed files rejected with partial outcomes, unchanged catalog/snapshot/attachment rows, preserved shared-note rendering, Windows junction exclusion and restore rejection, restart recovery, exact restored bytes, no-overwrite conflicts and retained recovery payloads. Managed backup restoration clears the panel and leaves quarantine only in the original workspace. Final evidence: `test-results/quarantine-1793177999879/`; preview and recovery screenshots were inspected (checkbox alignment was corrected after the initial run).
- Existing native integrity regression passed: `test-results/integrity-1793177999878/`. No native external dialogs were added or exercised in this slice.
- Quarantine is reversible organization, not disk-space reclamation: recovery copies remain after restore and are excluded from backup/relocation. Permanent disposal, portable recovery copies, recursive scanning, pagination, cancellation and large-file performance remain future work. Incomplete entries are retained with warnings; process interruption during the copy protocol was not injected. Physical disk-full/power-loss and concurrent modification by external tools are not acceptance-tested. File/directory paths are checked for redirects, but this is not an adversarial filesystem-race guarantee.

## Milestone 3 integrity report — 28 October 2026

- TypeScript, ESLint, eight frontend tests, 27 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend and standalone debug desktop builds passed. The debug executable includes the integrity report; release executable and installer remain at the icon refresh.
- Rust coverage adds shared attachment associations across live and trashed documents, SQLite foreign-key diagnostics, wrong-directory duplicate hashes, top-level unindexed files, unchanged snapshots and retained files. The audit succeeds under SQLite query-only mode.
- `node tests/native/integrity.mjs` passed against the compiled Windows app with real SQLite/filesystem fixtures: healthy, missing and corrupt attachments; live/Trash associations; refresh after fixture repair; unchanged document rows; retained unindexed files; backup-management access; and clearing stale results after an audit failure. Evidence: `test-results/integrity-1793177124289/`; the report screenshot was visually inspected. An initial test fixture omitted the schema-2 folder column; it was corrected to use explicit columns before the passing run.
- `node tests/native/acceptance.mjs` also passed, including formatting, canvas, attachment imports, SQLite save failure/retry, forced-termination recovery, offline saves and the updated integrity UI. Evidence: `test-results/acceptance-1793177133141/`.
- This slice is diagnostic only: no cleanup, attachment replacement or format migration. Database checks do not decode Yjs bodies or validate shared-document targets. Stored attachment associations include import history, not necessarily current visible use. The unindexed-file scan covers regular files directly in assets and one subfolder deep; it does not recursively inventory directories or links. Large report pagination, audit cancellation, inaccessible-file recovery and physical disk failures remain untested. An unreadable database or asset can abort the audit and produce an error instead of a partial report.

## Milestone 3 document exports — 28 October 2026

- TypeScript, ESLint, eight frontend tests, 26 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend and standalone debug desktop builds passed. The debug executable includes exports; the release executable and installer remain at the icon refresh below.
- Rust coverage verifies Markdown and ZIP attachment bytes, format/signature and unsafe-path rejection, safe suggested filenames, refusal to overwrite existing destinations, and temporary-file cleanup on failure.
- `node tests/native/exports.mjs` passed against the compiled Windows app and real SQLite storage. It checks formatted Unicode Markdown, exact attachment bytes, Page and Canvas PNG/PDF, canvas shapes and text, white image backgrounds, unchanged document blocks, failed-save retry, workspace-ID reference links without copying source bodies, cancellation, destination-failure retry, and oversized-view rejection.
- Evidence: `test-results/exports-1793176538164/`. Page and Canvas PNGs were visually inspected for complete text, image and shape rendering. The native test captures the export command handoff and simulates dialog cancellation/destination failure; it does not exercise the actual Save As dialog or its final write. Rust tests cover the writer separately. One non-fatal Yjs event-handler warning occurred during document switching.
- Markdown exports supported page blocks; canvas content is omitted and linked documents are not portable copies. PDF is a single raster page without selectable text. Visual exports are limited to 16 megapixels/16,000 pixels per side, and all payloads to 100 MiB. Multi-page documents, complex mixed-media fidelity and physical disk-full/power-loss remain untested.

## Knot icon refresh — 28 October 2026

- Generated a new ivory woven-knot mark on a forest-green rounded tile. Original artwork is stored in `public/knot-icon.png`; prompt and regeneration instructions are in `BRANDING.md`. Tauri platform icons, sidebar branding and favicon now use the same artwork.
- TypeScript and ESLint passed. Production frontend, debug desktop, release desktop and x64 NSIS installer builds passed. An initial concurrent frontend build collided on the shared output file; the release build was rerun sequentially using the completed frontend output. Both executables and the installer now include current Milestone 3 work. Installation on a clean machine was not tested.
- Inspected the 32-pixel icon, transparent source corners, icon extracted from the debug executable, and the native sidebar screenshot. Native backup regression passed: `test-results/backups-1793174974561/`; extracted-icon evidence: `test-results/icon-review/embedded-icon.png`.

## Milestone 3 external workspaces and relocation — 28 October 2026

- TypeScript, ESLint, eight frontend tests, 25 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend and standalone debug desktop builds passed. Release executable and installer remain older.
- Rust coverage includes existing-folder validation, locked destinations, canonical alias deduplication, registry/selection-write failures, external selection across restart, missing folders without silent recreation, returning locations, malformed-registry recovery, backups from folder names containing spaces, and relocation preserving manifest/document identity, Trash, attachments, tags and the independent source. Failed relocation selection retains the original lock and the validated destination copy.
- `node tests/native/external-workspaces.mjs` passed with a seeded external catalog: save-before-switch failure/retry, independent source/external edits, shared references, backup creation and verification, restart, missing-manifest startup recovery and retry when the manifest returns. Evidence: `test-results/external-workspaces-1793171145603/`.
- The interactive `--dialogs` run used the actual Windows folder picker to open an external folder and relocate it. It compared every document row between source and destination, verified save-before-relocation and restarted into the persisted new location. Those checks passed in `test-results/external-workspaces-1793170972920/`, but the run later failed in its offline-fixture directory rename with Windows EPERM. The fixture now temporarily renames its manifest instead. Attempts to repeat the entire interactive run were stopped because the computer-use tool reported unavailable/14-by-14 dialog geometry; a complete passing `--dialogs` rerun is not claimed. The picker screenshot from the first interactive run was inspected.
- The existing native managed-workspace and backup regression suites passed again: `test-results/workspaces-1793171434576/` and `test-results/backups-1793171434576/`.
- Relocation retains the source as a recovery copy. It does not synchronize copies, remove the source, move caches/unindexed files, or move application-managed backups. Cross-drive/removable/network storage, physical disk-full/power-loss and dialog cancellation are not acceptance-tested in this slice.

## Milestone 3 backup management — 28 October 2026

- TypeScript, ESLint, eight frontend tests, 22 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend build and standalone debug desktop build passed.
- Rust coverage includes unique archive creation, complete validation with temporary-copy cleanup, invalid and missing IDs, corrupt archive rejection, failed selection persistence retaining the current workspace lock, restored identity and persistent selection, archive-only deletion, and corrupt-asset export cleanup. Existing archive tests cover attachments, organization and shared document snapshots.
- `node tests/native/backups.mjs` passed in the compiled Windows app against an isolated workspace. It verifies save-before-backup failure/retry using a real SQLite trigger, creation/listing, full archive verification, restoration of the exact original ID and block JSON, retention of newer edits in the source workspace, deletion, and restart persistence.
- Evidence: `test-results/backups-1793170507348/`; the backup panel screenshot was inspected. Native external file dialogs were not retested; managed backups use the existing archive engine. Release executable and installer remain older.
- Managed backups are manual local archives; scheduling, automatic retention, catalog pagination and external-archive tracking are not implemented. Verification extracts a temporary copy and requires corresponding free disk space.

## Milestone 3 managed workspace picker — 27 October 2026

- TypeScript, ESLint, eight frontend tests, 20 Rust tests (two opt-in tests excluded), Clippy with warnings denied, production frontend build and standalone debug desktop build passed.
- New Rust tests cover switching to an archive-restored workspace, persisted selection, returning to the original, destination lock failure, failed selection-file replacement, rejected traversal/missing targets, retained workspace locks, and recovery from a missing startup selection. Missing selected workspaces are never silently recreated.
- `node tests/native/workspaces.mjs` passed in the compiled Windows app. A closed native workspace was copied into a managed restored-workspace fixture with identical document IDs. The UI test verifies independent edits, save-before-switch failure/retry using a real SQLite trigger, restart selection, history/Trash reset, and recovery through the picker after startup fails.
- Evidence: `test-results/workspaces-1793107768609/`; the picker screenshot was inspected. The test uses a copied fixture, not the native restore dialog; archive restore and selection are covered together by Rust tests. External workspace paths/moving, workspace naming and release/installer rebuilding are outside this slice.

## Milestone 3 Trash & recovery — 27 October 2026

- TypeScript, ESLint, eight frontend tests, 18 Rust tests (two opt-in tests excluded), and Rust Clippy with warnings denied passed. Production frontend and standalone debug desktop builds passed; release executable and installer were not rebuilt.
- New Rust coverage checks original snapshot bytes, ID, edit timestamp, attachments and folder/tag preservation, restoration after restart and from a backup, rejected writes and retry, invalid restore requests, and stable pagination of 105 deleted documents.
- `node tests/native/trash.mjs` passed against Windows WebView2/Rust/SQLite in an isolated workspace. It exercises Trash search and empty results, a real SQLite restore failure and retry, unchanged original ID/block JSON, immediate shared-preview recovery in the active board, restart persistence, and restoration into an empty library.
- Final evidence: `test-results/trash-1793107336304/`; screenshots were inspected. This is the first Milestone 3 slice, not validation of workspace moving, exports, permanent deletion or asset cleanup.

## Milestone 2 shared notes and references — 27 October 2026

- TypeScript, ESLint, eight frontend tests, Rust Clippy with warnings denied, production frontend build and standalone debug desktop build passed.
- Rust: 16 tests passed; two opt-in tests were excluded from the default run. The native archive round trip was then run separately and passed against the new shared-note workspace. The metadata benchmark was not rerun for this change.
- New Rust coverage verifies atomic creation of a linked note with its parent, rollback of both documents on SQLite failure, successful retry, prevention of deleted-note resurrection, and retention of deleted bodies through backup/restore.
- `node tests/native/shared-notes.mjs` passed against compiled Windows WebView2/Rust/SQLite. Two boards resolve the same note, source edits and title changes appear on both after switching and restarting, and board bodies contain the source ID without copied text. Native card navigation uses Back history. Removing a placement preserves the source and the other board; reciprocal links terminate; deleting a source leaves an unavailable card and its retained database row. Native-created collection documents commit with their parent and appear in the library.
- `node tests/native/legacy-references.mjs test-results/acceptance-1793088828161/Workspace` passed against a disposable copy of a pre-change native fixture. The source UUID and complete block JSON were unchanged, and a newly placed shared card resolved the original content. This diagnostic accepts any closed workspace with a saved live note; it never edits the supplied fixture.
- The existing native acceptance and organization suites passed again, including actual SQLite failure/retry, attachments, forced-termination recovery, offline editing, and folder/tag persistence.
- Evidence: `test-results/shared-notes-1793106118303/`, `test-results/legacy-references-1793106220484/`, `test-results/acceptance-1793106118303/`, and `test-results/organization-1793106118300/`. Screenshots were inspected for shared-content rendering.
- Shared placements are read-only previews; open the source to edit. The reference catalog materializes workspace metadata, while bodies load only for the active document and its reachable references. Large connected reference graphs and 10,000-document editor startup have not been performance-tested. No clean-machine installer test or new native backup-dialog test was performed for this change.

Repeat the main new check after building the debug desktop app:

```powershell
node tests/native/shared-notes.mjs
```

## Milestone 2 organization verification — 27 October 2026

- TypeScript, ESLint, six frontend tests, Rust Clippy with warnings denied, production frontend build and standalone debug desktop build passed.
- Rust: 15 tests passed, two opt-in tests not rerun for this change. Added coverage for real schema 1 migration and legacy archive restoration, folder/tag backup round trips, atomic rollback on invalid assignments, non-destructive deletion, and combined search/filter pagination.
- `node tests/native/organization.mjs` passed in the compiled Windows WebView2 application using a disposable workspace. It exercises folder/tag creation, document assignment, combined filtering and title search, reopening the application, folder renaming, deletion of an active folder/tag filter, and preservation of the document. Screenshots are saved under `test-results/organization-<timestamp>/`.
- The existing `node tests/native/acceptance.mjs` suite passed again, including formatted editing, Page/Canvas identity, attachments, actual SQLite write failure and retry, forced-termination recovery, offline editing and integrity checks.
- The navigation controls were also checked in the native application and confirmed working by the user before this change.
- Folders are single-level. Shared notes/references remain unimplemented. These checks do not constitute clean-machine installer validation.

Validated on this Windows development PC on 26–27 October 2026. Milestone 1 is implemented and tested; the aspirational performance targets and future milestones are not release guarantees.

## Automated results

- TypeScript `pnpm check`: passed.
- ESLint `pnpm lint`: passed.
- Vitest: 3 save-coordinator tests passed (coalescing, failed-write retry, changes during an in-flight save).
- Rust: 11 tests passed, with 2 opt-in tests separately run successfully. Coverage includes migrations/reopen, independent snapshot pairs, atomic title/state writes, attachment deduplication, archive restoration, unsafe ZIP paths, corruption, missing databases, exclusive workspace ownership, rejected SQLite writes, and read-only integrity auditing.
- Opt-in native workspace archive round trip: passed; compares actual BlockSuite snapshot bytes and attachments from the Windows editor.
- Rust Clippy, all targets with warnings denied: passed.
- Production Vite build and x64 Windows NSIS installer: passed.

## Native Windows acceptance

`tests/native/acceptance.mjs` launches the compiled Tauri application with an isolated workspace and WebView profile under `test-results/`. Playwright connects to WebView2 through a loopback debugging port enabled only for this test launch. This is the real Rust/SQLite backend, not a browser mock.

The repeatable suite passed:

1. First launch opens a welcome document; enter text and apply bold.
2. Page and Canvas share the same document identity.
3. Add a shape and connector through BlockSuite's surface model; save, undo and redo.
4. Import PNG, PDF, and duplicate PNG; confirm only two distinct physical hashes.
5. Create and rename an independent whiteboard; switch back without overwriting either document.
6. Inject an actual SQLite trigger that rejects snapshot writes. Save status reports failure; navigation stays on the unsaved document. Remove the trigger and retry; all edits survive.
7. Confirm deletion and verify the object is soft-deleted in SQLite.
8. Force-terminate the application after Saved, relaunch, and verify text, connector, image and PDF references.
9. Set WebView networking offline; edit and commit to SQLite successfully.
10. Run the integrity command and verify no missing or corrupt assets.

Additional native UI checks were performed with Windows computer-use automation:

- Freehand and shape tools operated through the built-in canvas toolbar, including undo/redo.
- Normal close and standalone release restart preserved formatted text, canvas elements, image and PDF. No Vite server was running.
- The PDF rendered with its fixture text in WebView2's inline viewer; images displayed after restart.
- Back up workspace opened the native Save As dialog and produced `verified.knot`.
- Restore backup opened the native archive picker, restored into a distinct sibling workspace and reopened the content. The original workspace remained intact.
- `tests/native/verify-restored.mjs` compared all rows of objects, documents, attachments and object_attachments between original and restored workspaces: identical IDs, state bytes, metadata and references. Image loading and the PDF iframe were also verified in the restored editor.

Archive UI evidence and screenshots are retained in the ignored `test-results` directory. The restoration diagnostic expects the manually restored test app to be running and uses `test-results/current-native.json`; it is not a standalone unattended dialog test.

## Repeatable commands

```powershell
pnpm tauri build --debug --no-bundle
node tests/native/acceptance.mjs
cargo test --manifest-path src-tauri/Cargo.toml library_10000_benchmark -- --ignored --nocapture
```

For an additional archive round trip, close the test workspace first:

```powershell
$env:KNOT_TEST_WORKSPACE = 'absolute path to the closed test workspace'
cargo test --manifest-path src-tauri/Cargo.toml native_workspace_backup_roundtrip -- --ignored
```

The Node diagnostics use Node 22's experimental built-in SQLite as test instrumentation. Application storage remains Rust-owned SQLite. `tests/verify-native.mjs` is a separate read-only diagnostic for the original manually created fixture containing the phrase “Knot recovery check”, brush and shape elements.

## Measurements

These are single-run smoke measurements on this PC, not statistical benchmarks:

| Scenario                                                         | Observed        |
| ---------------------------------------------------------------- | --------------- |
| 10,000 objects, first 100 metadata rows                          | 0.485 ms        |
| 10,000 objects, substring title search                           | 4.28 ms         |
| Insert 500 shapes and wait two animation frames                  | 425 ms          |
| Switch from that board to the note                               | 147 ms          |
| Debug native launch to paragraph ready, including CDP attachment | 2.5–3.8 seconds |

`tests/native/benchmark.mjs` creates a disposable 500-shape board in the running isolated test workspace. All 500 shapes saved. This does not establish sustained pan/zoom frame rate or guarantee that all elements are visible at every zoom level. The under-two-second cold-start target is not yet demonstrated.

## Durability and remaining limits

- Saved means the SQLite snapshot transaction committed. The app flushes when switching or closing normally. Process termination can lose edits that have not reached Saved.
- Failed-save behavior was exercised with a real SQLite failure, but physical power loss and a genuinely full disk were not tested.
- The installer and standalone executable were built and exercised; installation/uninstallation on a clean Windows VM remains unverified.
- Offline testing covers WebView networking disabled and a standalone executable without a dev server. The machine's network adapter was not disabled.
- Imports are bounded to 100 MiB and use in-memory IPC. PDF inline embedding is limited to 10 MiB. Multi-gigabyte library stress testing and streaming imports remain future work.
- BlockSuite's online-dependent embeds are unavailable under the offline CSP. Standard Markdown/PDF/PNG export and Trash restoration are covered by the Milestone 3 results above; destructive asset cleanup remains future work. Folders and shared cross-board notes are covered by Milestone 2.

## Notebook navigation — 30 October 2026

- Library entries now expose a neutral notebook identity, Whiteboard/Page views, live internal notes and linked shared notes. No storage migration.
- TypeScript, ESLint and all 29 frontend tests passed. Release/NSIS and debug builds passed; the existing large-chunk warning remains.
- `node tests/native/notebooks.mjs` passed against the isolated debug executable: multiple notes, Page navigation, canvas-only centering, live text updates, deletion, shared-source navigation and reload persistence. Screenshot inspected in `test-results/bundles-1793291076530/bundle.png`.
- Native accessibility suite passed, including keyboard menus, Escape, Jot focus and narrow layouts (`test-results/bundle-accessibility.log`).
- An initial test mistakenly targeted release, which ignores KNOT_TEST_DATA_DIR. The two persisted injected notes were removed through the editor, saved and confirmed absent after reload. The corrected suite targets debug and checks the isolated database exists before any edits.
- Installed app updated using `scripts/update-running.ps1 -SkipBuild`; executable hashes matched and the installed app was relaunched. Prior executable retained by the updater.

## Selected notes in Page — 30 October 2026

- Sidebar note selection now opens Page, temporarily revealing hidden notes without mutating displayMode. Selecting a note on Canvas then clicking the header Page switch also reveals it. Sidebar Page view clears the reveal. Hidden-note badges now say Hidden in page and explain the selectable behavior.
- TypeScript, ESLint and all 29 frontend tests passed. Native notebook tests passed against an isolated debug build, covering real keyboard edits to revealed content, save/reload, unchanged persisted visibility, returning to the full page, canvas selection to Page, select-all including the revealed note, shared links, deletion and live labels.
- Native accessibility checks passed. Screenshot inspected: `test-results/bundles-1793291602488/revealed-note.png`. Logs: `test-results/reveal-{debug,tests,lint,native,accessibility}.log`.
- Release/NSIS build succeeded (`test-results/reveal-release.log`). Installed Knot updated with the normal-close updater, verified byte-for-byte against the release executable, and relaunched.

## Focused note correction — 30 October 2026

- Selecting a note now renders only that note, omitting sibling note bodies and the document-wide heading. Sidebar selection highlights the focused note; Page view restores normal document rendering. The shell title remains the notebook title.
- View changes clear stale editor selections. Select-all is restricted to the focused note. Persisted visibility and bodies remain unchanged by navigation.
- TypeScript, lint and all 29 frontend tests passed. Native notebook tests passed, including explicit sibling absence, heading visibility, focused select-all, editable hidden notes, save/reload and full-page restoration. Visually inspected `test-results/bundles-1793292117782/revealed-note.png`.
- Native accessibility passed. Release/NSIS build passed (`test-results/focus-release.log`); installed app was updated, verified against the release executable and relaunched.

## Notebook title in focused Page view — 30 October 2026

- The editable notebook heading remains visible when an individual note is selected. Focused-note Ctrl+A no longer intercepts title editing.
- Removed the Hidden in page badge and the Viewing one note sidebar hint.
- TypeScript, ESLint and all 29 unit tests passed. Native notebook navigation passed, including keyboard title editing and saving while focused, sibling isolation and absence of both labels. Screenshot inspected: `test-results/bundles-1793328454693/revealed-note.png`.
- Release/NSIS build passed (`test-results/title-release.log`). Installed Knot updated through the normal-close updater, verified byte-for-byte against the release build and relaunched.

## Compact monochrome sidebar — 30 October 2026

- Replaced the green shell palette with neutral black, white and gray. Navigation actions use matching icons and compact rows; workspace switching is one line and library options sits beside its heading.
- Notebooks have a chevron to expand/collapse a single level of whiteboard and note children. Removed Page view, Notebook contents and Notes headings from the sidebar. Header Page remains available for the full-page view.
- TypeScript, ESLint and all 29 unit tests passed. Native notebook navigation passed, including collapse/expand, note focus, title editing, whiteboard switching and shared links. Screenshot inspected: `test-results/bundles-1793329701879/revealed-note.png`.
- Native accessibility passed for keyboard controls, contrast and layouts from 760 to 1920 pixels (`test-results/accessibility-1793329745509`). The contrast helper now accepts CSS shorthand hex colors.
- Release/NSIS build passed (`test-results/sidebar-release.log`). Installed app updated via normal close, verified against the release executable and relaunched.

## Global search modal — 30 October 2026

- Replaced the redundant Library/search side panels with a modal. Sidebar Search and Ctrl+K (Cmd+K on compatible keyboards) open it; Escape closes it, arrows navigate results and Enter opens the selected document. Focus is trapped by the native dialog and restored on dismissal.
- Debounced title/body search spans the workspace independently of sidebar folder/tag filters. The empty query lists recently updated documents. Superseded requests cannot replace current results; old scans stop at the next storage boundary. Saved-content limits and unreadable bodies are reported as partial results.
- The Library options icon now opens organization controls directly; search no longer filters or duplicates the sidebar list. Removed the separate body-search action and explanatory panel clutter.
- TypeScript, lint and 29 unit tests passed. Native search passed shortcuts, focus, keyboard opening, title/body search, filter independence, offline behavior, data preservation, save retry, freshness, corrupt bodies, Trash, restart and workspace changes. Screenshot inspected: `test-results/search-1793330829110/search.png`.
- Native accessibility, organization and panel suites passed. Logs: `test-results/global-search-{native,accessibility,organization,panels}.log`.
- Release/NSIS build passed (`test-results/global-search-release.log`). Installed Knot updated through normal close, verified byte-for-byte against the release build and relaunched.

## Workspace settings redesign (2026-10-30)

Replaced the flat Workspace actions menu with persistent Settings and Trash sidebar entries. Settings groups General, Backups, Workspace health and File recovery; external archive actions live alongside managed backups. Existing document state stays mounted and Escape returns focus to the original sidebar entry even after asynchronous navigation.

Validation: TypeScript, ESLint and 28 unit tests passed. Native settings coverage passed at 1280×800 and 760×540, including backup creation/verification, recovery navigation, Trash, Escape/focus and document continuity. Native backups and panels regression suites passed. Screenshots are in `test-results/settings-1793347406069/`. Release/NSIS rebuilt and installed executable updated through the normal save-flushing updater.

## Document actions redesign (2026-10-30)

Document actions now groups Add content, Organize & connect, and Read & export with consistent icons, task descriptions, and current-document context. Menu height is constrained to the window and scrolls independently. Keyboard navigation supports arrows, Home/End and Escape.

TypeScript, ESLint and 28 unit tests passed. `tests/native/document-actions.mjs` passed grouped navigation, bounds at 1920×1080 / 1280×800 / 760×540, keyboard wrap/dismissal, outside dismissal and all six panel destinations. The existing native panels suite also passed. Screenshots: `test-results/document-actions-1793347694015/`.

## Linked K identity (2026-10-30)

Applied the approved Linked K direction as editable SVG sources, a clean sidebar wordmark, charcoal/warm-white app and favicon assets, and regenerated Windows/macOS/mobile icon resources. Added reusable light and dark marks, horizontal lockup and 16/24/32-pixel proofs. The installed-app updater refreshes matching desktop/Start menu/taskbar shortcuts using a new icon filename.

Validation: TypeScript, ESLint and updater PowerShell syntax passed. Native identity smoke test passed and its screenshot was visually reviewed (`test-results/identity-1793364073892/linked-k-app.png`). Small-size icon proofs were visually checked. Release and NSIS installer rebuilt.

## Recovery screen simplification (2026-10-30)

Workspace health now shows a status summary and compact check rows, with diagnostics and recovery options collapsed. File recovery uses a compact file list, readable sizes, Set aside/Restore actions and an expandable explanation. Titles match settings navigation. Existing revalidation, save flushes and confirmation behavior remain unchanged.

Validation: TypeScript and ESLint passed. Native recovery UI (1280×800 and 760×540), integrity and quarantine regression suites passed, including set aside/restore, damaged/missing files, failed audit, cancellation, save failure, protected files and permanent disposal. Screenshots in `test-results/recovery-ui-1793364512275/` visually reviewed. Release/NSIS rebuilt; installed app relaunched and SHA-256 matched the release executable.

## Trash permanent deletion (2026-10-30)

- Added per-document Delete permanently and Empty Trash with a modal confirmation, default Cancel focus, Escape dismissal and explicit document counts. Empty Trash includes searched-out and paginated documents; it deletes only the IDs presented for confirmation.
- Backend validates every selected ID is still trashed before a single transaction removes snapshots, organization assignments, attachment associations and object records. A stale/live selection or database failure rolls back the entire batch. Shared asset indexes remain; unused file payloads are retained for File recovery. Existing backups are unchanged.
- Rust coverage verifies live-document protection, transaction rollback under an injected database error, shared attachments, unavailable restore after deletion, and a 105-document batch. Native WebView2 coverage exercises cancellation, individual deletion and Empty Trash while search hides another deleted document, alongside existing restore/restart/reference tests.
- Permanent deletion is logical removal from the current workspace, not secure erasure or automatic removal of existing backup archives or unused attachment payloads.

Validation: 42 Rust tests passed (2 explicitly ignored), 28 frontend tests passed, TypeScript and ESLint passed, and Clippy passed with warnings denied. Native evidence: `test-results/trash-1793365559344/`; inspected the centered confirmation screenshot and verified the complete deletion/restore flow.

## File drag-and-drop (2026-10-31)

- Disabled Tauri's native drag interception so WebView2 delivers browser File drops. The editor intercepts external file drops before BlockSuite to avoid duplicate imports, shows an editor-local drop overlay, and leaves internal text/block drag interactions alone. Drops elsewhere cannot navigate the app to a file.
- Page imports use the targeted/focused note and preserve a multi-file batch's insertion sequence. Canvas imports convert the client pointer to model coordinates and stagger the files. Images retain original bytes and aspect ratio, including GIFs. Page PDFs up to 10 MiB embed; Canvas PDFs and other files are attachment cards. Attach also supports selecting multiple files.
- Filename-based MIME fallback covers common image/PDF/Office formats when Windows supplies no useful type. Each file is validated against the existing 100 MiB limit; unreadable images report an error, and remaining files continue. Copies are stored through the existing durable attachment/snapshot pipeline; originals are untouched.
  `nFinal native validation (2026-11-01): test-results/media-drop-1793500382575/ passed real WebView2 file drag events for PNG/GIF/PDF/text, Page batch order, Canvas coordinates, multi-file Attach, restart persistence and bad-image recovery. Canvas card screenshot inspected. TypeScript, ESLint and 28 frontend tests passed. Release executable and NSIS installer rebuilt.

## Canvas attachment proportions (2026-11-01)

Removed card-based nonuniform scaling from Canvas embeds and bound the viewer dimensions directly to the Canvas object. Card-to-embed transitions expand the object; returning to Card restores its prior dimensions during the session. Previously flattened embeds expand on opening. PDF Canvas embeds render a first-page PDF.js preview with intrinsic page proportions and an Open PDF reader link, avoiding WebView2 iframe distortion under Canvas transforms. Existing custom portrait sizing remains retained; preview content uses object-fit contain when resized.

Validation: TypeScript, ESLint and 28 frontend tests passed. Native evidence `test-results/media-drop-1793501566122/` verifies drops, Card/Embed/Card transitions, actual rendered PDF proportions, saved file persistence and error recovery. The rendered PDF heading and square fixture were visually inspected. Full PDF navigation and highlighting remain in the existing reader.

## Canvas card layout (2026-11-01)

Card containers now use actual Canvas bounds with no nonuniform transform. Both horizontal and compact card styles reflow text and retain square icons. Native tests verified both styles after Embed-to-Card conversion and after restart; screenshots inspected in `test-results/media-drop-1793502317430/`. Final full native rerun passed in `test-results/media-drop-1793502407128/`. TypeScript build and ESLint passed.

### Sidebar resizing and shell motion (2026-11-01)

- Expanded sidebar is bounded to 200–400 px, supports pointer dragging and keyboard arrows/Home/End, and remembers width across reloads. Header collapse preserves that width; double-clicking the resize edge also collapses it.
- Collapse hides navigation from keyboard and accessibility interaction immediately. Notebook disclosures fold/unfold; shell menus, dialogs, and tool panels have short entrance transitions. Reduced-motion preferences disable these transitions.
- Passed TypeScript, ESLint, all 28 unit tests, native notebook navigation (including width limits, pointer resizing, collapse/restore, persistence, and reduced motion), and native shell acceptance at 1280 and 1920 px. Inspected the 1280 px Page screenshot.

### Notebook switching and Trash retention (2026-11-01)

- Notebook disclosures remain mounted while the old selection folds. Note labels are captured before destroying the old editor session, and closing contents are inert. Native regression checks retained contents and intermediate closing heights during navigation.
- Trash expires 30 days after `deleted_at`, checked on startup, every minute while running, and on the first page of Trash. Cleanup uses the existing transactional permanent-deletion path; live/restored documents and shared assets remain protected. Inactive workspaces are checked when active, and backups are unchanged.
- Passed 28 frontend tests, 43 Rust tests (2 existing opt-in tests ignored), TypeScript, ESLint, Clippy, native notebook navigation, and native Trash recovery/retention. Retention tests cover the exact cutoff, more than 100 expired rows, failure rollback, shared assets, startup cleanup, and cleanup on opening Trash.

### Trash presentation and move confirmation (2026-11-01)

- Trash uses a constrained content column, retention notice, search toolbar, document rows with days remaining, a designed empty state, and separate Workspace health / Backups links.
- Moving a notebook to Trash now uses an in-app modal naming the notebook and its 30-day restore window. Cancel receives initial focus; Escape cancels and focus returns to the invoker. Failed operations remain in the dialog with an error and retry action. Permanent deletion uses the matching dialog style.
- Passed TypeScript, ESLint, 28 unit tests, and native Trash acceptance including cancellation/focus, restore retry, permanent deletion, filtered Empty Trash, and retention. Inspected populated/empty pages and the move dialog, plus a 760 px layout with no horizontal content overflow.

### Windows virtualized backup paths (2026-11-01)

- Managed backup and workspace containment now resolves the child and compares its parent by filesystem identity using `same-file`, instead of comparing canonical path strings. Windows packaged-app storage can give one physical directory multiple resolved names.
- The actual installed backup directory passed a read-only listing check. Tests cover direct children, missing paths, case aliases, and rejection of a Windows junction targeting an unrelated folder. Existing backup create/verify/restore/delete tests pass. No data relocation is required.

## PDF split view and Office preview removal — 1 November 2026

Removed Office preview UI, source enumeration, XML extraction worker, styles, dedicated tests and direct fflate dependency. Existing Office attachments are retained. Added a separate wider PDF reading panel, 50–150% zoom, Fit width, page navigation and Canvas PDF links. Highlight tools remain separate. PDF rendering accounts for display pixel density within the existing rendering budget.

Validation: TypeScript, ESLint and 25 unit tests passed. Native PDF regression covers read-only split view, zoom/fit, Page/Canvas use, unchanged content/assets, highlights, undo/removal, restart and restore (`test-results/pdf-split-native.log`). Canvas link/file-drop persistence and document-menu navigation passed (`pdf-split-canvas.log`, `pdf-split-actions.log`). Release and NSIS builds passed (`pdf-split-release.log`).

## Optional collections — 1 November 2026

Folders/tags were replaced by optional many-to-many collections, contextual notebook popovers and a Library switcher. Schema 3 migrates populated groups (including Trash), merges equal names, removes old tables/column, and retains verified pre-migration recovery archives. Grouping does not rewrite editor snapshots or edit timestamps.

Passed TypeScript, ESLint, 25 frontend tests, 47 active Rust tests (3 existing opt-in tests ignored), and Clippy with warnings denied. Rust coverage includes schema 1/2 migration, equal-name merging, old backup restore, transactional rollback, collection filtering/pagination, multiple memberships, create-and-add atomicity, Trash and safe collection deletion. Native collections acceptance covers creation, filtering without changing the editor, automatic assignment/Undo, global search, inline rename, restart persistence, removal/deletion without notebook loss, Escape focus return and popup bounds at 800/1280 px. Native search regression passed with collection filtering. Screenshot review identified and corrected inherited checkbox sizing.

Native migration rollback/retry and exact content/reference/asset preservation passed. Release and NSIS builds and pnpm update:running succeeded (test-results/collections-update.log). Installed executable hash matches the release and the app relaunched normally. Read-only installed-workspace verification found schema 3, quick_check=ok, no foreign-key violations, and one schema-2 recovery archive.


## Collections accordion and Properties removal — 1 November 2026

Removed the redundant Properties action, surface, state, and styles. Collections now use a collapsed-by-default inline sidebar accordion with a small chevron, collection selection, and contextual rename/delete menus. Notebook membership remains in notebook menus; no storage changes. TypeScript, lint and 25 unit tests passed. Native collections and document-actions suites passed, covering keyboard expansion, membership, filtering, rename/delete, restart, responsive menu bounds, absence of Properties, and remaining panel destinations. Reviewed native screenshots of the accordion and menu.

Release and NSIS builds passed; pnpm update:running safely updated and relaunched the installed app. Installed executable hash verified against release (test-results/accordion-update.log).


## Collection tree correction — 1 November 2026

Each collection is now its own accordion containing its actual notebook rows and nested notes/whiteboard. Removed the collection filter navigation entirely. Collections expand independently; multi-membership notebooks appear under every containing collection. Uncollected notebooks remain directly accessible. Collection menus create notes/whiteboards within that group; global create actions produce uncollected notebooks. The catalog returns live notebook memberships without changing storage. All catalog pages load before grouping so notebooks beyond the initial 100 are not omitted; expanded collections render 100 at a time with Show more.

TypeScript, ESLint, 25 frontend tests and 47 active Rust tests passed. Native collection-tree acceptance verifies independent/keyboard expansion, nested notebooks and contents, shared memberships, uncollected items, contextual creation, rename, removal/deletion without loss and restart. Native screenshot reviewed.

## Library create-collection button — 1 November 2026

Replaced the Library notebook count with a muted plus icon and focused name popover. Enter creates, blank names are disabled, duplicate-name errors stay inline, and Escape dismisses. TypeScript/lint and native collection acceptance passed, including plus creation and duplicate handling. Existing collection tree behavior remains covered.

Collection menus now contain only Rename/Delete with compact icon rows, neutral white surfaces, restrained shadows and smaller corners. Create/rename use compact labeled inputs and Enter actions. TypeScript, lint and native collection checks passed; two-action menu screenshot inspected.

Sidebar hierarchy refinement: collection chevrons now precede titles and match notebook chevrons; notebooks indent 22 px beneath collections, with stronger collection headings and 14 px separation. TypeScript/lint and native collection regression passed; expanded-tree screenshot reviewed.

## Favorite notebooks — 2 November 2026

Favorites use the collection accordion styling with independent expansion and a pressed-state star next to the notebook title. Membership is persisted per workspace in schema 4. Sidebar entries derive from the shared notebook catalog, so title changes and Trash/restore stay current. Star mutations patch only favorite IDs; a revision guard prevents an older in-flight catalog response from replacing newer membership.

Validation: TypeScript, ESLint, 27 frontend tests, and 49 Rust tests passed (3 environment-specific tests ignored). Native favorites coverage verifies independent expansion, unchanged sidebar/collection DOM identity, no catalog reload calls on starring, rename, navigation, restart, remove, Trash and restore. Existing native collection coverage passed.

## Trash modal — 2 November 2026

Trash now uses the shared Settings modal, keeping the editor mounted and visible behind its backdrop. Nested confirmation keyboard events do not close the parent modal or interfere with focus. TypeScript, lint, build and native Trash coverage passed, including modal Escape/focus restoration, nested confirmation dismissal, search, failed restore/retry, restart, permanent deletion and filtered Empty Trash. Narrow-window layout was visually verified.

## Shell tooltips — 2 November 2026

Shell controls use a shared tooltip with BlockSuite toolbar theme tokens, 4px corners, 6px triangle arrows, 6px/12px padding and a 400ms hover/focus delay. Native title attributes were replaced with tooltip labels; editor tooltips remain separate. A manual popover renders above modal dialogs, flips below top-edge controls, and stays inside the viewport. Dismissal clears aria-describedby and responds to Escape, click, scrolling and window changes. TypeScript, lint, build and native light/dark, keyboard, dynamic-label and modal checks passed; both themes were visually inspected.

## Getting Started acceptance (2026-11-02)

`tests/native/getting-started.mjs` passed against the actual Windows WebView2 build. Evidence: `test-results/getting-started-1793582076402/`. Verified first-run creation, twelve notes/frames, native mind map/connectors, kanban/table/math blocks, local media and PDF source navigation, persisted task/status/checkbox edits after normal close/reopen, 100%/150% launch scaling, idempotent opening, fresh copies, Trash/restore, and attachment integrity with no page errors. Visual review led to a viewport-dependent opening zoom for smaller/scaled windows. TypeScript, ESLint, 27 frontend tests, 51 Rust tests (3 ignored benchmarks), and all-target Clippy passed. Full-board image export remains subject to the existing size limit; use smaller content or a focused Page note.

Final native rerun: `test-results/getting-started-1793582223773/` passed with responsive opening zoom and persisted shared-source edits. The 150% opening card fits above the canvas toolbar.

## Canvas recovery (2026-11-02)

Added the visible Canvas-only Find my content control and Ctrl+Shift+Home shortcut. Uses native BlockSuite fit bounds with space for the top control and bottom toolbar. Text inputs/editable content retain their normal shortcut behavior. Native acceptance (`tests/native/canvas-recovery.mjs`) passed far-away pan/zoom recovery, settled document snapshots unchanged, keyboard activation, input protection, Page/Settings visibility, empty boards, and 150% scaling. Evidence: `test-results/canvas-recovery-1793584846540/`. TypeScript, ESLint and all 27 frontend tests passed.

Final large-board recovery rerun passed: `test-results/canvas-recovery-1793586672737/`. Recovery can extend the viewport zoom below the native 10% floor when necessary; the test verifies the entire tour fits above the toolbar at 150% scaling. Empty canvases return to the origin at 100%.

## Unified PDF reader — 2 November 2026

- Replaced separate reading and highlighting panels with one PDF reader action across document menus, attachment toolbars, Canvas links and saved source links.
- Page navigation, zoom, fit width and text selection share the same resizable panel. Passage review appears only for a selection; normal attachment opening does not offer removal of a nonexistent highlight.
- Passed TypeScript checks, ESLint, all 31 unit tests, native document-actions checks and the full native PDF suite (selection at zoom, retry, undo/redo, source location, offline use, restart, corrupt/missing files and archive restore).
- Reviewed native screenshots of the reader and selected passage. Updated test setup to isolate fixtures from tutorial attachments and use current menu labels.


### Notebook creation actions (2026-11-02)

- Replaced sidebar New note / New whiteboard with Add note and New notebook…; the latter uses a compact naming popover.
- `pnpm check`, `pnpm test` (31 tests), and `pnpm lint` passed.
- `node tests/native/creation.mjs` passed against a fresh debug build with isolated test data: adding from Page and Canvas preserves notebook identity, Canvas addition opens the new note in Page, cancellation creates nothing, and a named notebook persists after reload.
- Visually reviewed the naming popover screenshot in `test-results/creation-1793603639974/new-bundle.png`.


### Notebook terminology cleanup (2026-11-02)

- Standardized notebook naming across creation, navigation, Favorites, collections, Trash, onboarding, documentation, component/API names, styles and native test selectors. Updated onboarding screenshots and old creation helpers. Preserved packaging terminology and historical evidence paths.
- No storage migration or rewriting of saved user-authored content. Existing editable Getting Started copies retain their saved content; newly created copies use the updated wording and images.
- Passed TypeScript, ESLint, 31 frontend tests, and 52 Rust tests (3 opt-in checks ignored).
- Native creation, collections and Favorites checks passed, including naming, membership, navigation, restart, Trash and restore. Corrected older test setup for the initial Getting Started collection and modal Trash flow.
- Refreshed and visually inspected the onboarding collection-membership screenshot.

## Mini browser v1 (6 November 2026)

See [Mini browser verification and limits](MINI-BROWSER.md). The native feasibility/isolation gate and integrated acceptance use `tests/native/browser-gate.mjs` and `tests/native/browser-v1.mjs` against an actual Windows build with production assets and disposable profiles. Public-page smoke results and the remaining mixed-monitor DPI hardware check are recorded there. Run `pnpm check`, `pnpm lint`, `pnpm test`, Rust tests, and the native suites before `pnpm update:running`.


## Tabbed supporting panes (6 November 2026)

Implemented the session-only two-group layout, real shared-Doc Page pane, selected-note toolbar action, stable supporting tools, drag/menu movement, resizing, responsive projection and native browser placement suppression. Existing working-tree changes were preserved; no reset, clean or unrelated commit was performed.

Verified:

- TypeScript and ESLint; all 67 unit tests, including layout identity, invariant preservation, close-neighbor behavior, responsive restoration, defensive geometry and adjacent width redistribution.
- `tests/note-pane-gate.browser.mjs`: identical active Doc, real Page input, shared undo/redo, heading/list/code rendering, sibling filtering, locked-note rejection, save and disposal.
- `tests/workspace-panes.browser.mjs`: stable editor host identity across split/swap/merge, edits, narrow projection/restoration, ordinary Escape, delete/undo and close without document deletion.
- `tests/native/pane-browser-gate.mjs`: actual native child hides throughout movement, resumes at measured physical bounds and retains its session.
- `tests/native/workspace-panes.mjs`: real PDF beside the note, reader scroll/controller continuity, live editing/saving, stable host and Canvas object geometry, native browser split/swap/merge and full drag hiding. Screenshots cover 1920x1080, 1440x900, 1280x720, 850x640, 760x540 and dark mode. HTML screenshots do not capture the sibling native webview; native window inspection independently verifies its visibility and physical bounds.
- Full native Browser v1, panels, accessibility and shared-notes suites passed. The harnesses now use tab closes, current settings/navigation controls, readiness/focus boundaries and actual resolved theme colors. PDF checks compare the reachable document tree and allow Card Deck's existing cited-excerpt UUID rebinding during redo while retaining strict note identity, text, source and order.
- Existing Canvas-performance and Card Deck browser suites passed. A paired browser sample with 1,000 shapes and 150 paragraphs measured pan median/p95 at 8.8/43.8ms without a pane, 9.0/14.2ms with it and 8.3/9.6ms hidden. One pane open took 1,536ms; ten open/close cycles took 10,143ms and left exactly the main editor host. This small headless sample is not a replacement for the native five-trial benchmark. Evidence: `test-results/pane-performance.json`.

Final native pane evidence is `test-results/workspace-panes-1793966625153`. Visual evidence reviewed includes `test-results/browser-v1-1793958182026/canvas-pdf-note.png`, `panes-dark.png`, the requested viewport screenshots, and `test-results/workspace-panes-split.png`. Headers remain stable; tools have one shared tab header, local functional controls and existing Page typography. PDF fills its pane, and error/notice overlays stay clear of supporting actions.

Limits: real Windows multi-monitor 125%/150% scaling and manual hardware IME input were not exercised; CSS viewport emulation is not evidence of OS scaling. There is no cross-document tab restoration, vertical docking or multiple browser sessions. The legacy `native/editor.mjs` suite advances through Page formatting, attachments, Canvas drawing/movement and Undo/Redo, then fails on its non-visible `zoom-bar-toggle-button` selector; it does not provide a clean full-editor result. Pane-specific editor input and browser/editor continuity have independent passing checks.

Additional regression limits: `native/pdf-highlights.mjs` passes selection, save-error retry, shared Undo/Redo and reader resize/source positioning, but stops at the legacy **Remove this highlight card** action. `native/cited-excerpts.mjs` completes its initial locked excerpt, unlink and Undo assertions, then fails to reconnect its native CDP endpoint after its first restart. These full suites are not claimed as passing; the real-PDF pane workflow has a separate passing native check.

Installed build: `pnpm update:running` completed successfully, verified the desktop installation and relaunched Knot. Final log: `test-results/panes-installed-update-final.log`. Computer-use inspection of the installed release confirmed Page/Canvas navigation, the native selected-note **Open in side panel** action, the actual Page pane with the user's existing typography/dark theme, and closing the pane without deleting content. The temporary pane was closed and the full Page view restored; no text was entered into user documents. The installed and release executables independently matched SHA-256 `5F65BA5B26BB99D2205A57E3CA68039F1A51D8D2DD867A4525A1EC9336C85EBA`.


## Notebook-specific supporting layouts (6 November 2026)

Supporting tabs and columns now persist per notebook within each workspace, including group order, active tabs, last-used group and preferred widths. Empty layouts are saved explicitly. Startup uses the existing per-workspace recent notebook history, with first-run tour priority and a fallback when the previous notebook is unavailable. PDF sources bind to the newly opened editor session.

Validation: TypeScript, ESLint and frontend unit tests; `tests/notebook-layout.browser.mjs` exercises real React StrictMode and WorkspacePanes with isolated storage, notebook/workspace switching, two columns, active tabs, widths/order, reload, a fresh browser context, persisted closing and malformed JSON. `tests/workspace-panes.browser.mjs` verifies live shared editing, stable hosts, split/swap/merge, responsive layouts and note delete/undo. Browser tests use no user documents.

Installed update: pnpm update:running completed successfully; desktop installation verified and Knot relaunched. Final checks passed: 73 unit tests, TypeScript, ESLint, notebook-layout browser acceptance and shared-pane browser regression.

PDF toolbar regression: editor controllers retain callbacks created before the active notebook is set. The layout dispatcher now has stable useReducer-like semantics and updates the current notebook state. The browser regression reproduces the initial unscoped callback followed by notebook activation: it failed before the fix and passes after it, alongside isolation, reload and closed-layout checks.

PDF toolbar fix validation: TypeScript, ESLint, all 73 unit tests and both pane browser suites passed. pnpm update:running completed successfully, verified the desktop installation and relaunched Knot.

Tab-strip scrolling polish: the tab row has a fixed top position with room for its horizontal scrollbar, including native high-contrast scrollbars. Visible-scrollbar geometry checks passed for stable tab/control positions, no vertical clipping, and matching content boundaries in light/dark/high-contrast modes. Vertical mouse wheel input over overflowing tabs now scrolls horizontally using a local non-passive listener; native horizontal gestures and modified-wheel input retain their defaults. Browser acceptance covers real wheel input in both directions, line deltas, modifier/horizontal pass-through and non-overflowing strips, alongside existing layout persistence and shared-editing checks. TypeScript and ESLint passed.

Exact column drop previews: edge indicators now simulate the same reducer action and responsive projection that the drop commits. The preview is anchored to the content row's right edge, so growth into the canvas and unequal column widths are represented accurately. Targets match the full destination content bounds, with no fixed 26% strips or inset margins. Invalid/no-op, narrow and expanded-layout split targets are suppressed. tests/pane-drop-preview.browser.mjs verifies preview versus landed x/y/width/height within one pixel for left/right splits at 1082/1280/1600px, unequal-column swaps and Escape. Light/dark screenshots were inspected. TypeScript, ESLint, 73 unit tests, persistence/wheel browser acceptance and shared-pane browser regression passed.

Exact-drop-preview installed update: pnpm update:running completed successfully, verified the desktop installation, and relaunched Knot.

Drop-target hover feedback: native dragenter/dragover now select a single destination, with a blue tint, solid inset border and stronger label. Dragleave clears only its own selection, protecting a newly entered target from late leave events; beginning/ending a gesture clears the selection. The active preview paints above overlapping alternatives. Browser acceptance verifies exclusive selection, switching, clearing, unchanged landing bounds and cancellation; shared-pane regression, TypeScript and ESLint pass. Light/dark hover screenshots were inspected.

Hover-highlight install result: pnpm update:running built successfully but its desktop scheduled-task wait timed out with result 267009. Independent verification confirmed the installed executable exactly matches the new release (SHA-256 1202D610BD0C3CDC3ED7699E2D55BEF1633865F8C80ED0A13F1B7242079A9D9E) and the installed Knot process relaunched with a responding main window. The update command itself is not recorded as passing.

Whole-column drag previews: the Move column handle now displays the valid opposite-side destination with exact projected width/position and existing exclusive hover highlight. Previews support columns with multiple tabs and unequal widths. Header drops use the same preview action; dropping onto the source header is a no-op. Browser acceptance covers both directions at 1082/1280/1600px, complete group metadata preservation, header/body drops and cancellation. TypeScript, ESLint, all 73 unit tests, tab/column drop-preview acceptance, notebook persistence/wheel acceptance and shared-pane regression passed. The desktop updater now launches asynchronously with Start-Process before its existing independent process check, avoiding a blocking shell automation call observed during the previous update.

Whole-column preview installed update: pnpm update:running passed, verified the desktop installation and relaunched Knot successfully with the asynchronous launcher.

Resized column destination fix: column moves now keep widths attached to screen slots instead of carrying the source width across the divider. Swap previews and committed actions use the currently projected slot widths; minimum-width constraints still apply. This supersedes the earlier group-width-following behavior. Browser regression first reproduced the mismatch after a real pointer resize, then verified both left/right destination bounds and unchanged landed divider positions. Existing multi-tab/hover/drop/persistence/shared-edit checks pass, along with TypeScript, ESLint and 74 unit tests. Resized preview screenshot inspected: test-results/pane-drop-resized.png.

Resized-indicator update outcome: the full build passed, but shortcut launching again kept the desktop task running after Knot opened and the command timed out. The updater now starts the installed executable directly via ProcessStartInfo with UseShellExecute disabled. PowerShell syntax validation passed. Retrying pnpm update:running -SkipBuild completed successfully: desktop installation verified and Knot relaunched.

Tab-strip insertion indicators: tab drags now show a blue vertical marker at the exact before/after boundary or end position. The marker and committed move share pointer-based insertion calculation, excluding the dragged tab from insertion indices to keep same-strip ordering correct. Scrolled strips use content coordinates and edge scrolling; projected merged strips retain each hovered tab's underlying group. Marker state clears on leave, cancellation, column-preview entry and completed drop. tests/pane-tab-drop.browser.mjs passes before/after/end order, cross-column and collapsed insertion, scrolling and cleanup. Column-drop/resized-width, persistence/wheel and shared-editor browser regressions, TypeScript and ESLint pass. Dark insertion screenshot inspected.

Tab insertion installed update: pnpm update:running passed, verified the desktop installation and relaunched Knot.

Column visibility toggle: the main document toolbar now offers Hide columns / Show columns using the shared columns icon. Visibility is saved with each notebook's existing layout (older records default to visible). Hiding keeps all pane controllers and tab metadata mounted, marks the hidden root inert, releases supporting width and restores the main editor in narrow layouts. Tool opening/activation reveals hidden columns. The narrow Back to canvas/page action uses the same visibility state. Tests cover the actual toggle, per-notebook isolation and refresh persistence, retained live Page host identity, restored editor width, legacy preference loading and tool reopening. TypeScript, ESLint, 75 unit tests and all four pane browser suites passed.

Column visibility installed update: pnpm update:running completed successfully, verified the desktop installation and relaunched Knot.
