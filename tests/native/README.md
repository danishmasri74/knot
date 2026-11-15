# Native suites

These scripts drive the real debug build (`src-tauri/target/debug/knot.exe`)
through WebView2's debugging port, each with its own throwaway data folder
(`KNOT_TEST_DATA_DIR`). They are run by hand; `pnpm checks` and
`pnpm release` don't use them.

## Out of date (as of 15 November 2026)

Most suites here still expect the layout from before the tabbed layout
(`docs/TABBED-LAYOUT-PLAN.md`) and will fail until updated:

- **Startup.** A fresh data folder opens on the Library, not a notebook
  (startup destination setting), so waiting for `affine-paragraph` at launch
  times out. `create-notebook.mjs` also needs `.first()`, since "New
  notebook…" appears in both the sidebar and the Library.
- **Header controls are gone.** "Document actions" is now the notebook
  pill's "Notebook actions" menu, which holds only notebook actions.
  Browser, Card Deck and PDF reader open from each column's "New tab" (+)
  menu. Columns have no ⋯ menu or grip: moving, separating, swapping and
  closing are in a tab's right-click menu (or Shift+F10). Undo, Redo and
  "Focus column" sit once at the right end of the header. There are no
  Page/Canvas buttons: Page view is a Note tab, and the canvas is the Canvas
  tab. `.topbar` no longer exists.
- **Export** is a dialog (radio buttons and an "Export…" button), not the
  "Export format" select and "Save export" button.
- **Panes.** Columns cover the whole content row, at most two beside the
  sidebar; the divider is "Resize columns"; Focus shrinks the other column to a
  rail.

`shell-navigation.mjs` is the shared helper to update first. Until then,
`tests/prototypes/browser-menu-overlap.native.mjs` and
`tests/prototypes/layout-screens.native.mjs` are current native checks of
the browser view and the tab layout.
