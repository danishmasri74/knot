# Knot

A Windows-first, offline knowledge workspace built with Tauri 2, React, TypeScript, and BlockSuite. SQLite and local attachment files are authoritative; there are no accounts, telemetry, cloud services, or IndexedDB persistence providers.

Milestones 1–5 are complete under the acceptance scope in [the roadmap](docs/ROADMAP.md). Milestone 5 adds a compact workspace shell, contextual panels, dedicated library/workspace management surfaces, a comfortable Page reading column and the default BlockSuite Canvas toolbar. The final accessibility/consistency audit, actual Windows 100%/150% scaling checks and release/NSIS rebuild passed. The current release includes recovery, backup management, workspace relocation, exports, guarded orphan cleanup, PDF reader with highlight cards, backlinks, body search; see [verification](docs/VERIFICATION.md) for tested coverage and deferred work.

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

After local changes, run `pnpm update:running` to rebuild the release and installer,
close the installed app through its normal save-flush handler, update the executable
under `%LOCALAPPDATA%/Knot`, verify its hash, and relaunch it. The previous executable
is retained as `knot.exe.previous`. If pending operations or save errors prevent
closing, the update stops without forcing the app to quit.

## Using Knot

Create a notebook with **New notebook…**, then use **Add note** to add notes inside it. Collapse or expand the sidebar from the main header. Drag its right edge to resize between 200 and 400 px; the width is remembered. Focus the edge and use arrow keys (or Home/End) to resize with the keyboard, or double-click it to collapse. Sidebar and notebook disclosures animate smoothly, with reduced-motion preferences respected. The library scrolls independently of workspace actions. Rename through the header title; open **Document actions** for a compact list of Attach, Reference, Backlinks, PDF reader and Export. Subtle separators group related actions. Use arrow keys, Home/End and Escape to navigate or dismiss the menu. Undo, Redo and Delete are visible toolbar icons. Page and Canvas are two views of the same content. Use BlockSuite's slash menu, formatting controls, drawing toolbar, shapes, and connectors. Canvas uses BlockSuite’s default illustrated toolbar, including its note, pen, eraser, shape, text/mind-map and template controls. Narrow editors page tools with the toolbar arrows. Zoom and Fit are at bottom left, behind the ellipsis in narrower editors. Select a shared card and choose **Open → Open this doc** to edit its source. Attach imports images and PDFs by copying; originals remain untouched. PDFs up to 10 MiB use BlockSuite's inline PDF embed. The current import limit is 100 MiB per file.

Drag files from Explorer directly onto Page or Canvas, or select multiple files with **Document actions → Attach**. Images (including GIFs) display inline, PDFs up to 10 MiB embed in Page, and other files appear as attachment cards. Canvas uses PDF attachment cards; switching to Embed shows a proportional first-page preview with an Open PDF reader link. Canvas drops place files at the drop location. Files are copied into the workspace with a 100 MiB limit per file; originals stay untouched. A bad file reports an error without stopping other files in the batch.

Use the Back and Forward buttons beside the document title to revisit documents opened in this session. Pending edits save before navigation; a failed save keeps you on the current document. History resets when opening a restored workspace or restarting Knot.

Collections optionally group notebooks without another page or sidebar. Click **+** beside **Library** to create an empty collection in a compact popover. Open a notebook's **⋯** menu (or right-click its row), type a name into **Find or create**, and press Enter to create a collection and add the notebook. Check existing collections to add the same notebook to several groups. Each collection is a minimal accordion in the Library: expand it to see its notebooks, then expand a notebook to reach its notes and whiteboard. Collections expand independently; a notebook belonging to several appears in each. Uncollected notebooks remain directly accessible below. A collection’s **⋯** menu contains only Rename collection and Delete collection. **Add note** inserts a note into the active notebook. **New notebook…** opens a compact naming popover and creates an uncollected notebook with a blank note. Use the header’s Page / Canvas toggle to access its whiteboard. Removing membership or deleting a collection never deletes notebooks. Ctrl+K searches the entire workspace. Existing populated folders and tags migrate to collections, merging equal names and retaining memberships for notebooks in Trash; empty groups disappear. A verified pre-migration backup is retained before the old schema is removed.

