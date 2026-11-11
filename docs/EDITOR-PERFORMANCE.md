# Knot editor performance baseline

Measured on 5 November 2026 in the native Windows WebView2 debug build on an Intel Core i5-12450H with 16 GiB RAM. The frontend used the Vite production build. Each scenario used a disposable test workspace. The loading screen and ordinary save behavior were enabled.

## Opening the same note

The target had 150 added paragraphs. The workspace also contained the navigation source and built-in content. Added notes had already been initialized and saved before timing. The warm time runs from the automation click request through shell readiness. The process-cold time includes launch and connection to the native window, with the OS disk cache left warm.

| Added notes | Distinct bodies read per open | Warm open, median / p95 (ms) | Click to first character, median / p95 (ms) | Highest sampled JS heap (MiB) | Process-cold open (ms) |
| ----------: | ----------------------------: | ---------------------------: | ------------------------------------------: | ----------------------------: | ---------------------: |
|          10 |                            14 |                    337 / 438 |                                   481 / 542 |                           177 |                  1,783 |
|         100 |                           104 |                    875 / 979 |                                 929 / 1,018 |                           211 |                  2,144 |
|       1,000 |                         1,004 |              86,179 / 87,660 |                          78,384 (one trial) |                           642 |                 77,366 |

Warm-open statistics use five trials per size. The click-to-character and heap measurements come from a separate run. That run capped repetitions after a warm open exceeded 30 seconds. Heap is sampled once per animation frame during navigation and can miss peaks within a blocked frame. Each process-cold number is a single restart.

## Switching views on the same board

Twenty rectangles were placed near the origin. Each additional rectangle was placed at least 10,000 model units away. The media variant also contained a local image and an embedded PDF. Fixture creation, saving and initial warming occurred before timing. The benchmark kept a unit zoom and panned the viewport programmatically through 30 animation frames per trial.

| Shapes | Media       | Into Page, median / p95 (ms) | Into Canvas, median / p95 (ms) | First character after focus, median / p95 (ms) | Pan frame p95 (ms) | Longest frame during typing (ms) |
| -----: | ----------- | ---------------------------: | -----------------------------: | ---------------------------------------------: | -----------------: | -------------------------------: |
|    100 | Shapes only |                    483 / 484 |                      519 / 527 |                                        28 / 36 |                7.1 |                               14 |
|    100 | Image + PDF |                    489 / 498 |                      714 / 742 |                                        24 / 33 |                7.1 |                               14 |
|  1,000 | Shapes only |                    714 / 725 |                      754 / 762 |                                        25 / 31 |                7.1 |                              160 |
|  1,000 | Image + PDF |                    758 / 783 |                      978 / 988 |                                        26 / 31 |                7.2 |                              139 |
|  5,000 | Shapes only |              11,466 / 17,972 |                13,561 / 18,321 |                                        38 / 44 |               14.0 |                              708 |
|  5,000 | Image + PDF |              11,314 / 11,670 |                11,329 / 11,698 |                                        33 / 36 |               14.0 |                              715 |

Each row contains five trials. With five observations, nearest-rank p95 equals the largest observation. Pan percentiles pool individual animation-frame intervals. The character measurement verifies the typed text in the editor DOM and waits two animation frames as a paint proxy. The typing sequence spans the 600 ms autosave timer. A frame gap in that interval needs a performance trace to attribute it to a particular operation.

## Opening the same note after lazy Card Deck enrollment

The same native workspace benchmark ran five warm trials per size. All timings below are in milliseconds. Each after trial checked the distinct document IDs requested through the first verified character and its save. Only the target appeared. Fixture setup opened Card Deck and saved the added notes before timing.

| Added notes | Median warm open, before → after | Median click to first character, before → after | Distinct bodies read, before → after |
| ----------: | -------------------------------: | ----------------------------------------------: | -----------------------------------: |
|          10 |                        337 → 343 |                                       481 → 483 |                               14 → 1 |
|         100 |                        875 → 361 |                                       929 → 529 |                              104 → 1 |
|       1,000 |                     86,179 → 782 |                                  78,384 → 1,093 |                            1,004 → 1 |

The 1,000-note first-character baseline had one trial. Opening a note now attaches the target and follows its references. Opening Card Deck explicitly still loads the workspace to discover legacy cards and compute placement filters. Closed placements reconcile shared content and deletions when next loaded.

Canvas/Page switching and long editing frames on the 5,000-shape board remain a separate follow-up.

## Reproduction

Run from the repository root on Windows. Each scenario starts a debug executable with its own database, WebView2 profile and debugging port. Raw per-trial results are written to the scenario’s timestamped folder under `test-results`.

