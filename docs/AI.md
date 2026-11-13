# Ask Knot v1



**Settings → AI → AI features** enables or disables AI on this device. The switch asks for confirmation before saving notes and reloading the app to show or hide AI controls. Cancel leaves the setting unchanged. Saved chats and connection credentials are retained; a save failure prevents the reload.



Open **Ask Knot** in the left sidebar, below Search. Connect your OpenAI API key using the connection settings icon in the panel header. The compact connection panel shows status, provides a Get an API key link that opens the official key page in the default browser, and shows the key input only when connecting or changing a key. Cancel clears a replacement key; Privacy & storage expands the handling details. The key stays in Windows Credential Manager (`com.knot.desktop.openai` / `api-key`), never in workspace files or browser storage. API usage is billed to your OpenAI account.



Ask, summarize, or explain the captured selection, focused note, Page, or readable Canvas text. **+ Context** explicitly adds another document. Context uses live editor content, including unsaved text; unloaded additional documents are decoded read-only from their saved snapshots. Only supplied context and the selected conversation are sent. Chats are saved automatically in the workspace database (`ai_chats`, schema 12), so workspace backups, restores and relocated copies include them. Chats are not synced between devices and are never part of a shared `.knotbook`. Chats saved by older Knot in app browser storage move into the workspace the first time Ask Knot opens; each browser copy is removed only after the workspace has stored it, and a failed move keeps the copy and retries next time. Saves are queued per chat (only the newest version is written) and are flushed before closing, updating or switching workspace; a save is refused if the workspace changed meanwhile. Chat history lists conversations from all documents in the workspace. New chat preserves previous conversations; Delete asks for confirmation and permanently removes the selected chat. Storage errors are shown with a retry action.

**Cost per answer (13 November 2026).** When OpenAI reports usage for a request, Rust prices it with the same pricing table as [diagnostics](AI-DIAGNOSTICS.md) and sends it once, after the text, on the response stream. The answer header shows "≈ $0.0042"; hovering or focusing it shows the input, cached, output and reasoning tokens. Usage that can't be priced exactly (non-standard service tier, missing cache breakdown, a model without published long-context rates) shows "Cost unknown", never $0. Below the conversation, "This chat ≈ $…" totals every priced request sent from this chat, including retries, failed requests that reported usage and answers later replaced by Save & send; unpriced requests are counted separately. A regenerated branch starts its own total. Stopped requests report no usage and are not included. The figures are estimates from published standard prices; the OpenAI bill is final. This works whether or not diagnostics are enabled.



**Automatic actions (13 November 2026).** There is no mode to choose. Knot answers in chat, or proposes one edit when the message asks for one: a rewrite of the selection, an addition to the note, or cards on the canvas. Each possible edit is a tool offered to the model only when Settings → AI → Abilities (or the chat's sparkles popover) allows it and the target is open and editable; a tool that isn't offered can't be called. Design and phases: [AI-AUTO-ACTIONS-PLAN.md](AI-AUTO-ACTIONS-PLAN.md). Knot also searches the workspace itself when a question needs other notes (Abilities → Search my workspace): the search runs on this device, the excerpts go back to the model, and the answer cites them and shows what was searched. With Settings → AI → Search the web on (off by default), it can search the web through OpenAI (about $0.01 per search, included in the answer's cost), offered only when a message looks like it needs the web (latest, today, price, news, a website, "search online") or follows an answer that searched; cited links become numbered sources that open in your browser. It can also look at up to three images in the open note or canvas when a question is about them (Look at images in my notes), and, with Create new notes on (off by default), propose a whole new note in the open notebook: Apply adds it after the other notes, Open note goes to it, Undo removes it. "Just answer instead" on the latest proposal reruns the message without edit tools; the note and board buttons on an answer turn it into an addition or canvas cards.

A rewrite previews replacements while retaining text-run formatting, links, references, and block identity. An addition appends paragraphs, headings, bullets, numbered lists, or checklists to the current note. When several notes are visible, open a specific note first. Apply creates one normal editor undo step and uses existing autosave. Dismiss leaves the document untouched. Undo edit refuses to skip over newer edits; normal editor Undo remains available.



