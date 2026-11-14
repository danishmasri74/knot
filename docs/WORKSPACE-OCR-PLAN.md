# Offline OCR for workspace search

Plan written 14 November 2026. **Phase 1 implemented 14 November 2026** (images in notes, canvases and cards) and **phase 2 implemented 14 November 2026** (scanned PDF pages, line highlights); see "Phase 1 as built" and "Phase 2 as built". Phase 3 (reuse) is not started.

## Goal

Text that exists only as pixels becomes findable by workspace search, and Ask Knot can cite it:

- images in notes and on canvases (screenshots, photos of whiteboards or slides, scanned handouts);
- PDF pages with no text layer (scanned PDFs, or scanned pages inside an otherwise normal PDF).

Everything runs on this device. No image leaves the computer, nothing is downloaded at runtime, and it costs nothing per image.

**It must stay light on the device.** OCR is optional background work: it never competes with the user for CPU, never runs on battery unless asked, and never runs a burst over a large backlog. Revised 14 November 2026 to add the resource budget below.

## Not in scope

- **Describing what an image shows** (charts, diagrams, photos without text). That needs a vision model; it stays with `view_images` on the open note.
- Handwriting quality. Windows OCR reads neat print handwriting poorly; we index what it returns and don't promise more.
- Making scanned PDF pages selectable in the PDF reader, or OCR in Library search. Both can reuse this later (phase 3).
- Sending OCR text instead of images to `view_images`. Separate decision.

## Repository facts checked during planning

- Workspace search is a renderer pipeline (`src/services/workspace-topic.ts`) feeding a disposable native cache (`src-tauri/src/topic.rs`, SQLite FTS5 plus 384-dimension E5 vectors, `FORMAT = 3`). `topic_replace` stores the passages of one source at one revision; nothing is written to the workspace.
- `extractTopicContent` (`src/services/topic-extract.ts`) walks a document's blocks and already returns side lists for slower work: `pdfs` (attachments with `prop:type = application/pdf`) and `videos` (YouTube cards). The indexer then extracts each one and embeds the passages through the worker's `passages` call. OCR fits as a third list, `images`.
- Images are `affine:image` blocks (`prop:sourceId`, `prop:caption`) on both Page and Canvas; image files can also be `affine:attachment` with an `image/*` type (`src/features/editor/blocksuite/ai.ts:209`). Bytes are content-addressed assets: `attachments.get(key)` in the renderer, `Workspace::asset_path(sha256)` in Rust (`src-tauri/src/storage.rs:498`).
- PDF extraction for search (`src/services/topic-pdf.ts`) already marks pages with empty text as partial and skips them. Those are the OCR candidates. Passages carry a `pdf` location `{ key, documentId, blockId, page }`, so citations open the reader at the page.
- Knot ships Windows only (NSIS target) and already depends on the `windows` crate (0.62).
- Image citations don't exist yet. Citation kinds live in `src/services/ai-citations.ts`.

## Engine

**Recommendation: Windows' built-in OCR (`Windows.Media.Ocr`).**

| | Windows.Media.Ocr | Tesseract (WASM) | PaddleOCR (ONNX) |
|---|---|---|---|
| Download size | none, part of Windows | ~5–15 MB per language | ~10 MB+, more per script |
| Speed | fast, native | slow in WASM | medium in WASM |
| Languages | the OCR packs installed with the user's Windows languages | the packs we bundle | the scripts we bundle |
| Line and word boxes | yes | yes | yes |
| Confidence | no | yes | yes |
| Platform | Windows 10+ | any | any |

Windows OCR adds nothing to the installer, is quick enough for background indexing, and follows the languages the user already has. Its gaps (no confidence score, weak handwriting) are acceptable for search. The engine sits behind one Rust function, so it can be swapped for a bundled model later if Knot leaves Windows.

Languages: `OcrEngine::TryCreateFromUserProfileLanguages`. If none of the user's languages has an OCR pack, OCR is reported as unavailable with a pointer to Windows Settings → Language (installing the optional OCR feature), and nothing else changes.

## Design

### Native command

`ocr_image` in a new `src-tauri/src/ocr.rs`, behind `windows` features `Media_Ocr`, `Graphics_Imaging`, `Storage_Streams`, `Globalization` and `Foundation_Collections`, plus `Win32_System_Power` and `Win32_System_Threading` for the resource budget.