```powershell
pnpm tauri build --debug --no-bundle
node tests/native/editor-baseline.mjs
```

Pass `workspace`, `shapes`, or `media` to run one scenario. Pass `board` to run both board fixtures. Measurements include desktop automation overhead and represent this machine and build.

## Canvas note-height follow-up

A disposable SQLite backup of Software Testing reproduced the slow Canvas switch. It contained 41 notes, 77 surface elements and two attachments. CPU sampling identified repeated synchronous layout measurements in the note-height MutationObserver. The pinned BlockSuite patch uses ResizeObserver border-box measurements instead.

On the copied notebook, two repeated switches before the change took 11,798 and 11,964 ms. With the final patch they took 7,371 and 7,373 ms. These are a small diagnostic sample from the native debug build, not five-trial benchmark medians. The first profiled switches took 14,047 and 8,961 ms respectively. Rich-content mounting and selection/layout work still contribute several seconds.

TypeScript, 51 unit tests, the shared-card browser check, and a focused browser check for content growth, scale, zoom and view remount passed. The installed release was rebuilt, verified and relaunched. A separate binary-search stacking experiment was removed after a grouped/equal-index ordering regression.

## Canvas startup: interactive viewport (9 November 2026)

The current checkout was rebaselined before these changes in the native WebView2 debug build with the production frontend, then measured again under the same build and opening viewport conditions. Each warm result below contains five separate pan trials and five separate typing trials. Times include automation overhead. Twenty rectangles remain near the opening viewport as the total grows; the rest are offscreen. The shape fixture also has one editable note for the typing probe.

The rich fixture is a synthetic board with 41 formatted notes, 77 rectangles, a PNG and an embedded PDF. It is **not** the historical Software Testing copy above; its numbers must not be compared directly with that notebook's two diagnostic switches.

### Actual input results

Times are milliseconds, **median / worst**. Pan means a real Space-drag followed by a verified viewport-center change. Character means entering the requested note, placing the caret, typing `q`, and verifying both DOM text and the paragraph model grew by one character. Pan and typing use separate switches.

| Fixture      | Before first pan | After first pan | Before first character | After first character |
| ------------ | ---------------: | --------------: | ---------------------: | --------------------: |
| 100 shapes   |        792 / 855 |       338 / 452 |              642 / 742 |             296 / 329 |
| 1,000 shapes |    1,267 / 1,439 |       336 / 411 |              952 / 973 |             295 / 334 |
| 5,000 shapes |  15,032 / 16,405 |       441 / 449 |        15,137 / 17,094 |             314 / 394 |
| Rich notes   |   4,757 / 10,123 |     999 / 1,462 |          4,359 / 4,968 |         1,234 / 1,464 |

The scaling curve for first pan is now nearly flat for 100–5,000 shapes. Rich-note layout remains the slower workload. In three of five rich pan trials, the embedded PDF was still loading when viewport movement was verified.

The post-pan settling check (180 ms of DOM quiet with no pending visible media) finished at median / worst 524 / 635 ms, 525 / 595 ms, 623 / 636 ms and 1,184 / 1,647 ms respectively. This is a conservative observation after the input probe, not the earliest possible renderer-idle timestamp. Offscreen notes can intentionally remain previews.

### Separate direct-open trials

These are single, separate pan and typing trials from the Library into a notebook saved in Canvas mode, not process-cold launch measurements.

| Fixture      | Before first pan | After first pan |                    Before first character | After first character |
| ------------ | ---------------: | --------------: | ----------------------------------------: | --------------------: |
| 100 shapes   |                — |             557 |                                         — |                   480 |
| 1,000 shapes |                — |             792 |                                         — |                   686 |
| 5,000 shapes |           13,439 |           1,373 | Failed to enter requested note within 5 s |                 1,324 |
| Rich notes   |            3,396 |           1,424 |                                     4,703 |                 1,627 |

The before direct-open failure exposed cached viewport/pointer coordinates from mounting under the hidden Library. Explicit geometry refresh and a pointer-down origin refresh fix that failure. Save, restart and reopen verified the same document identity, paragraph text and shape count for every after fixture.

### Phase attribution

Median after timings below are relative to the Canvas click except the two layer durations. The viewport-paint mark is an animation-frame proxy, not a GPU presentation timestamp. The note mark is a rich-mount **request**, not completion of its body layout.

| Fixture      | Layer watch duration | Bulk construction duration | First note mount request | Viewport paint proxy | Transition input unlock |
| ------------ | -------------------: | -------------------------: | -----------------------: | -------------------: | ----------------------: |
| 100 shapes   |                  0.3 |                        0.2 |                     71.7 |                129.4 |                   132.1 |
| 1,000 shapes |                  1.3 |                        0.6 |                     68.1 |                114.4 |                   116.4 |
| 5,000 shapes |                 11.1 |                        4.7 |                    108.1 |                172.8 |                   175.8 |
| Rich notes   |                  1.4 |                        1.3 |                     89.5 |                285.4 |                   301.2 |

