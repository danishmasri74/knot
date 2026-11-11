# Workspace topic retrieval verification

9 November 2026. Existing checkout changes and untracked work were preserved. No reset, clean, staging or commit was performed.

## Implementation checkpoints

- A: preference/single scope resolver, real bundled FTS5, selected-evidence native request-builder test, mocked streaming and closed-note navigation. Real local E5/tokenizer tested in Edge and the packaged Windows app under its CSP.
- B: disposable native SQLite cache; stable 100-source batches; source revisions, activation identity and canonical workspace/database identity; atomic source replacement, digest/model-keyed vectors, failure categories, reconciliation and corruption rebuild. Cache storage is outside authoritative workspaces/backups.
- C: reachable note passages/headings, canonical shared/unplaced deck content, saved-source provenance, referenced PDF pages, in-memory dirty and first-save card overlays, verified destinations.
- D: independent FTS5/BM25 and real local normalized E5 cosine search, bounded candidates, reciprocal-rank fusion, identifier preference, exact-text/provenance deduplication and explicit no-match/partial states. No cloud embeddings or automatic URL fetches.
- E: versioned frozen evidence and turn-local citation IDs; conservative 4,000/8,000 token upper bounds; soft three-passage source limits before filling remaining budget; minimal provider payload; existing native byte/message limits; native cancellation before stream startup.
- F: shared device-local evidence bundles, legacy compatibility, fresh workspace retry/edit retrieval, scope narrowing/history isolation, source verification/navigation, source chooser/progress and content-free diagnostic counts.

## Measured fixture

Windows 11 Home Single Language x64, Intel Core i5-12450H, 16,866,680,832 bytes installed RAM. Generated isolated fixture: 225 base notes (most intentionally empty to isolate the pagination ceiling), two substantive closed-note passages, the normal generated tutorial, a canonical conflicting card with repeated placements, and a 40-page PDF with a qualification on page 37. Additional dirty/new-card cases use held native saves. These are synthetic correctness measurements, not a large populated-workspace benchmark.

A standalone run at `test-results/topic-1794197950423` measured cold backfill at 15,139 ms. Five warm exact searches: 134, 155, 184.7, 194, 176.3 ms (median 176.3 ms; nearest-rank p95 194 ms; only five samples). Concurrent regression runs took longer, so these figures must not be treated as general performance guarantees.

Pinned model/tokenizer files: 135,393,260 bytes, plus 21,640,503 bytes for the checked WASM/module pair. Browser first use was approximately 2.2–3.3 s. The packaged app at `http://tauri.localhost`, with Vite stopped, loaded the real model in approximately 4.8 s and retrieved the known paraphrase after restart. The original notebook-owned passage had migrated to its live canonical deck destination; the test verifies its exact text rather than assuming the obsolete location.

The first paraphrase attempt missed the expected passage because boilerplate lexical matches outranked semantic-only evidence within the budget. Removing boilerplate question terms fixed the fixture. The expected zero-keyword-overlap passage is now selected, though tutorial passages can still rank above it. Broader multilingual relevance/faithfulness evaluation is not claimed.

## Acceptance evidence

- Exact product identifier selects the correct variant beyond 200 documents. Real E5 retrieves the closed-note paraphrase; unrelated quasar/spectroscopy query returns no evidence.
- 17-watt and conditional 19-watt claims plus the PDF-only qualification survive selection. Repeated placements use canonical deck ownership. Closed note, canonical card preview and PDF page 37 navigation are exercised.
- No note sources drops prior workspace evidence/history. Disabling search during a held search produces no answering request. Native tests also cancel requests queued before streaming begins.
- An unsaved edit and a never-saved card appear in outgoing selected evidence while native persisted deck content still lacks their sentinel text. They persist only after the held save is released.
- Trash removes a result immediately, without waiting for reconciliation. Native tests cover activation/revision changes, cache corruption and workspace identity; existing storage tests cover save atomicity, trash/restore/purge and backup/restore compatibility.
- The native request builder serializes selected evidence once and strips local IDs, revisions, vectors and navigation metadata. Browser/native provider responses are mocks; the embedding model is real and local. No paid answer-model evaluation was run.

## Checks

Passed: `pnpm check`, `pnpm lint`, `pnpm test` (97 tests), `cargo test --lib --manifest-path src-tauri/Cargo.toml` (83 passed, 4 intentionally ignored); `tests/native/topic-retrieval.mjs`; packaged semantic smoke; editor/canvas/image/PDF browser regressions; native AI/settings/web-source regressions. The older native harness selectors were adapted to the checkout's current writing menu, source chips, attachment picker and column-close controls without removing their assertions.

Native AI/web regressions include Apply/Undo, streaming/failure/cancel, explicit sources, retry/refresh, frozen evidence, branch/edit/regeneration, quota retry, saved chats, restart and backup restore. Shared menu/light/dark/keyboard/viewport checks also pass.

## Practical limits and unmeasured cases

PDF extraction is deliberately conservative for ambiguous layout and unsupported/encrypted/image-only pages. Snapshot, text, page/item and worker limits can reduce coverage. The test fixture is small in substantive text; no claim is made for a broad multilingual benchmark, exhaustive source-support grading or hardware fault-injected disk-full behavior. Existing cache-error isolation and storage failure tests establish separation from authoritative saving, not every possible operating-system fault.

