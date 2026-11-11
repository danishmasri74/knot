# Canvas panning performance handoff

Improve sustained panning in the Software Testing notebook at both overview and reading zoom. Start with shared viewport movement. Use a second, independent preview change only if the desktop measurements still point to the oversized card.

## What the investigation established

- An isolated Edge session ran Knot’s production frontend with a read-only snapshot of the current notebook. Two sustained Space-drags at 15% zoom had 95th-percentile frame gaps of about 35 ms and worst gaps of 194 and 229 ms. At 100% zoom, the two p95 values were about 63 and 69 ms. The idle control at 15% had a p95 of 7 ms. Desktop WebView2 still needs its own baseline.
- The snapshot contained 31 note cards and 62 surface elements. “Chapter 2 — Fundamentals of Software Testing” had 246 direct child blocks and 8,433 descendant DOM elements. It was the only card without a cached overview preview. Instrumentation confirmed the snapshot builder returned “Preview is too complex” at its 8,000-element guard.
- The measured drags triggered zero new note mounts, preview builds, or storage calls. Browser tracing showed substantial paint and layer preparation. Holding note transforms fixed improved both diagnostic runs but left the cards stationary. Hiding Chapter 2 alone gave mixed results. These experiments identify candidates for a working prototype.

## 1. Establish the desktop baseline

1. Reuse the isolated WebView2 setup in `tests/native/editor-baseline.mjs`. Give it a disposable workspace and a separate WebView2 profile. Use a consistent SQLite backup of the active notebook and its referenced assets. Keep notebook contents local and outside version control. Use the current production frontend in the same native build configuration before and after.
2. After full canvas readiness, replay a sustained Space-drag out and back over the same coordinates at fixed 15% and 100% zoom. Include a route crossing the Chapter 2 card edge and an empty-area control. Record the starting viewport, window size, display scale and refresh rate. Verify intermediate movement and the return position. A final center check alone would miss a frozen canvas on a round trip.
3. Run five warm trials per route and zoom. Record per-trial p50, p95, worst frame gap and count of gaps over 50 ms during movement. Record any stall after release through the first click. Capture one separate rendering trace to attribute time without charging profiler overhead to the baseline. Count per-card transform writes, note mounts and preview builds. Extend the existing synthetic navigation fixture with mixed cards and shapes for repeatable regression coverage.

## 2. Prototype shared translation at fixed zoom

- In `@blocksuite/block-std`, inspect `src/view/element/gfx-block-component.ts`. Both component variants use `handleGfxConnection`, which writes a transform on every viewport update. In `src/gfx/viewport-element.ts`, the viewport also handles visibility and queued child mounts. In `@blocksuite/blocks`, inspect `src/root-block/edgeless/edgeless-root-block.ts`, plus the frame and edgeless-text overrides of `getCSSTransform()`.
- Keep the existing viewport as the source of truth for pointer mapping, selection and culling. Factor the common screen-space translation out of each block’s transform. Apply it once per frame to an existing shared layer where practical. Keep block-local scale, rotation, origin and geometry correct. New blocks and geometry edits must pick up the current viewport immediately. The optimization should cover fixed-zoom translation regardless of whether the input came from a drag, wheel or trackpad.
- **Prove layer alignment first.** BlockSuite interleaves DOM blocks and raster canvases by stacking order. Its surface renderer already draws using viewport coordinates. Inspect the actual DOM and stacking contexts on a mixed board. If the shared ancestor also moves a viewport-sized raster surface, compensate at that surface or use existing compatible layer boundaries. Check visible positions and topmost hit targets for a shape both above and below a card. The grid, connectors, selections and handles should track the same model point throughout the drag.
- Keep zoom changes, viewport resize, fit-to-content and programmatic jumps correct on the first painted frame. Handle a model edit during movement, an offscreen card entering view and editor remounts. Avoid moving editor DOM between parents during a gesture, which can disrupt the caret and IME. Preserve full canvas preparation and export behavior. Carry dependency changes through the pinned pnpm patches and verify the shipped runtime files contain the change.
- Repeat the baseline with this change alone. Look for fewer per-card transform writes and lower p95 frame gaps at both zooms, beyond baseline trial variation. Compare the worst stalls and time to the first usable click after release. A reasonable goal is a 16.7 ms p95 on a 60 Hz display. Report the measured result even if the prototype misses that goal. If writes disappear but frame times stay high, use the new trace to identify the remaining paint, surface redraw or culling work before expanding the patch.

## 3. Decide whether oversized previews need a separate change

Proceed if the desktop comparison still shows excess overview cost when Chapter 2 is visible or crossing the viewport edge. If the remaining lag is equally strong on the empty route or at reading zoom, follow that evidence first.

- Start in `src/features/editor/blocksuite/canvas-note-preview.ts` and the note preview rendering in `patches/@blocksuite__blocks@0.19.5.patch`. Prototype a sectioned preview for oversized text cards. Divide work at content-block boundaries **before** serializing the entire card. Retain the supported live fallback for content that cannot be captured.
- Use the existing source-size, decoded-pixel and cache budgets across all sections. Prioritize the visible range and preserve saved card bounds. Verify that crossing a section boundary during a pan performs no synchronous capture and shows no blank strip. Edits, font and theme changes must invalidate affected previews. Editing, selection, IME and export must still use full content.
- Benchmark this separately against the shared-translation result. Add a synthetic long card that actually trips the guard. Check preview coverage at overview zoom, first-character placement after zooming in, cache cleanup and full-content export.

## 4. Verify and deliver

- Run `pnpm check`, `pnpm test` and lint the touched files. With the browser test server running, exercise `tests/canvas-navigation.browser.mjs` with `KNOT_NAV_ASSERT=1`, plus the startup, direct-open, LOD, performance and export canvas browser tests. Use `tests/native/canvas-exports.mjs` for desktop export coverage.
- Check rapid reversals, pan into zoom, immediate click-to-edit, rotated text, frames, connectors, groups, equal-index stacking, reorder/undo and Page ↔ Canvas switching. Compare model coordinates, rendered positions and actual hit targets. Pure panning should leave document geometry and undo history untouched.
- Record before/after desktop results and the disposition of the preview follow-up in `docs/EDITOR-PERFORMANCE.md`. Include the routes, trial counts and any remaining stalls. After verified implementation changes, follow `AGENTS.md` and run `pnpm update:running`. Verify the installed executable and relaunch using the normal close/save flow.

## Recorded outcome — 9 November 2026

Shared translation, raster-layer compensation, rotated-text sizing and mixed-board pixel/click regression coverage are implemented through the pinned patches. The disposable native baseline was collected before renderer edits, followed by a matched original/candidate replay with five trials per route and zoom. Per-card transform writes fell to zero, but p95 frame gaps did not improve beyond trial variation; the 16.7 ms goal remains unmet. The oversized preview is deferred in favor of investigating the remaining style/accessibility lifecycle work identified by the desktop trace. Full preparation also now loads offscreen lazy images without deadlocking. All requested checks passed, and the installed release was verified and relaunched through the normal update workflow.

See [the detailed results, limitations and installed build verification](EDITOR-PERFORMANCE.md#sustained-desktop-panning-9-november-2026).
