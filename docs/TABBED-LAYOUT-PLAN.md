# Tabbed layout plan

Replace the fixed main view, the two supporting columns and the app header with one column model. Every surface is a tab. A notebook has one Canvas tab and any number of Note tabs. Columns can be expanded, and the others collapse to rails. Each notebook keeps its own layout. Design boards: the "Knot Tabbed Layout" canvas (boards 01–09).

## Decisions to lock before starting

These come from the design review. The plan assumes the recommended answer.

| Question | Recommendation |
| --- | --- |
| Page view | Removed. Knot's Page view already shows one note (`showView("page", noteId)` in `adapter.ts`), so it becomes a Note tab. |
| Page view with no note selected | Open the notebook's first page note. Drop the "every page note in order" fallback. |
| Undo across views | Keep one history per notebook for v1. That's how it works today. Revisit only if it confuses people. |
| Column limit | 3 content columns plus the sidebar. |
| Browser in two notebooks | Allowed. Both show the one shared webview. The tab tooltip says it's shared. |
| Library, Home, Trash, Settings | Stay full-area screens over the layout, not tabs. |
| Layout storage | Stays in `localStorage` (no `CURRENT_SCHEMA` change). Moving it to the workspace database is a separate, later decision. |

## What exists today

- `src/app/workspace-layout.ts`: `WorkspaceLayout` v1, `layoutReducer`, `projectLayout`. Groups are supporting columns only (max 2). The main editor sits outside them.
- `src/app/useNotebookLayout.ts`: one layout per notebook under `notebookLayoutKey(workspace, notebook)` in `localStorage`. It already drops tabs from other notebooks.
- `src/app/WorkspacePanes.tsx`: renders every tab of every group as a flat, absolutely positioned `<section>` and only toggles `hidden`. **Every open note tab keeps a live editor today.** Moving a tab never remounts it, which is the pattern the canvas needs too.
- `src/features/editor/blocksuite/note-page-view.ts`: `createNotePageView` mounts a second `AffineEditorContainer` on the session's doc and shows one note. Note tabs use it through `NotePagePane.tsx`.
- `src/app/App.tsx`: the `topbar` header (around line 3075). It holds the sidebar toggle, back/forward, title, favorite, save status, the Page/Canvas switch, `ColumnVisibilityToggle`, undo/redo and the "Document actions" `ShellMenu`. It also owns `aiPlacement` (`page | panel | hidden`, stored in `knot.ai.placement.v1:<workspace>`), `browserExpanded`, `surface` and the page/edgeless `mode`.
- `src-tauri/src/browser.rs`: one native child webview (`LABEL`). It's positioned through `browserApi.bounds`, and `WorkspacePanes` already hides it during pane gestures.

## 1. Layout model v2 (pure logic)

Files: `workspace-layout.ts`, `useNotebookLayout.ts`, `tests/workspace-layout.test.ts`, `tests/notebook-layout.test.ts`.

1. Add `canvas` to `PaneKind` and remove the supporting/main distinction (`supportingKinds`).
2. Define `WorkspaceLayout` v2: `version: 2`, `tabs`, `groups` (max 3), each group's `ratio` instead of `preferredWidth`, `expandedGroupId`, `lastUsedGroupId`, plus a per-tab `view` record for saved positions (filled in step 7). Drop `hidden`.
3. Add one `tabPolicy` table so the rules live in one place: `max` (`1` or `many`), `scope` (notebook or shared), `idle` (`alive`, `sleep`, `unmount`), `minWidth`.
   - canvas: 1, alive, 360
   - note: many, sleep, 360
   - pdf, video: many, sleep
   - browser: 1, alive (shared webview)
   - ask, cardDeck: 1, alive
   - links, backlinks: 1, unmount
4. Reducer rules:
   - `open` focuses an existing tab with the same identity, or the single instance of a `max: 1` kind. If that tab is in a rail or behind an expanded column, its column comes back.
   - Opening while a column is expanded opens into the expanded column.
   - `split` is refused at 3 columns; the tab joins the column it was dropped beside.
   - Closing the last tab of a column removes the column and gives its share to its neighbours. Closing an expanded column also restores the others.
   - New `expand` and `restore` actions, and `closeColumn`.
