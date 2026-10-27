# Milestone 1 verification

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
- BlockSuite's online-dependent embeds are unavailable under the offline CSP. Standard Markdown/PDF/PNG export, folders, shared cross-board notes, trash UI and destructive asset cleanup are future milestones.
