# YouTube cards: side-panel player with transcript

Plan written 14 November 2026, after a brainstorm. **Phase 1 implemented 14 November 2026** (side panel, fetch, schema 13); phase 2 (Ask Knot) is not started.

## What the user asked for

- Clicking a YouTube card works as it does today: it plays inline.
- The card's toolbar gets a new button, **Open in side panel**.
- The side panel shows the video player at the top and the transcript underneath, as timestamped lines.
- Clicking a line seeks the player to that moment. The line being spoken is highlighted and kept in view.
- The transcript is saved, so it's fetched once and is there next time.
- Later, Ask Knot can use the transcript and cite **which YouTube card** and **which timestamp**. Clicking a citation opens that card's side panel at that moment.

The reference is Heptabase's video card (player on top, transcript list with timestamp chips below, current line highlighted). Knot doesn't add a new object type: the video stays a card inside a note or canvas.

## Design mockup

Agreed 14 November 2026 on the design canvas "YouTube side panel" (a private claude.ai artifact). It has four artboards:

1. **Main screen:** the note with the YouTube card selected and its toolbar showing **Side panel**. The side panel is a tab next to Ask Knot. From top to bottom: the player, title and channel, a find box, the caption-language `<select>` and Refresh, then the transcript grouped under chapter headings. The current line is a grey row with a blue timestamp chip. The footer shows the caption kind and the save date. While the panel plays the video, the inline card shows "Paused · playing in side panel".
2. **Card toolbar:** the button in the Page hover toolbar (pressed when the panel already shows this video, and clicking it again closes the panel) and in the Canvas toolbar. Tooltip: "Open in side panel · video and transcript".
3. **Panel states:**
   - Not fetched: a short explanation and **Get transcript**.
   - Loading: placeholder lines and **Cancel**.
   - Failure: one grey line, such as "No captions for this video", and **Try again**. Keep failures this short: no explanations, no extra buttons.
4. **Ask Knot (phase 2):** inline `▶ 12:24` citation chips. The source card shows the video, "YouTube card in <note>", the quoted line, and **Play from 12:55** and **Go to card**.

## Repository facts checked during planning

- YouTube cards are BlockSuite's `affine:embed-youtube` block (props include `url`, `videoId`, `title`, `creator`). Knot doesn't own its schema, so the transcript can't live on the block. Its inline player is `https://www.youtube.com/embed/<id>` with no player-control option.
- The CSP in `src-tauri/tauri.conf.json` already allows `frame-src https://www.youtube.com/embed/`, `img-src https://img.youtube.com` and YouTube oEmbed.
- PDFs already follow the same pattern: `src/features/editor/blocksuite/pdf-toolbar.ts` adds a button to the attachment toolbar on both Page (portal toolbar) and Canvas (shadow-root toolbar) via `observeToolbarMounts`, and `src/app/App.tsx` opens `PdfReader` as a `"pdf"` tab in the contextual tool slot it shares with the Mini browser and Ask Knot.
- PDF citations carry a location (`PdfLocation` in `pdf-highlights.ts`), and citation kinds live in `src/services/ai-citations.ts` (`note`, `link`, `web`). A video citation is a new kind next to these.
- The native web fetcher is `src-tauri/src/web_sources.rs` (SSRF checks, size limits, cancellation). Schema is `CURRENT_SCHEMA = 12` in `src-tauri/src/migrations.rs`; older builds refuse newer databases.

## Getting the transcript (tested 13 November 2026)

- **Fails:** caption URLs taken from the web watch page (`ytInitialPlayerResponse` → `captionTracks[].baseUrl`) return 404. YouTube now wants a proof-of-origin token there.
- **Works:** `POST https://www.youtube.com/youtubei/v1/player?prettyPrint=false` with an `ANDROID` client context and the `videoId` returns `playabilityStatus`, `videoDetails` and caption tracks. Fetching a track's `baseUrl` returns timed text format 3: `<p t="ms" d="ms">text</p>`. Auto-generated tracks (`kind: "asr"`) nest words in `<s>` tags, which are stripped.
- This route isn't documented and can break. It's the approach open-source transcript tools use, and they need occasional fixes. Keep the client details in one place so a fix is a small change, and fail with a clear message.
- The user starts every fetch. Nothing is fetched when a card is pasted or a note opens.

