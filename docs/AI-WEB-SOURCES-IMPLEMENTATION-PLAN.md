# Ask Knot: URLs to sourced notes and canvas cards

Core release implementation, 7 November 2026. Milestones 0–5 are implemented; final verification and installed-update evidence are tracked in [AI-WEB-SOURCES-VERIFICATION.md](AI-WEB-SOURCES-VERIFICATION.md). Follow-on remote PDFs and browser capture remain deferred.

## User intent and agreed behavior

Users can send one or several website URLs to Ask Knot and ask it to read, explain, compare, or turn them into notes. On Canvas, reuse the existing generation of multiple native note cards and labeled connections. On Page, reuse Insert content. Generated material is a reviewable proposal before Apply; normal Undo and autosave still apply.

Example: “Read these three URLs, make study notes grouped by topic, and connect related ideas.”

The feature must handle failures independently, disclose missing/partial sources, cite content actually captured, and preserve sources in saved notes/cards. Do not invent facts from inaccessible pages or treat a supplied URL as proof that its contents were read.

This handoff authorizes planning only. In the next chat, implement when the user requests it. Do not create a new chat automatically.

## Repository facts checked during planning

- `src/app/AskKnot.tsx` owns request construction, context attachments, chat persistence, streaming, proposal previews, Apply and citation UI. Saved chats are workspace-scoped localStorage records; request context is saved, editor instances and undo closures are omitted.
- `src-tauri/src/ai.rs` owns AI requests, cancellation, instructions and strict proposal schemas. Text context has a 180,000-byte limit. Existing canvas limits include 20 cards, 40 connectors and 60 mind-map nodes.
- `src/services/ai-citations.ts` currently models note citations as document/block identities. Web citations need a separate source kind and resolver.
- `src/services/ai-source-scope.ts` controls note inclusion. “No notes” must not accidentally exclude explicitly supplied web sources.
- `src/features/editor/blocksuite/ai.ts` validates and applies native proposals with editor/workspace/revision guards and grouped Undo.
- `src/features/editor/blocksuite/ai-content.ts` builds native content. Its inline formatter currently handles bold/italic, not durable web citations.
- `src/features/editor/blocksuite/card-suggestions.ts` has a separate request-context path. Both request builders must share the new source composer to avoid inconsistent evidence.
- `src/features/editor/blocksuite/card-deck.ts` stores a card's child content, not arbitrary placement-only metadata. Source provenance must travel with the card's child content.
- `src/services/pdf-input.ts` handles an existing PDF attachment, with a 10 MiB reader limit and single PDF/image input path. This is not already a multi-URL PDF pipeline.
- Knot already has a single native mini browser: `src/app/BrowserPanel.tsx`, `src/services/browser.ts`, `src-tauri/src/browser.rs`, `browser_windows.rs`. It deliberately has no extraction, saved sources, or AI access. See `docs/MINI-BROWSER.md`.
- `src-tauri/src/lib.rs` rejects application commands from untrusted webviews before dispatch. Preserve this guard for all new commands.
- `src/services/web-links.ts` provides address classification/normalization for navigation. It is not sufficient network-address validation for a public-source fetcher.
- The working tree already contains extensive modified/untracked user work. Preserve it. Re-read relevant code before implementation; this plan is not a clean-branch baseline.

## Delivery scope

Complete the core release through milestones 0–5 below:

- One or multiple explicitly supplied public HTTP/HTTPS pages; HTML and plain text.
- Directly pasted URLs and a + Context → Website URLs entry.
- Ask, Insert content and Create on canvas, with existing note/image/PDF behavior preserved.
- Per-source progress, preview, Retry, Remove and explicit Refresh.
- Mixed successes/failures, disclosed coverage, stable captured evidence and durable card citations.
- No automatic crawling of links found within fetched pages or notes.

Follow-on milestones are direct remote-PDF ingestion and capture from the existing browser. Detect these cases and provide recovery in the core release; do not claim support before their gates pass. No external extraction service, additional API key, or production headless-browser bundle is needed for the core release.

## Product contract

### Input and source states

Detect explicit HTTP/HTTPS URLs in submitted prompt text, including Markdown links and multiple lines. + Context also accepts a list and normalizes bare hostnames. Show detected source chips before submission where practical; removing a detected chip must keep it excluded for that submission even if its URL remains in the prose.

