# Knot

A Windows-first, offline knowledge workspace built with Tauri 2, React, TypeScript, and BlockSuite. SQLite and local attachment files are authoritative; there are no accounts, telemetry, cloud services, or IndexedDB persistence providers.

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

Edits save automatically after roughly 600 ms. **Saved** means the snapshot has committed to SQLite. Ctrl+S retries/flushes saves; switching documents and normal window closing flush pending edits. If a save fails, keep the window open and retry. Sudden process termination may lose changes that have not reached Saved.

Back up workspace produces a versioned ZIP-based `.knot` file. Restore validates and opens a new sibling workspace; your previous workspace is retained. Deleted documents are soft-deleted and retained in backups; a trash-management UI is not yet implemented.

Check workspace audits attachment hashes and reports missing, corrupt, and unreferenced files without deleting anything. If startup detects a damaged workspace, the shell remains available so you can restore a backup. A missing database is never silently replaced.

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