### Track choice

1. Creator-uploaded captions before auto-generated ones.
2. The interface language, then English, then the first track.
3. A language menu in the panel lists the other tracks, and fetches one on request.

## Design

### Toolbar button

- New `src/features/editor/blocksuite/youtube-toolbar.ts`, modelled on `pdf-toolbar.ts`: when the toolbar belongs to an `affine:embed-youtube` block with a `videoId`, add **Open in side panel** (tooltip and accessible name). Page and Canvas.
- Clicking the card body is unchanged.

### Side panel

- A `"video"` tab kind in the contextual tool slot, beside `"pdf"` and `"browser"`, with its own `VideoReader.tsx` (lazy loaded). It identifies its card by document ID + block ID + video ID.
- Top: the YouTube player in a 16:9 frame, `https://www.youtube.com/embed/<id>?enablejsapi=1`.
- Below: the title and channel, then the transcript in its own scroll area, so the player stays visible.
- Each line: a timestamp chip (`m:ss` or `h:mm:ss`) and the text. Merge raw captions into lines of roughly 5–10 seconds that end at sentence breaks where possible.
- Chapters from the video description (lines starting with a timestamp, the first at 0:00) become small headings in the list.
- A find box filters or highlights matching lines.
- Footer: the caption kind ("Creator captions" or "Auto-generated captions") and the save date.
- **Get transcript** button when nothing is saved yet; **Refresh** and the language menu otherwise.

### Playback sync

- Seek: `postMessage({event:"command", func:"seekTo", args:[seconds, true]})` to the player frame, then `playVideo`.
- Current time: send `{event:"listening"}` and read `infoDelivery` messages (`currentTime`). Check `event.origin` is `https://www.youtube.com` and `event.source` is our frame before trusting a message.
- Highlight the line containing the current time and scroll it into view, unless the user has scrolled the list in the last few seconds.
- Fallback if messaging fails in WebView2: reload the frame with `&start=<seconds>&autoplay=1`. It works but loses the highlight.

### Saving

- Schema 13 adds `video_transcripts` (`video_id`, `language`, `kind`, `fetched_at`, `data`): one row per video. Choosing another caption language fetches it and replaces the row. `data` is versioned JSON: title, channel, duration, chosen and available tracks, chapters and segments (`start`, `duration`, `text`), with a 2 MiB cap.
- Keyed by video ID, not by card, so every card for the same video shares one transcript, and pasting the card elsewhere keeps it.
- Workspace backups, restore and relocation include it through the database.
- `.knotbook` sharing does **not** copy transcripts in the first version. A recipient fetches again with one click. This keeps the `.knotbook` format and `minKnotVersion` unchanged.
- Older Knot refuses a schema-13 workspace, as with every schema change. **Suggest a release** when this lands.
- Commands: `video_transcript_get(workspace, videoId)` and `video_transcript_fetch(workspace, videoId, track?, preferred)` (fetches and saves; the network request runs without the workspace lock). Cancel in the panel stops waiting; a request already sent may still finish and save. No delete command yet.

### Failure messages

One short grey line plus **Try again**, nothing more:

- "No captions for this video"
- "This video is private or unavailable" (also covers removed, age-restricted, members-only and region-blocked, from `playabilityStatus`)
- "You're offline"
- "Couldn't read captions. Knot may need an update" (YouTube changed its response)

A saved transcript stays readable offline. Only the player needs a connection.

## Ask Knot (phase 2)

