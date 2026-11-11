# Ask Knot v1



**Settings → AI → AI features** enables or disables AI on this device. The switch asks for confirmation before saving notes and reloading the app to show or hide AI controls. Cancel leaves the setting unchanged. Saved chats and connection credentials are retained; a save failure prevents the reload.



Open **Ask Knot** in the left sidebar, below Search. Connect your OpenAI API key using the connection settings icon in the panel header. The compact connection panel shows status, provides a Get an API key link that opens the official key page in the default browser, and shows the key input only when connecting or changing a key. Cancel clears a replacement key; Privacy & storage expands the handling details. The key stays in Windows Credential Manager (`com.knot.desktop.openai` / `api-key`), never in workspace files or browser storage. API usage is billed to your OpenAI account.



Ask, summarize, or explain the captured selection, focused note, Page, or readable Canvas text. **+ Context** explicitly adds another document. Context uses live editor content, including unsaved text; unloaded additional documents are decoded read-only from their saved snapshots. Only supplied context and the selected conversation are sent. Chats are saved automatically on this device in app browser storage, grouped by workspace. Chat history lists conversations from all documents in the workspace. New chat preserves previous conversations; Delete asks for confirmation and permanently removes the selected chat. Chats are not included in workspace backups or synced to other devices. Storage errors are shown with a retry action.



Choose **Rewrite selection** to preview replacements while retaining text-run formatting, links, references, and block identity. Choose **Insert content** to append paragraphs, headings, bullets, numbered lists, or checklists to the current note. When several notes are visible, open a specific note first. Apply creates one normal editor undo step and uses existing autosave. Dismiss leaves the document untouched. Undo edit refuses to skip over newer edits; normal editor Undo remains available.



Proposals are bound to the live editor instance, workspace, document, and content revision. Any intervening document edit (including deletion) makes a proposal stale. Select text again or refresh context and request a new proposal. Models cannot supply source destinations or block properties. Website links come from the frozen application evidence table and open only on a user action; generated scripts and operations are never executed.



Copy is available beneath every message, including proposal text. Edit on a user message opens an inline editor. Save & send replaces that message in the same chat, removes all later messages, and generates a new response using the captured context. Cancel leaves the conversation unchanged. Regenerate on an assistant response creates a new chat branch with the original prompt and captured context; the original conversation remains intact. History replaces the chat view; Back to chat restores the conversation and composer. Continuing a saved conversation uses the current editor context shown in the composer. Saved proposals remain readable, but editor instances and undo closures are never persisted; reopened previews cannot apply stale edits.



## Connection and models



Settings groups personal preferences under General, Editor, and AI, with Workspace and Backups together and recovery tools under Advanced. The AI model list saves device-local visibility preferences. At least one model stays enabled; Ask Knot only offers enabled models available to the connected API project. If none overlap, it explains how to enable another model instead of silently using a hidden one.



