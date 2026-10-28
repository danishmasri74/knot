# Roadmap

## Milestone 1 — complete

- Tauri 2 desktop shell, React/TypeScript/Vite/Tailwind.
- BlockSuite Page/Edgeless views sharing a document, native editing tools.
- Managed local workspace, migrations, SQLite snapshots, content-addressed attachments.
- Create/open/rename/soft-delete, paginated library and title search.
- Save queue, error/retry state, switch/close flushing.
- Image/PDF import; native archive backup and restore into a new workspace.
- Non-destructive attachment integrity audit; recoverable startup errors.
- Windows native acceptance tests, storage fault/retry tests, process-kill recovery, and verified native backup/restore dialogs.

See VERIFICATION.md for the acceptance evidence and measured performance. Completion covers the initial desktop milestone, not every aspirational performance target or future capability.

## Further hardening / performance

Streaming IPC for large files; multi-window navigation; startup optimization; sustained canvas pan/zoom profiling; multi-gigabyte attachment testing; physical disk-full/power-loss tests; clean-machine installer testing. The 10,000-object query and 500-shape smoke benchmarks now exist.

## Milestone 2 — complete

- Implemented: session navigation history with Back/Forward controls, save-before-switch behavior, deleted-document removal, and history reset when restoring a workspace. History keeps the latest 100 visits and is not persisted across restarts.
- Implemented: single-level folders and tags, document assignment, combined sidebar filters and title search, create/rename/delete management, database migration and backup preservation.
- Implemented: native shared-note placements across boards and workspace-level link cards/inline references. A session workspace collection resolves stable IDs and loads referenced bodies on demand. Shared previews open their source for editing; board snapshots never duplicate authoritative note bodies.
- Existing per-object snapshots open without a bulk rewrite. Dirty workspace documents (including native-created linked notes) commit atomically, with failed-write retry and backup preservation. See VERIFICATION.md for native consistency, restart, navigation, and deletion coverage.

## Milestone 3

- Implemented first slice: searchable, paginated Trash & recovery panel with deletion dates and individual restore. Restoring retains the original ID, snapshots, attachments and surviving organization assignments, and refreshes active shared references.
- Implemented managed workspace picker: return to the personal workspace or reopen a restored backup, persist selection across restarts, flush before switching and retain the current workspace on opening/selection failure. Missing startup selections are recoverable without creating an empty replacement.
- Remaining: external workspace selection/moving, backup management, standard exports, broader recovery UI, orphan cleanup, richer integrity tooling and format migrations. No permanent deletion or asset cleanup is included in the Trash slice.

## Milestone 4

PDF highlight cards, Office previews, backlinks, advanced search, Jot integration. No custom Office editor or second canvas engine.
