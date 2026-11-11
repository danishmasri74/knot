# Ask Knot page and panel

Implemented 10 November 2026.

## Shared tabs correction (10 November 2026)

Panel placement now uses the existing WorkspacePanes Ask tab, including tab
activation, close, movement, split/merge, responsive projection and shared
resizing. The separate AI dock and its resize control were removed. The same
portal container is moved between the pane content slot and page host, retaining
the live React chat instance. Page mode removes the Ask tab; closing the tab parks
the retained chat in the hidden page host. Existing saved Ask tabs are restored
instead of stripped. The panel-specific statements below describe the original
implementation and are superseded by this correction.

Verified: updated actual-shell ai-placement test (singleton, page/tab movement,
streaming continuity, explicit Stop, tab closing/reopening, draft and reload),
workspace-panes and pane-tab-drop browser suites, ask-continuity browser suite,
17 layout/persistence unit tests, TypeScript and ESLint. The native update is run
through pnpm update:running with its result reported in the implementation chat.

Ask Knot has one workspace-scoped mounted chat in the shell. The sidebar opens
its page; contextual editor actions open its dock. Placement and visibility do
not change its React identity. The dock reserves space beside Library or the
notebook and its other supporting panes. Legacy notebook Ask tabs are consumed
into the shell-owned chat without creating another instance.

Both placements use AskKnot, ShellIcon, the existing composer, source pickers,
model controls, and dropdown theme. The page centers its messages and composer.
The dock has a pointer- and keyboard-accessible width separator. Insufficient
space promotes it to a page; source navigation in a narrow window reveals the
source and retains the hidden chat for return navigation.

Closing hides the chat, including during generation. Stop explicitly cancels.
Leaving a workspace disposes that workspace's running controller. Active chat,
draft text, image attachment reference, and placement preferences are stored per
workspace. Stored transcripts retain the existing format and interrupted-response
behavior. Placement changes do not recapture the initial source context.

## Checks

- `pnpm check` and ESLint for the changed React files.
- Unit suite: 27 files, 107 tests passed.
- `tests/ai-placement.browser.mjs`: actual shell, one mounted chat, draft
  continuity, close/reopen, reload, history, an in-flight mocked provider request
  across moves and hiding, explicit Stop, light/dark captures, and narrow fallback.
- Existing composer tests: dropdown theme, labels, selection, keyboard, Escape,
  outside dismissal, focus return, and viewport bounds in light/dark.
- Existing chat-scroll tests: history, manual reading position, follow-latest,
  batching, and final save.
- Existing Library history test: Back/Forward endpoints and branching.
- Updated the desktop updater to wait while Task Scheduler reports
  `SCHED_S_TASK_RUNNING` (267009), including when its separate state snapshot
  has already changed to Ready. The original run reported failure even though
  the child installer completed; executable hashes and the relaunched process
  independently confirmed that replacement.

Browser provider requests use mocks; no paid provider request is made by these
tests. Installed-app build, replacement, hash verification, and relaunch are run
with `pnpm update:running`; its outcome is reported in the implementation chat.