On the before 5,000-shape direct-open trace, synchronous `LayerManager.watch()` consumed 11,101 ms of the 13,439 ms to first pan. The after layer watch is approximately 10 ms. Its initial layer list now uses the existing bulk reset instead of repeatedly rebuilding all layers. Grouped and ambiguous equal-index inputs retain incremental construction; the common shared-lowest note/shape index is supported by the bulk path. Subsequent edits remain incremental.

The remaining 5,000-shape direct-open time is mostly before layer attachment (watch begins about 1,042 ms after the click in that trial). Document loading/model setup needs further CPU profiling before attributing that interval more precisely. Rich-note mounting/layout is still around one second in the native input measurements.

### Readiness, previews and correctness

Canvas opening now releases only the transition lock once the correct connected document/root has usable viewport geometry and a stable intended position. It does not wait for media, the full block queue, DOM quiet or the extra 220 ms mode-switch hold. Save and navigation locks still apply. Readiness runs are invalidated by newer requests, document/mode changes, root replacement and AbortSignal cancellation.

Canvas overview uses pixel snapshots of the actual rendered browser layout, including database shadow roots. A temporary inert SVG is decoded and painted once into a scaled canvas; the displayed preview contains only cached pixels, so zooming does not re-render a foreignObject document. Tables retain their columns, grid and cell text; headings keep their original positions. Visible notes mount one per animation frame after navigation settles; offscreen notes retain saved bounds until needed. Live content remains visible until a snapshot is ready, and remains the fallback for unsupported, oversized or loading media. Capture does not write document content or create undo entries; the normal rich-note height observer maintains geometry independently of zoom level.

At 40% zoom notes switch to live content; they return to snapshots at 30%. Between those thresholds they retain their previous state. Both layers share the same card layout and crossfade over 140 ms, with zero animation for reduced-motion users. Hover never changes detail. Editors remain mounted and active editing stays visible across zoom changes to preserve caret and IME composition. Snapshots refresh after model/content edits, media/layout changes, theme changes and editor font preferences. The per-editor cache accounts for both source data and decoded pixels, evicting offscreen entries first above a 64 MiB budget. Source snapshots are limited to 4 MiB and bitmaps to 1024×2048 pixels. Unchanged snapshots reuse their existing image; old/released URLs and bitmap references are released. Preview canvases are excluded from export; full-content capture remains unchanged.

Navigation previously requested a Lit update on every card for every viewport event. The 41-card synthetic fixture recorded 4,920 card renders during 120 navigation frames. Viewport handlers now request an update only when crossing an LOD boundary; steady overview movement performs zero note renders. Preview work and new rich-note mounts pause for 250 ms after viewport/wheel/drag activity. Large snapshot copies yield in roughly 3 ms chunks and abort when input resumes. Block-level edit subscriptions invalidate only the owning note, excluding position/index changes and unrelated surface metadata. `tests/canvas-navigation.browser.mjs` covers steady movement, an edit during movement, deferred capture, and actual serialization of only the edited card after the gesture ends.

In one before/after browser diagnostic on 9 November 2026, the 41-card navigation fixture improved from median/p95 frame intervals of 21.7/26.4 ms to 14.1/17.4 ms after rasterizing the previews and removing the redraw loop. Maximum intervals were 43.6 and 21.1 ms respectively. The final run recorded zero note renders, preview requests or computed-style reads during 120 overview navigation frames. These are synthetic browser measurements, not installed-app timing guarantees. The navigation, table LOD, canvas startup, offscreen PNG export and note-height checks all passed, as did TypeScript and targeted ESLint checks.

Distant-card navigation waits for that specific rich note before focusing it. PNG/PDF export uses full-content readiness and promotes all notes, including offscreen notes, then restores zoom-based detail in a finally block; Markdown remains model based. A deferred selection synchronization now checks host identity, connection and version before touching the event handler or caret. All dependency changes are delivered through the pinned pnpm patches for `@blocksuite/blocks@0.19.5` and `@blocksuite/block-std@0.19.5`.

