# Knot quality benchmark v1

Status: **60 live Luna cases executed on November 5, 2026 under an approved US$5 limit;
provisional AI-assisted review complete, independent human grading pending**.
See [results and findings](../../docs/AI-QUALITY-BASELINE-2026-11-05.md).
Offline mocks and regression checks verify mechanics, never model quality.

`cases.v1.json` contains 60 synthetic cases: 12 questions/citations, 8 summaries,
8 rewrites, 8 comparisons, 8 canvas, 10 PDFs/images, and 6 follow-up conversations.
Each contains exact context, conversation, operation, expected behavior and rubric.
Follow-ups replay fixed prior turns for reproducibility; they do not measure cumulative
free-running conversation drift. The synthetic PDF and diagram are committed under
`assets`; regenerate with `node tests/benchmarks/generate-assets.mjs`.

## Routing suite

`routing.v1.json` holds 27 synthetic automatic-routing cases (13 November 2026; cases 21–26 add workspace search, case 27 sends a completed search back): each offers
a set of tools and names the expected route (`answer` or a tool). Run it with the same gate
plus `KNOT_BENCHMARK_SUITE=routing`. Result rows add `route`, `expected_route` and
`route_ok`. Phase 1 of [automatic actions](../../docs/AI-AUTO-ACTIONS-PLAN.md) should not
ship to a release before a routing run is reviewed.

## Paid execution gate

The initial run was explicitly authorized for GPT-6 Luna and US$5 total. New runs
need their own approved model and spending limit. Configure a dedicated OpenAI project for standard processing
with a matching account-side spending cap, and connect its key in Knot. The runner
uses Credential Manager and never prints or stores the key. Do not use production
notes. Do not enable Fast/Flex or other project-default service tiers.

Only after approval, set `KNOT_BENCHMARK_APPROVED=paid-synthetic-evaluation`,
`KNOT_BENCHMARK_MODEL` to an approved Knot model, and
`KNOT_BENCHMARK_BUDGET_USD` to the approved numeric limit. From `src-tauri`, run:

```text
cargo test --lib ai::tests::live_quality_benchmark -- --ignored --exact --nocapture
```

The sequential runner reserves 20,000 input tokens (at the highest cache-write rate for
GPT-6) and 6,000 output tokens per case using the versioned standard rates. The largest v1
case used 1,219 input tokens, and any request reporting more than the reservation stops
the run. It refuses to start unless the full suite fits the limit. Unknown usage,
nonstandard service tiers, failures or an exceeded reservation stop further requests.
Unknown cost with reported standard tier and bounded input/output consumes the full
reservation. No automatic retries. The reservation is a conservative client check, not a
substitute for a provider-side account cap. For Luna the full reservation is $0.48; this
is an estimate, not authorization. `KNOT_BENCHMARK_LABEL` optionally names a run in its
result header. See the [11 November comparison](../../docs/AI-INSTRUCTION-TRIM-BENCHMARK-2026-11-11.md).

Results are separate JSONL files in `results/` (git-ignored), containing synthetic
answers, usage, timing, fixture IDs, model and pricing version. A stopped run is
partial. Successful transport leaves quality **ungraded**. Never copy ordinary
diagnostics content into these fixtures or results.

To resume the same authorized run, also set `KNOT_BENCHMARK_RESUME` to its UUID.
The runner checks the original model, suite and approved budget, retains prior
costs/reservations, and skips successful cases. It does not reset the budget.
`node tests/benchmarks/replay-live.mjs <run-uuid>` validates and applies/undoes the
live edit proposals in an isolated browser editor; this uses no paid calls.

## Scoring and baseline acceptance

Review every result against its three rubric items. Score each dimension 0 (fails),
1 (partially meets), or 2 (fully meets): factual fidelity, citation correctness
(or visual/page grounding), instruction compliance, and edit/format validity.
Record reviewer, UTC review time, per-dimension scores and rationale in a separate
`results/<run>.review.json`; mark non-applicable citation dimensions null and exclude
them from the denominator. Inspect structured proposals in Knot before scoring
edit validity; a parseable JSON response alone does not establish editor safety.

Report per-category and overall mean scores, severe factual/citation failures,
proposal validity rate, p50/p95 latency, known cost and usage/cost coverage. Report
all 60 case IDs, model, suite version, pricing version and app source revision.
Initial acceptance targets: >=90% fully correct factual grounding, >=95% valid
proposals, no unsafe edits, no fabricated source citations, and no category below
80% of applicable score. These are targets, not observed results. A baseline is
complete only when all cases have live results and human grading; compare future
runs using the same fixtures, model settings and scoring rules.