5. `projectLayout` turns columns that don't fit into rails (40px) instead of hiding them. The last-used column always stays full width. The sidebar becomes a rail before any content column does.
6. `migrateV1(layout, { mode, focusedNote, aiPlacement })`:
   - Canvas mode becomes the Canvas tab first in the leftmost column.
   - Page mode with a focused note becomes the Canvas tab plus that note's tab.
   - `aiPlacement: "page"` becomes an Ask tab with its column expanded. `"hidden"` means no Ask tab.
   - Read `knot.ai.placement.v1` once during migration, then stop using it.
7. Tests cover policies, rail projection at several window widths, expand/restore round trips and migration from v1 fixtures.

## 2. Editor budget (sleeping tabs)

This can land before the canvas moves, because it fixes the existing cost of many note tabs.

Files: `WorkspacePanes.tsx`, `NotePagePane.tsx`, `note-page-view.ts`, `PdfReader.tsx`, `VideoReader.tsx`, `tests/pane-performance.browser.mjs`, `tests/page-note-performance.browser.mjs`.

1. Work out each tab's state from the layout:
   - **live**: the active tab of a visible column.
   - **warm**: the tab you just left, kept loaded for about 30 seconds.
   - **asleep**: everything else, including tabs in rails or next to an expanded column.

   Pass the state to `render(tab, state)`.
2. `NotePagePane` disposes its view when asleep. Before disposing it:
   - finish any IME composition,
   - save scroll position and selection to a per-tab state map,
   - restore them when the tab mounts again.
3. Show a lightweight placeholder (title plus skeleton lines) while the view mounts. Add HTML snapshots only if measured switch time is still noticeable. Throw a snapshot away whenever the note changes.
4. Some tabs must stay live even when hidden:
   - a note that has an Ask Knot proposal preview attached (`AiProposalPreview`, `observeAiToolbar`),
   - a note with an IME composition in progress.
5. PDF and video sleep, keeping their page, zoom and playback time.
6. Extend `pane-performance.browser.mjs` with 6 note tabs open. Record heap and tab-switch time before and after in `docs/EDITOR-PERFORMANCE.md`.

## 3. Canvas becomes a tab, Page view goes away

This is the riskiest step. Prototype the host move first.

Files: `App.tsx`, `WorkspacePanes.tsx`, `adapter.ts`, `note-page-view.ts`, `view-transition.css`, the `tests/canvas-*.browser.mjs` tests, `tests/search-reveal.browser.mjs`, `tests/citation-reveal.browser.mjs`, `tests/navigation.test.ts`.

1. Render the session's `AffineEditorContainer` host inside `WorkspacePanes` as one more flat positioned section, keyed by notebook. Moving the Canvas tab between columns then changes only `left` and `width`. Confirm in a prototype that BlockSuite survives resizing and re-parenting without remounting, and that the canvas viewport is kept.
2. Separate the session's lifetime from whether the canvas is visible. Closing the Canvas tab hides the host. Saving, undo and Ask context keep working.
3. Remove page mode from the main editor. Route every `showView("page")` and `focusedNote` caller to "open or focus the note's tab":
   - the mode switch and `pageModeButton` (Ctrl+Enter),
   - `focusNotebookNote`,
   - opening a note from the sidebar, search, Favorites and Backlinks,
   - startup with "Open notes in: Page",
   - transition overlays.
4. Add `reveal(query)` and `focusBlock(id)` to the note view, so `revealSearchMatch`, PDF citations and backlinks can target a note tab instead of the main editor.
5. Ctrl+Enter behaviour:
   - one note card selected: open or focus that note's tab, beside the canvas.
   - nothing selected: focus the last Note tab.
   - several cards selected: open the first.
   - a non-note element: do nothing and show a hint.
6. Handle deleted notes. When a note is deleted, its tab shows "This note was deleted" with Undo. Undo restores the tab. Tabs whose note is gone are dropped quietly when a layout loads.
7. Once nothing calls it, delete the main-editor page path in `adapter.ts` (`showView` page branch, `revealedNoteId`, `emptyRevealedParagraph`).

## 4. Expand, rails and the end of Ask Knot's page mode

Files: `WorkspacePanes.tsx`, `App.tsx`, `AskKnot.tsx`, `BrowserPanel.tsx`, `src/styles/app.css`, `tests/ai-placement.browser.mjs` (rewrite), `tests/workspace-panes.browser.mjs`, `tests/pane-tab-drop.browser.mjs`.

1. Add an Expand button to every column's tab row. Ctrl+Shift+Enter toggles expand. Esc restores, but only if no editor popup or dialog uses Esc first.
2. Build the rail component:
   - one icon button per tab, with the tab's `ShellIcon`,
   - a vertical label,
   - clicking an icon restores the column with that tab active,
   - a tab dropped on a rail opens there and ends the expand.
