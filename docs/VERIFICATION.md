# Verification

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
