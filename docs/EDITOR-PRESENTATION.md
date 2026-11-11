# Editor presentation integration

Canvas uses the unmodified BlockSuite 0.19.5 toolbar, including its default
64-pixel height, illustrations, menus, drag targets, tooltips and responsive paging.
The custom shadow-DOM presentation bridge, replacement text labels and injected
keyboard handlers have been removed. Toolbar behavior and accessibility now follow
the upstream implementation.

Page retains its reading-column and theme settings. Document storage and the
editor lifecycle are unchanged.

Run tests/native/editor.mjs against the rebuilt native app to verify the default
toolbar and pointer interactions, zoom, navigation and restart persistence.


## Editable note panes (6 November 2026)

A single unlocked Canvas note exposes **Open in side panel** in its native floating toolbar, using the shared note/page icon. It opens the real Page editor beside Canvas. Tab labels come from live note content; the pane never shows an editable parent-notebook title. Main Page/Canvas navigation remains independent.

Supporting content uses a shared 36px tab header, neutral active state, single-line overflow, close controls, tooltips and a pane menu. **Show beside current tab** separates the active tab to the left; move/merge menu actions accompany drag operations. The common header replaces redundant tool close/title chrome; PDF and Browser retain their functional local controls. Browser expansion remains available.

The content row reserves 360px for the main editor and 360px for note/PDF groups (320px for simpler groups). Interior dividers redistribute adjacent supporting widths. Insufficient space projects two groups into one strip; narrower windows show one content surface with an explicit return to Canvas/Page. Membership and live hosts survive these projections. Page typography and settings match the main editor; only reading margins reduce to 24px. No card coordinates or saved display modes change as a layout side effect.
