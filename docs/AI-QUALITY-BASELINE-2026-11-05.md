# GPT-6 Luna live quality benchmark — November 5, 2026

**60/60 live cases completed. Provisional AI-assisted review completed; acceptance
targets are not fully met, and independent human grading remains pending.**

Run: `c8ce1850-168c-41fe-b146-6b073c6a3e82`. Model: `gpt-6-luna`.
Suite: `knot-quality-v1`. Pricing: `openai-standard-2026-11-05-v1`.
The user explicitly authorized this model and a **US$5 total limit**. No other
model was used. Prompts, routing and production payload construction were unchanged.
All inputs and outputs belong to the separate synthetic benchmark fixtures.

## Results

| Measure | Result |
| --- | ---: |
| Successful live responses | 60 / 60 |
| Valid edit proposals | 17 / 18 (94.44%) |
| Valid proposals passing editor Apply and Undo | 17 / 17 |
| Median response latency | 1.531 seconds |
| p95 response latency | 3.826 seconds |
| Provider input/output usage coverage | 60 / 60 |
| Exact estimate coverage | 49 / 60 (81.67%) |
| Known estimated cost, covered calls only | US$0.0051081 |
| Budget accounted, including full reservations for unknown costs | US$0.7861081 |
| Approved limit | US$5.00 |

The budget-accounted amount is **not a billed total**. Eleven costs remain unknown:
ten responses reported positive cache-write totals without lifetime breakdowns;
the first response predates service-tier capture in this run's output file.
Each unknown-cost call consumes the full US$0.071 conservative reservation.
Known estimates are only a partial sum. The runner made exactly one request per
case, resuming after cases 1 and 21 without repeating completed cases.

## Provisional scoring

Reviewer: Codex assistant, not an independent human evaluator. Each case has a
written rationale and 0–2 scores for factual fidelity, source/visual grounding,
instruction compliance, and edit validity where applicable. Non-applicable
dimensions are excluded. This single run is not a statistical reliability estimate.

| Category | Cases | Applicable score |
| --- | ---: | ---: |
| Questions and citations | 12 | 98.61% |
| Summaries | 8 | 91.67% |
| Rewrites | 8 | 91.67% |
| Comparisons | 8 | 100.00% |
| Canvas | 8 | 83.33% |
| PDFs and images | 10 | 100.00% |
| Follow-up conversations | 6 | 94.44% |
| Overall | 60 | 94.72% |

Fifty-five of 60 cases received full factual-fidelity scores (91.67%). No fabricated
source markers were observed in this review. The proposal-validity target was
95%; **94.44% misses that target**. Therefore this is a recorded baseline run,
not an accepted quality gate or a completed human-reviewed baseline.

## Findings to carry into the next milestone

- **Case 43 — invalid canvas self-connection.** The model returned one card and an
  edge from card 0 to itself. Knot's validator rejected it before Apply. The source
  sequence was readable, but the proposal was unusable.
- **Case 23 — rewrite changes plurality.** “The teams is ready” became “The team
  is ready” rather than preserving “teams” and correcting the verb. It is a valid
  edit structurally, but changes meaning.
- **Case 22 — rewrite weakens urgency.** “Now” became “when you have a chance.”
- **Cases 13–14 — summary precision.** One answer infers causality between a delay
  and a blocker; another moves “preliminary” from results to the trial itself.
- **Cases 16 and 39 — omitted source detail.** The risk summary drops the backup
  vendor mitigation; two canvas cards retain topic titles but lose their actions.
- **Cases 40–41 — partial format compliance.** A comparison uses a single table
  card instead of distinct cards; a checklist combines completion information
  rather than preserving separate task status presentation.
- **Cases 5, 57 and 58 — incomplete comparison/follow-up wording.** Answers are
  grounded but omit part of the expected comparison or clear correction.

Case 42's arrows were accepted because their “depends on” labels make the reverse
direction semantically correct. A rigid direction-only check would falsely fail it.
PDF page citations, image labels/counts, the protected rewrite run, and stale-source
citation refusal passed this review.

## Accounting fix and verification

Live responses exposed a valid zero-cache-write variant: the provider reports
`cache_write_tokens: 0` but omits its two lifetime fields. The estimator now derives
zero lifetime charges only when the reported total is zero; raw missing fields
remain null. Positive writes without their breakdown still have unknown cost.
Regression tests cover zero, missing, positive and contradictory counts.

The benchmark now resumes an existing run while retaining all prior reservations.
It continues with unknown cost only when reported standard service tier and
input/output counts prove the request fits the conservative reservation. Failures,
unknown usage/tier, or counts outside the bound still stop further calls.

All 18 live edit proposals were replayed in Knot's actual editor implementation
inside an isolated browser workspace, without additional model calls. Seventeen
validated, applied and undid successfully; the invalid self-connection was blocked.
This checks editor mechanics, not the semantic correctness of every valid edit.

## Artifacts

- [Raw live results](../tests/benchmarks/results/c8ce1850-168c-41fe-b146-6b073c6a3e82.jsonl)
- [Per-case provisional review and source hashes](../tests/benchmarks/results/c8ce1850-168c-41fe-b146-6b073c6a3e82.review.json)
- [Editor replay results](../tests/benchmarks/results/c8ce1850-168c-41fe-b146-6b073c6a3e82.editor.json)

Result files are local and git-ignored, separate from workspace diagnostics.
The review records the repository HEAD plus hashes of evaluated source files and
fixtures because the working tree contains uncommitted work.

Post-run verification: 67 offline Rust tests passed, with 4 intentionally ignored. The replay script passed ESLint. pnpm update:running completed, verified the installed executable, and relaunched Knot through the normal close/save flow. Update log: test-results/ai-live-benchmark-update.log.

