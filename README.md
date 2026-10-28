# Knot

A Windows-first, offline knowledge workspace built with Tauri 2, React, TypeScript, and BlockSuite. SQLite and local attachment files are authoritative; there are no accounts, telemetry, cloud services, or IndexedDB persistence providers.

Milestones 1–3 are complete under the acceptance scope in [the roadmap](docs/ROADMAP.md). Milestone 4 is next. The current release includes recovery, backup management, workspace relocation, exports and guarded orphan cleanup; see [verification](docs/VERIFICATION.md) for tested coverage and deferred work.

## Development

Prerequisites: Windows 10/11, Microsoft C++ Build Tools (Desktop development with C++ and Windows SDK), WebView2 Runtime, Node 22+, pnpm 10.13.1, and rustup. `rust-toolchain.toml` selects Rust 1.90.0 without changing your global toolchain.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` starts only the frontend preview. It does not simulate durable storage; use Tauri to edit documents.

```sh
pnpm check
pnpm lint
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm build
pnpm tauri build
```

The Windows executable and NSIS installer are written under `src-tauri/target/release`. No development server is needed by the packaged application.

## Using Knot

Create notes or whiteboards in the sidebar. Page and Canvas are two views of the same content. Use BlockSuite's slash menu, formatting controls, drawing toolbar, shapes, and connectors. Attach imports images and PDFs by copying; originals remain untouched. PDFs up to 10 MiB use BlockSuite's inline PDF embed. The current import limit is 100 MiB per file.

Use the Back and Forward buttons beside the document title to revisit documents opened in this session. Pending edits save before navigation; a failed save keeps you on the current document. History resets when opening a restored workspace or restarting Knot.

Use **Manage folders & tags** in the sidebar to create, rename, or delete folders and tags. Open **Organize** above a document to choose one folder and any applicable tags. Sidebar folder/tag filters combine with title search. New documents start unfiled and clear the library filters. Deleting a folder makes its documents unfiled; deleting a tag removes its assignments. Neither action deletes documents. Folders are a single level for now.

Edits save automatically after roughly 600 ms. **Saved** means the snapshot has committed to SQLite. Ctrl+S retries/flushes saves; switching documents and normal window closing flush pending edits. If a save fails, keep the window open and retry. Sudden process termination may lose changes that have not reached Saved.

**Trash & recovery** searches and restores deleted documents with their original identities, content and surviving organization assignments. Shared references resolve again after restoration. Documents remain soft-deleted until restored; permanent document deletion is not provided.

**Manage backups** creates, lists, verifies, restores and deletes local `.knot` archives. **Back up workspace** and **Restore backup** use native file dialogs for external archives. Restore validates and opens a separate workspace; your previous workspace is retained. **Switch workspace** reopens managed or external workspaces. Relocation opens a validated copy while retaining the source.

**Export** shares supported Page content as Markdown (with attachments bundled when needed), or the current Page/Canvas view as PNG or a single-image PDF. Exports are not lossless backups; linked documents remain workspace references and PDF text is not selectable.

**Check workspace** reports database/relationship, attachment and basic document/reference issues without changing stored content. It offers recovery for eligible referenced Trash documents and missing attachments with exact local copies. **Orphan quarantine** moves selected unindexed files into retained recovery copies; individual copies can be restored or explicitly permanently deleted after revalidation. Quarantine, unindexed files and pre-migration recovery archives are excluded from ordinary backups and relocation. Quarantine alone does not free disk space.

If startup detects a damaged workspace, the shell remains available so you can restore a backup. A missing database is never silently replaced. Supported database upgrades retain verified pre-migration archives and roll back on failure. Advanced damaged-document repair and exhaustive rendering validation are deferred; see the roadmap and verification limits.

## Native acceptance tests

Milestone 1 has been exercised in the actual Windows WebView2 application. Build an isolated test executable, then run:

```sh
pnpm tauri build --debug --no-bundle
node tests/native/acceptance.mjs
cargo test --manifest-path src-tauri/Cargo.toml library_10000_benchmark -- --ignored --nocapture
```

The native suite creates disposable data under `test-results/`, uses a separate WebView profile, and never edits your normal workspace. It tests actual SQLite write failure/retry, offline editing, attachments, and process-kill recovery. Playwright attaches to the installed WebView2; no additional browser download is needed. Close other test instances using port 9241 first. The debug-only `KNOT_TEST_DATA_DIR` override is absent from release builds. Native archive dialogs were also tested manually; see the verification report for evidence and remaining non-milestone validation.

See [architecture](docs/ARCHITECTURE.md), [storage](docs/STORAGE.md), [decisions](docs/DECISIONS.md), [roadmap](docs/ROADMAP.md), and [verification](docs/VERIFICATION.md) for scope and limitations.

## Implementation source map

- `src/app/App.tsx`: workspace shell, library navigation, actions, save/error state, close handling.
- `src/features/editor/blocksuite/adapter.ts`: editor and BlobSource integration, complete snapshot pairs, lifecycle.
- `src/services/workspace.ts`, `src/services/persistence.ts`: typed backend boundary and save queue.
- `src/styles/app.css`: Tailwind and application styling.
- `src-tauri/src/{lib,storage,backup}.rs`: commands, durable storage, native backup format.
- `src-tauri/migrations/001_initial.sql`: initial versioned schema.
- `tests/` and `src-tauri/src/tests.rs`: fixtures and verification.
- `pnpm-lock.yaml`, `src-tauri/Cargo.lock`, `rust-toolchain.toml`: reproducible dependencies/toolchain.