Validation passed: `pnpm check`; `pnpm test` (25 files, 100 tests); `tests/canvas-startup.browser.mjs`; `tests/canvas-direct.browser.mjs`; `tests/canvas-performance.browser.mjs`; `tests/card-deck.browser.mjs`; and `tests/native/canvas-exports.mjs`. Coverage includes preview first-character/caret placement, IME through zoom, Page switching, shared-note updates/save/reload, distant focus, bounds preservation, export promotion, cancellation, overlapping shape hit-testing, groups, equal indexes, reorder and undo. Native export checks exercise Page/Canvas PNG/PDF, Markdown and assets. An additional bounded offscreen-note PNG pixel check passed (`tests/canvas-export.browser.mjs`).

LOD checks include `tests/canvas-lod.browser.mjs` (table live/thumbnail pixel comparison, boundary hysteresis, appearance reuse, model edits, theme refresh and bounds), `tests/canvas-startup.browser.mjs` (offscreen deferral, light/dark previews, hover invariance, first character and IME), `tests/canvas-export.browser.mjs` (offscreen PNG text and preview restoration), and `tests/canvas-performance.browser.mjs` (height through content growth, scale, zoom and remount).

The snapshot revision passed these four browser checks, `pnpm check`, and ESLint for the snapshot service and table regression test. `pnpm update:running` rebuilt and verified the installed release and relaunched Knot on 9 November 2026; the relaunched app was independently confirmed responding.

### Reproducing and raw evidence

Use `KNOT_BENCH_SIZES` to choose shape counts, `rich` for the rich fixture, `KNOT_BENCH_EXE` for an archived executable, and `KNOT_BENCH_ROOT` for a disposable directory under `test-results`. `KNOT_DIRECT_ONLY`, `KNOT_SKIP_DIRECT` and `KNOT_REUSE_FIXTURE` isolate direct-open checks. The benchmark supplies WebView2 background-throttling disable flags, following Playwright's launch defaults, so an occluded test window retains normal animation-frame scheduling. Earlier runs with exact 1,000 ms frame cadence were excluded and retained separately; their 30-second outliers are scheduling artifacts, not valid startup comparisons.

```powershell
pnpm tauri build --debug --no-bundle
$env:KNOT_BENCH_SIZES = '100,1000,5000'
node tests/native/editor-baseline.mjs shapes
node tests/native/editor-baseline.mjs rich
node tests/benchmarks/summarize-canvas-startup.mjs test-results/canvas-startup-before.json test-results/canvas-startup-after.json
```

Consolidated evidence: `test-results/canvas-startup-before.json`, `canvas-startup-after.json`, and `canvas-startup-summary.json`. Final raw after trials: `test-results/canvas-active-100`, `canvas-active-1000`, `canvas-active-5000`, and `canvas-active-rich`. Before warm trials: `editor-baseline-1794211207247` (100/1,000), `editor-baseline-1794211647056` (5,000), `editor-baseline-1794213119089` (rich). Before direct trials: `canvas-verified-before-5000` and `canvas-verified-before-rich`. The archived before executable is `test-results/knot-canvas-before.exe`.

### Installed build status

The final release was installed successfully on 9 November 2026 after the user closed Knot normally. The completed `scripts/update-running.ps1 -SkipBuild` run reused the successful `pnpm update:running` release build, verified the installed executable against it, and relaunched Knot. Both executables have SHA-256 `476120D8114678EC82C68576F37D9153E8FFCF823EF11D6DDE84D2A5316C77D1`. The relaunched installed process was independently confirmed at `C:\Users\Acer\AppData\Local\Knot\knot.exe`, with title `Knot` and `Responding=True`. Performance numbers above remain debug-build measurements, not installed-release timings.

Earlier desktop installation attempts stopped safely because the running app refused normal close and displayed `runtime error: failed to send message to the webview` despite showing `Saved`. No force termination was used. The diagnostic retry is logged in `test-results/Knot-DesktopUpdate-b589319f479844baae0dd184b3bbfaca.log`. The update script now retains desktop-task transcripts and reports the concrete failure instead of only task result 1.

### Panning follow-up: demand-driven previews (9 November 2026)

A real Space-drag regression check exposed unnecessary snapshot serialization after panning at live-detail zoom. An edited card rebuilt an invisible overview snapshot after the gesture. Preview requests now remain queued until the card is visible in overview; live-detail mode does not repeatedly poll that queue. Capture also rechecks navigation after asynchronous hashing and image decoding, before rasterizing or replacing the preview.

The new check fails before this change (one hidden snapshot build) and passes afterward (zero), then verifies that zooming out services the deferred request. Existing overview movement still records zero note renders, capture requests and computed-style reads. This is a targeted regression fix, not a measurement of the user's particular notebook or a guarantee that all panning costs are eliminated.

Validation: TypeScript, targeted ESLint, canvas navigation (including real Space-drag), canvas startup/editing/IME/undo, and table LOD/layout/theme checks passed. The table comparison now first visits overview to request its snapshot before comparing live and cached content at the same scale.
`pnpm update:running` completed successfully for this follow-up: the installed executable was verified and Knot relaunched.