Use a URL parser after candidate detection. Handle punctuation and balanced parentheses without damaging valid URLs. Deduplicate exact normalized URLs and identical captured documents; preserve meaningful query parameters, signed query values and fragment targets. Do not trust canonical tags as permission to fetch another address. Group ordinary anchor variants for one fetch, but preserve their requested section; hash-route pages need a rendered-browser fallback.

Use these source states: queued, fetching, extracting, ready, partial, failed, cancelled. Unsupported type/access restrictions are structured reasons, not fake readable content. “Ready” means usable content was captured, not guaranteed completeness.

Source chips show title/domain/status. Details show original/final URL, capture time, extracted text/sections, warnings, and which sections were supplied to the AI. Display private-looking query values sparingly in chips and diagnostics; preserve exact URLs only where needed for retrieval/provenance.

### Batch outcomes

- All readable: generate normally.
- Some failed: general summary/card requests continue using readable sources with a conspicuous “3 of 4 sources used” notice listing exclusions. Do not ask for confirmation for every ordinary failure.
- Essential source absent: a request such as “compare A against B” cannot be fulfilled as a complete comparison if B fails. Explain the missing evidence; offer Retry or an explicitly labeled account of the available source. Do not quietly manufacture a comparison. Enforce all-failed handling in application code; semantic dependency handling also needs model instructions and acceptance examples, not a brittle keyword-only guarantee.
- All failed: skip source-based generation and show recovery options. A user can separately request a general answer, clearly distinguished from reading those URLs.
- Partial content: usable partial sources may participate, with visible warnings in preview and saved provenance.
- Stop: cancel fetching, extraction and generation, retain completed captures, and ignore late results. Retrying one failed source does not refetch successful ones.
- Refresh: create a new immutable capture. Old answers/proposals keep their old evidence. Changing selected captures invalidates an unapplied proposal for this request; never silently swap its evidence.

## Architecture and initial limits

`Prompt / + Context → source coordinator → native fetch → extraction worker → captured passages → shared context composer → existing AI modes → proposal → durable source content + Apply`

Proposed initial constants, centralized and enforced in native code where relevant: 8 unique URLs per submission, 3 concurrent fetches, 20-second per-source total deadline, 60-second batch deadline, 5 redirect hops, 4 MiB decoded HTML/text per response, 16 MiB aggregate downloaded decoded content per batch, and 3-second extraction-worker deadline. These are product defaults to tune against fixtures, not existing app limits. Stream bodies with a cap even when Content-Length is absent or false; bound compressed and decoded data. Bound total sections, DOM size and output size as well.

One bounded retry for transient network/5xx errors; honor Retry-After within the batch deadline. Do not retry login, challenge, certificate or permanent 4xx failures automatically. Timeout includes body transfer and redirects. Keep network cancellation separate from the existing AI cancellation registry but expose one Stop action for the active operation.

### Source records

Create versioned TypeScript types for source attempts, immutable captures and selected evidence. Captures include source/capture ID, requested and final URL, title, optional author/published time, fetched time, content type, extraction method/version, content hash, warnings and ordered sections. Publication dates are nullable metadata; never substitute fetched time for published time.

Each section has a stable ID within its capture, heading path, content kind and text. Evidence references resolve to capture ID + section ID. Source IDs and URL destinations come from application code, never invented model output.

Use a discriminated citation union (`note`, `web`, existing PDF handling) with a backwards-compatible reader for current chats. Request-local [S1] numbering remains a presentation detail. Stable evidence identities survive different ordering and future turns.

### Fetch boundary

Add `src-tauri/src/web_sources.rs` with trusted-shell-only fetch/cancel commands registered behind the existing `browser::trusted` dispatch check in `lib.rs`.

- Use a separate reqwest client: no OpenAI Authorization header, browser cookies, user credentials, automatic remote resource fetching, or inherited browser session.
- Accept public HTTP/HTTPS only; reject credentials, reserved Knot/app origins, local files, non-public IPv4/IPv6 destinations, loopback/link-local/private/metadata addresses and malformed addresses.
- Resolve and validate all candidate IPs; bind connections to validated addresses while preserving hostname/TLS checks so a second DNS lookup cannot bypass validation. Apply the same policy to each manually followed redirect. Do not rely on hostname regex checks alone. Account explicitly for proxy configuration rather than silently trusting a proxy to enforce destination rules.
- Preserve normal TLS verification. Redirect loops and HTTPS-to-HTTP downgrades produce explicit errors under a documented policy; default to rejecting the downgrade.
- Determine actual response type from headers and bounded inspection. Detect ordinary HTML error/login/challenge pages even with HTTP 200. Treat certainty as limited; provide view-content access for ambiguous pages.
- Keep bodies and exact signed URLs out of diagnostics/error logs. Do not hold workspace locks while networking.
- Bind operations/results to workspace session and request generation. Cancel/discard on workspace switch, restore, unmount or replacement request; no result may attach to a different workspace/chat.

