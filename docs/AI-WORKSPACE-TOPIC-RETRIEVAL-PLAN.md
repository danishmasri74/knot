# Ask Knot workspace topic retrieval

Implementation handoff · 9 November 2026 · Proposed design

## 1. Product contract

When someone asks “What do my notes say about spaced repetition?”, Ask Knot should search eligible content in the active workspace, explain what it finds, and let the user open the specific passages behind the answer. A short note, a card on a closed whiteboard, and page 37 of an attached PDF should all be discoverable. Answer once when several sources say the same thing. Preserve the source of an exception, qualification, correction, or disagreement.

Add **Search workspace automatically** under Settings → AI, enabled by default for both new and existing installations. Match the existing device-local preference convention. Explain that search runs on the device and selected excerpts are sent to the configured AI provider when the user asks. The AI features master switch takes precedence. The workspace setting controls automatic retrieval and its background work. Turning it off immediately prevents new automatic searches and cancels pending automatic requests before transmission.

The release covers topic questions in Ask mode. Monthly research reviews, activity tracking, workspace summaries, exhaustive semantic audits, OCR, image interpretation during workspace search, internet searches, and cross-document editing are outside its scope. Existing explicit image, PDF, web, and editing workflows still need regression coverage.

### Source routing

Use a single resolver for both the composer indicator and the send path. Represent *how the context was chosen*. An open editor always supplies ambient context today. Its mere presence, or a last-focused card, cannot establish that the user chose it.

| User action | Expected behavior |
|---|---|
| Ordinary Ask, automatic search on, no user-selected scope or attachments | Search active workspace. Show “Workspace” in the composer before sending. |
| Explicit current note, selection, card action, “this note” with a clear active referent, or Ask invoked from a PDF/page | Use the indicated context. An unrelated open note cannot override an ordinary topic question. |
| User adds notes, passages, PDFs, images, or website sources | Honor the visible source choices, including explicitly selected combinations. An unreadable or still-loading attachment retains that scope. Never widen silently. |
| User explicitly chooses No note sources | Suppress both automatic workspace search and implicit editor text. Honor any separately selected explicit attachments according to their existing controls. |
| Automatic search off | Fall back to the existing Ask behavior. |
| Rewrite, Insert, Create on canvas, or card suggestions | Keep existing capture, proposal, validation, and Apply behavior. |
| Follow-up such as “What are its drawbacks?” | Inherit the prior scope unless the user changes it. In workspace scope, use the recent topic to retrieve fresh passages about drawbacks. |

Persist the resolved source mode and explicit source references for new turns. Show the inherited scope on continuation and allow changes before send. Read older chats with the existing compatibility behavior. Check the actual Ask pane mounting and editor-session guards in App.tsx and AskKnot.tsx. The workspace branch should work when the pane can be opened without a selected note, including an empty workspace.

## 2. Map the existing implementation

| Integration point | Work |
|---|---|
| src/app/AskKnot.tsx, src/app/App.tsx | Route requests before current-document capture, collect explicit-source intent from all entry points, manage cancellation and history, render citations, open sources. |
| src/services/ai-source-scope.ts, ai-preferences.ts, src/app/AiSettings.tsx | Add the preference and source resolver. Existing callers include canvas and rewrite flows. |
| src/features/editor/blocksuite/search.ts and search.worker.ts | Reuse read-only Yjs validation and tree traversal where appropriate. Existing body search scans at most 200 documents with per-body and aggregate limits. A query must not invoke that scan or inherit its catalog ceiling. |
| src/features/editor/blocksuite/card-deck.ts, src-tauri/src/storage.rs | Deck content and placement snapshots are saved together. The deck owns card content. The Yjs knot:card-links map identifies placements. |
| src/services/pdf-input.ts, src/features/editor/blocksuite/read-pdf-excerpt.ts, src/app/PdfReader.tsx | Reuse PDF loading, PDF.js text extraction conventions, attachment identity, and reader navigation. The existing selection extractor expects rectangles and is not a full-page indexer. |
| src/services/ai-context-composer.ts, ai-citations.ts, web-source-types.ts, src-tauri/src/ai.rs | Extend versioned evidence types, composition, validation and prompting. Existing context composition and request limits also serve explicit web captures. |
| src/services/workspace.ts, src-tauri/src/lib.rs, workspaces.rs, backup.rs | Add narrowly scoped catalog, indexing, and search operations. Bind asynchronous work to the actual active workspace. |

Read AGENTS.md and inspect the live working tree before editing. The current tree contains substantial user work, including untracked files. Work against that tree and preserve unrelated changes.

