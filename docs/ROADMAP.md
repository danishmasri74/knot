# Roadmap

Current scope update — 30 October 2026: Jot capture has been removed at the user’s request, including its UI, adapter API, validation, styles and dedicated tests. Existing captured notes remain ordinary editable document blocks. References to Jot below are historical implementation/verification records, not current functionality.

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

These are explicit follow-up scope, not unfinished Milestone 3 acceptance criteria. Milestone 4 subsequently completed under the bounded scope below.

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

## Milestone 5 — complete: cohesive workspace and UI/UX refinement

Documented on 28 October 2026 before implementation. Research and the user's Knot/Heptabase screenshots establish the direction. All four bounded slices are implemented and verified below. Completed on 29 October 2026 after the native 100%/150% scaling audit, final consistency regressions and release/NSIS builds passed. Milestones 1–4 remain complete.

### Problem and intended experience

Knot currently gives navigation, document actions, organization and maintenance similar visual priority. In the supplied screenshots, Trash and organization panels push the actual page/canvas roughly halfway down the window; the sidebar scrolls even with one document; and a large illustrated drawing toolbar competes with the board.

The intended experience is a quiet, consistent frame around the user's content: compact navigation on the left, one slim document header, an expansive center, and contextual tools on the right. Keep Knot's green identity through restrained accents and selected states. Preserve existing capabilities while changing where and when their controls appear.

### Workspace layout and action placement

| Surface | Responsibility |
| --- | --- |
| Left navigation | Compact workspace switcher, search, new note/whiteboard, Jot access, library/whiteboard navigation and current-document indication. |
| Main header | Back/Forward, document title/location, compact Page/Canvas switch, save status, relevant panel toggles and document overflow menu. |
| Main content | Page editor, canvas or library view, directly below the header. No stacked maintenance or metadata forms above the editor. |
| Contextual right panel | Document properties/folder/tags, backlinks, references, PDF highlights/reader and supported Office preview. Show the requested context with a clear title and close control. |
| Library view | Search results, folder/tag filtering, collection browsing and folder/tag management. |
| Workspace menu and dedicated management surface | Switch/open/relocate workspace, managed and external backups, Trash, integrity checks and quarantine. Recovery remains reachable when a workspace cannot open. |
| Canvas tools and object menus | Compact creation/navigation tools; selection-specific formatting and advanced object actions. |
| Document overflow / insertion controls | Export, rename, soft-delete, attachments and less frequent document operations, with clear labels. |

A full reference/PDF/Office reader may use a wider panel or dedicated reader surface when necessary for legibility. It must preserve an explicit route back to the originating document. Do not force complex maintenance workflows into narrow inspectors.

### Completion criteria

- All four slices below meet their acceptance criteria. Record implementation and evidence per slice rather than marking the entire redesign complete after shell styling.
- Existing Milestone 1–4 capabilities remain discoverable and functional. Maintain an action inventory mapping each old entry point to its new location; no feature may disappear merely because its old button is removed.
- The default Page and Canvas views have one compact header and immediately available content. Metadata and maintenance are absent from the default editing flow.
- A shared visual system governs navigation, menus, panels, dialogs, typography, spacing, icons, borders, focus, selection and status/error states.
- Save-before-navigation, retry, stable document/attachment identities, shared references, undo/redo, offline use and backup preservation retain their existing guarantees and documented limits.
- Closure requires TypeScript, ESLint, frontend/Rust tests, Clippy, relevant native acceptance and existing regression suites, production/debug/release/NSIS builds, plus recorded native visual and keyboard checks in VERIFICATION.md. Update README instructions to match implemented navigation.

### First bounded slice: workspace shell and navigation

Status: implemented and verified on 29 October 2026. Compact sidebar, independent library scrolling, sidebar collapse/expand, one 56-pixel header, shared shell tokens and line icons, and labeled document/workspace/library disclosures are in place. Properties are opt-in; the default editor starts directly beneath the header. Existing tool surfaces remain for slice two.