Native fixture tests can inject a transport/resolver or a cfg(test)-only public-address policy. Do not introduce a release localhost bypass or disable TLS for tests.

### Extraction and context budget

Proposed extraction stack: `@mozilla/readability` plus `linkedom/worker` in a dedicated Vite Web Worker, using a DOM implementation that does not render remote content. Validate their compatibility in milestone 0. Readability is article-oriented; preserve/fallback to meaningful `main`/`article` documentation structure when its output loses important code, tables or headings. Do not blindly accept the whole body as an article.

Parse without executing page scripts, loading subresources or inserting fetched HTML into the live shell DOM. Return plain structured sections only. Resolve source links against the final URL, validate link schemes, and keep them inert unless the user opens them. Render previews through normal text/native components. Do not use dangerouslySetInnerHTML on captured HTML.

Handle declared encodings/BOMs, Unicode, malformed HTML, empty pages and bounded large DOMs. Strip scripts/styles/forms/navigation/ad boilerplate while preserving meaningful list, code and table boundaries. Mark unsupported visual/iframe content and detected truncation as coverage warnings. Short valid pages must not fail solely because they are short. No heuristic can prove universal completeness.

Compose web evidence alongside note context, leaving headroom beneath the existing 180,000-byte serialized-context limit. Count UTF-8 bytes including metadata and duplicated evidence. Avoid repeating the same text in structure/text/citation tables. For long sources, split at semantic boundaries and select passages using prompt terms/headings with diversity across selected sources; show included/omitted sections. For broad summaries that exceed coverage capacity, say “selected sections” and offer narrower requests. No hidden paid summarization calls or embeddings are required for the first release.

Do not silently drop a whole source to satisfy the budget. If even minimal useful coverage will not fit, show an actionable limit message. Keep explicit web sources independent of the note-scope toggle. Rewrite can use web evidence as read-only support while retaining the current selection-only edit targets.

### Persistence and citations

For chat, save only bounded selected passages and capture metadata in the frozen request; do not put raw HTML or entire fetched documents into repeated localStorage turns. Preserve current visible storage-failure recovery. Regenerate/reopen reuses captured evidence without an automatic network request. Continuing a chat shows which sources are attached and re-includes retained selected captures deliberately; prior assistant text alone is not evidence.

For applied cards/notes, introduce a native child content block such as `knot:web-source` with versioned bounded source metadata and supporting excerpts. Keep it as card content so it survives Card Deck reuse, document snapshots and native backups. Do not overload the PDF-specific `knot:cited-excerpt` URL semantics. Implement schema/view/service, registration, text/HTML export adapters, copy/paste and integrity/search handling as needed by existing extension conventions.

Extend web-enabled structured proposals with per-content `sourceRefs` (and connector evidence where applicable), validated against the exact frozen evidence table. Legacy proposals/chats without this field continue to load. Resolve refs to captured metadata in application code; models cannot supply arbitrary source HTML, destinations or block properties. Unknown refs make a proposal invalid rather than becoming clickable fake citations. Structural validation does not prove semantic support; instructions and quality fixtures must test that separately.

Render compact source references beside supported content and a collapsible excerpt view. Opening a website is a user action via existing validated link routing. Ask-mode citations resolve to web captures instead of calling the note block navigator. Applied content must remain understandable if the chat is deleted or the original website disappears.

Pure web-derived mind maps need a companion source card with captured evidence and node references; preserve existing mind-map generation. Source blocks, generated cards and connectors belong to the same native Undo operation. A stale editor revision, changed selected evidence or failed source serialization prevents Apply. Do not attach provenance only to placement metadata: the Card Deck would lose it.

The first release stores selected evidence, not an offline mirror of complete websites. Durable source blocks and new PDF assets (later) use normal workspace backup handling; chat-only evidence retains the existing chat backup exclusion. Explain this distinction in AI documentation.

## Milestones and file map

### 0. Freeze contracts and prove extraction feasibility