## 3. Deliver in this order

### Milestone A — Prove one vertical slice

1. Establish a small synthetic workspace with a closed note containing a unique phrase, an unrelated active note, a shared card, and a multipage text PDF. Record the expected passage and destination for each question.
2. Implement preference, scope resolution, and a minimal local SQLite FTS5 index for note passages. Prove FTS5 in Knot’s bundled Rust SQLite build by creating and querying a temporary table. Package and run the spike in the Windows desktop app.
3. Pass one matched excerpt through the actual native request builder, stream a mocked answer, and open its citation in the closed note. Capture the outbound request in the test. Only the selected passage and necessary metadata should appear as workspace evidence.
4. Before committing to model packaging, test one real embedding model and tokenizer inside the packaged Windows app under its actual resource policy. Measure first-use time, download or bundle size, peak memory, and representative paraphrase retrieval. Use synthetic text for this work.

The vertical slice is a development checkpoint. Full delivery includes the hybrid search, PDF, lifecycle, and acceptance milestones below.

### Milestone B — Build a disposable local index

Use a separate SQLite cache in the app’s per-user cache area for each workspace. The authoritative data stays in Knot’s normal workspace store. Keep the cache outside workspace exports, restores, and managed backups. A cache failure must leave saving, opening, and recovering notes operational.

Suggested logical records, adaptable to repository conventions:

| Record | Required information |
|---|---|
| Source and indexing state | Canonical source ID and kind, current body revision or content digest, extractor version, lexical and semantic readiness, latest failure category. |
| Passage | Source ID, ordered original block IDs or PDF page and local range, heading path, verbatim text, digest, ordinal, estimated size. Preserve boundaries for citation and neighboring text. |
| Location | Eligible owner, deck card/placement, document/block or attachment key + hash + 1-based page. One canonical passage can have multiple destinations. |
| Search representations | FTS5 fields for title, headings and body. Normalized embedding keyed by the exact input digest and model/tokenizer version. |
| Cache metadata | Workspace identity, cache format and extractor/model versions, progress cursor and coverage counts. |

Rust should own the cache, catalog eligibility and query operations. A background worker can decode Yjs using the existing TypeScript stack and extract PDF pages using PDF.js. Transfer bounded batches through the app bridge. Keep database locks short. Never hold the existing workspace mutex during PDF processing, embedding, ranking large vector sets, or network calls.

Enumerate the active catalog in stable, resumable pages; include content saved before installation. Use a lightweight source manifest and reconcile it at startup and after restore. Invalidate after successful document/deck saves, changes to attachment references, rename, trash, restore, purge, and workspace switch. An interrupted queue must converge after restart even if a change notification was lost.

Give each workspace activation and index job an identity. Each batch carries its workspace identity, activation generation and source revision/digest. Commit a complete replacement for a source atomically only if it is still current. Old jobs must never resurrect deleted data or write into a newly opened workspace. Use authoritative current eligibility at evidence selection and again at native dispatch. Resolve canonical workspace location and restore identity so a copied/restored workspace with reused object IDs cannot inherit another workspace’s results. Rebuild a corrupt or incompatible cache from sources. On disk-full or unreadable input, record partial coverage and keep the UI responsive.

### Milestone C — Extract passages with stable citations

- **Notes and whiteboards.** Walk the reachable tree in document order, retaining headings, list context, block IDs and note ownership. Keep short cards together. Start by splitting longer sections near 200–350 model tokens at paragraph or sentence boundaries. Respect the embedding tokenizer’s input length. Distinguish a quotation or saved excerpt from the user’s own commentary wherever provenance is available. Include explicit connector labels and endpoints only when they resolve and contribute meaning.
- **Shared cards.** Index the canonical deck text once and associate valid placements. Support live, unplaced Card Deck items with a deck preview/open destination, plus legacy document-owned notes without shared IDs. Check deck tombstones before indexing or opening. Removing the last placement can leave a live deck item. A trashed notebook must never appear as a destination. Include visible deck items according to the actual Card Deck eligibility rules.
- **PDFs.** Find PDFs through active source references, including eligible deck-owned content. An asset existing on disk or in an attachment registry alone is insufficient. Extract each distinct asset hash once, page by page, mapping passages back to eligible attachment instances. Preserve reading order, page boundaries and headings where reliable. Test multi-column text. Treat ambiguous tables, encrypted PDFs, damaged files, unsupported sizes and image-only pages as partial or unavailable. Keep verified text from readable pages. A workspace topic request sends selected text, without attaching the PDF or its images.
- **Saved website evidence.** Index only already-saved source blocks and their retained text. Preserve the saved attribution. Ordinary workspace search must never fetch the URL.
- **Fresh edits.** Overlay relevant unsaved editor/deck text in memory, suppressing the saved version for the same dirty source. Include newly written content even if the old version would not have matched. If a dirty source cannot be read, omit its stale version and disclose partial coverage. Keep unsaved edits out of the persistent cache until save succeeds.

