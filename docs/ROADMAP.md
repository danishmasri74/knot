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

## Milestone 2

Folders/tags, navigation history, shared note placements and workspace-level BlockSuite references, tested shared-note consistency. No duplicate authoritative note bodies.

## Milestone 3

Workspace picker/moving, backup management, standard exports, recovery UI, orphan cleanup, richer integrity tooling and format migrations.

## Milestone 4

PDF highlight cards, Office previews, backlinks, advanced search, Jot integration. No custom Office editor or second canvas engine.
