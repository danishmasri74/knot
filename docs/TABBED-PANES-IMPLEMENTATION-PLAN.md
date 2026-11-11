# Tabbed panes and editable Page pane

Status: implemented on 6 November 2026; verification and installed-build results are recorded in docs/VERIFICATION.md.
Prepared: 6 November 2026.

## Notebook layout persistence follow-up (6 November 2026)

The later notebook-persistence request supersedes the original session-only scope below: supporting tabs, column membership/order, active tabs and widths now restore per workspace and notebook. Switching notebooks replaces pane views with the destination notebook's saved arrangement; empty layouts remain empty. Startup returns to the last available notebook. Content snapshots, editor objects, selections and browser history remain outside layout preferences. See `useNotebookLayout.ts` and the current architecture description.

## 1. Outcome and agreed direction

Knot should let someone edit a canvas note at normal Page-view size while keeping the canvas visible, then place a PDF beside that note when needed. Preserve the existing app identity and editor behavior. The design direction is Notion-like restraint: quiet surfaces, compact controls, clear content hierarchy, predictable interactions, and little persistent chrome. This describes the intended qualities, not a request to copy Notion's UI.

The default is **A: canvas plus one supporting pane with tabs**. Deliberately separating a tab produces **B: canvas plus two supporting columns**. These are states of the same layout system, not separate modes. A tab strip and a single-column header are the same component.

```text
No supporting content:
Library | Canvas

A:
Library | Canvas                  | [Chapter 2] [PDF] [Browser]
                                  | Editable Page content

B, after separating PDF to the left of the note:
Library | Canvas           | [PDF]          | [Chapter 2] [Browser]
                           | PDF reader     | Editable Page content
```

The existing Page/Canvas switch remains available for the main document. The new note-pane launch action appears ONLY in the selected canvas note's floating toolbar. Do not add it to the main header, document actions menu, sidebar, or canvas creation palette.

The user's request in the planning chat authorizes planning, not implementation. Start implementation when the user starts the follow-up task using this handoff. Do not treat generated images as executable requirements.

## 2. Baseline and references

Read `AGENTS.md` and inspect the current working tree again before implementing. The repository currently has extensive modified and untracked work. Preserve it; do not reset, clean, overwrite, or commit unrelated changes. Read the current files rather than assuming HEAD represents the running app.

Primary visual baseline: the existing installed app and the three original user screenshots. Reuse real components, theme variables, and Page-editor preferences. Generated concepts illustrate arrangement only; their reflowed canvas cards, typography differences, improvised PDF controls/content, and missing controls are not requirements.

Original screenshots, currently local:

- `C:/Users/Acer/AppData/Local/Temp/codex-clipboard-0ac38d79-798a-4862-b772-c6da23bf4f0b.png` — canvas and existing Card Deck pane.
- `C:/Users/Acer/AppData/Local/Temp/codex-clipboard-525fb18c-2eb7-404e-bd01-2606846f6468.png` — Page editor.
- `C:/Users/Acer/AppData/Local/Temp/codex-clipboard-d94d1f8c-0450-420c-87ea-08a9a0d96db3.png` — selected-note toolbar.

Generated visual references, optional if still available:

- A: `C:/Users/Acer/.codex/generated_images/01a1b003-eb4a-7390-82ed-cff44618009c/exec-a088c464-9e8d-4bb3-932c-afd342bbc06f.png`
- B: `C:/Users/Acer/.codex/generated_images/01a1b003-eb4a-7390-82ed-cff44618009c/exec-dffbc08e-ba56-4b73-88d0-6f1af59a80b9.png`
- C, NOT selected for this implementation: `C:/Users/Acer/.codex/generated_images/01a1b003-eb4a-7390-82ed-cff44618009c/exec-a551f4c2-bdda-4989-a3d4-0a87985409db.png`

Do not depend on temporary screenshots for runtime assets. If unavailable, inspect the actual app; all interaction requirements are written below.

## 3. First-release scope and explicit defaults

These are implementation defaults proposed during planning, rather than additional user-approved features. They keep the initial implementation bounded and should be stated in the implementation report.

