# Milestone 5 action inventory

Slices one and two preserve the existing handlers, storage model and bounded formats. The shell keeps entry points visible; one primary surface is shown at a time.

| Previous entry point                             | Current location and behavior                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add note / New notebook… | Sidebar creation actions: add a note to the active notebook, or name and create a separate notebook. The canvas is the notebook’s Canvas tab; a column’s + menu reopens it. |
| Title search / body search                       | Search library or Library options opens the library surface. Title matches update as you type; Search titles & body explicitly flushes and scans saved content. |
| Collection navigation                                | Each collection expands inline to show its own notebooks and their contents. Ctrl+K remains workspace-wide.                                                             |
| Collection creation, rename, deletion            | Notebook ⋯ → Find or create. Rename/delete live in the collection’s ⋯ menu; deleting keeps all notebooks.                                                           |
| Document list / Load more                        | Independently scrolling sidebar library; library surface also offers title results and pagination when the sidebar is collapsed.                                |
| Switch/open/relocate workspace                   | Sidebar Switch workspace → dedicated Workspaces management view. Existing native folder dialogs and relocation confirmation remain.                             |
| Backup creation, verification, restore, deletion | Settings → Backups → dedicated management view. Restore opens a separate workspace; archive deletion still requires confirmation.                               |
| External backup / restore                        | Settings → Backups → Back up workspace / Restore backup; existing native archive dialogs.                                                                       |
| Trash search, pagination and restore             | Sidebar → Trash → dedicated management view.                                                                                                                    |
| Integrity, guided reference/attachment recovery  | Settings → Workspace health → dedicated management view, including retry and Recovery backups.                                                                  |
| Quarantine preview, move, restore and disposal   | Settings → File recovery → dedicated management view; existing revalidation and confirmations remain.                                                           |
| Back / Forward | Sidebar top row, or the slim rail while the sidebar is collapsed; save failure blocks navigation. |
| Rename | Notebook pill (first in the first column’s tab row): its title field (Enter or blur). |
| Page / Canvas | Page view is a Note tab: a column’s + menu → Note, Ctrl+Enter on a selected card, or a sidebar note row. The canvas is the Canvas tab. |
| Save status / retry | Notebook pill: a dot while saved or saving; a failure shows its words and retries when clicked. |
| Notebook collection memberships                    | Notebook ⋯ or right-click row → collection checkboxes.                                                                                                            |
| Backlinks                                        | Notebook pill menu → Backlinks; explicit refresh and source navigation in the right panel.                                                                        |
| Reference selection/insertion                    | Notebook pill menu → Reference; insert link or place shared note in the right panel.                                                                              |
| PDF reader / source reopening | A column’s + menu → PDF reader, or a saved highlight source link; reader fits its column and preserves normalized locations. |
| Export                                           | Notebook pill menu → Export → right panel; existing format limitations and native save dialog remain.                                                             |
| Attachments                                      | Notebook pill menu → Attach; native file picker.                                                                                                                  |
| Undo / redo / soft-delete | Tab tools at the end of the Canvas or Note tab’s row; editor keyboard shortcuts retained. Notebook pill menu → Move to Trash, still confirmed. |
| Sidebar Quiz cards → New multiple-choice card   | Canvas note tool (bottom toolbar) → Multiple choice, after Image / Link / File. Opens the composer and places a standalone question card on the canvas. In Page, use the `/mcq` slash command or the Multiple choice action in the text and card toolbars. |
| Sidebar Quiz cards → Create MCQ from selection   | Select text, then use Multiple choice in the formatting toolbar; the question is inserted inline at the selection.                                              |
| Sidebar Quiz cards → Reset quiz progress…       | Notebook pill menu → Reset quiz progress…; still permanently clears this notebook's answers after confirmation.                                                   |
| Startup workspace recovery                       | Switch workspace, Settings and Trash remain available without an editor.                                                                                        |

The right panel closes through its single labeled header Close control or Escape while focus is inside the panel. Focus returns to its invoking control (the disclosure summary for menu actions). Busy operations cannot be dismissed.

Drag the left separator, or focus it and use Left/Right arrows, to resize a contextual/library panel. Width is session-only, bounded to 320–600 pixels and at most 55% of the main area; at 850 pixels window width and below it takes the content area while the mounted editor is hidden and excluded from keyboard focus. Closing restores the editor without remounting it. Workspace management uses the main content area. The editor stays mounted during tool changes and resizing. Selecting a different document or workspace clears the surface; same-document recovery refreshes can keep the management view open.

No document bodies, attachment identities, database schemas or editor engines are converted. Slice four adds exclusive shell disclosures, topmost shell Escape handling, shared contrast/focus styling. Actual Windows 100%/150% scaling passed; see VERIFICATION.md for measured client sizes and evidence.

## Slice three: native editor tools

Page keeps native typing, formatting shortcuts, selection formatting and slash
insertion, with a narrower reading column. Canvas retains the native toolbar and
selection menus; its large illustrations are replaced by compact labels.

| Action                                 | Visible entry point                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Select / pan                           | Pointer/Hand control; native V/H shortcuts on the canvas.                                     |
| Frame / connector / link               | Native compact icon controls, with accessible names and tooltips.                             |
| Note card / freehand / eraser / shapes | Note, Pen, Erase and Shape controls; native option menus retain content colors and variants.  |
| Canvas text / mind maps                | Text / More → native text and mind-map menu; drag the desired item onto the board.            |
| Templates                              | Template → native template panel.                                                             |
| Additional tools in a narrow editor    | Previous tools / Next tools and More tools; native responsive paging remains.                 |
| Zoom / fit                             | Bottom-left zoom controls; open the ellipsis (Zoom controls) in narrower editors.             |
| Object formatting / advanced actions   | Select an object to show its native contextual toolbar.                                       |
| Open a shared card's source            | Select the card → Open → Open this doc; normal save-before-navigation and Back history apply. |

Creation, paging and zoom controls support Tab and Enter/Space. Their original
native handlers remain responsible for tool activation. The version-specific
presentation boundary and upgrade checks are documented in
[EDITOR-PRESENTATION.md](EDITOR-PRESENTATION.md).

### Document action groups

The compact document menu uses separators between three accessible task groups:

- Add content: Attach and Reference.
- Connections: Backlinks.
- Read & export: PDF reader and Export.

Each entry has an icon and a single label; repeated titles, visible group headings, descriptions and submenu arrows are omitted. Arrow keys wrap through enabled actions; Home/End move to the first/last action. Escape restores focus to the menu trigger. Existing panel routes, native file selection, and disabled states remain in place.