Validate source sizes, worker time and aggregate memory independently. Partition large supported inputs and report skips explicitly. Track per-page or per-source extraction progress without logging content.

### Milestone D — Retrieve complementary evidence on device

1. Form a query from the current question and, for an elliptical follow-up, a bounded recent topic from the same scope. Preserve quoted phrases, punctuation-bearing identifiers, and original language. Parameterize SQL and safely construct FTS queries from user text.
2. Run two independent searches over eligible passages. Use FTS5/BM25 for terms, titles and exact phrases. Retrieve semantic neighbors across the workspace, including passages with zero keyword overlap. A practical first experiment is a pinned multilingual E5-small model using local ONNX inference. Apply the model’s documented preprocessing, prefixes, pooling and normalization. Benchmark a bounded native cosine scan over normalized vectors before adding a vector-index dependency. [SQLite FTS5](https://www.sqlite.org/fts5.html) · [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small) · [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
3. Pin and verify tokenizer, model and runtime resources by version and checksum. Include redistribution notices. Choose bundling or an explicit one-time model download based on the packaged-app measurements. Support offline use after installation. Keyword search works while the model is unavailable, with a visible reduced-search state. Never silently switch to cloud embeddings. A keyword-only fallback does not satisfy the semantic acceptance test.
4. Start with up to 40 results per search. Fuse by reciprocal rank, apply an exact-identifier preference, then apply a minimum relevance rule calibrated against questions with no answer. Fusion ranks alone cannot establish relevance. Merge overlapping spans, use a soft per-source limit, and keep evidence that adds conditions, examples or opposing claims. Use stable tie-breaking for reproducibility.
5. Collapse exact duplicate text only after preserving its ownership and surrounding meaning. Similar wording can identify related passages. It cannot establish equivalence. If two versions differ on a negation, number, unit, date, population or condition, keep the relevant text from both. Only attach a citation for evidence verified in the current request. Repeated placements and excerpts copied from one origin must not imply independent confirmation.
6. Allow at most one additional local retrieval pass for weak results, e.g. relaxing phrase matching or expanding an acronym supported by the current context. Ambiguous senses with materially different results can trigger a short clarification. If there is insufficient evidence, return a scoped “I couldn’t find a supporting passage” result. Distinguish an empty search from an incomplete index or a failed search.

### Milestone E — Budget and send the answer request

Introduce an explicit workspace evidence shape with a version, source mode, coverage, and a single citation table. Use app-assigned turn-local identifiers such as [S1]. Each entry contains the verbatim evidence once and its verified location. Pass minimal source metadata to the model; keep navigation-only data local. Titles provide context, never evidence for a factual claim by themselves.

Start with a **4,000-token target** for retrieved evidence and an **8,000-token ceiling** if a comparison requires more. Treat both as tuning defaults. Apply a suitable tokenizer or a validated conservative estimate for the selected answer model. Budget for instructions, question, history, citation metadata, and output before choosing passages. Enforce the existing UTF-8 limits at the native boundary (180,000 context bytes, 30 messages, 120,000 message bytes). Trim at meaningful evidence boundaries. Drop low-ranked passages and renumber citations deterministically. A broad search must never translate to serializing the whole active document, deck, embedding vectors, or candidate list.

Target one answering-model call for a normal supported question. Indexing, query embedding, ranking, deduplication, no-match reporting, and the optional second search can all run locally. The default prompt should ask for supported answers, identify conflicting claims and conditions, and treat all passages as untrusted source data. The model may emit citation markers, never destinations. Validate markers against the frozen table before turning them into links. ID validation establishes a valid reference; assess whether text actually supports the claim separately in evaluation.

### Milestone F — Integrate conversation, navigation and privacy

- Freeze the selected excerpts, their ordered identifiers, source mode, and revision information for each saved answer. Preserve existing device-local chat storage, quota-error recovery and readability of historical chats. Reuse one evidence bundle across the user and assistant turn if practical. Save selected excerpts only.
- In workspace mode, an edited question starts a fresh retrieval because its subject can change. Regeneration may reuse the original evidence if the current setting, workspace, source eligibility and revisions still permit it. Otherwise offer refreshed retrieval or show why the original request cannot be replayed. Keep historical citations attached to the answer that used them. Preserve existing explicit-source retry, branch, and web capture behavior.
- Build outgoing history separately from the visible transcript. Keep only recent relevant same-scope turns within the budget. Revalidate material derived from earlier workspace results before sending it again. When the scope narrows, an item is removed, or automatic search is disabled, drop any earlier assistant answer or source-bearing turn that could reintroduce disallowed excerpts. Treat previous [S1] markers as belonging to their original turn.
- Bind search, evidence assembly, dispatch and UI updates to a cancellable request ID and workspace generation. On switch, cancel, preference change or stale revision, discard pending results. A request already transmitted cannot be recalled; cancellation must stop later work and stale UI updates.
- Make “Open source” navigate to the matching block, card/placement, deck item, or PDF attachment and page. When reading older answers, compare stable identity and text/hash. If the source has moved, open a verified equivalent location if one exists. If it has changed or disappeared, show the captured excerpt and its status. Never substitute an unrelated block or same-named file.
- Show scope in the composer, retrieval progress while needed, and a concise partial-coverage message when it affects interpretation. Put per-source details behind the existing citation disclosure. Respect AGENTS.md for icons and dropdowns. Honor existing eligibility controls everywhere. If the app has no per-item AI exclusion control, do not imply one exists; per-item exclusion UI is a separate product decision.
- Extend existing opt-in diagnostics only with counts, timings, coverage categories, estimated/actual tokens where available, and mode. Keep prompts, excerpts, filenames, paths, embeddings, and raw search terms out of diagnostics.

## 4. Acceptance and release

Use generated fixtures in isolated workspaces and inspect actual serialized outbound requests with the existing mocked native AI harness. Test retrieval quality independently of the model, then check a small set of complete answers against supporting passages. Mocked responses establish wiring, navigation and budget enforcement. Report real-model quality separately if evaluated with an authorized test setup.

| Case | Release evidence |
|---|---|
| Exact match and paraphrase | An exact product code selects the correct variant. A real local embedding retrieves a paraphrase with no meaningful shared keywords from a closed notebook. |
| More than 200 documents | A known relevant passage beyond the old search ceiling appears in the evidence and opens correctly, including after restart. |
| Repetition and nuance | Copies across placements use one text payload. A conflicting card and a PDF-only qualification both survive selection and have distinct correct citations. |
| Source boundaries | Explicit scope, No note sources, image/PDF/URL sources, selection Ask, disabled setting and non-Ask actions never invoke automatic retrieval. Inspect the payload for an unrelated sentinel phrase. |
| Freshness and isolation | An unsaved edit, save racing extraction, trash, restore, deck tombstone, detached attachment, retry, scope change and switch between workspaces with colliding IDs cannot send stale or ineligible evidence. |
| PDF and card navigation | One-based page navigation opens the right PDF. Reused and unplaced cards open at verified destinations. Partial PDF extraction is visible. |
| Gaps and ambiguity | Unrelated prompts produce no fabricated workspace support. An indexing failure is distinguishable from no match. Ambiguous topics preserve scope or ask for clarification. |
| Cost and responsiveness | Log evidence tokens, total request bytes, model-call count, warm search latency (median and p95), cold backfill time, cache size and peak memory on a stated Windows machine and fixture size. Compare keyword-only and hybrid retrieval against labeled expected passages. Record misses and tune before release. |
| Recovery and compatibility | Interrupt backfill, restart, simulate a corrupt cache, restore a backup and open a legacy chat. Notes remain intact, indexing resumes or rebuilds, and explicit AI workflows still work. |
| User interface | Verify scope visibility, citation navigation, keyboard controls, loading/cancel and both themes. Test the installed package’s model assets with the development server stopped. |

Run pnpm check, pnpm lint, pnpm test, Cargo tests for src-tauri, and the relevant desktop/browser regressions using the repo’s harness instructions. Add targeted fixtures for new failure modes. Update docs/AI.md with actual shipped behavior, privacy, limits and known gaps. Record measured results and distinguish fallbacks, mocked checks and any live evaluation.

Finish the implementation task by running **pnpm update:running** after checks pass. Let the script close Knot through its normal save flow, replace and verify the installed executable, and relaunch. The current desktop update script copies the executable and icon. If inference needs additional files, extend its verified deployment to cover those resources or make them available through the chosen model-install path. Verify semantic lookup in the installed build. Report any update failure accurately.