Proposals are bound to the live editor instance, workspace, document, and content revision. Any intervening document edit (including deletion) makes a proposal stale. Select text again or refresh context and request a new proposal. Models cannot supply source destinations or block properties. Website links come from the frozen application evidence table and open only on a user action; generated scripts and operations are never executed.



Copy is available beneath every message, including proposal text. Edit on a user message opens an inline editor. Save & send replaces that message in the same chat, removes all later messages, and generates a new response using the captured context. Cancel leaves the conversation unchanged. Regenerate on an assistant response creates a new chat branch with the original prompt and captured context; the original conversation remains intact. History replaces the chat view; Back to chat restores the conversation and composer. Continuing a saved conversation uses the current editor context shown in the composer. Saved proposals remain readable, but editor instances and undo closures are never persisted; reopened previews cannot apply stale edits.



## Connection and models



Settings groups personal preferences under General, Editor, and AI, with Workspace and Backups together and recovery tools under Advanced. The AI model list saves device-local visibility preferences. At least one model stays enabled; Ask Knot only offers enabled models available to the connected API project. If none overlap, it explains how to enable another model instead of silently using a hidden one.



The curated OpenAI list includes GPT-6 Luna (quick tasks), GPT-6.1 Terra (writing), GPT-6.1 Sol (reasoning), and GPT-6 Astra (demanding work, higher API cost), plus the existing GPT-5.4 mini and GPT-5.4 options. Existing toggle preferences remain unchanged; new models can be enabled in Settings. A fresh installation shows all six. The backend checks account access before showing enabled models in Ask Knot. All use Responses streaming and structured outputs for edits. GPT-6.1 Sol and GPT-6 Astra answer and draft proposals at medium reasoning effort, with a 16,000-token output cap (reasoning tokens count against it) and a 300-second request timeout; the other models, and AI suggestions on every model, use low effort, a 6,000-token cap and 120 seconds. References: [OpenAI models](https://developers.openai.com/api/docs/models) and [GPT-6 compatibility](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra). Live paid generation is not covered by the mocked native tests.





Prompt caching (11 November 2026, step 1 of [the caching plan](AI-PROMPT-CACHING-PLAN.md)): GPT-6 models bill implicit cache writes at 1.25× input. Requests whose prefix is rarely reused (AI suggestions, workspace and no-note questions, and first-turn Rewrite/Insert/Canvas proposals) send `prompt_cache_options: {"mode": "explicit"}` without breakpoints, so they create no cache writes. Note-scoped Ask and edits that continue a chat keep implicit caching. GPT-5.4 models receive no cache parameters.

Compact note context (11 November 2026): the renderer still freezes the full context (plain text, structure blocks and the citation table) for storage and citation resolution. Rust compacts only the copy sent to the provider (`src-tauri/src/ai_context.rs`). Each note block is sent once in `noteSources`, as a line led by its `[S#]` marker, with indentation for nesting and a type marker (headings, bullets, numbered items, open/completed tasks, quotes, code). Titles appear once per note, `--- note N ---` separates canvas notes, and attributions and saved web sources follow as continuation lines. Document and block IDs, the duplicate `structure`, and plain `text` (when every line is covered by a block) are not sent. Website passages stay in `citationSources`. Read-only surrounding context is rendered the same way without markers. Workspace contexts, PDF-located blocks, entries without a citation marker, and unknown entry fields keep the previous format. On the 49 compactable synthetic benchmark contexts, context bytes fell from 22,670 to 6,513 (−71%). The renderer also stores each block once: when the frozen citation table covers a `structure` list (matched by document and block ID) or every line of the plain `text`, those copies are omitted from the saved request (`dropCoveredCopies` in `src/services/ai-context-composer.ts`). Uncovered text such as unstructured canvas text is kept, and older saved chats remain readable. The 180,000-byte request limit therefore counts each note block once, so roughly three times more note content fits, and saved chats use less device storage.

Conditional instructions (11 November 2026): base instructions are assembled from sections, and each request gets only the rules that can apply (visual/PDF, read-only surrounding context, rewrite, insert, edit JSON). A plain note question carries about 40% of the former base text. Benchmarked on GPT-6 Luna: −27% input tokens and −22% cost on the synthetic suite, with all edit proposals applying. See [the benchmark notes](AI-INSTRUCTION-TRIM-BENCHMARK-2026-11-11.md).

Rust sends Responses API requests with streaming and `store: false`; edits use strict JSON-schema output. Requests can be cancelled and are bounded by size and timeout. Failure, refusal, incomplete output, and malformed proposals never enable partial edits. Model access is checked against the user's `/v1/models` response on connection and panel open. Availability in the model catalog does not guarantee billing or Responses access for every project; access failures are shown in the panel.



Approved model list, verified against official documentation on November 2, 2026:



- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) — fast everyday tasks; first choice on fresh installations when available.