- One main document view and at most TWO supporting pane groups: three content columns total. The sidebar is navigation, not a pane group.
- Horizontal columns only. Allow tab reorder, moving tabs between groups, swapping the two supporting groups, and merging them. No arbitrary docking trees, vertical stacks, detached windows, saved layout templates, or global workspace tab bar.
- Multiple note tabs from the active document, one PDF reader tab using the current reader's source-selection model, and one Browser tab using the existing native browser session. Do not silently introduce a multi-browser-session feature.
- Card Deck, Ask Knot, and Backlinks participate in the same supporting-tab system. Existing workflows must remain reachable and retain their semantics.
- Settings, editor/AI/workspace settings, backups, integrity, recovery, workspace selection, and Trash retain their existing management/modal/full-page presentation. Library and global search retain their existing navigation presentation. Reference selection and export remain transient tasks with explicit completion/cancel behavior, outside the persistent tab list.
- Parent-document navigation is a lifecycle boundary in v1. Flush before leaving; close document-bound note/PDF/Backlinks tabs when the parent changes. Do not imply cross-notebook note tabs survive when the current adapter destroys their collection. Workspace tools such as Browser and Card Deck may retain their existing workspace lifetime; audit their bindings when the main document changes. Ask Knot retains existing conversation rules but must not apply a stale suggestion to the new document.
- Switching only the main Page/Canvas mode does NOT change the parent document or close its tabs. The new action is shown on Canvas selections; a previously opened note pane can remain while the main view is Page.
- Persist only validated layout preferences such as widths. Keep open content tabs and pane membership in session memory for v1. Do not newly persist browsing URLs/history, selections, note text, or editor objects in layout storage. Restart restoration of open tabs is deferred.
- Keep the existing main header in a stable position across A and B. B's generated image removed it for exploration; that is not necessary for the transition and is not part of this implementation. No unrelated header redesign.

## 4. Detailed interaction contract

### Open and identify content

1. Select exactly one editable `affine:note` canvas block. Show a native toolbar button with the shared note/page icon and tooltip/accessible name **Open in side panel**. No action for shapes, attachments, multiple selection, or unsupported linked/embed objects. Locked notes must keep their current edit restrictions; do not bypass them through the pane.
2. Clicking opens a Page editor focused on that note block. It does not switch the main view, duplicate content, alter the note's saved display mode, or reposition/reflow canvas objects.
3. Deduplicate note tabs by workspace ID + owning document ID + note block ID, not by title. If already open, activate its existing group/tab and focus its editor. Clicking again never closes it.
4. Derive a note tab's label from its first useful heading/text, with `Untitled note` as fallback. Show the full label in the existing tooltip system. Do not create a new persisted note-title field or let editing a tab title accidentally rename its notebook/document.
5. New content opens as a tab in the last-used supporting group. With no supporting group, create one on the right. Reopening a singleton tool or already-open note activates it where it lives; it does not move or recreate it.
6. A tab becomes active on explicit activation, not by merely selecting another canvas card. Keep panel scroll and caret when focus moves between the canvas and a pane.
7. Existing header/sidebar tool launchers must use the same open-or-focus route. Audit current toggles: a launcher should not delete an inactive tab or close an entire group unexpectedly. Close belongs to the tab's close action.

### Switch, close, and return focus

- Activating another tab preserves the previous tab's durable state and unsaved editor changes. Inactive content is not keyboard-focusable or exposed as an active tabpanel to assistive technology.
- Close a tab with its close button or menu action **Close tab**. Closing UI content is never deleting a note, attachment, or browser history entry. No routine discard confirmation for saved/live note edits.
- After closing the active tab, activate the neighbor to the right, otherwise the one to the left. Closing the final tab removes its empty group; other content receives the space.
- For a tab close, return focus to the next tab or the surviving pane. If no supporting tabs remain, return to the original canvas invoker if it still exists, otherwise the main editor. Never focus a detached element.
- Escape first dismisses an open menu/popover or cancels a drag. Escape from ordinary note text must not close the editor. When focus is on a pane header/tab, Escape may close that active tab with the same behavior as its close action. Preserve special editor Escape behavior.
- Native toolbar insertion must preserve the selection while the button is clicked. Opening may focus the note editor at its remembered caret or beginning, but must not select all or mutate the content.

### A to B by drag or menu

