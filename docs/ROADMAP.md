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

## Milestone 4 — complete

PDF highlight cards, Office previews, backlinks, advanced search, Jot integration. No custom Office editor or second canvas engine.

Completed on 28 October 2026: all five bounded slices meet their documented acceptance criteria, including the user-confirmed in-app Jot workflow. Closure passed 29 frontend tests, 41 Rust tests, TypeScript, ESLint, Clippy, all 17 native regression suites and production/debug/release/NSIS builds. See VERIFICATION.md for evidence and artifact hashes. Clean-machine installation and the explicit Milestone 3 deferrals remain follow-up work.

### Completion criteria

- PDF highlight cards retain the original attachment identity, selected text and page/location, survive restart/backup, and navigate back to the source PDF.
- Office attachments have read-only previews for explicitly documented supported formats, with clear unsupported-file/error states and original bytes retained. No custom Office editor.
- Backlinks identify live referring documents by stable ID and open their source through save-before-navigation; refresh reflects removed links and Trash.
- Advanced search finds supported document body text as well as titles, combines organization filters, and opens results by stable ID. Supported content and indexing freshness must be documented.
- Jot capture creates durable content through the existing workspace/editor model, with an explicit destination and retry on failed saves. No second canvas engine.
- Closure requires frontend/Rust tests, TypeScript, ESLint, Clippy, relevant native acceptance plus existing regression suites, production/debug/release/NSIS builds, and recorded evidence/limitations. All five capabilities must meet their stated criteria before Milestone 4 is closed. Clean-machine installation and Milestone 3's explicit deferrals remain separate follow-up work.

### First bounded slice: on-demand backlinks

Implemented and verified on 28 October 2026; included in the full milestone closure.

Acceptance: show one result per other live source document containing a shared card, link card or inline reference to the active ID; exclude Trash and self references; sort deterministically by title/ID. Flush before scanning and before source navigation, retain normal Back/Forward behavior, and clear results on document/workspace transitions. Explicit refresh must reflect saved link removal, renames and deletion. Unreadable/incomplete snapshots must produce a visible partial-results warning; failed scans must clear stale results and allow retry. Scanning must not write bodies, metadata or attachment associations. Verify extraction/deduplication/error handling with frontend tests and native save-failure, navigation, refresh, restart and preservation checks. Workspace format 1/schema 2 remain unchanged; no Yjs conversion or persistent index in this slice.

### Second bounded slice: PDF text highlight cards

Implemented and verified on 28 October 2026 under the bounds below; included in the full milestone closure.

Acceptance defined before implementation: choose an existing PDF attachment in the active document, read a locally rendered page, select text on that page and create a native BlockSuite note card with the quote and a source link. The source link retains the original attachment key, filename, one-based page and normalized selection rectangles; opening it returns to that PDF/page and marks the selection. Cards and original attachments survive restart and native archive restore without copied PDF bytes or rewritten source blocks. Card insertion participates in ordinary undo/save/retry and Page/Canvas rendering. Flush before opening the reader or inserting a card, prevent duplicate insertion on retry after a failed save, and clear reader state across document/workspace transitions. Missing/corrupt/encrypted or oversized PDFs must produce explicit errors without losing saved cards. Verify native selection, location reopening, failed-save retry, undo, offline use, restart and backup preservation alongside frontend validation tests and the relevant regressions.

This slice supports text-bearing PDFs up to 10 MiB, one page/selection at a time, with bounded page rendering and quote length. OCR, cross-page highlights, editing PDF bytes, annotation round-tripping, custom Office editing and a second canvas engine are excluded. Workspace format 1/schema 2 remain unchanged; no Yjs body conversion.

### Third bounded slice: read-only Office preview

Implemented and verified on 28 October 2026 under the bounds below; included in the full milestone closure.

Scope and acceptance defined before implementation: support `.docx` (Word OOXML) main-body text only, including paragraphs and table-cell text in document order. Display a persistent fidelity notice: no page layout, formatting, images, headers/footers, comments, tracked-change interpretation or embedded objects. Legacy `.doc`, `.xls`/`.xlsx`, `.ppt`/`.pptx`, macro-enabled and encrypted files are unsupported. Keep their original attachments and report unsupported/error states.

Limit input to 5 MiB, main document XML to 1 MiB, output to 100,000 characters and 5,000 paragraphs. Decompress only the main XML in a disposable worker with a timeout; never follow relationships or render supplied HTML. Flush before opening, allow load retry, clear on document/workspace transitions, and never save preview output. Verify supported text, malformed/oversized/unsupported input, offline use, failed-save gating, navigation clearing, unchanged identities/content/assets, restart and backup preservation with focused frontend/native checks. Workspace format 1/schema 2 and Yjs bodies remain unchanged. Full milestone regression and release/installer rebuild wait for closure.

### Fourth bounded slice: explicit title and body search

Implemented and verified on 28 October 2026. The scope and acceptance below were defined before implementation.

Search live document titles plus native paragraph/heading, list and code `prop:text` values, including PDF quotes stored as paragraphs. Match one trimmed, case-insensitive literal substring (1–200 characters); no stemming, regex, Boolean syntax or ranking. Exclude attachment contents (including Office/PDF extraction), canvas-only elements, tables, captions and transcluded source bodies. Shared sources are searched independently by their own stable IDs. Combine the existing folder and tag filters, exclude Trash, deduplicate and order by title/ID, and show a bounded matching excerpt.

Freshness: each explicit Search/Refresh flushes pending saves and reads current filtered metadata and saved snapshots; no persistent or incremental index. Results state their scan time and remain a snapshot until refreshed. Changing query/filter, document selection/deletion or workspace clears results. Failed saves/storage reads clear stale results and permit retry; navigation rechecks the live ID and uses normal save/history handling.

Bounds: inspect at most 200 filtered documents, 1 MiB per snapshot pair, 16 MiB aggregate snapshot bytes and 100,000 extracted characters per document. Decode in a disposable worker with a five-second per-document timeout. Show explicit partial-results warnings for catalog limits and unreadable/oversized bodies; title matches remain available for skipped bodies. Never rewrite snapshots, metadata or asset associations. Verify supported/excluded text, limits, corruption, freshness, combined filters, stable-ID navigation, failed-save retry, offline/restart and unchanged persisted data through focused frontend/native checks. Workspace format 1/schema 2 remain unchanged. Full regression/release/installer builds wait for milestone closure; Jot workflow confirmation follows this slice.

### Fifth bounded slice: in-app Jot capture

Implemented and verified on 28 October 2026 under the acceptance defined below before implementation; included in the full milestone closure.

User confirmed workflow on 28 October 2026: choose an existing live destination document, append text, and retry failed saves. A modal capture form accepts 1–10,000 characters of plain text, defaults to the current document and explicitly displays the destination. Submitting flushes earlier edits, rechecks the destination ID, opens it through normal history navigation, and appends a native note/paragraph at the end of the document (beside existing notes on Canvas). No separate inbox, global shortcut, background capture service or second canvas engine.

Acceptance: a successful capture is committed through the existing SaveCoordinator, visible in Page/Canvas, searchable, undoable and durable across restart/backup. Failure retains the submitted text/destination and stable capture block ID, locks further draft changes and offers retry without duplicate insertion. Before submission a draft is session-only and closing explicitly discards it. Verify destination choice, Unicode/newlines, empty/oversized rejection, real save failure/retry, undo, navigation, offline use, restart, backup and preservation of existing content/references/attachments. No Rust/schema/workspace-format change or Yjs conversion. Full milestone regression and release/installer rebuilding remain separate closure work.