The [action inventory](ACTION-INVENTORY.md) maps every relocated entry point. Native acceptance covers Page/Canvas at 1280×720 and 1920×1080, long titles, empty and scrolling libraries, create/open/rename/soft-delete, Jot, Back/Forward, and real SQLite save failure/navigation/retry. Existing native workflow regressions also pass. See VERIFICATION.md for evidence, build details and remaining limits; this does not close Milestone 5.

Replace the oversized branding and stacked navigation controls with a compact sidebar and single main header. Establish shared visual tokens for typography, spacing, neutral surfaces, green accents, borders, radii and icon sizing. Use a consistent line-icon family, with labels/tooltips and accessible names. Provide sidebar collapse/expand and separate scrolling for a long document list; workspace actions must not be pushed offscreen by that list.

Acceptance: create/open/rename/soft-delete notes and whiteboards, use Jot, switch Page/Canvas, and navigate Back/Forward through the new shell. Preserve save status and visible failure/retry controls. Verify an empty library, a long library, long titles and failed-save navigation. At 1280×720 and 1920×1080, the default editor begins directly beneath one header without shell overflow or maintenance content above it. Start the old-to-new action inventory before removing existing entry points.

### Second bounded slice: contextual panels and management surfaces

Status: implemented and verified on 29 October 2026. Document tools use one resizable right panel; search/filtering and folder/tag management live in the library surface. Workspace tools use dedicated management views below the header. Tool transitions clear inactive reports, document/workspace navigation clears context, and Close/Escape returns focus to the invoker. PDF pages fit panel width while retaining highlight retry identity during resizing.

The completed [action inventory](ACTION-INVENTORY.md) records every entry point. See VERIFICATION.md for native workflow coverage, corrected regression assumptions, screenshots and remaining limits. Release/installer rebuilding and the full display-scaling/accessibility audit remain slice four work.

Move document organization, backlinks, reference selection and document-specific readers/previews into contextual surfaces. Move library filters/search and organization management into the library workflow. Group workspace maintenance behind the workspace menu, with dedicated management views or dialogs. Keep one active primary right-panel tool at a time, allow closing/resizing it within usable bounds, and prevent stale document/workspace context when switching tools or destinations.

Acceptance: reach and complete every relocated workflow, including filtered title/body search, tag/folder assignment and management, reference insertion, PDF highlight creation/source reopening, supported Office preview, export, Trash restore, backup verification/restore, workspace switching/relocation and integrity/quarantine recovery. Retain existing bounded formats, search freshness, confirmation and error semantics. Closing a panel returns focus to its invoker; transitions preserve pending edits and honor save-failure gating. Jot's submitted failed-save draft must retain its existing retry protection. Startup recovery must work without an active editor. Complete the action inventory and verify missing, unsupported, empty, loading and retry states.

### Third bounded slice: page editor and whiteboard refinement

Status: implemented and verified on 29 October 2026. Page uses a bounded reading column and consistent typography. Canvas retains its native card typography and user styling on a neutral background; a compact 44-pixel native toolbar replaces the large illustrations with labeled controls. Native option menus, responsive paging and selection actions remain available. Creation, paging and zoom controls support keyboard focus and activation.

Installed BlockSuite extension points and the isolated version-specific presentation bridge are documented in [EDITOR-PRESENTATION.md](EDITOR-PRESENTATION.md). Native acceptance uses visible pointer/keyboard interactions for formatting, slash insertion, attachments, note/text/shape/freehand/connector creation, movement, zoom/fit, undo/redo and shared-source navigation. Panel/sidebar changes retain canvas center, zoom, identity and content. See VERIFICATION.md for evidence and bounds. No body conversion, schema change or new canvas engine; full accessibility/scaling audit and release builds remain slice four.

Give Page a comfortable reading width, consistent heading/body typography and unobtrusive editing controls. Give Canvas a neutral background, readable cards, restrained borders/shadows and compact tools. Remove the oversized illustrated toolbar presentation. Keep color primarily available for user content, selected objects and meaningful status. Advanced object actions belong in contextual menus or selection tools.