- Re-read AGENTS.md, current AI/browser/card-deck paths and existing user changes.
- Add source/citation types and centralized limits; establish backwards compatibility fixtures.
- Prove Readability + linkedom/worker on representative article/documentation/table/code/Unicode/malformed/hostile fixtures in a production Vite build. Verify no scripts or subresource requests run. Worker timeout is enforceable by termination.
- If the DOM compatibility gate fails, select a native HTML parser/extractor behind the same section interface and record the decision before building UI; do not ship a live untrusted-page renderer as a shortcut.

### 1. Native fetch service

- Add `src-tauri/src/web_sources.rs`, cancellation/lifecycle state, commands and tests; update `lib.rs` and dependencies only as needed.
- Deliver typed outcomes, manual redirect/IP validation, bounded streaming, MIME/encoding handling and trusted-shell command tests.

### 2. Source coordinator and composer UI

- Add `src/services/web-sources.ts`, `web-source-types.ts`, `web-source-extract.worker.ts`, a shared AI context composer, and a focused UI component such as `src/app/WebSourceList.tsx`.
- Integrate URL detection, + Context, status/detail/retry/remove/refresh and unified Stop in `AskKnot.tsx`.
- Keep native browser behavior unchanged. Reuse `ShellMenu`, `ChoicePopover`, `ShellIcon` and `src/styles/dropdowns.css`; no local menu skins.
- Maintain light/dark styles, keyboard use, focus, live progress announcements and viewport bounds. Source previews must not overlay the native browser incorrectly.

### 3. Evidence composition and AI generation

- Update `ai-citations.ts`, `ai-source-scope.ts`, shared request building and `src-tauri/src/ai.rs`.
- Include web captures in ask/insert/canvas requests, explicit coverage/outcome manifests and consistent evidence numbering.
- Update both normal and card-suggestion request paths without discarding existing note context.
- Preserve disagreements, distinguish inference, refuse unsupported full comparisons, ignore instructions embedded in sources, and prevent invention of missing source content.
- Add structured source refs and validation without breaking existing modes or saved chats.

### 4. Durable native provenance

- Implement/register `knot:web-source` and adapters; extend AI preview and apply paths in `ai-content.ts`, `ai.ts`, `AiBlockPreview.tsx` and relevant editor registration/export paths.
- Verify Card Deck sharing, source ownership, existing card content signatures/revisions, native snapshot save/reopen and backup restore.
- Keep one grouped Undo, cancellation/staleness behavior and accurate autosave failure reporting. Cite supporting sections, not just a generic list of URLs.

### 5. Acceptance, documentation and installed app

- Add deterministic source fetch/extraction/batch tests and native end-to-end coverage described below.
- Update `docs/AI.md`, relevant storage/architecture notes and verification evidence. Revise the old “no browsing” instruction to describe captured web evidence accurately; the model itself still has no autonomous browsing tools.
- Run checks and focused regressions. Then run `pnpm update:running` to build, close/save normally, replace, verify and relaunch the installed app. This is already authorized by AGENTS.md; no extra confirmation. Never force-kill the user's app. Report build/update failure honestly.

### Follow-on A. Direct PDF URLs

Core release identifies PDF responses and offers external open/download plus attach-in-Knot recovery. Then extend the native service with a bounded ephemeral download result and an explicit ownership path into existing PDF preparation.

Reuse PDF text/page rendering and model inputs while preserving page numbers and PDF limits. The current API accepts one PDF input: multi-PDF batches need an intentional backend design, budget handling and tests. Do not silently analyze a PDF filename, first-page thumbnail or extracted text while claiming full visual PDF understanding. Unapplied temporary captures must not create hidden permanent workspace attachments. Commit needed assets through the normal verified attachment path and preserve references on Apply/backups.

### Follow-on B. Explicit capture from Knot's browser

Add an “Use this page in Ask Knot” action in the trusted browser chrome. Native code reads bounded DOM/content through WebView2 at a specific navigation ID/session/URL; reject capture if it navigates meanwhile. The page itself never receives workspace state, AI credentials or a new invoke capability. Do not accept unsolicited page messages as trusted source captures.

This can handle some JavaScript-rendered pages and pages the user has legitimately opened. It does not guarantee login/payment/bot-challenge support. Capture is explicit: browser visits do not silently become AI context or persisted URLs. Clearly show that captured content will be included in the AI request. Keep form inputs/passwords out of capture. Browser and Ask Knot share the contextual tool slot, so finish capture before switching panels. Re-run the native browser isolation gate after any browser changes.

