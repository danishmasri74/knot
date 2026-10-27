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

Streaming IPC for large files; trash restore; multi-window navigation; startup optimization; sustained canvas pan/zoom profiling; multi-gigabyte attachment testing; physical disk-full/power-loss tests; clean-machine installer testing. The 10,000-object query and 500-shape smoke benchmarks now exist.

## Milestone 2 — in progress

- Implemented: session navigation history with Back/Forward controls, save-before-switch behavior, deleted-document removal, and history reset when restoring a workspace. History keeps the latest 100 visits and is not persisted across restarts.
- Implemented: single-level folders and tags, document assignment, combined sidebar filters and title search, create/rename/delete management, database migration and backup preservation.
- Remaining: shared note placements and workspace-level BlockSuite references, tested shared-note consistency. No duplicate authoritative note bodies.
- Shared notes require a workspace collection/provider design; the current per-object BlockSuite collections are still authoritative until that migration is implemented and verified.

## Milestone 3

Workspace picker/moving, backup management, standard exports, recovery UI, orphan cleanup, richer integrity tooling and format migrations.

## Milestone 4

PDF highlight cards, Office previews, backlinks, advanced search, Jot integration. No custom Office editor or second canvas engine.
