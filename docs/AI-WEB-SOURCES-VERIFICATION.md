# Website-source release verification

7 November 2026. Core milestones 0–5; remote PDF ingestion and rendered browser capture remain follow-ons.

The implementation preserves the existing working tree and uses Knot's native preview/Apply, editor identity/revision guards, grouped Undo, autosave, Card Deck and backup paths. No live paid AI evaluation or external extraction service was used.

## Verified behavior

- Production Vite worker: Readability 0.6.0 plus LinkeDOM 0.18.15, structured article/docs/code/tables/Unicode/malformed/short pages, inert hostile HTML, and no script or subresource requests. The parser never inserts captured HTML into the shell. Deadline tests assert worker termination on timeout and cancellation.
- Native fetch fixtures: public IPv4/IPv6 policy, mixed DNS answers/rebinding defense, app origins/credentials, manual redirects/loops/private redirect/downgrade rejection, chunked/absent-length streaming, type/PDF recovery, declared encodings/BOM behavior, compressed expansion limits, response/batch limits, 403/404/429/5xx, bounded retry and Retry-After. A cfg(test)-only pinned fixture address is absent from release policy; production always validates DNS and pins every connection. Proxies are explicitly bypassed.
- Input/composition: multiple/Markdown URLs, balanced parentheses, query preservation, ordinary fragments, exact deduplication and captured-document deduplication, No notes with web evidence, failed-only retry, mixed outcomes, all-failed generation skipped, cancellation/late callbacks, source diversity, UTF-8 budgets, included/omitted sections, and frozen selected evidence.
- Native UI: Ask, Insert content, Create on canvas, preview/Apply, web refs validated against the frozen table, refresh invalidation, source removal despite URL remaining in prose, normal Stop, quota failure/Retry save, light/dark menu tokens, keyboard/focus dismissal, and 760×540 bounds.
- Durable content: supporting excerpts in `knot:web-source` child blocks, native cards/connectors, pure mind-map source companion, one Undo without orphan source children, stale proposal rejection, Card Deck sharing, save/reopen, native restart and backup/restore after chat deletion, HTML/plain-text export and normal Markdown conversion. Improving a saved sourced card retains original web evidence through the shared composer.
- Existing frontend AI selection rewrite, formatting, native insertion, Canvas layout and Card Deck suites; PDF and image AI suites; card-suggestion scoped requests and snooze/revisit; shared dropdown suite; full native AI persistence/regeneration/cancellation suite. Older native AI selectors were updated for the existing tabbed shell, and the card-suggestion fixture was isolated from the shell's asynchronous empty-state rendering.
- Native browser isolation includes denial of `web_sources_fetch` and `web_sources_cancel` from remote pages. Mini-browser behavior and production browser code were not changed.

## Commands and evidence

`pnpm check`, `pnpm lint`, `pnpm test`, and `cargo test --manifest-path src-tauri/Cargo.toml` are required before installation. Focused commands:

```
node tests/web-source-worker.browser.mjs
node tests/web-provenance.browser.mjs
node tests/ai.browser.mjs
node tests/ai-canvas.browser.mjs
node tests/card-deck.browser.mjs
node tests/card-suggestions.browser.mjs
node tests/pdf-ai.browser.mjs
node tests/image-ai.browser.mjs
node tests/dropdowns.browser.mjs
node tests/native/ai-web-sources.mjs
node tests/native/ai.mjs
node tests/native/browser-gate.mjs
```

The worker browser test uses a production build served by Vite preview at port 1421. Other browser suites use the development server at 1420. Native suites use the debug executable and isolated test workspaces, with mocked AI and source transport at the test WebView boundary. Actual fetch/encoding/network policy uses native fixture tests. None substitutes the user's API key or changes their workspace data.

The final native workflow exercised the actual fetch command against a loopback URL and verified its ordered completion event before switching to mocked sources. Rust fixtures also checked TLS certificate rejection. Representative evidence is in `test-results/ai-web-sources-1794019065227`, `test-results/ai-1793991423838`, and `test-results/browser-gate-1793991534114`.

## Limits and interpretation

Ready means usable captured text, not proven completeness. Article heuristics can miss boilerplate, access restrictions or JS content; ambiguous partial content remains inspectable. Semantic support and essential-source dependency are model instructions, with acceptance examples in `tests/fixtures/web-evidence-quality.json` and a native request/schema contract test. Mocked generation validates application behavior, not live model quality. Direct PDF URLs and hash-route/rendered-browser pages expose recovery rather than claiming support. No automatic crawling occurs.

The core stores bounded supporting excerpts, not offline copies of entire websites. Applied evidence is in workspace backups; chat-only evidence retains the existing localStorage backup exclusion. The existing broader legacy failures documented in `MINI-BROWSER.md` (panels/editor/PDF-highlight orphan-undo expectations) are not represented as a clean full native suite.

## Final checks and installed app

`pnpm check` and `pnpm lint` passed. All 89 frontend tests passed. Rust reported 76 passing tests and 4 ignored tests. The production Vite worker and focused browser and native workflows passed.

`pnpm update:running` built the release executable and NSIS installer, verified the installed executable against the release build, and relaunched Knot. The update log is `test-results/web-sources-installed-update.log`.

## Website proposal schema correction

The first reported live canvas attempt returned HTTP 400 after successful page capture. The citation-schema walker used mutable indexing while visiting primitive and array nodes, which inserted `properties: null` into those schema nodes. Traversal now uses `get_mut` and preserves their original shape. The native contract test validates every schema node, object requirements and citation references across rewrite, insert and canvas requests.

TypeScript, lint, all 89 frontend tests and 76 Rust tests passed after the correction. The installed app was rebuilt, verified and relaunched through `pnpm update:running`. Logs are in `test-results/web-sources-schema-rust.log` and `test-results/web-sources-schema-update.log`.
