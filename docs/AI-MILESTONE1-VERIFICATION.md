# Milestone 1 verification — November 5, 2026

Subsequent execution: the user later approved a US$5 GPT-6 Luna run. All 60 live
cases completed; see [the provisional review](AI-QUALITY-BASELINE-2026-11-05.md).
The original implementation-stage results below predate that run. After the
zero-cache-write fix, 67 offline Rust tests passed (4 intentionally ignored).

Implemented measurement and the quality-evaluation harness. **The live quality
baseline remains unexecuted and ungraded. No paid model calls were made.**

Passed:

- `pnpm check` and `pnpm test`: 55 frontend unit tests, including coverage arithmetic
  and 60-case benchmark manifest checks.
- `cargo test --lib`: 66 passed, 4 intentionally ignored. Includes frozen payload
  comparisons on/off, actual local HTTP/SSE byte-fragmentation, numeric usage,
  cache read/write accounting, missing-usage handling, cancellation records,
  privacy, unavailable storage, bounded queue/performance, retention, clear of
  in-flight records, outcome deduplication and workspace-backup exclusion.
- `node tests/ai.browser.mjs`, `node tests/ai-canvas.browser.mjs`,
  `node tests/image-ai.browser.mjs`, `node tests/pdf-ai.browser.mjs`.
- `node tests/native/ai-diagnostics.mjs`: real Rust IPC and SQLite, no provider
  network calls; retry links, collection control, filters, clear, content exclusion.
  Screenshot inspected at `test-results/ai-diagnostics-1793857934028/diagnostics.png`.
- `node tests/native/ai.mjs`: mocked provider, real editor/save workflow; Apply,
  Undo, stale rejection, streaming, failure, cancellation, explicit context,
  outcomes, chat persistence, message editing, regeneration, copy and restart.
- `node tests/native/ai-settings.mjs`: enable/disable, normal reload/save,
  connection/model settings and retained chats.
- ESLint over all changed feature and test files, and `git diff --check`.

Full `pnpm lint` remains blocked by two pre-existing unused variables:
`welcome` in `tests/native/.card-probe.mjs:8` and `child` in
`tests/native/ai-library.mjs:8`. These unrelated files were not changed to suppress
the errors.

Initial browser checks encountered a stale Vite dependency cache (HTTP 504); the
project dev server was restarted and all four checks passed. An intermediate debug
rebuild encountered a Windows executable lock from an isolated test instance;
the test instance closed normally, and the next debug build passed. No installed
user process was force-killed.

The native AI test was updated to assert the current structured additional-note
context instead of the obsolete `.text` field and to wait for asynchronous copy
confirmation. It now also checks application outcome events.

Limitations: native provider responses are mocks; local backend HTTP tests use
synthetic SSE. Neither establishes live model quality or account billing accuracy.
The native export save-file dialog was not automated; export content is covered
by the storage snapshot/privacy checks. Generic editor Undo is not attributed to
an AI attempt; the guarded Ask Knot Undo action is. No paid benchmark budget has
been approved. See `tests/benchmarks/README.md` for the explicit execution gate and
human grading requirements.

Installed-app update result is recorded in `test-results/ai-milestone1-update.log`.

Final update: pnpm update:running completed successfully. The updater verified the installed executable and relaunched Knot through the normal close/save workflow.