Installed-build measurements and updater results follow.

## Final installed-build verification

The final release was built with `pnpm update:running`. Its initial desktop replacement failed while an overlapping smoke test was running; that test was restored and the completed release was installed successfully with `pnpm update:running -SkipBuild`. The updater verified the executable and relaunched Knot. Independent SHA-256 verification matched release and installed executables: `C38E2DD4898F550F71BAA444E13D2BE16DFC5723F272321F01055F28DA97D278`. No force termination was used.

The subsequent confirmed run, `test-results/topic-installed-20261109-confirmed`, used the installed executable at `http://tauri.localhost` with Vite stopped. It passed real local semantic search, unrelated-active-note exclusion, closed-note navigation, conflicting 17/19-watt claims, PDF page 37 navigation, unreadable-image scope retention and blocked send, and the source chooser in both themes with keyboard dismissal. Keyword-only search found the exact product passage but missed the labeled recall paraphrase; hybrid search selected that paraphrase. This is a small labeled correctness comparison, not a broad relevance benchmark.

| Measurement | Result |
|---|---|
| Installed first semantic question, including cold indexing | 5,959 ms |
| Fixture SQLite cache | 270,336 bytes |
| Sampled peak private committed memory | 1,754,697,728 bytes, app plus descendants, 1-second samples |
| Answer requests | 2 total; one per supported question; mocked responses |
| Semantic native provider JSON | 6,982 bytes, 8 citations, 3,066 context UTF-8 bytes |
| Exact comparison native provider JSON | 4,659 bytes, 3 citations, 831 context UTF-8 bytes |

Payload metrics were produced by compiling the exact current native `request_body` function as a standalone probe against the captured synthetic requests. Each had two provider input messages (instructions plus current question). Native byte/message bounds were asserted; local document IDs, block IDs, source revisions, vectors and the unrelated active-note sentinel were absent. Context UTF-8 bytes provide a conservative token upper bound; they are not billed token counts. No live answer-model quality or paid usage was evaluated.

The synthetic workspace and its cache were removed, original device preferences and workspace selection restored, and installed Knot relaunched normally. Normal close/save was allowed throughout; one cleanup close exceeded 30 seconds and succeeded on retry. The screenshot `pdf-page37.png` shows the verified closed-note paraphrase alongside the correct PDF page. The earlier semantic-navigation screenshot was captured before the editor finished painting and is not used as visual proof.
## Placed-card citation correction

A user screenshot exposed a navigation gap: canonical card citations always opened the deck preview, even when a live placement existed. The resolver now prefers a root-owned eligible placement, checking the active notebook first and then stable catalog order. It reads saved owners without hydrating the editor, honors live unsaved removal, rechecks identity/text after opening, and discards results after workspace switches. Older saved answers use this same resolver. Unplaced cards retain the verified deck fallback.

Passed typecheck, lint and all 100 frontend tests, including new identity/orphan-link, unsaved-removal/unplaced and workspace-switch cases. The existing native topic harness now expects placed-card navigation. `pnpm update:running` completed successfully without overlap with smoke testing. The confirmed installed run `test-results/topic-installed-20261109-placements` verified the real shared-card citation opens its formatted note in the owning notebook, alongside the prior semantic, PDF, scope and theme checks. `placed-card-citation.png` captures the actual destination. Answer responses remain mocked, while native storage and local embeddings are real.

Installed measurements for this run: first semantic question 8,037 ms including indexing; cache 270,336 bytes; sampled peak app-plus-descendant private memory 2,004,652,032 bytes; two answering requests total (one per supported question). These samples are not performance guarantees.
Verified installed/release SHA-256: `D5ACE69D8299B112FE4935BED6700CAACEF8E7EFE7B867FE00018910EF6CC256`.

## Conversation continuity on source navigation

Citation-driven notebook changes now carry the mounted Ask pane through layout restoration. The destination's other saved tabs and widths are restored; Ask is opened/revealed without mounting a second conversation or choosing its last saved chat. The current draft and source disclosures stay in the same live component. Ordinary notebook/workspace navigation continues its usual session restoration. Chat ownership is retained with the original conversation; editor-selection subscriptions rebind to the destination editor.

Passed `pnpm check`, `pnpm lint`, all 100 frontend tests, `tests/ask-continuity.browser.mjs` and the existing `tests/notebook-layout.browser.mjs`. The browser tests run under React StrictMode and cover empty/existing/hidden destination panels, preserved DOM/input state, widths/tab membership, and ordinary navigation resetting its session. `pnpm update:running` then built, verified and relaunched the installed app successfully.

The installed run `test-results/topic-installed-20261109-continuity`, with Vite stopped, asserted actual Ask DOM identity, retained unsent drafts and the same transcript across source clicks. One destination had no Ask panel; another was seeded with a hidden Ask/browser layout and a different saved conversation. Neither source click replaced the active conversation. Real local semantic search, placed-card and PDF page-37 navigation, unreadable-attachment scope and both themes also passed. Two supported questions made two mocked answer requests total. The screenshot `ask-conversation-continuity.png` captures the placed card alongside the original chat and retained draft.
Verified installed/release SHA-256: `46C596B4BA9A9F29C719F304150C4165DBE7445A0A569D2197738BF7889FE591`.