### Full canvas preparation behind loading (9 November 2026)

This supersedes the early viewport-ready behavior above. Canvas navigation now paints the loading screen before opening the destination and retains the input lock until all note bodies (including offscreen notes), fonts, local image/PDF loading markers, and initial preview work have settled. Errors retain the existing failed-load lock; cancellation and document/root replacement invalidate preparation. Prepared roots can focus existing cards without repeating full initialization.

Loading retains the bulk layer-construction optimization. The readiness gate drains the block queue immediately rather than waiting for DOM quiet first, mounts all remaining note bodies together, and prepares cached snapshots without the normal 250 ms interaction delay or an extra animation frame per card. Offscreen blocks are temporarily measurable behind the loader, then offscreen notes are explicitly culled before interaction resumes. A note-height observer now ignores hide/show notifications with unchanged nonzero height, preventing redundant snapshot builds on the first pan into a prepared card. Normal edits and real height changes still invalidate previews.

The 41-note synthetic startup check measured 2,833 ms in a single run and 3,371 ms while other checks ran concurrently. These are browser diagnostics, not installed-app or real-notebook timing guarantees. Both runs completed preparation before readiness and verified zero new note mounts or preview builds when navigating to a previously offscreen card. The test also checks that pending offscreen media holds readiness. Direct-open typing, first character, IME, zoom, cancellation, export promotion, groups/ordering/undo, table previews and theme refresh, real drag navigation, note-height updates, and offscreen PNG export passed. TypeScript and targeted ESLint passed. Preview cache limits and unsupported-media live fallbacks remain in effect.

## Sustained desktop panning (9 November 2026)

**The shared-translation change removes per-card transform writes, but does not improve p95 frame gaps beyond desktop trial variation. The 16.7 ms goal remains unmet.** This is a measured reduction in renderer writes and a correctness-verified foundation, not a claim that sustained panning is now smooth.

The baseline was collected before editing the renderer, on a disposable copy of the actual Software Testing notebook. It matched the handoff: 31 note cards, 62 surface elements, and 8,433 DOM descendants in Chapter 2; 30 cards had cached previews. The source database was opened read-only and copied using SQLite's online backup API, including committed WAL contents. Assets were copied locally. Each run used a separate workspace and WebView2 profile under ignored `test-results`; the installed workspace was never benchmarked or edited.

Packaged Codex sees redirected LocalAppData containing starter notebooks. `scripts/snapshot-panning-workspace.ps1` obtains the snapshot under the interactive desktop token, without closing or changing the user's app. It verifies the notebook exists before accepting the copy. A plain copy of the live `knot.db` would not have been a consistent snapshot.

### Protocol and environment

Both executables use `pnpm tauri build --debug --no-bundle`: a native debug host with the production frontend. These are **desktop WebView2 measurements, not installed-release timings**. The original executable was archived before renderer changes. A final matched replay against that archived original separates movement frame gaps from release/click latency; the earlier pre-edit baseline remains archived too.

Windows reported a 1920×1080 display at 144 Hz, with 125% scaling. WebView2 reported a 1280×844 CSS-pixel window, a 1048×788 canvas viewport, and devicePixelRatio 1.25. Its short frame cadence was approximately 6.9 ms. Both runs supplied the same background-throttling disable flags. Five prepared/warm trials ran per route at each fixed zoom, for 20 trials per executable. No profiler ran during these trials.

The replay holds Space and sends 120 pointer movements at a steady 16 ms source cadence: 240 CSS pixels right and 60 down, then back over the same coordinates. CDP acknowledgments are collected independently so a slow paint cannot pause the input source. The harness verifies movement at the midpoint and the final return center; coalescing can reduce the number of delivered viewport updates. Frame sampling stops before mouse release. Release-to-click includes mouse-up, Space-up, a real click and two animation frames, including automation overhead; it is a response proxy, not a GPU presentation timestamp or typing benchmark.

Starting centers were `[4083.676, 222.714]` for the Chapter 2 edge at 15%, `[1794.343, 222.714]` at 100%, and `[100892.343, 99972.714]` for both empty controls. The Chapter 2 right edge starts 120 CSS pixels into the viewport and crosses the edge during the drag. The pointer starts at client `[632, 406]`. Each trial restores its starting viewport before replay.

### Matched results

Frame gaps below are milliseconds: **median of trial p50 / median of trial p95 / largest observed gap**. The over-50 count is summed across all five movement trials.