- [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) — writing and revision.

- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) — complex reasoning.

- [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) — demanding work, higher API cost.

- [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) — retained existing option.

- [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) — retained existing option.

- [Responses streaming documentation](https://developers.openai.com/api/docs/guides/streaming-responses).



## Acceptance



`node tests/ai.browser.mjs` (with `pnpm dev`) proves selection → replacement → undo → serialized save/reopen before connection integration. It also checks formatting, references, supported block types, malformed output, workspace/instance identity, stale deletion, and guarded undo.



`node tests/native/ai.mjs` (after a debug Tauri build) exercises the panel and real editor/storage in an isolated test workspace. It substitutes deterministic AI responses at the test WebView's fetch boundary, with no test hooks in production code. It verifies preview/Apply/Undo, native block insertion, streaming, failure, cancellation, explicit context, saved chat isolation, and normal close/reopen. It does not use or replace the user's credential. Live paid generation requires a user-provided key and was not part of automated acceptance.



Deferred: cross-document edits, autonomous web search, direct remote-PDF ingestion and capture from the mini browser. Existing attached PDF/image analysis remains available.



Structured AI context preserves native text block order, parent/note IDs, headings, list types, and checkbox state for the current scope and explicitly added documents. Selection requests include up to 4,000 characters of read-only nearby/heading context (up to 1,500 per block); replacement runs remain the only edit targets. Canvas text remains text-only, without spatial interpretation.



The native text-selection format toolbar includes an Ask AI sparkle action when AI is enabled. It captures the selection and opens Ask Knot, updating context even if the panel is already open. The action uses BlockSuite's native inline-action configuration and icon-button styling.



Ask responses can cite supplied structured blocks using [S1] markers. Expand the corresponding source beneath the answer to read the captured excerpt, then choose Open source to navigate and highlight the paragraph. Source numbering is scoped to the saved request, including explicitly added notes. Missing and changed paragraphs show an error; captured excerpts remain readable. Citation resolution verifies source identity, not whether the claim is logically supported. Canvas text without structured blocks has no citation target.



A canvas proposal generates a reviewable batch of up to 20 note cards and 40 labeled connectors. Cards are placed left to right beside existing objects. The preview lists card text and numbered connections; Apply requires a captured Canvas context and unchanged document revision. All objects use native editor models and one undo step. Existing cards are not modified. This first version does not interpret existing canvas relationships or offer tree/grid layout. Run `node tests/ai-canvas.browser.mjs` against the development server to verify card creation, attached connector labels, and grouped undo.



## Usage and diagnostics



See [Milestone 1 diagnostics](AI-DIAGNOSTICS.md) for local measurement, privacy, retention, versioned estimates and the separate 60-case quality benchmark.







## Website sources (core release, 7 November 2026)



Paste one or several explicit HTTP/HTTPS URLs in your message, including Markdown links, or choose **+ Context → Website URLs** to add addresses (bare hostnames are accepted there). Review detected sources before sending. Remove excludes a detected URL for that submission even if it remains in the prose. Up to eight URLs can be attached; ordinary anchor variants share a fetch while retaining requested addresses. Query values are preserved; chips omit query strings. Review the exact requested/final address in source details when pasting punctuation beside a signed URL.



Ask Knot captures public HTML and plain text without using the mini browser, browser cookies, your credentials, an external extraction service or an additional API key. It does not follow links found in pages or notes. The model has no autonomous browsing tools. No notes controls note context independently; explicitly attached websites still participate. Ask, Insert content, Create on canvas and selection-only Rewrite use the same evidence composer. Improving an existing sourced card reuses its retained supporting excerpts.



Each source shows queued/fetching/extracting/ready/partial/failed/cancelled state, details and captured text. Ready means readable content was captured, not guaranteed completeness. Retry handles one failed source without refetching successful ones. Refresh explicitly creates a new capture and invalidates unapplied proposals that used the selected evidence; old answers keep their frozen evidence. Stop cancels fetching, worker extraction and generation, retains completed captures, and ignores late results. Workspace/document/chat changes isolate callbacks.



Mixed batches continue using readable sources, with a visible used/total notice and excluded-source reasons. If every website fails, generation is skipped: retry, remove URLs to ask a general question, or open/download externally. Instructions require an incomplete comparison to be described as incomplete when an essential source is missing, preserve disagreements, distinguish inference, and ignore instructions embedded in sources. These instructions and structural citation validation do not prove semantic support of every model claim.



Extraction (`src/services/web-source-extraction.ts`) reads each paragraph, list item, caption or other inline-only element as one passage, and each run of inline text between blocks as one passage, so links don't split sentences. Text uses rendered whitespace: source line breaks and indentation collapse and only `<br>` breaks a line. Code laid out as `<br>` lines in a code-classed `<div>` (as on w3schools) is converted to code before Readability runs. Navigation, dialogs, buttons and wiki edit links, navigation boxes and category footers are dropped. A password field marks a sign-in page only on a page with little other text (under 3,000 characters), so form tutorials are captured. Tables with at most one filled cell per row (note banners) become text.

Long pages use selected sections, ranked by prompt terms/headings with coverage across every readable source. Expand the coverage notice to see included/omitted section IDs and warnings. Narrow the request for more coverage. Images, iframes and other visual material are not captured. Login/challenge/error pages, paywalls and unsupported types have recovery messages or partial-coverage warnings. **PDF links (13 November 2026).** A link that returns a PDF (by content or `application/pdf`) is downloaded by the same native fetcher, up to 10 MiB (pages stay at 4 MiB; the 16 MiB batch budget still applies), and sent to the renderer as base64. pdf.js reads its text layer on the device (`src/services/web-pdf-extraction.ts`), in its own worker, without XFA or PDF scripts, within 20 seconds and 500 pages. Text runs become lines and lines become paragraphs at larger gaps or column changes, with words hyphenated across lines rejoined; each passage records its page (`page`, shown as the heading "Page N") and keeps the usual 400-section, 400,000-character and 6,000-character passage limits. The title is the PDF's metadata title unless it looks like a file name, else the largest text on page 1, else the file name. Code-like metadata authors are dropped, and the PDF creation date is not reported as a publication date. Every PDF capture carries the warning "PDF text only: figures, images and scanned pages were not read." A PDF with almost no text (under 20 characters, such as a scan), a password, or a damaged file fails with a message suggesting download and attachment, which uses Ask Knot's visual PDF reading. Citation links for PDF passages open `#page=N` instead of a text fragment.

**Pages built with JavaScript (13 November 2026).** When a fetched HTML page ships scripts and has almost no text (under 50 characters), or little text (under 400) plus app-shell markers (`<noscript>`, a module script, `<app-root>`, or an empty `#root`/`#app`/`#__next`-style element), or extraction finds no readable text, Knot renders it (`needsRenderedCapture` in `src/services/web-sources.ts`). Hash-route addresses (`#/…`, `#!/…`) are rendered straight away. The page loads in a hidden WebView2 child (`src-tauri/src/web_render.rs`) placed outside the window at 1280×900, muted, with its own InPrivate temporary profile, so nothing is shared with the mini browser or the shell. It has no IPC capability (every command checks for the trusted shell), app resources return 403, popups, downloads, permissions and dialogs are denied, and navigation is limited to public HTTP(S) addresses (the initial address also passes the fetcher's DNS check). Knot polls the page every 400 ms and reads it once it has finished loading and its text has stopped changing for 1.2 s (with at least 200 characters, or 3.6 s without), within 20 s. It takes a copy of the DOM without scripts, styles, frames or form fields (4 MiB limit), closes the view, deletes its profile and runs the copy through the same non-rendering extraction. Captures show the method as `rendered-…`. Renders run one at a time, inside the 60-second batch, and Stop cancels them. If rendering fails, a page that had some plain text keeps its plain capture; otherwise the source fails with the reason. Login and bot-challenge pages are not rendered. Only the starting address and main-frame navigations are checked against the private-network policy; the scripts, images and requests a rendered page loads are not, as in any browser tab. `node tests/native/web-render.mjs` is a public smoke test (a JavaScript app, a docsify hash route, a plain page that is not rendered, Stop, and cleanup).



Sources use request-local [S1] markers backed by immutable capture/section identities. Ask citations open the retained excerpt and route Open source to the website, rather than a note paragraph. Open source, and each excerpt's Open passage link in a saved source block, add a text fragment (`#:~:text=start,end`, built from the first and last words of the excerpt in `src/services/text-fragment.ts`) so supporting browsers scroll to and highlight the passage; when the page text no longer matches or the browser lacks support, the page opens at the top. Exports keep the plain page link. Long website passages (220+ characters) are narrowed to the sentence the claim used, on the device and without model changes (`src/services/cited-sentence.ts`): the answer sentences carrying a marker (or, for saved source blocks, the supported content in the block's first line) are matched to the passage's sentences by shared content words weighted by rarity, adding a neighbouring sentence when it contributes more of the claim. Ask's source list shows that sentence with the full passage behind Full passage; saved blocks highlight it in the excerpt; both use it for the passage link. With fewer than two shared words, or a tie between distant sentences, the whole passage is kept. This narrows display and links; it does not prove the sentence supports the claim. Structured proposals must use known evidence references; invented/missing references invalidate the preview. Apply stores a native **knot:web-source** child next to supported content, including captured metadata, supporting excerpts, coverage warnings and the source URL. Cards/connectors and a pure mind map's source companion share one Undo operation. The supporting content remains readable after deleting the chat or losing access to the website. Card Deck reuse, normal snapshots and workspace backups retain those children. HTML/text clipboard export and Markdown export include excerpts and source links.



Chats store bounded selected passages and metadata in the frozen request, never raw HTML. Reopening, continuing or regenerating reuses selected captures without an automatic network request; Refresh is explicit. Chat storage quota failures retain the visible Retry save recovery. Chat-only evidence keeps the existing device-local chat backup exclusion. Applied source blocks are normal workspace content included in backups. This stores supporting evidence, not an offline mirror of entire websites.



Limits: eight URLs, three native fetches at once, 20 seconds per source including redirects/body/retry, 60 seconds per batch, five redirects, 4 MiB each for compressed/decoded response and decoded UTF-8, and a conservative 16 MiB aggregate transfer/decode budget. One bounded retry covers transient network/5xx/429 failures and honors Retry-After within the deadline. HTTPS downgrades, non-public IPv4/IPv6 destinations, credentials and app origins are refused; every redirect is revalidated and DNS answers are pinned. System/environment proxies are explicitly bypassed. TLS verification stays enabled. Extraction runs in a non-rendering worker with a three-second termination deadline, 50,000 DOM elements, 400 sections and 400,000 extracted characters. Context selection targets 170,000 UTF-8 bytes beneath the existing 180,000-byte request ceiling, including metadata and duplicated note context. Requests that cannot fit useful coverage from every source show a limit message.



See [web-source verification](AI-WEB-SOURCES-VERIFICATION.md) for deterministic coverage and remaining limits. No live paid AI evaluation was run for this release.





## Workspace topic retrieval (9 November 2026)



Ordinary Ask questions now use **Workspace** scope when **Settings → AI → Search workspace automatically** is enabled. The device-local preference defaults to on for existing and new installations; the AI master switch takes precedence. The source picker can choose automatic sources, current note, or No note sources. Explicit selections, note/passages, images, PDFs and website captures retain their own scope. Ambient editor state and a last-focused note do not establish deliberate source intent. Ask can open without a selected note.



Rust maintains a disposable SQLite FTS5 cache outside workspace folders, exports and managed backups. Backfill enumerates stable 100-source batches without the Library search's 200-document ceiling. Source revisions and workspace activation identities guard replacement, selection and native AI dispatch. Startup reconciles older content and retries failures; saving and recovery do not depend on this cache. Incompatible/corrupt caches rebuild. Queries use the index rather than scanning saved document bodies.



Keyword/BM25 and local semantic searches run independently, then reciprocal-rank fusion selects complementary passages. The pinned multilingual E5-small q8 model and tokenizer are bundled, use query/passage prefixes, mean pooling and normalized 384-dimensional vectors, and work offline. There are no cloud embeddings or model downloads at runtime. Every build verifies model and runtime SHA-256 checksums. See [model notices](TOPIC-MODEL-NOTICES.md). If local inference fails, keyword search remains available with a reduced-search notice.



Canonical live Card Deck content is indexed once; repeated placements do not become independent confirmation. Card citations prefer a verified live placement (the active notebook first, then a stable eligible owner), opening its formatted note. Unplaced live cards have a verified deck preview destination. This also applies to older saved answers; unsaved placement removal supersedes saved links. Notes retain reachable block order and heading context. Saved website/quotation blocks retain their provenance; automatic search never fetches their URLs. PDFs are discovered from actual live source references, not the asset registry alone. Selected page text is sent without attaching the PDF or page images. Dirty editor/card content overlays saved versions in memory, including first-save cards with an eligible placement owner. It is not persisted to the retrieval cache before a successful save.



Workspace evidence uses one turn-local citation table. Its target is a conservative 4,000-token upper bound (8,000 for comparisons), estimated with UTF-8 bytes; native context/message byte limits remain enforced. The provider receives selected text, minimal attribution and citation IDs, without vectors or navigation destinations. Ordinary supported questions make one answer-model call; no-match reporting is local. Recent same-scope questions can supply a bounded topic for elliptical follow-ups. Earlier answers and evidence are not replayed into outgoing history. Edited workspace questions and regeneration retrieve fresh evidence. Disabling automatic search stops background work and cancels queued automatic requests in both renderer and native code; explicit-source/edit requests continue.



New workspace chats store a shared frozen evidence bundle once per answer, preserving legacy chat readability and quota-error recovery. Citations resolve against that answer's assigned IDs. Open source verifies the current note/card/placement or PDF reference and one-based page. Changed/deleted sources retain their captured excerpt and an explanatory status. Programmatic citation navigation does not silently select a new source scope for the next question. Opening a citation in another notebook carries the current live Ask conversation, draft and open source details into the destination layout. It opens or reveals Ask there without loading that notebook's previous chat. Other saved tabs and widths remain notebook-specific; ordinary notebook navigation still restores its usual Ask session.



Current conservative limits: saved snapshots up to 8 MiB and one million extracted characters per source; PDF input up to 10 MiB, 1,000 pages, two million characters and 20,000 text items per page. Long passages are split without dropping text and refined with the pinned tokenizer below its input length. Ambiguous multi-column pages/tables, image-only pages, damaged/encrypted PDFs and unsupported inputs can be partial or unavailable; readable pages remain usable. OCR, image interpretation during retrieval, monthly reviews, exhaustive audits and cross-document editing remain outside this feature. Search ranking is calibrated on synthetic fixtures, not a broad multilingual quality benchmark; plausible but weak semantic neighbors can remain in the candidate set.



See [workspace retrieval verification](AI-WORKSPACE-TOPIC-RETRIEVAL-VERIFICATION.md) for measured results, regression commands, mocked-vs-real distinctions and installed-app verification.


## AI suggestions

Settings > AI > AI suggestions enables opt-in contextual starters in empty Ask Knot chats on this device. Enabling from the panel saves the same preference. A bounded current-note excerpt is sent to the connected provider; API usage applies. Suggestions use the selected model (a fast enabled available model for Auto), produce answers in chat, and never apply edits. Clicks bind to the captured note; changed revisions invalidate suggestions. Typing, closing or changing scope cancels pending work. Results are cached only in memory. Basic starters remain available on failure. Workspace, selection and attachment suggestions are deferred.