1. Start dragging a tab from its label/grip after a modest movement threshold; a normal click remains activation. Close/menu buttons are excluded from the drag hit area.
2. Dropping within a tab strip reorders or groups. Hovering the left/right edge of a supporting pane previews a NEW supporting column, subject to available width and the two-group limit.
3. During drag show a quiet insertion marker or translucent rectangular drop preview. Do not move editors, resize columns, change active tabs, or write layout preferences until release.
4. On a valid drop commit one layout transaction. For PDF dropped to the left of the note, the order becomes main canvas | PDF | note. Keep the canvas permanently in the main slot.
5. On invalid drop, pointer cancellation, lost capture, or Escape, restore the exact starting layout and focus. Announce an unavailable split when useful; never silently squeeze panes below their minimums.
6. The tab menu provides **Show beside current tab** when a second group can be created. Place the source tab in a new group to the left of its former group. If it was active, activate a remaining neighboring tab in its old group. Disable this action when its source group has no remaining tab or the width cannot fit the split, with a short explanation.
7. Once two groups exist, offer **Move to left pane** or **Move to right pane** as appropriate; do not offer a third split. Group options can offer **Move pane left/right** and **Merge with left/right pane**. These explicit actions provide full alternatives to drag.
8. Dragging the sole tab in a group beside the other group moves/reorders that existing group; it must not create empty columns. Group merge preserves tab order and activates the moved tab the user was working with.

### B back to A

- Drop a tab onto the other group's tab strip. When its old group becomes empty, remove that group.
- Alternatively use **Move to left/right pane**, **Merge with left/right pane**, or close the now-unneeded tab.
- Preserve PDF page/position, note selection/scroll, browser navigation/session, Card Deck filters, and Ask Knot draft while rearranging. Focus follows the moved content once; background tools must not steal it.
- Capture and restore the main canvas viewport center and zoom around width changes using existing editor viewport APIs. Preserve every object's canvas coordinates and size. Canvas content must not reflow like a responsive document.

## 5. Visual specification

- Extend the current shell design. Use existing `--shell-*` tokens, light/dark behavior, sidebar, typography preferences, menus, tooltips, focus rings, and loading/error components. Do not hard-code the serif screenshot font: the user can choose sans, serif, mono, or custom text.
- Use `ShellIcon` everywhere in React. Native Lit toolbar integration must render the same shared semantic path rather than invent a different note symbol. If needed, extract a neutral shared icon definition consumed by React and Lit without copying path strings.
- Semantic icons: note = page, notebook = bound book, collection = folder. Workspace and backup settings must not use notebook icons.
- A supporting pane has ONE compact tab-strip header, then its content. Avoid a duplicated `Page`/`PDF reader` heading beneath it. Browser address controls and PDF-specific tools remain local content toolbars; remove redundant close/expand chrome where the common pane controls take ownership, while preserving useful capabilities.
- Start with approximately 36 px pane-header height, 28 px header-control hit boxes, and existing 4/8 px spacing rhythm. These are proposed starting values, not measured app constants; adjust to existing tokens and real text rendering during visual QA. Keep keyboard targets and touch/scale usability intact.
- Tabs show semantic icon + truncated content label + close control. Active state should be a subtle neutral background or fine border, not a large colored pill. Keep blue for selection, focus, and existing accents. Close controls may appear on hover/focus, but the active tab's close remains discoverable.
- Tab overflow stays on one line. Use scrollable tabs with a visible overflow affordance/menu and ensure the active tab scrolls into view. Do not wrap the header into multiple rows or shrink labels/icons indefinitely.
- One-pixel separators between panes; wider invisible drag hit areas for resizing. No ornamental card frames around the Page editor and no new permanent feature-icon rail.
- Page pane uses the actual Page editor's text/block formatting and settings. Reduce outer reading-column margins for available width, not text scale. Tables/code blocks use local horizontal overflow; they must not widen the application or compress every pane.
- Preserve the full-page title behavior only where it belongs. The note pane identifies its note in the tab/header and shows that note's content; it must not offer the parent notebook title as if it were this card's title.
- Use minimal motion: a short width settle after committing a split is optional; respect reduced-motion preferences. Do not animate live editor transforms or scale text. Avoid preview-triggered layout oscillation.
- Canvas creation palette remains the upstream toolbar. Constrain it to the main editor viewport and retain its existing responsive paging. Do not reproduce the simplified generated palette.

## 6. Width, narrow windows, and preference policy

Calculate available width from the actual main content container after the sidebar, not from the physical screen resolution. Use CSS pixels and verify real Windows scaling separately.

