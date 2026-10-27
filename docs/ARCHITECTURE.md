# Architecture

React owns navigation, title editing, library queries, status, and application actions. BlockSuite owns rich text, canvas rendering, drawing, selection, and undo/redo. The editor is mounted as a custom element and is not rerendered on pointer events.

- `src/app`: application shell and active-document lifecycle.
- `src/features/editor/blocksuite/adapter.ts`: the only BlockSuite integration boundary; schema registration, collection/subdocument initialization, BlobSource, mode switching, snapshots, and disposal.
- `src/services/workspace.ts`: typed Tauri command APIs for documents, attachments, and backups.
- `src/services/persistence.ts`: bounded, serialized asynchronous save coordination.
- `src-tauri/src/storage.rs`: migrations, workspace initialization, SQLite transactions, asset hashing and storage.
- `src-tauri/src/organization.rs`: folder/tag catalog, atomic assignments and filtered library queries.
- `src/app/Organization.tsx`: organization management, document assignment and library filter controls.
- `src-tauri/src/backup.rs`: consistent SQLite snapshots and validated archive restoration.
- `src-tauri/src/lib.rs`: narrow commands and default workspace selection.

Only the active document is initialized. Library reads are paginated in batches of 100, with indexed ordering and title substring filtering. A future FTS migration can replace the substring scan. React retains no attachment payloads in state. BlobSource loads a requested asset only when needed.

Each object has a stable UUID independent of its display title or mode. For this milestone each object has its own BlockSuite collection containing one document. This keeps collection metadata and subdocument persistence atomic and allows lazy loading without materializing a whole knowledge library. Cross-document BlockSuite links and shared cards require a future workspace collection/provider design. Future placements will refer to stable object IDs and board IDs; they must never duplicate note content as their authoritative model.

The Rust workspace mutex serializes storage operations, so a backup contains a coherent metadata/asset view. Tauri async commands keep database work off the WebView rendering thread, though long backup operations currently delay subsequent commands. A dedicated blocking worker is a future refinement.

No arbitrary path-based file commands are exposed. Backup paths come from Rust native dialogs; asset paths are derived from validated SHA-256 strings. Network embeds are intentionally restricted by the production CSP.

Workspace ownership is protected by a process-held OS file lock. A second process refuses to open the same workspace; the lock is released after process termination. The title edited inside BlockSuite is saved with its snapshot and mirrored to library metadata. The application temporarily disables editor interaction during switching, importing, and backup/restore dialogs.
