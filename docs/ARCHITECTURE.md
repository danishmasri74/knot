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

The editor projects live workspace metadata into a session-scoped BlockSuite collection. Only the active document and its transitively referenced documents have their bodies loaded; cycles are visited once. Library reads are paginated in batches of 100, with indexed ordering and title substring filtering. The reference catalog reads all metadata pages, so collection metadata memory grows with library size. A future FTS migration can replace the substring scan. React retains no attachment payloads in state. BlobSource loads a requested asset only when needed.

Each object has a stable UUID independent of its display title or mode. SQLite `objects` owns the workspace catalog; `documents.document_state` holds the sole authoritative Yjs body for each object. On open, the adapter validates the legacy per-object collection envelope and applies its document update to the matching workspace subdocument. Existing bodies and IDs are preserved; no bulk rewrite or SQLite schema change is required. Per-object collection envelopes are retained and their title metadata is maintained for compatibility, but they are no longer the runtime reference catalog.

Shared placements are native `affine:embed-synced-doc` blocks containing a `pageId` and board-local layout. Native `affine:embed-linked-doc` cards and inline reference attributes use the same workspace IDs. There is no second note body or denormalized preview stored on a board. Preview rendering reads the referenced subdocument; opening its card navigates through the app's flush/history path. Shared previews are read-only; edit the source to update every placement. Removing or undoing a placement only changes its owning document. Soft-deleted targets are absent from the runtime catalog and render as unavailable, while their stored bodies and referring IDs remain intact.

One SaveCoordinator observes every loaded subdocument. A save transaction commits all dirty bodies and their titles together, including new documents created by BlockSuite's native linked-document operations. Failed transactions preserve all prior snapshots and retain the dirty set for retry. Unloaded metadata placeholders are never saved as empty documents. Workspace changes and editor disposal discard the session collection; switching reconstructs references from committed source content. The single-window workspace lock remains the concurrency boundary. Attachments continue to resolve through the workspace BlobSource and are retained globally for backups; no reference-aware garbage collection is introduced.

The Rust workspace mutex serializes storage operations, so a backup contains a coherent metadata/asset view. Tauri async commands keep database work off the WebView rendering thread, though long backup operations currently delay subsequent commands. A dedicated blocking worker is a future refinement.

No arbitrary path-based file commands are exposed. Backup paths come from Rust native dialogs; asset paths are derived from validated SHA-256 strings. Network embeds are intentionally restricted by the production CSP.

Workspace ownership is protected by a process-held OS file lock. A second process refuses to open the same workspace; the lock is released after process termination. The title edited inside BlockSuite is saved with its snapshot and mirrored to library metadata. The application temporarily disables editor interaction during switching, importing, and backup/restore dialogs.