Starting minimums to validate: main editor 360 px; note/PDF pane 360 px; Browser and simpler tool panes 320 px. A group uses the highest minimum of its open tab kinds, so switching tabs does not unexpectedly resize neighbors. Two 360 px supporting groups plus a 360 px main editor and dividers require about 1082 px of content width, excluding sidebar. Do not claim three columns fit every laptop.

- Default one-pane preferred width: use existing PDF/Browser preferences where appropriate and a readable approximately 480 px note width, clamped to actual space. Preserve manually chosen group widths rather than jumping them on tab activation.
- Resize an interior divider by redistributing width between its adjacent groups; clamp to both minimums. Resize the main/supporting divider within the same constraints. Support the existing arrow-key resize pattern and meaningful separator ARIA values.
- When two supporting groups no longer fit after window resize, render them as one combined tab strip while retaining their underlying group membership and active-tab history. Prioritize the focused supporting tab. Widening can restore the prior two-column arrangement because the user already chose it.
- If the main editor plus one supporting pane cannot fit, use a deliberate single-content presentation with an explicit **Back to canvas** / **Back to page** action in the pane. Keep the editor session alive. Do not silently collapse the user's sidebar, lose tabs, overlap editors, or force horizontal window scrolling.
- Distinguish responsive presentation from user layout mutations. Closing or explicitly merging groups while in a narrow projection must operate on stable tab IDs and normalize the saved session layout predictably.
- Save a small versioned width-preference record defensively. Validate numbers, clamp stale values on restore, tolerate unavailable local storage, and namespace any document/workspace-specific preferences. No document schema migration should be needed for layout.

## 7. Code findings and implementation map

| Current area | Finding | Planned change |
| --- | --- | --- |
| `src/app/App.tsx` | A single `surface` selects tools and management views; `clearInactiveSurface` clears PDF/Backlinks; tool launchers call this directly. | Separate persistent supporting layout from transient/management surfaces; centralize all tool opening/closing. |
| `src/app/ToolSurface.tsx` | Owns one absolute-positioned panel, one width, focus return, Escape, and management modal rendering. | Extract reusable management shell; introduce workspace pane/group/tab components without nesting old panel headers. |
| `src/styles/app.css` | `--panel-width`, absolute positioning, `margin-right`, `:has(...)`, Browser overrides, floating overlays assume one right pane. | Use one measured flex/grid content layout; replace single-panel offsets and audit all overlays. Keep modal positioning independent. |
| `src/features/editor/blocksuite/adapter.ts` | `openEditor` owns collection, Yjs documents, persistence, one `AffineEditorContainer`, listeners and disposal. `showView` has a per-view selected-note filter. | Add a secondary Page-view host attached to the SAME loaded document/session, with independent view state and cleanup. |
| `src/features/editor/blocksuite/ai-toolbar.ts`, `pdf-toolbar.ts` | Existing native toolbar extension examples; some observers/portals query globally. | Follow native-control conventions; scope registrations/listeners by editor host and avoid duplicate portal handling. |
| `src/services/editor-preferences.ts` | Settings apply presentation independently of stored blocks. | Apply the same preferences to both main and note editor hosts. |
| `src/app/PdfReader.tsx` | Holds active source/page/selection/render state locally; App gives it a random key when opened. | Retain stable tab/controller identity; separate navigation-to-citation from creating/resetting the reader. |
| `src/app/BrowserPanel.tsx`, `src/services/browser.ts` | One native child WebView, serialized commands, physical-pixel bounds, visibility/overlay checks. | Make active/visible/drag/modal state explicit, preserve one session, and update bounds after layout changes. |
| `src/app/AskKnot.tsx` and App callbacks | AI context/suggestions tied to current session and editor; PDF Ask currently swaps `surface`. | Opening Ask adds/activates a tab without destroying the source; preserve context identity and target the originating editor/document. |
| `src/app/CardDeckPanel.tsx`, `BacklinksPanel.tsx` | Current tool bodies depend on active session and local state. | Host them with stable keys; preserve filters/position and refresh bindings at parent-document transitions. |
| `tests/native/panels.mjs` and editor/native suites | Assume one surface and often query the first editor globally. | Scope selectors to main/editor-pane identities; replace obsolete single-panel assertions with explicit invariants. |

Suggested new modules (names may adapt to repository conventions):