| Zoom / route | Original frame gaps | Shared translation frame gaps | Gaps >50 ms, before → after | Trial p95 range, before → after |
| --- | ---: | ---: | ---: | --- |
| 15%, Chapter 2 edge | 7.1 / 173.7 / 277.9 | 34.7 / 187.5 / 284.8 | 114 → 112 | 131.9–215.3 → 139.0–201.4 |
| 15%, empty | 34.7 / 118.1 / 145.9 | 27.8 / 117.4 / 131.9 | 60 → 57 | 104.2–125.1 → 111.1–125.0 |
| 100%, Chapter 2 edge | 41.7 / 83.4 / 152.7 | 41.6 / 83.4 / 97.3 | 88 → 62 | 83.3–97.2 → 76.4–90.3 |
| 100%, empty | 27.8 / 104.2 / 132.0 | 27.7 / 104.2 / 132.0 | 57 → 54 | 97.3–125.0 → 97.2–104.2 |

| Zoom / route | Release-to-click before, median / worst | Release-to-click after, median / worst | Card transform writes across five trials, before → after |
| --- | ---: | ---: | ---: |
| 15%, Chapter 2 edge | 539.1 / 686.0 | 449.7 / 553.0 | 8,525 → 0 |
| 15%, empty | 221.5 / 273.3 | 197.5 / 251.9 | 12,617 → 0 |
| 100%, Chapter 2 edge | 248.6 / 309.7 | 210.9 / 236.5 | 11,129 → 0 |
| 100%, empty | 175.4 / 278.2 | 169.7 / 224.4 | 13,392 → 0 |

No new paragraph mounts or native storage invocations occurred in any timed trial. Preview-build marks were 4 before and 1 after on the overview edge route, and zero elsewhere; this counter extends through the first-click response window and can include deferred work after release. The original pre-edit steady-input baseline recorded zero preview marks on every route. The synthetic gesture regression independently verifies zero serialization during navigation and targeted refresh afterward.

The complete original model maps from both benchmark copies were compared with the frozen source after normal save/close: every pre-existing block and surface property was identical, including text and geometry. Synthetic alignment additions were made only after timing and tracing, in the disposable after copy.

### Renderer and remaining cost

The existing `gfx-viewport` now carries the shared screen translation. Card transforms retain local position/zoom/scale and update on zoom or model changes, while fixed-zoom pans skip their transform writes. Frames keep their dimension-based zoom behavior, and edgeless text retains its local scale and rotation. The viewport remains the source of truth for pointer mapping, culling and selection; drag, wheel and programmatic movement share the same path. Nothing reparents editor DOM.

The actual DOM contains DOM cards and a surface whose raster canvases interleave by z-index. The surface already renders in viewport coordinates. Relative `left`/`top` offsets cancel the shared translation at that surface without creating a new surface stacking context. Moving the surface with a counter-transform would flatten its canvases into one stacking context and break above/below-card ordering. The mixed-board regression checks actual raster pixels and real clicks for both orders, plus connector pixels, frame/text bounds, intermediate reversals, zoom changes and zero card transform calls.

That regression also exposed rotated text sizing from its rotated screen rectangle and percentage-height rich text. Text now measures unrotated layout dimensions with its model scale and uses natural rich-text height; unchanged/hidden measurements do not rewrite geometry. This prevents the saved bounds from growing during a pan or zoom.

Separate rendering traces still show appreciable work after writes disappear. The before/after edge traces recorded 418/474 ms of `UpdateLayoutTree`, 104/93 ms of layout, 230/239 ms of paint, 243/248 ms of layer preparation and 496/710 ms of accessibility processing. They contain 80/115 main-frame slices respectively, so these totals are **not normalized performance comparisons**, and nested trace categories must not be added together. They identify remaining style/layout, input/selection and accessibility lifecycle work; raster tasks alone were only 33/28 ms. A source-level CPU investigation of that cross-route work should precede further renderer expansion.

In the after trace, the longest individual paint slice was 4.77 ms, versus 120.65 ms for `UpdateLayoutTree` and 149.52 ms for accessibility processing. This is a stronger reason to investigate lifecycle invalidation than to add a new image-capture path. These are separate profiled diagnostic slices, not unprofiled trial frame gaps.

**Oversized preview disposition: deferred; no sectioned preview was added.** Chapter 2 still uses the supported live fallback at the 8,000-element guard. The shared change did not isolate the residual lag to overview capture: empty routes still have 104–117 ms p95 gaps, reading zoom still has 83 ms, and the trace retains substantial lifecycle work. A preview would not address that empty/reading workload, and a new capture path is not justified as the next fix by this comparison. The existing source-size, decoded-pixel, cache, editing, IME and full-content export behavior is preserved.