Edits save automatically after roughly 600 ms. **Saved** means the snapshot has committed to SQLite. Ctrl+S retries/flushes saves; switching documents and normal window closing flush pending edits. If a save fails, keep the window open and retry. Sudden process termination may lose changes that have not reached Saved.

The sidebar **Settings** entry opens General, Backups, Workspace health and File recovery. **Trash** stays directly accessible in the sidebar. General explains each tool; Backups groups managed archives with external backup and restore actions. The workspace name / **Switch workspace** button opens the workspace picker, including when startup fails.

**Trash & recovery** searches and restores deleted documents with their original identities, content and surviving organization assignments. Shared references resolve again after restoration. Use **Delete permanently** for one document or **Empty Trash** for all deleted documents, including those hidden by search. Both require confirmation and cannot be undone. Items are also permanently deleted automatically after 30 days in Trash. Knot checks on startup, when opening Trash, and every minute while running; overdue items in the active workspace are cleared when Knot is reopened. Existing backups remain unchanged; unused attachment files can be cleaned up through **Settings → File recovery**.

**Manage backups** creates, lists, verifies, restores and deletes local `.knot` archives. **Back up workspace** and **Restore backup** use native file dialogs for external archives. Restore validates and opens a separate workspace; your previous workspace is retained. **Switch workspace** reopens managed or external workspaces. Relocation opens a validated copy while retaining the source.

**Export** shares supported Page content as Markdown (with attachments bundled when needed), or the current Page/Canvas view as PNG or a single-image PDF. Exports are not lossless backups; linked documents remain workspace references and PDF text is not selectable.

**Settings → Workspace health** shows a compact status summary, with the full technical report collapsed below. It reports database/relationship, attachment and basic document/reference issues without changing stored content. It offers recovery for eligible referenced Trash documents and missing attachments with exact local copies. **Settings → File recovery → Set aside** moves selected unindexed files into retained recovery copies; individual copies can be restored or explicitly permanently deleted after revalidation. Quarantine, unindexed files and pre-migration recovery archives are excluded from ordinary backups and relocation. Quarantine alone does not free disk space.

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

## Visual identity

Knot uses the Linked K identity in charcoal and warm white. The sidebar uses the standalone vector mark, while the Windows executable, installer, shortcuts and favicon use the rounded-square app icon. See [identity guidelines](docs/IDENTITY.md) for sources, colors and regeneration steps. The installed-app updater also refreshes Knot shortcut icons.

PDF reader opens from **Document actions → PDF reader**, or **Open PDF reader** on a Canvas PDF. Read beside your notes with page controls, 50–150% zoom and **Fit width**. Drag the divider to resize the reading pane. Select text in the reader to review a passage and save it as a highlight card. Office preview has been removed; attached Office files remain stored in the workspace.

Favorite a notebook with the star beside its title. Favorites appear above collections in the library, expand independently, and are saved per workspace. Renames update the same notebook everywhere; trashed favorites disappear and return when restored. Toggling the star updates membership without reloading the sidebar.

## Getting Started

New workspaces open an editable thirteen-section tour. In an existing workspace, use **Settings → General → Add Getting Started**. The tour includes local images, a visible PDF preview, a playable YouTube embed (internet required), cropped screenshots, rich text, a kanban board, budget table, math, a mind map, a labeled flowchart, and a shared example project. **Open Getting Started** returns to your copy; **Create fresh copy** preserves your previous edits. See [tour maintenance](docs/GETTING-STARTED.md).

Lost on a whiteboard? **Find my content** stays at the top right of Canvas and fits the whole board into view, including notes, images, frames, and drawings. **Ctrl+Shift+Home** does the same outside text fields. This changes only the viewport; your content stays in place. The control is hidden in Page view and while a tool surface or search is open.