- `src/app/workspace-layout.ts`: pure layout types, reducer, normalization, width constraints, responsive projection.
- `src/app/useWorkspaceLayout.ts`: controller/open-or-focus routing, focus and session lifecycle coordination.
- `src/app/WorkspacePanes.tsx`, `PaneGroup.tsx`, `PaneTabs.tsx`, `PaneDivider.tsx`: reusable shell and interaction components.
- `src/app/pane-registry.tsx`: kinds, labels/icons, scope, minimum widths, factories, availability, disposal policies.
- `src/app/NotePagePane.tsx`: React host for an adapter-owned Page view; no second content model.
- `src/features/editor/blocksuite/note-pane-toolbar.ts`: selected-note action integration.
- Adapter-local view helper modules as necessary; BlockSuite internals remain behind that boundary.
- `tests/workspace-layout.test.ts`, `tests/workspace-panes.browser.mjs`, `tests/native/workspace-panes.mjs`: focused new coverage.

Do not add a general docking library by default. The bounded layout can use existing React and pointer events. If a dependency is needed, justify it against accessible interaction, maintainability, and editor-host lifetime rather than visual convenience.

## 8. State and ownership design

Keep metadata serializable and editor/PDF/native objects in runtime controllers, not in React reducer state or localStorage.

```ts
type PaneTab =
  | { id: string; kind: "note"; workspaceId: string; documentId: string; noteId: string }
  | { id: string; kind: "pdf"; workspaceId: string; documentId: string }
  | { id: string; kind: "browser" | "cardDeck"; workspaceId: string }
  | { id: string; kind: "ask" | "backlinks"; workspaceId: string; documentId: string };

type PaneGroup = {
  id: string;
  tabIds: string[];
  activeTabId: string;
  preferredWidth: number;
};

type WorkspaceLayout = {
  version: 1;
  tabs: Record<string, PaneTab>;
  groups: PaneGroup[]; // zero, one, or two supporting groups
  lastUsedGroupId: string | null;
};
```

Use actual existing ID types where available. PDF controller state separately stores source/citation location. Ask context must retain originating document/view/version identity independently of which tab is currently focused.

Reducer actions: open-or-focus, activate, close, reorder-tab, move-tab, split-tab, reorder-group, merge-group, resize, clear-document-scope, clear-workspace-scope. Validate each transition: every tab belongs to exactly one group, no duplicates, no empty groups, active IDs exist, at most two groups, singleton tool identities remain unique. UI-only actions never enter the document undo history.

Have a runtime registry keyed by tab ID holding mount host/controller, scroll/selection bookmarks, cleanup, visibility, and transient errors. Stable React keys alone do NOT guarantee preservation when moving a child to a different parent. Prove the mounting/reparenting strategy: either stable hosts plus controlled placement, or explicit bookmarks and safe remounting of views bound to the same store. Do not serialize/reload the document to move a tab. Prefer keeping live Page hosts mounted for open note tabs; suspend expensive work for hidden panels. Cancel gestures/popovers before structural moves and verify IME composition is not lost.

### Shared editor model: first technical gate

- Reuse the active `Doc` and its collection, BlobSource, SaveCoordinator and undo manager. Do NOT call `openEditor` a second time with a separate repository load for the same document.
- Introduce an adapter operation such as `createNotePageView(noteId, host)` returning focus, visibility/bookmark and dispose capabilities. Names are illustrative.
- A second `AffineEditorContainer` renders Page mode and filters only its own note children using the existing per-view filtering approach. Its filter/selection must not change the main editor's mode, filter or selection, or mutate stored `displayMode`.
- Use the same editor specs, attachments, link routing, settings, AI affordances and supported block rendering. Check scoped Ctrl+A, paste, slash menus, floating formatting menus, link popovers, drag/drop and selection across both editors.
- Keep one document undo stack, consistent with current behavior. Ctrl+Z in either note editor/canvas edits that shared document history. Do not promise independent per-note undo. Prevent double handling and focus-scoped commands firing in both hosts.
- Main header document actions keep their explicit main-document meaning. Text inputs and the native browser keep their own undo handling. A header Undo must not misleadingly imply it undoes browser navigation or PDF selection; establish a focus-aware enabled state and test it.
- Closing a view releases ONLY that host's listeners/observers/UI. Session disposal releases all attached hosts before disposing the underlying collection. Save errors retain the session and dirty data.
- If a note is deleted while open, show a concise unavailable state and a close action; do not keep editing a stale model or recreate it. On normal document undo restoring the same block ID, rebind safely. Handle parent Trash and workspace changes with the existing flush boundaries.
- Prove this gate on the pinned BlockSuite version before broad panel migration. If a dependency-level defect prevents it, document the exact failure and propose an isolated fix; do not substitute a second text editor with different formatting.