3. Replace `browserExpanded` and the `expanded` prop with the general expand. Remove `aiPlacement`, `aiPageHost` and the AI settings choice for placement.
4. Browser webview:
   - Hide it whenever its tab is asleep, in a rail, next to an expanded column, or under a global screen.
   - Keep a registry of open dropdowns. While any open `ShellMenu`, `ChoicePopover` or `knot-dropdown` overlaps the webview's bounds, hide the webview the same way `beginGesture` does.
   - Prototype this early; it's the main risk in this step.
5. When a column collapses with keyboard focus inside it, move focus to the expanded column's active tab.

## 5. Remove the header

Files: `App.tsx`, `SidebarFrame.tsx`, `src/styles/sidebar.css`, a new `NotebookPill.tsx`, `Notice.tsx`, `LibraryPage.tsx`, `LibraryCardDeck.tsx`, `NoteCrumb.tsx`, `docs/ACTION-INVENTORY.md`, `tests/dropdowns.browser.mjs`.

1. **Sidebar top row:** sidebar toggle, back, forward and search. When the sidebar is collapsed, they move onto its rail.
2. **Notebook pill:** pinned first in the first visible tab row and can't be dragged. Its `ShellMenu` contains:
   - Rename (F2)
   - Add to Favorites
   - Save now, showing the save state
   - Attach file, Links, Backlinks
   - Export, Share as file
   - Reset quiz progress
   - Move to Trash

   The pill shows a save dot. A failed save turns the dot red and shows a `Notice` toast with Retry. The pill moves when the leftmost column is a rail.
3. **"+" in each tab row:** a `ShellMenu` that opens a tab of any kind. Single-instance kinds that are already open show "Open" and focus the existing tab. This replaces "Open tools".
4. **Tab tools:** a slot at the right of each tab row for the active tab. v1 has undo/redo for the Canvas and Note tabs. PDF zoom can move here later.
5. **In-content headers:**
   - The Library breadcrumb and the Card Deck library controls (`#library-card-chrome`) move into those screens.
   - `NoteCrumb` moves to the top of the note tab's content.
6. Delete the `topbar`, `ColumnVisibilityToggle`, the mode switch and their CSS.
7. Follow `AGENTS.md`:
   - `ShellIcon` `notebook` for the pill, `note` for note tabs,
   - the shared sparkle icon for the Ask tab,
   - the `dropdowns.css` tokens for every menu.
8. Update `docs/ACTION-INVENTORY.md` with the new location of each action.

## 6. Sidebar on the left or right

Files: UI preferences (`tests/ui-preferences.test.ts`), `SidebarFrame.tsx`, `sidebar.css`, `tests/sidebar-drag.test.ts`.

- Add a `sidebarSide: "left" | "right"` preference in General settings, using a native `<select>`.
- Flip the order with CSS `order`. Mirror the sidebar's top row so its toggle stays on the outer edge. Rails and the sidebar resize handle mirror too.
- This step is independent of steps 3–4 once step 5 has moved the toggle.

## 7. Per-notebook positions and navigation

Files: `useNotebookLayout.ts`, `workspace-layout.ts`, `App.tsx` history code, `tests/notebook-layout.browser.mjs`, `tests/library-history.browser.mjs`.

1. Save each tab's position in its `view` record:
   - canvas viewport,
   - note scroll position,
   - PDF page and zoom,
   - video time.

   Restore them when the tab wakes or the layout loads.
2. Lifecycle of saved layouts:
   - A new notebook opens with only its Canvas tab.
   - Imported and duplicated notebooks start with the default layout.
   - Moving a notebook to Trash keeps its layout. Permanent deletion removes the `localStorage` key.
3. Links to a note in another notebook switch to that notebook's layout and focus the note. History entries record `(notebook, tabId)`. Back/Forward only moves focus; it never opens or closes tabs.
4. With "Reopen last notebook", only live tabs mount at startup. Check with `tests/library-startup.browser.mjs` and the canvas startup test.

## 8. Verify and deliver

- Run the rewritten and extended browser tests listed above, plus:
  - `notebook-layout.browser.mjs`
  - `pane-drop-preview.browser.mjs`
  - `ask-continuity.browser.mjs` (the Ask continuation across notebooks must survive)
  - `references-panel.browser.mjs`
  - `floating-toc.browser.mjs`
  - `mcq-note-menu.browser.mjs`
  - the native checks in `tests/native/`