- **Input:** either an asset (`activation`, attachment key; Rust resolves the SHA-256 and reads the file itself, so image bytes never cross IPC) or raw PNG bytes for a rendered PDF page (sent as a raw invoke body, not a JSON number array).
- **Work:** decode with `BitmapDecoder` (PNG, JPEG, GIF, BMP, TIFF; formats without a Windows codec, such as SVG, are skipped), downscale to fit `OcrEngine::MaxImageDimension`, convert to a `SoftwareBitmap`, call `RecognizeAsync`.
- **Output:** lines in reading order, each with its text and bounding box (fractions of the image), plus the language used.
- Runs on one dedicated low-priority thread (see the resource budget) with the WinRT apartment initialised there; one recognition at a time; a per-image timeout; cancelled when indexing stops. The workspace lock is never held during OCR (same rule as `topic_replace`).

### OCR result cache

OCR is the slow step, and the same image can appear in many notes or be re-indexed after every edit. Each image is read **once**, and results are cached by **image SHA-256 + engine version + language**.

The cache is its own file, `ocr.sqlite`, next to the topic caches in app local data, shared by all workspaces. It is **not** a table in the topic cache: `open()` in `topic.rs` deletes a topic cache whose `FORMAT` doesn't match or that fails `quick_check`, and OCR results must survive those rebuilds, workspace switches, restores and relocated copies. Like the topic cache it stays outside workspaces, backups and `.knotbook` files. Entries for images not seen by any indexing pass for 90 days are pruned.

An image is read again only when:

- its bytes change (editing or replacing an image gives it a new hash; moving, resizing on the page, recaptioning or editing the note around it does not);
- the OCR language changes (a different Windows language pack is used);
- Knot deliberately bumps the engine version after an improvement, which is a release decision;
- `ocr.sqlite` is lost or corrupt, or the workspace is opened on another computer.

An image marked unreadable (two timeouts, or no usable text) is recorded too and not retried until it changes. Reading nothing useful is still a result.

### Indexing