### Native browser: second technical gate

- Only the active, actually visible Browser tab may display the remote child WebView. Inactive tabs, modal dialogs, menus overlapping it, drag previews, narrow-layout hiding, minimized/document-hidden states all hide it explicitly.
- Hide the child for the full tab/column drag operation, not just after a pointer enters it. Native webviews can intercept input and cover HTML previews; a high CSS z-index alone is insufficient.
- Recompute bounds from its visible viewport after layout commit, resize and scale changes; keep the existing device-pixel conversion and serialized native calls. Avoid stale queued visibility updates showing it in the old column.
- Moving or temporarily hiding the tab must not recreate or navigate the session. Preserve address, navigation history, scroll and session cookies under current privacy/lifecycle rules. Closing the UI tab should follow existing hide behavior; workspace change/app shutdown still dispose normally.
- Preserve native F6/Ctrl+L address focus and browser isolation. Do not route shell shortcuts into remote web content or claim its events bubble to React.
- Show/hide/resize correctness must be verified in the native Windows app, not only a browser mock. No broad CSP, capability, or native permission changes are justified by this layout work.

## 9. Persistence, focus, and failure behavior

- Both editor views share autosave. A pending save is not canceled when closing a tab; it belongs to the session. Navigation, workspace switching and app shutdown retain the existing awaited flush/save-error flow.
- In-flight PDF loading, AI requests, and browser status updates must be scoped to the tab/controller/session that initiated them. Disposed tabs ignore late results. Closing one tab must not cancel unrelated work.
- Tab focus registry distinguishes main editor, supporting editor, PDF, browser, chrome, and modal focus. Commands use that registry or scoped event paths instead of `document.querySelector` selecting the first editor.
- Apply `inert`/focus containment to ALL editing hosts during blocking management operations, loading or workspace changes, not only today's `host.current`. Nonmodal supporting panes must not make the canvas inert.
- Keep hidden tab DOM out of tab navigation. Use tablist/tab/tabpanel semantics, `aria-selected`, `aria-controls`, roving tabIndex, arrow keys and Home/End. Keep active close accessible without conflating close with tab selection. Use existing menu keyboard behavior.
- Announce moves/merges with a short live-region message; provide keyboard menu alternatives to every drag operation. No new global shortcut should conflict with native browser/editor shortcuts.
- Render loading/errors within the affected tab. Main canvas remains usable for independent panel loading. If a save failure blocks a lifecycle change, preserve the current layout and content and expose the existing retry/error flow.
- Do not write content snapshots or note selections into geometry preference files. Invalid layout preferences reset only layout; they never trigger content repair or migration.

## 10. Delivery sequence and exit criteria

### Phase 0 — Baseline and technical validation

Inspect current repository and relevant docs; capture baseline screenshots in Page, Canvas, PDF, Browser and Card Deck at useful desktop/narrow sizes. Establish current check failures separately from new failures. Audit all `surface`/`setSurface` call sites and all single-editor selectors. Prove two editor hosts on the same document and native browser hide/resize during drag with minimal isolated changes.

Exit: verified shared edits, single undo handling, single persistence owner, and a viable native browser visibility path. Record exact BlockSuite hooks used.

### Phase 1 — Shared pane shell and model

Implement reducer, invariants, registry, group/tab/divider components and measured width projection. Separate management/transient surfaces from supporting tools. Convert existing one-pane presentation to the new shell while keeping the main header/sidebar stable. Consolidate single-pane CSS assumptions rather than appending contradictory overrides.

Exit: one group supports stable tabs, closing, overflow, focus and resizing; management dialogs preserve their existing behavior; no duplicate panel headers/close buttons.

### Phase 2 — Editable note pane

Add adapter-owned Page view, shared styling/settings, note identity/label, and native selected-note toolbar action. Wire shared data, save/undo, link/attachment actions and view disposal. Update AI/portal/keyboard scoping where required.

Exit: the exact selected note can be edited beside Canvas with full supported Page behavior; edits appear in both views and survive normal close/reopen; opening never changes main view or stored display mode.

### Phase 3 — Migrate existing supporting tools