- Check manually:
  - light and dark themes,
  - keyboard only (Ctrl+W, Ctrl+Tab, Ctrl+1–3, expand and Esc),
  - window widths from 1024px to an ultrawide,
  - dropdown viewport bounds next to the browser webview,
  - a save failure while switching notebooks.
- Each step that ships follows `AGENTS.md`:
  - run `pnpm checks`,
  - add a line to `docs/releases/UNRELEASED.md`,
  - commit, then run `pnpm update:running`.
- The saved layout format stays local, so no release is forced. Suggest a release once steps 3–5 land, because the header and Page view changes are large and visible.

## Order and risk

| Step | Depends on | Risk |
| --- | --- | --- |
| 1 Model v2 | — | Low; pure and unit-tested. |
| 2 Sleeping tabs | 1 (state from projection) | Medium; IME, selection and AI previews. |
| 3 Canvas as a tab | 1, 2 | **High**; prototype moving the host without a remount first. |
| 4 Expand and rails | 1, 3 | Medium; **browser webview under menus** needs a prototype. |
| 5 Remove the header | 3, 4 | Medium; many small moves, mostly in `App.tsx`. |
| 6 Sidebar side | 5 | Low. |
| 7 Positions and navigation | 3 | Low to medium. |

Work on a branch of its own, because steps 3–5 change most of `App.tsx`. Prototype the two high-risk items before writing step 1 in full: moving the canvas host without a remount, and hiding the webview under dropdowns. If either fails, the design needs adjusting before anything is built on it.

## Prototype results — 15 November 2026

Both risks are retired. Scripts are in `tests/prototypes/`.

### Moving the canvas host (`canvas-host-move.browser.mjs`)

Setup: the real `openEditor` session in headless Edge against the Vite dev server. The editor sat in an absolutely positioned section, and only `left`, `width` and `hidden` changed.

| Change | Same editor, no disconnect | Viewport (zoom, center) | Card drawn where BlockSuite expects | Click selects the card |
| --- | --- | --- | --- | --- |
| Move to the right column (left 0 → 700) | yes | kept (1, 150,60) | yes | yes |
| Narrow (700 → 400) | yes | kept | yes | yes |
| Expand to full width (1400) | yes | kept | yes | yes |
| `hidden`, then shown | yes | **lost**: center jumped to −32,−32 (size was 0×0 while hidden) | yes | yes |
| Fix A: `visibility: hidden` + `inert` | yes | kept | yes | — |
| Fix B: `hidden`, saving the viewport before and restoring it after | yes | kept | yes | yes |
| Re-parent the host into another element | instance kept, but viewport size 0×0; an earlier run threw many BlockSuite errors | broken | — | — |

Model edits after all the moves worked, and there were no page errors before the re-parent step.

What this means for step 3:
- Position the canvas like other tabs, as a flat section. **Never move it to another parent.**
- When the Canvas tab is hidden (closed, in a rail, or next to an expanded column), save the viewport and restore it after showing. Keep `display: none` so a hidden canvas costs no painting. Add this to `canvasViewport` in `adapter.ts`.

### Hiding the browser under menus (`browser-menu-overlap.native.mjs`)

`BrowserPanel` already hid the native page whenever *any* menu or dialog was open, anywhere on screen. With menus in every column, the browser would blank whenever any menu opened. The prototype changed it to hide for menus and popovers only when their box overlaps the page. Dialogs, native `<select>` pickers, search and banners still always hide it.

Measured in the native debug build (`KNOT_TEST_DATA_DIR`, disposable workspace):

| Case | Result |
| --- | --- |
| Menu over the sidebar | page stays visible, no flicker |
| Menu moved over the page | hidden in 28 ms, stays hidden |
| Menu closed | shown again in 29 ms |
| Menu overlapping the page edge by 4px | hidden in 31 ms |
| Real "Document actions" menu (overlaps) | hidden; shown 18 ms after Esc |
| Modal dialog anywhere | hidden in 23 ms, shown 44 ms after closing |

Closed `ShellMenu`s keep their content laid out, so the check must match `.shell-menu[open] .shell-menu-content`, not `.knot-dropdown`. The first attempt matched closed menus and kept the page hidden. `tests/dropdowns.browser.mjs` still passes.

The `BrowserPanel.tsx` change works on its own today and could ship before the layout work.
