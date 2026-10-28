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

## Milestone 3 — complete

### Completion criteria

This milestone delivers the recovery, portability and storage-maintenance features listed below. Closure requires passing TypeScript/ESLint, frontend and Rust tests, Clippy, the automated native regression suites for existing editing/shared references and Milestone 3 workflows, and production frontend/debug/release/NSIS builds. Verification records the tested artifacts, evidence and remaining limits. Existing manual-dialog evidence is retained; clean-machine installation, physical failure testing and exhaustive content fidelity are follow-up hardening, not closure gates.

Completed on 28 October 2026: all closure checks passed, including 12 native regression suites and refreshed release executable/installer. See VERIFICATION.md for the release record. Completion uses this bounded scope; it does not claim the deferred capabilities below.

- Implemented first slice: searchable, paginated Trash & recovery panel with deletion dates and individual restore. Restoring retains the original ID, snapshots, attachments and surviving organization assignments, and refreshes active shared references.
- Implemented managed workspace picker: return to the personal workspace or reopen a restored backup, persist selection across restarts, flush before switching and retain the current workspace on opening/selection failure. Missing startup selections are recoverable without creating an empty replacement.
- Implemented backup management: create and list local managed archives, verify through the full restore validator, restore into a separate workspace, and explicitly delete individual archives. Existing external archive dialogs remain available.
- Implemented external workspace selection through a native folder dialog, remembered locations and unavailable-location recovery. Relocation creates and opens a validated copy in the selected destination while retaining the source recovery copy; automatic source removal is not implemented.
- Implemented standard export slice: Markdown with referenced attachments bundled in ZIP, and PNG/single-image PDF snapshots of the current Page or Canvas view. These are sharing formats, not lossless backups; portable linked-document collections and paginated/selectable-text PDF remain future work.
- Implemented integrity report: SQLite integrity and relationship checks, missing/corrupt attachment details with live and trashed document associations, retained unindexed-file inventory, refresh and backup recovery guidance.
- Implemented recoverable orphan quarantine: explicit file/byte preview, up to 100 selected files per operation, index/content revalidation, persistent recovery copies and no-overwrite restoration. Indexed attachment names and bytes remain protected regardless of document or Trash associations. Quarantine does not free disk space and is excluded from backups/relocation.
- Implemented document/reference integrity slice: isolated saved Yjs decoding, collection identity and page-root checks, incomplete-update detection, and missing/trashed/unreadable card and inline targets across live documents and Trash. Findings preserve all stored bytes and reference IDs.
- Implemented guided reference recovery: the integrity report offers deduplicated restore actions for referenced Trash targets whose saved snapshots pass basic checks. Actions flush edits, revalidate current findings, retain original identities and content, refresh shared previews and rerun the report; failed saves/restores remain retryable.
- Implemented database migration safeguards: schema 1→2 upgrades retain a pre-upgrade archive, validate database relationships and indexed assets, verify archive readability/restore limits, and commit schema changes atomically. Failed upgrades retain the old schema and archive; the integrity report lists recovery archive locations. New databases initialize atomically, while unknown and populated unversioned databases are refused.
- Implemented permanent orphan disposal: individually confirmed deletion of validated quarantine copies, with fresh attachment-index protection, save-before-delete, changed-copy rejection and preservation of restored originals. Incomplete/damaged entries remain retained; there is no bulk or automatic disposal.
- Implemented missing-attachment recovery: explicit integrity-panel actions search ordinary local asset files and complete quarantine copies for exact indexed hash/size matches. Recovery retains the source, publishes without overwriting, refreshes the editor/report and preserves all attachment keys and document associations. Occupied/corrupt destinations are refused.
- Current workspace format remains 1 and database schema remains 2; no Yjs body conversion is needed or performed. Trash remains soft-delete only.

### Deferred beyond Milestone 3

- Advanced recovery: arbitrary missing/damaged document-body reconstruction, corrupt-attachment replacement, external-file/archive extraction into an existing workspace, and damaged/incomplete quarantine repair. Existing recovery paths and their limits remain supported.
- Exhaustive block-schema and rendering validation across all BlockSuite content. Current structural/reference checks and tested rendering/export cases define this release's coverage.
- Future document/workspace-format conversions when an actual format change requires them. No speculative body conversion is needed for the current release.
- Portable linked-document exports, paginated/selectable-text PDF, large-library scan performance/cancellation, automatic retention and source-copy cleanup remain follow-up work alongside the hardening items above.

These are explicit follow-up scope, not unfinished Milestone 3 acceptance criteria. Milestone 4 can now proceed.

## Milestone 4

PDF highlight cards, Office previews, backlinks, advanced search, Jot integration. No custom Office editor or second canvas engine.