Native export validation additionally exposed an existing full-preparation deadlock on the fresh Welcome board: offscreen `loading="lazy"` images never started loading, while their loading markers held readiness. Preparation now temporarily requests those images eagerly and restores their original lazy policy in `finally`, including cancellation. A browser regression places an image 100,000 pixels offscreen, verifies that full preparation loads it, and verifies restoration. This final readiness correction is outside the measured sustained-movement path; the archived shared executable and numbers above isolate the renderer change before this follow-up. The final candidate includes it; native export and installation status are recorded below. The native export harness retains full startup readiness, allows the full preparation timeout, uses the same background-throttling flags as the desktop benchmark, and reports assertion failures before cleanup errors.

### Verification and reproduction

Passed: `pnpm check`; `pnpm test` (25 files, 100 tests); ESLint on touched test/harness files; `KNOT_NAV_ASSERT=1` navigation; startup; direct-open; LOD; performance/height; and canvas export browser checks. Coverage includes model edits during motion, prepared offscreen cards entering view, first-character placement, IME, zoom hysteresis, theme refresh, bounds, remounts, groups/equal indexes, reorder/undo, wheel movement and full-content export. The same mixed-card/shape/connector/frame/rotated-text pixel and real-click assertions also passed inside native WebView2 after the desktop timings.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/snapshot-panning-workspace.ps1
pnpm tauri build --debug --no-bundle
# Archive each executable immediately after building its source revision.
$env:KNOT_BENCH_EXE = (Resolve-Path 'test-results/knot-panning-before.exe').Path
node tests/native/canvas-panning.mjs before-paired
$env:KNOT_BENCH_EXE = (Resolve-Path 'test-results/knot-panning-shared.exe').Path
$env:KNOT_PAN_ALIGNMENT = '1'
node tests/native/canvas-panning.mjs shared-paired
node tests/benchmarks/summarize-canvas-panning.mjs test-results/canvas-panning-before-paired test-results/canvas-panning-shared-paired
```

Raw trial data, fixture/window/display metadata, executable hashes, separate traces and screenshots live in `test-results/canvas-panning-before-paired` and `test-results/canvas-panning-shared-paired`; the summary is `test-results/canvas-panning-summary.json`. The original pre-edit runs are retained in `canvas-panning-before-final` and `canvas-panning-before-desktop-2`; the latter used acknowledgment-paced input and is diagnostic only, not the matched comparison above. Browser tests used a separate Vite cache and bounded entry scan to avoid interference from existing dev servers and the many local WebView2 fixture files.

Final native export validation passed without intervention (`test-results/panning-native-exports-clean.log`): full fresh-workspace startup, Page/Canvas PNG and PDF, Markdown with assets, visible shape and note pixels, and unchanged export document state. The fresh Welcome board's optional YouTube `maxresdefault.jpg` returns HTTP 404 before fixture creation; the harness logs it separately and asserts console cleanliness from creation of the actual export fixture. The final startup regression, direct-open and browser export checks, TypeScript, 100 unit tests and touched-file ESLint also passed after the readiness correction.

### Installed result

`pnpm update:running` completed successfully on 9 November 2026. It built the release and installer, closed the existing app through its normal close/save flow, verified the replacement and relaunched Knot. No force termination was used. Independent verification found the installed process at `C:\Users\Acer\AppData\Local\Knot\knot.exe`, title `Knot`, `Responding=True`. Both the installed executable and `src-tauri/target/release/knot.exe` have SHA-256 `A05539DCA5F248073C29FE484F3E8ADD831DEF77478DC6A925D0B9DFD69E53BE`.

The updater log is `test-results/panning-installed-update.log`; the desktop-token transcript is `test-results/Knot-DesktopUpdate-877ac37f931a4f1d83ed347b4bed326e.log`. Installation success does not change the sustained-panning limitation reported above: desktop p95 did not improve beyond trial variation.

## Canvas opening: compact preview styles (10 November 2026)

CPU profiling of the current full-preparation path identified repeated computed-style copying and SVG serialization as avoidable startup work. Each snapshot element previously received roughly 90 individual CSS setters and a complete inline declaration. Snapshots now share identical computed declarations through classes in an internal SVG stylesheet. Every selected computed property is retained, including measured dimensions and typography; HTML, SVG, images, canvases and flattened shadow-root content use the same rules. The stylesheet is XML-serialized along with the content.

This retains the full-preparation gate, offscreen rich-content mounting, media readiness, preview limits, cancellation, editing fallback and export behavior. It does not defer initialization into the first pan or change the viewport/zoom policy.

Headless Edge measurements used the same 1400×900 browser viewport and 1000×850 editor, a Vite development frontend, and sequential before/after runs. The before real-notebook run intercepted only the preview module with its original source; all other code and fixture data stayed the same. The saved Software Testing fixture came from the existing read-only `test-results/panning-source` snapshot; saves were mocked in memory. These are browser diagnostics, not native release or process-cold launch timings.

| Fixture | First preparation, before → after | Repeated Page → Canvas median, before → after | Warm samples per version |
| --- | ---: | ---: | ---: |
| 41 synthetic cards | 3,556 → 2,366 ms | 2,744 → 1,972 ms (28% reduction) | 3 |
| Saved Software Testing notebook | 16,593 → 12,658 ms | 14,180 → 10,771 ms (24% reduction) | 4 |

First preparation starts after attaching the editor. Repeated trials start immediately before switching back to Canvas and end after full readiness. Each run's final additional trial was CPU-profiled and excluded from these medians. In the synthetic profile, individual CSS setters previously accounted for 281 ms and serialization for 166 ms; neither appears among the after profile's leading costs. Rich-content mounting, layout and computed-style reads still contribute to opening time.

Raw measurements and profiles are `test-results/canvas-open-{before,after,real-before,real-after}.{json,cpuprofile}`. The local diagnostic harnesses are `test-results/canvas-open-bench.mjs` and `test-results/canvas-open-real.mjs`, run with `KNOT_TEST_ORIGIN=http://localhost:1430` against the bounded Vite configuration `test-results/vite-panning.config.mjs`. The original preview module is retained at `test-results/canvas-note-preview-before.ts` for the comparison.