- When a note or canvas in the request contains YouTube cards with saved transcripts, include them as sources. Each passage is a short span (about 30–60 seconds, or a chapter) with its start time.
- New citation kind `video`: document ID, card block ID, video ID, start seconds and title. Shown as `[12:34]` with the video title.
- Clicking it opens the card's side panel and seeks to that time. If the card is gone, open the video on YouTube at `&t=<seconds>s`.
- Long transcripts use the existing section selection for long pages, so only the parts relevant to the question are sent.
- Workspace search indexes transcripts, so Ask Knot can find a video across notes.
- Saved chats keep the matched passage, as web citations do now.
- A YouTube link pasted into Ask Knot (not a card) can use the same fetch as a one-off web source with timestamp citations. Nothing is saved.

## Feasibility

Assessed 14 November 2026 from the code and one live test of the fetch. Sizes are relative: S is about a day or less, M a few days, L a week or more.

| Piece | Feasible? | Size | Why |
| --- | --- | --- | --- |
| Toolbar button (Page + Canvas) | Yes | S | Same mechanism as `pdf-toolbar.ts` (`observeToolbarMounts`, portal and shadow-root toolbars). |
| `"video"` side-panel tab | Yes | M | `App.tsx` already has tab kinds `ask`, `pdf`, `browser`, `cardDeck`, with per-kind width and undo handling. Add one kind and a lazy `VideoReader`. |
| Player in the panel | Yes | S | The CSP already allows `https://www.youtube.com/embed/`. Adding `?enablejsapi=1` stays within that origin. |
| Seek and current-line highlight | **Yes (spike passed)** | S–M | Uses the player's `postMessage` protocol, so no YouTube script is needed (the CSP `script-src 'self'` stays). Verified in WebView2 from `http://tauri.localhost`: see Spike results. |
| Pausing the inline card while the panel plays | Likely | S | Needs the same messaging in the card's own frame, which has no `enablejsapi` today. Otherwise only show "playing in side panel" when the card isn't playing. Not essential. |
| Fetching the transcript | **Yes (spike passed)**, can break | M | `reqwest` 0.12 with `rustls-tls` (Knot's existing setup) fetched creator and auto-generated tracks in about 0.3–0.4 s. The web route returns 404. It needs fixture tests and a clear error when YouTube changes its responses. |
| Saving (schema 13 table) | Yes | M | The migration pattern exists. Older Knot then refuses the workspace, so it needs a release. |
| Ask Knot sources and citations | Yes | M–L | The closest model is web captures, not PDFs: `ai-context-composer.ts` already sends website passages as `citationSources` with sections and resolves `web` citations. A transcript becomes a capture whose sections carry `startSeconds`. The new parts are the citation kind, the chip and the open-and-seek action. |
| Workspace search over transcripts | Yes | M | `search.ts` indexes by flavour (`SEARCH_FLAVOURS`, with MCQ special-cased). Transcripts live in the database, not the doc, so indexing joins YouTube cards to saved transcripts by `videoId`. |

**Conclusion:** everything is feasible with code Knot already has, and nothing needs a new dependency. Phase 0 confirmed both external unknowns on 14 November 2026. What remains is a maintenance cost: the fetch can break when YouTube changes its endpoints.

### Spike results (14 November 2026)

Throwaway code only, outside the repository. Nothing in Knot changed.

**1. Transcript fetch from Rust.** A small Rust program using the same `reqwest` setup as `src-tauri` called `youtubei/v1/player` with the `ANDROID` client, chose a track and parsed timed-text format 3.

| Video | Result |
| --- | --- |
| Me at the zoo (19 s) | OK: creator `en` track, 6 segments, 0.34 s |
| A 3Blue1Brown lecture (18 min 40 s) | OK: 31 tracks (30 creator, 1 auto-generated). Creator `en`: 286 segments, 26 KB, 0.33 s. Auto-generated `en`: 533 segments, 106 KB, 0.40 s, punctuated, nested `<s>` tags stripped correctly. |
| A music video (3 min 33 s) | OK: creator `en`, 61 segments |
| Made-up ID | `playabilityStatus` `ERROR`, "This video is unavailable", no tracks: maps cleanly to the unavailable message |

Notes for the build:
- Auto-generated segments **overlap** (rolling captions: each lasts about 4 s but they start about 2 s apart). Use start times only to find the current line, and merge by start time.
- At about 106 KB for 19 minutes of auto-generated XML, a 3-hour video is about 1 MB of raw XML and much less once parsed into JSON. The 2 MiB cap holds.

**2. Player control inside Knot.** A debug build with embedded assets (`pnpm tauri build --debug --no-bundle`) ran with disposable data (`KNOT_TEST_DATA_DIR`), so page origin was `http://tauri.localhost` as in the installed app. The test injected `https://www.youtube.com/embed/<id>?enablejsapi=1&origin=http%3A%2F%2Ftauri.localhost` into the page:

- `onReady` and `initialDelivery` arrived, with duration 1120 s. No CSP violations.
- `mute` + `seekTo(120)` + `playVideo`: playing (state 1) at 124.5 s. A screenshot shows the video playing inside Knot.
- `pauseVideo` + `seekTo(600)`: paused (state 2) at exactly 600 s.
- During playback, `infoDelivery` sent `currentTime` about every 250 ms (13 updates in 3 s), which is enough for the current-line highlight.
- WebView2 "Tracking Prevention blocked access to storage" warnings for youtube.com are harmless. Playback is unaffected.

**Gotcha found:** a plain `cargo` debug build loads `devUrl`. Without the dev server, the page origin is `null`, and YouTube refuses with **error 153** (player configuration / missing referrer). The installed app is fine because it has a real origin. Native tests of the player need the embedded-asset debug build, or the dev server running.

**Not covered:** unmuted `playVideo` without a user gesture. In the real panel, a timestamp click is a user gesture in the parent page, and the frame has `allow="autoplay"`. If the browser still blocks unmuted playback, seek and show the frame's own play button, or start muted and unmute on the next click.

### Open questions

- **Storage alternative:** a schema-13 table (recommended) or a JSON file per video in the workspace's asset store. Assets avoid a schema change, but they're content-addressed and tied to documents, which doesn't fit a lookup by video ID.
- **Canvas:** should the button come in phase 1 on Canvas too, or Page first? It costs little extra (same toolbar mechanism).
- **Transcripts in `.knotbook` later:** this needs a format change and a `minKnotVersion` bump.
- **Size limit:** a 3-hour video's transcript is about 200–400 KB, so a 2 MiB cap covers practically everything.

## Phases

0. **Spike: done 14 November 2026, both parts passed** (see Spike results).
1. **Side panel:** toolbar button, `VideoReader`, fetch command, schema 13 storage, seek and highlight, chapters, find, failures. Useful without any AI work.
2. **Ask Knot:** transcript sources, `video` citations that open the panel at a timestamp, workspace search.
3. **Later:** transcripts in `.knotbook`, quoting selected lines into the note with a timestamp link, MCQ cards from a video, on-device Whisper for videos without captions.

## Verification

- Rust tests: track choice, format-3 parsing (including `asr` `<s>` tags and entities), `playabilityStatus` error mapping, size caps. Use saved fixtures, not live YouTube.
- Frontend tests: line merging, chapter parsing, timestamp formatting, current-line lookup, citation round trip.
- Manual checks in the installed app: Page and Canvas buttons, seek and highlight, light and dark themes, narrow window, keyboard focus and Escape, a video with no captions, offline with a saved transcript, backup and restore.
- Any dropdown (language menu) uses `ChoicePopover` and the shared dropdown styles.

## Risks

- **The fetch can break** when YouTube changes its endpoints. Keep it isolated and the error clear.
- **Player messaging in WebView2** was confirmed in phase 0. It depends on a real page origin (error 153 otherwise).
- **YouTube's terms** discourage automated access. Lower risk here because the user starts each fetch and everything stays on the device.
- **Auto-generated captions** have no punctuation and contain errors. Label them, and keep AI answers citing timestamps so claims can be checked.
