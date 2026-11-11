# Project instructions

## Object icons

Use the shared `ShellIcon` consistently throughout Knot: `note` (page) for individual notes, `notebook` (bound book) for notebooks, and `folder` for collections. Apply this to navigation, creation actions, lists, search, Favorites, Trash, and any new surfaces. Do not use notebook icons for workspace or backup settings.

## Dropdowns and menus

All dropdowns throughout Knot must follow the Library sort dropdown reference: a neutral theme-aware surface, a thin border, a 6px outer radius, 5px inset padding, rounded rows, a quiet hover/selected background, and a right-aligned checkmark for the current choice. Use the shared tokens and rules in `src/styles/dropdowns.css`; do not add per-screen menu skins, raw menu colors, different shadows, or different row spacing.

Use `ShellMenu` for action menus and `ChoicePopover` for simple choice lists. Other `Popover` content and imperative context menus must carry `knot-dropdown`. Native single-choice `<select>` controls inherit the same picker styling; preserve native labels, keyboard navigation, disabled states, and change events. Action menus do not need selection checkmarks. Complex forms and multi-select content retain their own layout inside the shared surface. Editor integrations must use the same dropdown theme tokens. Verify light/dark themes, keyboard selection and dismissal, selected indicators, and viewport bounds when changing dropdowns.

## Update the installed app

After changes to Knot, always rebuild and update the installed app as part of completing the task. The user explicitly authorized this ongoing workflow; do not stop at source changes or ask for confirmation each time.

- Run the appropriate checks, then `pnpm update:running` to build, safely close the installed app, replace its executable, verify the installed build, and relaunch it.
- Preserve user data and allow the normal close/save flow; never force-kill the user's app to update it.
- If building or updating fails, report the failure clearly and do not claim the installed app was updated.