Validation passed: TypeScript, touched-file ESLint/Prettier, 107 unit tests, canvas startup (including zero new mounts or previews on the first offscreen pan), table pixel/layout comparison, edits/theme invalidation, IME, ordering/undo, direct-open typing and viewport restoration, browser canvas export, and `KNOT_NAV_ASSERT=1` navigation with mixed DOM/raster alignment and actual click assertions. Table pixel difference remained within the existing tolerance (3.92% changed pixels, 1.72% mean difference).

`pnpm update:running` completed successfully on 10 November 2026, including normal close/save, replacement verification and relaunch. The installed app is responding, and both executable hashes are `BB0964C10635B6BD6EE2283665525970D8359AC013FC8FA68F6768781059D5FF`. The build/update log is `test-results/canvas-opening-installed-update.log`. Native release opening time was not separately benchmarked.

## Canvas opening: overlapped previews and disk cache (11 November 2026)

Profiling the 41-card `canvas-startup` fixture split full preparation (~1,520 ms) into rich-content mounting/rendering (~370 ms), media and quiet-period waits, and preview capture (~770 ms: snapshot 300 ms, SVG decode 383 ms, rasterization 36 ms), followed by a 180 ms quiet period restarted only by the preview layers themselves.

- **Overlapped decode.** While the loading screen owns input, the next card is snapshotted while up to four earlier SVGs decode. Background rebuilds stay sequential with 3 ms slices. Preparation slices are 40 ms, yielding through a message-channel task instead of clamped nested timers, and a first capture skips the SHA-256 comparison.
- **Preview-only mutations ignored.** The readiness gate's quiet period ignores mutations confined to `[data-knot-note-preview]` layers (absolutely positioned decorations that never move content).
- **Disk cache.** Preview SVGs are restored from `cache/previews/` (see STORAGE.md) for unchanged cards, skipping their snapshot. SVG decode is still required, because `foreignObject` canvases cannot be read back to cache a bitmap, and Chromium decodes those SVGs serially on the main thread even when they are requested concurrently.
- **Launch splash.** The post-animation pause is 250 ms instead of 850 ms, and the fade is 200 ms instead of 320 ms.

Headless Edge, Vite development frontend, same viewport/editor sizes as above:

| Fixture | Before | After |
| --- | ---: | ---: |
| 41 synthetic 8-line cards, full preparation | ~1,520 ms | ~1,000–1,100 ms |
| 41 synthetic 40-paragraph cards, preview phase only, fresh → cached | ~4,200 ms | ~700–1,000 ms |

On the heavy fixture, total preparation on a cached reopen is dominated by rich-content rendering of every card (1.8–3.4 s, noisy). Without cache hits, the fingerprint costs about 1 ms per card. The full-preparation gate, offscreen mounting and viewport/zoom policy are unchanged.

Validation: TypeScript, ESLint, 109 unit tests, 90 passing Rust tests (including 2 new cache tests), and canvas-preview-cache (new: reuse across full page reloads, edit invalidation, prune, corrupt-entry fallback), startup, LOD, performance, navigation, direct, export, wheel-focus and AI canvas browser tests.