The curated OpenAI list includes GPT-6 Luna (quick tasks), GPT-6.1 Terra (writing), GPT-6.1 Sol (reasoning), and GPT-6 Astra (demanding work, higher API cost), plus the existing GPT-5.4 mini and GPT-5.4 options. Existing toggle preferences remain unchanged; new models can be enabled in Settings. A fresh installation shows all six. The backend checks account access before showing enabled models in Ask Knot. All use Responses streaming, structured outputs for edits, and low reasoning effort. References: [OpenAI models](https://developers.openai.com/api/docs/models) and [GPT-6 compatibility](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra). Live paid generation is not covered by the mocked native tests.





Prompt caching (11 November 2026, step 1 of [the caching plan](AI-PROMPT-CACHING-PLAN.md)): GPT-6 models bill implicit cache writes at 1.25× input. Requests whose prefix is rarely reused (AI suggestions, workspace and no-note questions, and first-turn Rewrite/Insert/Canvas proposals) send `prompt_cache_options: {"mode": "explicit"}` without breakpoints, so they create no cache writes. Note-scoped Ask and edits that continue a chat keep implicit caching. GPT-5.4 models receive no cache parameters.

Compact note context (11 November 2026): the renderer still freezes the full context (plain text, structure blocks and the citation table) for storage and citation resolution. Rust compacts only the copy sent to the provider (`src-tauri/src/ai_context.rs`). Each note block is sent once in `noteSources`, as a line led by its `[S#]` marker, with indentation for nesting and a type marker (headings, bullets, numbered items, open/completed tasks, quotes, code). Titles appear once per note, `--- note N ---` separates canvas notes, and attributions and saved web sources follow as continuation lines. Document and block IDs, the duplicate `structure`, and plain `text` (when every line is covered by a block) are not sent. Website passages stay in `citationSources`. Read-only surrounding context is rendered the same way without markers. Workspace contexts, PDF-located blocks, entries without a citation marker, and unknown entry fields keep the previous format. On the 49 compactable synthetic benchmark contexts, context bytes fell from 22,670 to 6,513 (−71%). The renderer's 180,000-byte limit still applies to the uncompacted context.

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



Create on canvas generates a reviewable batch of up to 20 note cards and 40 labeled connectors. Cards are placed left to right beside existing objects. The preview lists card text and numbered connections; Apply requires a captured Canvas context and unchanged document revision. All objects use native editor models and one undo step. Existing cards are not modified. This first version does not interpret existing canvas relationships or offer tree/grid layout. Run `node tests/ai-canvas.browser.mjs` against the development server to verify card creation, attached connector labels, and grouped undo.



## Usage and diagnostics



See [Milestone 1 diagnostics](AI-DIAGNOSTICS.md) for local measurement, privacy, retention, versioned estimates and the separate 60-case quality benchmark.







## Website sources (core release, 7 November 2026)



Paste one or several explicit HTTP/HTTPS URLs in your message, including Markdown links, or choose **+ Context → Website URLs** to add addresses (bare hostnames are accepted there). Review detected sources before sending. Remove excludes a detected URL for that submission even if it remains in the prose. Up to eight URLs can be attached; ordinary anchor variants share a fetch while retaining requested addresses. Query values are preserved; chips omit query strings. Review the exact requested/final address in source details when pasting punctuation beside a signed URL.



Ask Knot captures public HTML and plain text without using the mini browser, browser cookies, your credentials, an external extraction service or an additional API key. It does not follow links found in pages or notes. The model has no autonomous browsing tools. No notes controls note context independently; explicitly attached websites still participate. Ask, Insert content, Create on canvas and selection-only Rewrite use the same evidence composer. Improving an existing sourced card reuses its retained supporting excerpts.



Each source shows queued/fetching/extracting/ready/partial/failed/cancelled state, details and captured text. Ready means readable content was captured, not guaranteed completeness. Retry handles one failed source without refetching successful ones. Refresh explicitly creates a new capture and invalidates unapplied proposals that used the selected evidence; old answers keep their frozen evidence. Stop cancels fetching, worker extraction and generation, retains completed captures, and ignores late results. Workspace/document/chat changes isolate callbacks.



Mixed batches continue using readable sources, with a visible used/total notice and excluded-source reasons. If every website fails, generation is skipped: retry, remove URLs to ask a general question, or open/download externally. Instructions require an incomplete comparison to be described as incomplete when an essential source is missing, preserve disagreements, distinguish inference, and ignore instructions embedded in sources. These instructions and structural citation validation do not prove semantic support of every model claim.



Long pages use selected sections, ranked by prompt terms/headings with coverage across every readable source. Expand the coverage notice to see included/omitted section IDs and warnings. Narrow the request for more coverage. Images, iframes and other visual material are not captured. Login/challenge/error pages, paywalls, JavaScript-only pages and unsupported types have recovery messages or partial-coverage warnings. Direct PDF URLs offer external download and attachment recovery; they are not silently analyzed as ordinary web text. Hash-route pages require a future rendered-browser capture.



Sources use request-local [S1] markers backed by immutable capture/section identities. Ask citations open the retained excerpt and route Open source to the website, rather than a note paragraph. Structured proposals must use known evidence references; invented/missing references invalidate the preview. Apply stores a native **knot:web-source** child next to supported content, including captured metadata, supporting excerpts, coverage warnings and the source URL. Cards/connectors and a pure mind map's source companion share one Undo operation. The supporting content remains readable after deleting the chat or losing access to the website. Card Deck reuse, normal snapshots and workspace backups retain those children. HTML/text clipboard export and Markdown export include excerpts and source links.



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