Integrate PDF, Browser, Card Deck, Ask Knot and Backlinks with stable identities and retained state. Replace direct `setSurface` transitions in PDF Ask, citations, browser links and tool launchers with open-or-focus routing. Preserve PDF source selection/highlighting and browser session lifetime. Separate export/reference-picker task state so opening those tasks does not erase tabs.

Exit: switching tabs preserves reader position, editor caret, browser session, deck filters, and AI draft; actions target the correct source; modal transitions do not leak browser overlays.

### Phase 4 — A/B transition

Implement drag previews, tab reorder/move, split, group reorder/merge, menu alternatives, width constraints and responsive projection. Preserve editor hosts/controller state, focus and canvas viewport. Handle native browser visibility for gestures and popovers.

Exit: PDF can move out beside a note and back with no reset, duplicate content, unexpected third column, overlapping native webview, or canvas-object reflow.

### Phase 5 — Visual and behavioral verification

Inspect actual screenshots, not just geometry assertions. Match spacing, type, active/hover/focus, light/dark, empty/loading/error states, long labels, and panel-local menus. Resolve regressions in existing native suites. Document results and remaining limitations honestly.

Exit: acceptance matrix below passes; any excluded cases are explicitly identified, not described as supported.

### Phase 6 — Build and update installed app

Run relevant checks, then `pnpm update:running` as required by `AGENTS.md`. It builds, requests normal close/save, replaces/verifies the installed executable, and relaunches it. Never force-kill the user's installed app. If build/update fails, report the failure and do not claim the installed app was updated. Smoke-check the installed release with the requested workflow. Do not perform this phase for this planning-only document.

The phases are sequencing, not permission checkpoints. Once implementation is requested, continue through the authorized scope without asking for approval after each routine reversible step. Do not stop after a partial pane UI and call the whole task complete.

## 11. Acceptance and verification matrix

| Area | Required evidence |
| --- | --- |
| Entry point | Exactly one selected-note toolbar action; correct shared icon, tooltip, disabled/unsupported-selection behavior; no new global Page-pane launcher. |
| Same content | Edit text, lists, headings, table cells, code and attachment-containing notes in pane; canvas updates; no duplicate block IDs or alternate body snapshots; normal restart retains edits. |
| Independent views | Opening pane leaves main Canvas active; selecting other objects leaves pane pinned; changing main Page/Canvas does not retarget/close it. |
| Editor input | Cursor, scroll, Ctrl+A, Ctrl+Z/redo, paste, IME, slash/format/link menus target the intended host; no duplicate events or stale popup ownership. |
| Tab behavior | Stable IDs, deduplication, overflow, long/empty titles, active-neighbor close, no document deletion, focus return, explicit toolbar reactivation. |
| A/B movement | PDF left of note; drag back merges; menu actions produce same result; reorder columns; canceled/invalid drags do not mutate state; no third supporting group. |
| State continuity | Note selection/scroll, PDF source/page/scroll/zoom where supported, Browser URL/history/session, Card Deck filter and Ask draft survive tab switches and moves. |
| Canvas integrity | Object coordinates/sizes and zoom unchanged; viewport center preserved through split/merge; palette remains usable within canvas. |
| Native browser | Hide inactive child and during drag/modals; correct bounds after resize/move/DPI; no overlap/input interception; focus-address shortcuts and session/privacy lifecycle preserved. |
| Responsive | 1920x1080, 1440x900, 1280x720, 850x640 and 760x540 CSS viewports; no app horizontal overflow; two groups collapse/restored predictably; narrow return-to-main action works. |
| Accessibility | Keyboard tab selection, menu-based move/split/merge, keyboard resize, clear focus, correct tab semantics, reduced motion, disabled split explanation, topmost Escape behavior. |
| Lifecycle | Delete/undo selected note; parent navigation, workspace switch, app close and save failure; no destroyed collection still referenced; failed transitions retain dirty data. |
| Regression | PDF highlights/citations, shared notes, browser links, AI targeting, Card Deck placements, export/reference tasks, global search, settings and original Page/Canvas navigation. |
| Performance | Compare against current editor baseline using representative large canvas/PDF; hidden views do not render continuously or create repeated listeners; repeated open/close/move cycles release resources. |

Unit tests should cover reducer invariants, deduplication, width clamping, responsive projection and invalid preferences. Integration/native tests should verify real editor and native-webview behavior rather than merely echoing reducer implementation. Test resource cleanup after repeated moves and save-error paths.