- `extractTopicContent` also returns `images: { key, blockId, caption }[]`, deduplicated by key, at most 50 per source.
- For each image the indexer calls `ocr_image`, joins lines into text, drops results with fewer than 3 words or mostly non-letters (Windows gives no confidence, so this guards against noise from photos), splits long text with `splitPassage`, and embeds it through the existing `passages` call.
- Passages: `id` = the image block, `title` = `<caption or "Image"> · text in image`, and a new optional `image: { key, documentId, blockId }` location.
- **Scanned PDF pages:** `topic-pdf.ts` keeps the page numbers it skipped for having no text. For those (at most 200 per PDF) the renderer draws the page with pdf.js to an `OffscreenCanvas` at about 2× scale, capped at 2 megapixels (enough for body text; it halves render work and memory compared with the reader's 4 MP), and sends the PNG to `ocr_image`. Pages are drawn one at a time inside the same budget as images, and the canvas is released after each page. Passages reuse the existing `pdf` location, so citations open the page as they do today. A PDF whose only gaps were scanned pages stops being reported as partial once they are read.
- Small images (under 64 px on either side) and images over the 10 MiB asset limit are skipped.
- OCR is not part of a source's normal indexing pass. Text, PDF and transcript passages are stored as today; images go into a separate OCR queue, and their passages are added to the source when read. Ordinary search is never delayed by OCR.
- `FORMAT` goes from 3 to 4 so existing workspaces re-index once and pick up their images. This is the disposable search cache only: no workspace schema, `.knot` or `.knotbook` change, and no effect on what older Knot can read.

### Resource budget

The aim is that the user can't tell OCR is running: no fan spin-up, no noticeable battery drain, no lag while typing. Windows OCR is the engine Windows' own tools use and is light per image, but a backlog of hundreds of images or scanned pages adds up, so the work is paced rather than run as fast as possible.

**Two kinds of work.**

- **New images** (pasted, dropped or imported into a note while Knot is open): read one by one shortly after the note saves. This is a handful of images at a time and naturally spread out.
- **The backlog** (images already in the workspace when the feature arrives, scanned PDF pages, a workspace restored from backup): never read automatically in bulk. Settings shows "142 images and 38 scanned pages not read yet" with **Read now**; until the user chooses it, only new images are read. Once started, the backlog follows the pacing rules below and can be paused.

**When OCR may run.** Before each image the queue checks, and waits if any fails:

- **On mains power.** On battery, or with Windows battery saver on, OCR waits (`GetSystemPowerStatus`). Settings has "Also read on battery", off by default.
- **The user isn't busy.** No keyboard or mouse input anywhere on the computer for 30 seconds (`GetLastInputInfo` is system-wide, so OCR also waits while the user works in other apps). Input pauses the queue after the current image.
- **Knot is not doing heavy work:** no Ask Knot request streaming, no workspace switch, backup, restore or export, no first-time text indexing, no update in progress.
- **The window state doesn't matter:** minimised or in the background is fine, as long as the other rules hold.

**How hard it may work.**

- One image at a time, on one thread, never a pool.
- The thread runs at background priority with Windows' efficiency mode (`THREAD_MODE_BACKGROUND_BEGIN` and `ThreadPowerThrottling`/EcoQoS through `SetThreadInformation`, `Win32_System_Threading`), so Windows schedules it below everything else, prefers efficiency cores, and keeps clocks low.
- A rest after every image at least as long as the image took (OCR busy at most half of the time on one core), and a longer rest (one minute) after every 20 images.
- A ceiling per hour (300 images or pages) so an enormous backlog spreads over days instead of running all evening.
- Images are downscaled before OCR: longest side at most 2,500 px, which keeps text readable and memory small. Larger photos aren't read at full resolution.
- A per-image timeout of 10 seconds; an image that times out twice is marked unreadable and not tried again until it changes.

**Resuming.** Queue progress is the OCR cache itself: anything already read is never read again, so closing Knot, pausing or losing power just resumes later where it stopped.

**Status, so it is never invisible.** Settings shows what OCR is doing: "Reading images · 12 of 142", "Paused: on battery", "Paused while you work", "Done". There's a **Pause** button. Workspace search coverage shows how many images are still waiting.

These numbers are starting points. They are set from a measurement on this machine (see Verification) before phase 1 ships, and kept as constants in one place.

### Ask Knot and citations

- New citation kind `image`: Open source opens the note or canvas and selects and scrolls to the image block. Phase 2 can highlight the matched line using the stored boxes.
- The source card shows the matched OCR text, labelled "Text read from image", so it's clear the words weren't typed.
- The model is told these passages come from OCR and may contain recognition errors.

### Settings and status

- Settings → AI, under Search workspace automatically: **Read text in images and scanned PDFs**. On by default for new images only; the existing backlog waits for **Read now** (see the resource budget). Under it: **Also read on battery** (off), the status line and **Pause**. Turning the main switch off stops the queue at once and removes OCR passages from the search cache; `ocr.sqlite` is kept so turning it back on doesn't redo the work.
- When OCR isn't available for the user's languages, the setting says so in one line with a link to Windows language settings.
- Search coverage counts OCR'd images ("Includes text from 12 images").

## Phase 1 as built

- **Native:** `src-tauri/src/ocr.rs`. `engine::read` decodes with `BitmapDecoder`, downscales to 2,500 px, skips images under 64 px and runs `OcrEngine::TryCreateFromUserProfileLanguages`. `decide` and `rest` hold the pacing rules as pure functions with unit tests; the `knot-ocr` thread sets background priority and EcoQoS, then loops: check the rules, survey the active workspace, read one image, store, rest. Results go to `app_cache_dir/ocr-v1/ocr.sqlite` (`results` keyed by SHA-256, engine `windows-ocr/1` and language; `workspaces` holds when OCR first saw a workspace and whether Read now was chosen). Ask Knot requests hold OCR through `OcrState::busy`; the renderer holds it while indexing text (`ocr_hold`); a workspace lock held by backup, restore or switch makes it wait (`try_lock`).
- **New vs backlog:** an image is new when its asset file was created after OCR first saw the workspace. Restored and relocated workspaces get a new identity, so their images are backlog.
- **Search cache:** `FORMAT` 4 adds `images(source, key, sha256)`. `topic_replace` registers a source's image keys and the keys whose text it included; if a reading exists that wasn't included (stored after the renderer looked), the source is saved with an empty revision so the next pass indexes it again. After reading, the thread drops the sources holding those images from the cache at most once a minute (or when it stops or rests) and emits `ocr-read`, which makes the renderer reconcile.
- **Renderer:** `extractTopicContent`/`extractDeckPassages` return `images` (image blocks and image attachments, one per key, at most 50). The indexer asks `ocr_lookup` for stored readings, splits each into passages titled "<caption or Image> · text in image" with an `image` location, and embeds them like other passages.
- **Ask Knot:** the provider receives only title and text, and `SEARCH_RULES` says those excerpts may contain recognition errors. The source card shows "Text read from image" and **Open image**, which checks the image is still in the note or card, opens it and outlines the image block.
- **Settings → AI:** "Read text in images" under Search my workspace, with the live status, **Read now** for older images, **Also read on battery** and **Pause** (session only).
- **Not done in phase 1:** a recognition can't be interrupted part-way, so the 10-second timeout isn't enforced; an image whose read fails twice is marked unreadable. The resource measurement on a 200-image workspace and the native end-to-end test are still to do.

## Phase 2 as built

- **Rendering in the background, not the window.** Instead of pdf.js in the renderer (the original plan), scanned pages are drawn by Windows' own PDF renderer (`Windows.Data.Pdf`, `engine::read_pdf_page`) on the `knot-ocr` thread at about 2 megapixels, so page drawing follows the same pacing, priority and idle rules as images and costs the window nothing. The last PDF's bytes stay in memory between its pages. Password-protected or damaged PDFs fail as unreadable.
- **Pages are units.** `ocr.sqlite` (format 2, older files are rebuilt) and the search cache (`FORMAT` 5) key results by asset hash **and page**; page 0 is an image file. `topic_replace` and `ocr_lookup` take `{ key, page }` units.
- **Which pages.** `extractTopicPdf` lists pages with no text layer (`scanned`, at most 200 per PDF) instead of counting them as partial. Their passages reuse the PDF location with the page and are titled "<PDF> · p. N · text in image" with `ocr: true`; the source card says "Text read from scanned page". A PDF stays reported as partial until all its scanned pages are read.
- **Line highlights.** `ocrPassages` (`src/services/ocr-passages.ts`) splits OCR text into passages and keeps the boxes of the lines in each. Scanned-page citations pass them as PDF highlight rects, so the reader opens at the page with those lines marked; image citations draw the same marks over the image for a moment (`highlightImageLines` in `App.tsx`).
- **Tests:** `reads_a_scanned_pdf_page` (fixture `tests/fixtures/ocr-scan.pdf`, built by `generate-ocr-scan.mjs`: one typed page, one image-only page), page-level results in `records_failures_then_gives_up`, and the passage/box test in `tests/topic-retrieval.test.ts`.
- **Still not done (at phase 2):** the native end-to-end test and the 200-image/50-page measurement. Both were run on 14 November 2026; see "Verification results".

## Verification results (14 November 2026)

**End to end:** `node tests/native/ocr.mjs` (with `pnpm dev` and a debug build; leave the keyboard and mouse alone). An isolated workspace gets a note with an image, a canvas with a different image and a note with a two-page PDF whose second page is image-only. Background OCR read them (and the Getting Started pictures, 6 items) in about 13 s; search finds all three; a saved Ask Knot answer citing them opens the note and the canvas with one mark per line read, each mark on the picture, and opens the PDF at page 2 with the lines highlighted; Pause shows as paused; turning OCR off removes its passages and turning it on brings them back from the cache in about 3 s without reading anything again; Knot closes normally. The citation step uses a saved chat because Tauri's IPC can't be mocked from the page (see below), so no AI request is made.

**Resources:** `node tests/native/ocr-benchmark.mjs 5` (debug build, 12-thread laptop): 200 distinct images in 20 notes and a 50-page scanned PDF.

| | After fixes | Before the rest fix |
|---|---|---|
| Knot CPU while reading, average | **0.34%** of the machine | 1.3% |
| Knot CPU, peak 5-second sample | 1.6% | 2.9% |
| Window stalls while reading | worst 2 ms | worst 2 ms (about 120 ms during re-index) |
| Pace | batches of 20, then a 1-minute rest: about 19 a minute until the 300-an-hour ceiling | about 36 a minute, no long rests |

A 250-item backlog therefore takes about 50 minutes. The only stall over 50 ms in the fixed run was the test creating its 21 documents.

**Found and fixed by these runs:**

- The native search cache rebuilt passages from a fixed struct without `image` or `ocr`, so OCR citations lost their image location, line boxes and scanned-page flag. `Passage` now carries both; `FORMAT` 6 re-indexes once.
- Rests were ended early by any wake-up, including the renderer's indexing hold after each batch. A rest is now a deadline (`Pace::rest_until`).
- Readings were handed to search (which costs the window some work) as the user came back to the keyboard. Now only while they are still away.
- The PDF reader only drew rectangles of saved highlight cards and the current selection, so cited lines on a scanned page weren't marked. It now marks a cited passage that isn't a saved card.
- On a canvas, image marks were placed while the canvas was still opening and zooming. They now wait until the picture has stopped moving.
- Debug test runs shared the real OCR cache in app local data; with `KNOT_TEST_DATA_DIR` the cache now lives in the test folder.
- **Not OCR, found on the way:** Ask Knot sends `callId` with workspace-search and image-viewing results, while `SearchResult` and `ImageResult` in `ai.rs` only accepted `call_id`. Every answer that searched the workspace or looked at images failed at its second request with "invalid args `searches`… missing field `call_id`". Both now accept either spelling (`tool_results_accept_the_renderers_camel_case`).

**Testing note:** this app's Tauri IPC goes over `postMessage`, and `invoke`, `ipc` and `postMessage` on `__TAURI_INTERNALS__` are non-writable. Overriding `window.fetch` or `invoke` in a native test does not intercept `ai_*` commands, so such tests reach the real provider with the user's saved key. Two attempts while writing `ocr.mjs` did (priced under $0.0003 in total; only test text was sent). Native tests that mock AI this way, such as `topic-retrieval.mjs`, should be checked before they are run again.

## Phases

1. **Images in notes and canvases.** `ocr.rs`, the OCR cache, the paced queue with every resource rule (power, idle, priority, rests, hourly ceiling, Pause, status), `images` extraction, `image` passages and citations, the setting with Read now, `FORMAT` 4. The budget ships with the first version, not later.
2. **Scanned PDF pages.** Page rendering, page passages, partial-PDF accounting, highlight of the matched line for images.
3. **Reuse.** Selectable OCR text in the PDF reader's empty pages, OCR in Library search, OCR text for the open note's images in Ask Knot's note context (cheaper than `view_images` for text-heavy screenshots).

## Verification

- Rust unit tests on generated fixture images (printed text in two languages, a blank image, a photo with no text, an oversized image, an unsupported format), skipped with a clear message on a machine without an OCR language pack.
- A browser test for extraction: image blocks on Page and Canvas produce `images` refs, duplicates collapse, the cap holds.
- A native test (`tests/native/ocr.mjs`) in an isolated workspace: a note with a screenshot is found by a word that only appears in the image; the citation opens the note at the image; a scanned PDF page is found and opens at its page; turning the setting off removes those results; editing the note re-indexes from the cache without calling the engine again.
- **Resource measurement before shipping**, on this laptop, with a workspace of 200 images and a 50-page scanned PDF: time and peak memory per image, Knot's CPU share while the backlog runs (target: under 10% of total CPU averaged over a minute), and confirmation that typing in a note stays smooth with the queue active. The pacing constants are set from these numbers.
- Unit tests for the queue rules with a fake clock and fake power/idle sources: waits on battery and battery saver, pauses on input and resumes after 30 s idle, waits during an Ask Knot request, honours rests and the hourly ceiling, resumes from the cache after a restart, never reads the backlog before Read now.
- The native test also checks that a newly pasted image is read without Read now, and that Pause stops the queue.

## Open questions

- Should captions typed by the user be indexed even when OCR is off? They're text already and cheap.
- How should multiple Windows languages be handled? Try the profile's first language with an OCR pack, or run a second language when the first returns little text.