Automated browser rendering of arbitrary URL batches is a separate future capability. It must not navigate away from the user's existing browser page or reuse its authenticated session silently.

Implemented 13 November 2026 as a separate hidden renderer rather than the mini browser: it uses its own throwaway profile, so it never touches the user's browser page or session. See "Pages built with JavaScript" in [AI.md](AI.md). The explicit "Use this page in Ask Knot" action above is still open.

## Required acceptance matrix

Use deterministic fixture pages/transports and mocked AI. Public smoke tests are optional; they must not replace assertions or require user API charges.

| Area | Required evidence |
| --- | --- |
| Input | Single/multiple/Markdown URLs, punctuation, parentheses, duplicate links, meaningful queries, fragment variants, limits, removed detected chip |
| Network | Redirect chains/loops, DNS failure, slow headers/body, 404/403/429/5xx, bounded retry, TLS errors, MIME mismatch, absent/lying Content-Length, compressed oversized body |
| Destination rules | IPv4/IPv6 private/local/link-local/metadata, reserved app origins, credentials, DNS rebinding attempts, redirect into a forbidden destination, proxy policy |
| Extraction | Article, docs, code, tables, non-English/RTL, malformed/short/empty HTML, iframe/visual gaps, HTML 200 challenge/login/paywall, no script/subresource execution |
| Batch | All success, mixed success/partial/failure, all failure, cancel at each stage, late callback, failed-only retry, workspace/chat switch isolation |
| Budget | Long sources, multiple source diversity, UTF-8 byte limits, visible omitted sections, no silent complete-source drop, localStorage quota failure |
| AI/evidence | Note + web mixture, No notes with web attached, comparison missing a source, contradictions, source prompt injection, invalid refs, no citations to earlier unsupplied evidence |
| Persistence | Frozen regeneration, explicit refresh, legacy chat reload, applied sources survive chat deletion/restart, Card Deck reuse, native backup/restore, HTML/text export |
| Editor | Existing selection rewrite protections, insert destination, native cards + connectors, mind-map source companion, one Undo, stale proposal, autosave failure recovery |
| UI | Light/dark, keyboard selection/dismissal, accessible status updates, viewport bounds, responsive lists, existing dropdown tokens, browser overlay interaction |

Suggested new tests: `tests/web-sources.test.ts`, `tests/web-source-extraction.test.ts`, `tests/web-ai-citations.test.ts`, native module tests, and `tests/native/ai-web-sources.mjs`. Keep test-only transports/instrumentation out of release code paths. Extend the existing canvas and Card Deck browser tests for provenance/Undo/persistence.

Run `pnpm check`, `pnpm lint`, `pnpm test`, and `cargo test --manifest-path src-tauri/Cargo.toml`. With the expected development server/debug build, run focused `tests/ai.browser.mjs`, `tests/ai-canvas.browser.mjs`, `tests/card-deck.browser.mjs`, the new native suite and affected AI/PDF regressions. Re-run browser isolation/native browser suites if browser code changes. Consult existing baseline failures in `docs/MINI-BROWSER.md` and current verification docs; report actual failures without claiming an entirely clean native suite.

Completion means working one/many URL → sourced native content, truthful partial failures, durable evidence, verified editor lifecycle/Undo, appropriate checks, and a verified installed update. Do not mark it complete at source compilation or mocked chat generation alone.

## Reference rationale

- [Mozilla Readability](https://github.com/mozilla/readability): article extraction and metadata; extraction is not HTML sanitization.
- [LinkeDOM](https://github.com/WebReflection/linkedom): DOM implementation with a worker entry point; compatibility with Readability must be tested rather than assumed.
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): network destination, DNS and redirect defenses for URL fetching.
- [Playwright navigation](https://playwright.dev/docs/navigations): page load events do not guarantee that dynamic content is complete. Production browser capture will use Knot's existing WebView2 boundary.

## Next-chat starting prompt

> Implement the core release in docs/AI-WEB-SOURCES-IMPLEMENTATION-PLAN.md through milestones 0–5. Re-read AGENTS.md and the current code first, preserve existing user changes, and reuse Knot's native card/connector/preview/Undo workflow. Handle multiple URL failures and durable sources as specified. Keep direct PDF URL ingestion and browser capture as documented follow-ons unless needed to resolve a core defect. Run the appropriate checks and pnpm update:running before declaring the implementation complete.