Typical commands (confirm actual scripts/test prerequisites in the implementation chat):

```powershell
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm tauri build --debug
node tests/native/editor.mjs
node tests/native/panels.mjs
node tests/native/pdf-highlights.mjs
node tests/native/shared-notes.mjs
node tests/native/browser-v1.mjs
node tests/native/accessibility.mjs
node tests/native/workspace-panes.mjs
pnpm update:running
```

The proposed new test does not exist yet. Run existing native tests in isolated test workspaces, serially where ports/native ownership conflict. Do not aim destructive test cleanup at the installed user app; some existing harnesses force-stop their own test processes and must remain scoped to those processes. Broaden Rust checks only if native Rust changes are made. Capture actual Windows 100/125/150% scaling evidence when feasible and distinguish real OS scaling from viewport emulation.

## 12. Implementation report and handoff expectations

Update this plan with actual decisions and progress, and add verified implementation details to `docs/ARCHITECTURE.md`, `docs/EDITOR-PRESENTATION.md` and `docs/VERIFICATION.md` as appropriate. Keep design and implementation status distinct. Report what changed, checks performed, screenshot evidence, any material limitations, and whether the installed executable was updated and relaunched.

The central success scenario is: select a canvas note -> open its Page pane -> open PDF as another tab -> show PDF beside the note -> edit while reading -> regroup or close PDF -> return to full canvas with all content and positions intact.


## 13. Implementation decisions (6 November 2026)

- `workspace-layout.ts` implements the bounded two-group reducer and responsive projection. `WorkspacePanes.tsx` owns the common tab strip, menus, HTML drag previews, dividers, announcements and stable content hosts. No docking dependency was added.
- Supporting content has flat, stable React parents. Movement changes measured placement, never the editor/PDF parent or document instance. Inactive content retains geometry/scroll, with `hidden`, `aria-hidden`, `inert` and visibility containment. PDF rendering ignores zero-width resize notifications.
- `EditorSession.createNotePageView` attaches another pinned BlockSuite 0.19.5 `AffineEditorContainer` to the same `Doc`. The Page root's instance-local `renderChildren` bridge selects exactly one note; no `displayMode` or document snapshots change. The session owns saving and undo. The view owns preferences, references, toolbar observers and cleanup. Captured Ctrl+A stays within the note and Ctrl+Z/redo reaches the shared undo manager once.
- The selected-note native toolbar uses the shared `shellIconPaths.note`, appears for exactly one editable, unlocked note, and opens or focuses its stable identity. Labels derive from live note content, with `Untitled note` fallback. The parent notebook title is hidden in the supporting Page view.
- Browser remains one native session per workspace. Inactive/blocked content and pane gestures suppress the child explicitly. Placement commands carry a revision, so queued obsolete placement cannot show the child at an old rectangle. Native physical bounds, session identity, drag hiding and window resize behavior were exercised.
- PDF, Browser, Card Deck, Ask Knot and Backlinks use open-or-focus routing. PDF citation navigation updates the mounted controller. Ask keeps its draft across tab changes and retains originating context; parent document changes clear document-bound tabs after the existing flush boundary. Settings and transient reference/export workflows retain their separate shell.
- One supporting group defaults to a readable width; existing browser width preferences are used on first opening. Only versioned, validated widths persist. Open tabs, URLs, note text, selections and editor objects are not added to layout storage. Narrow projection preserves actual membership and restores the two-column arrangement when space returns.
- Scope remains horizontal columns, at most two supporting groups, one main editor, one PDF reader and one Browser session. There are no detached windows, vertical stacks, cross-document note-tab restoration or saved layout templates.

The technical gates passed before relying on the broader migration: `note-pane-gate.browser.mjs` verifies the shared document, real text input, supported heading/list/code blocks, undo/redo and cleanup; `native/pane-browser-gate.mjs` verifies the native child hides during movement, moves to the measured physical rectangle and keeps its session. The full native pane scenario additionally exercises a real two-page PDF beside the editable note.


Delivery: implemented, checked and installed on 6 November 2026. The final release was built with `pnpm update:running`, verified by the update script and an independent executable hash comparison, relaunched, and smoke-checked through its actual Windows UI. See `docs/VERIFICATION.md` for passing checks, screenshot evidence and explicit legacy-suite/manual-hardware verification limits.
