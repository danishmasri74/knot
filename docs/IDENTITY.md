# Knot identity

Approved direction: Linked K. Three solid shapes create a K with an over-under crossing. Use flat fills and preserve the crossing gaps.

- Ink: `#242423` (charcoal).
- Paper: `#FAF9F6` (warm white).
- Wordmark: Segoe UI Semibold, with Inter and sans-serif fallbacks.
- Sidebar: standalone charcoal mark beside the Knot wordmark.
- App icon: warm-white mark inside a charcoal rounded square.
- No gradients, green tints, shadows, or grayscale filters applied to the mark.

## Object icon rule

- Individual notes use the page icon (`ShellIcon` name `note`).
- Notebooks use the bound-book icon (`notebook`), including creation, navigation, Favorites, search results, library rows, and Trash.
- Collections use the folder icon (`folder`).
- Workspace and backup settings use their own `workspace` and `backup` icons.

Choose icons by the represented object, not its title or current view. A notebook named “Note 2” still uses the notebook icon. Keep these meanings consistent across all Knot surfaces.

## Brand assets

`assets/knot.svg` is the canonical app icon. `assets/knot-mark.svg` and `assets/knot-mark-light.svg` provide standalone marks. `assets/knot-wordmark.svg` provides a horizontal lockup using the system typeface. Public SVG copies supply the UI and favicon; `public/knot-icon.png` is the raster fallback.

Regenerate platform icons with `pnpm tauri icon assets/knot.svg --ios-color '#FAF9F6'`. Copy `src-tauri/icons/icon.png` to `public/knot-icon.png` and `src-tauri/icons/128x128.png` to `tests/fixtures/knot.png` so attachment tests use the current identity. Small-size proofs are in `assets/identity-sizes/` (16, 24 and 32 pixels).

Keep clear space around the mark of at least one stroke width. Do not distort or close the diagonal crossing gaps. The compact app-icon composition is for small OS surfaces; use the unboxed mark in the application sidebar.