Inspect the installed BlockSuite 0.19.5 extension points before choosing toolbar customization. Use supported configuration/extensions where possible; do not hide the native toolbar until equivalent required actions work. Any unavoidable version-specific integration must be isolated and documented. Retain the same editor, document model and canvas engine.

Acceptance: exercise text formatting, slash insertion, attachments, note cards, selection, text, shapes, freehand, connectors, movement, zoom/fit, undo/redo and shared-reference navigation through the visible UI. Preserve Page/Canvas identity and existing saved content without body conversion. Verify actual pointer interactions and keyboard access, not only programmatic model insertion. Inspect empty, populated and selected-object states, plus a board with a right panel open. Opening/closing panels or collapsing navigation must not reset content or unexpectedly jump the canvas viewport.

### Fourth bounded slice: consistency, accessibility and release verification

Status: implemented and verified on 29 October 2026. Shared contrast/focus styling, exclusive shell disclosures, protected Jot Escape/focus handling, a narrow-window tool view and one shared close action per tool are in place. Actual Windows 100%/150% scaling, final affected workflow regressions, release/NSIS builds and the release keyboard/layout smoke check passed. VERIFICATION.md records viewport sizes, screenshots, logs, artifact hashes and remaining limits.

Audit all migrated views together. Standardize control density, tooltip behavior, menu placement, panel headers, empty states, destructive-action wording and save/error feedback. Remove obsolete duplicate actions, decorative helper copy and inconsistent icon treatments. Keep full action labels in menus and tooltips so a cleaner shell does not depend on memorizing symbols.

Acceptance: keyboard users can reach navigation, menus, panels, dialogs and their close controls with visible focus. Escape dismisses the topmost dismissible surface without discarding protected edits; dialogs manage focus and restore it on close. Controls have accessible names; status and selection are not conveyed by color alone. Check text/control contrast and native Windows display scaling at 100% and 150%, with a usable narrower-window fallback that does not overlap the editor. Record tested viewport sizes and scaling rather than claiming universal responsiveness.

Capture and inspect before/after native screenshots for Page, Canvas, open inspector, library/search, PDF reader, Office preview, Jot, maintenance and startup recovery. Include populated, empty and error states. Run closure checks, record evidence and remaining limits in VERIFICATION.md, and rebuild release artifacts only after the final implementation passes.

### Scope boundaries

- This milestone refines existing workflows. It does not add Heptabase's AI chat, Journal, Inbox, collaboration, cloud services, tag databases, browser tabs or media-transcription features.
- Retain single-level folders, current shared-note semantics, supported preview/export formats and search bounds. Existing Milestone 3 deferrals remain deferred.
- No planned database/workspace-format change, Yjs body conversion, editor replacement or second canvas engine. UI preferences may be stored separately from document content if needed.
- Native desktop refinement is the target. Mobile layouts, a new dark theme and unrelated performance/storage projects are outside closure scope.
- Heptabase supplies interaction/layout references, not assets to copy. Its screenshots span different versions; do not treat every pictured control as a current requirement for Knot.

### Research basis

Reviewed on 28 October 2026: official documentation plus the user's two Knot and five Heptabase screenshots. Documentation research is not a hands-on audit of every authenticated Heptabase screen. Key observations: stable navigation, content immediately beneath a slim header, contextual supporting panels, compact tools, neutral canvas surfaces and object-specific menus.

- [Heptabase getting started](https://wiki.heptabase.com/getting-started-with-heptabase)
- [Interface logic and main views](https://wiki.heptabase.com/user-interface-logic)
- [Cards and whiteboard interactions](https://wiki.heptabase.com/fundamental-elements)
- [PDF and media workflows](https://wiki.heptabase.com/pdf-annotation)
- [Database views and filters](https://support.heptabase.com/en/articles/16627169-tag-database-views-and-filters)
- [Trash entry points](https://support.heptabase.com/en/articles/10447264-restore-items-from-trash)
- [Backup settings](https://support.heptabase.com/en/articles/11064116-how-does-auto-backup-work-in-heptabase)
