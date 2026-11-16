# Quality rerun — 16 November 2026

Model: `gpt-6-luna`. Suite: `knot-quality-v1` (60 synthetic cases). Source: `5600ffa`
(0.6.2, clean tree). Approved limit: **US$0.50 total**. Spent: **US$0.019** across
three runs. Each run's budget was the limit minus the actual cost of earlier runs, so
the runner's worst-case reservation never exceeded what was left. All 180 requests
succeeded with known costs. Grading is AI-assisted (Claude), using the suite's rubric.
It is not independent human grading. Edit proposals were replayed in Knot's editor
without paid calls. Review files: `tests/benchmarks/results/<run>.review.json`
(git-ignored).

The suite sends the requests Ask Knot makes when an action is forced (Insert into note,
Make cards, rewrite of a selection). Choosing an action for an ordinary message is
measured by the separate routing suite, which this rerun did not run.

## Results

| Run | Overall | Full factual | Valid proposals | Cost (USD) | p50 / p95 ms |
|---|---:|---:|---:|---:|---|
| 5 Nov baseline `c8ce1850` | 94.72% | 55/60 | 17/18 | 0.0051* | 1531 / 3826 |
| `87b9fead` run 1 | 95.00% | 54/60 | 17/18 | 0.0064 | 1377 / 3287 |
| `75a8ea90` run 2 | 95.83% | 54/60 | 18/18 | 0.0062 | 1382 / 2852 |
| `0b5e9212` run 3 | 97.22% | 56/60 | 18/18 | 0.0065 | 1266 / 3046 |

\*11 of 60 baseline costs were unknown.

| Category | Baseline | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|---:|
| Questions and citations | 98.61 | 100.00 | 98.61 | 95.83 |
| Summaries | 91.67 | 97.92 | 97.92 | 97.92 |
| Rewrites | 91.67 | 93.75 | 93.75 | 97.92 |
| Comparisons | 100.00 | 93.75 | 93.75 | 100.00 |
| Canvas | 83.33 | 93.75 | 95.83 | 93.75 |
| PDFs and images | 100.00 | 98.33 | 98.33 | 98.33 |
| Follow-up conversations | 94.44 | 80.56 | 88.89 | 97.22 |

**Acceptance targets.** Runs 2 and 3 meet all of them: ≥90% fully correct facts, ≥95%
valid proposals, no unsafe edits, no fabricated citations, and no category below 80%.
Run 1 misses only proposal validity: case 33 added an empty duplicate table, which Knot
refused to apply. Across all three runs, 53 of 54 proposals were valid (98%), and run 1's
follow-up category scored 80.56%, just above the 80% floor. Pending human grading, the
target is met on this evidence.

## Fixed since 5 November

- Canvas: no invalid self-connections. Case 43's proposal is valid in every run.
- Summaries keep the mitigation (case 16) and the "preliminary" qualifier (case 14).
- The protected link run (case 27) and the injection case (case 8) stay safe.

## Fixed the same day: false "cannot cite" answers

In the three runs above, 4 of 180 answers said real sources couldn't be cited (cases 11,
34, 55 and 58). One (case 58, run 1) refused to compare at all. There were none on
5 November, 1 across the five 11 November runs, and 4 here. Two causes, both in
`src-tauri/src/ai.rs`:

1. **Compact context.** Since 11 November, note blocks reach the model as `noteSources`
   lines, and `citationSources` is omitted. But `BASE_CITATIONS` and `BASE_NOTES` still
   said to cite from "the citationSources table", and that text absent from it "cannot be
   cited". One answer said the context "doesn't include a citationSources entry". The
   rules now say "copy the citation marker of the source line or entry" and "text without
   a citation marker".
2. **Follow-ups.** The context is the first input message, before the whole conversation,
   which keeps the cached prefix stable. "Only cite blocks present in this request, never
   sources from previous turns" led the model to treat the context as an earlier turn's.
   It now says the document context at the start of the input is current for every turn;
   markers that appear only in earlier assistant messages are still never cited.

The runner gained `KNOT_BENCHMARK_CASES`, so cases can be repeated cheaply.

| Check | Before | After fix 1 | After both |
|---|---:|---:|---:|
| False refusals, cases 11/34/55 | 3 of 9 | 0 of 33 | 0 of 30 |
| False refusals, case 58 | 1 of 3 | 5 of 11 | 0 of 10 |
| Case 12/59 still decline unsourced text | 6 of 6 | 22 of 22 | 20 of 20 |
| Case 57 corrects the stale "Friday" claim | 0 of 3 | 0 of 1 | 4 of 11 |

Regression run `d7051ba0` (both fixes, 56 cases, leaving out 11/12/34/55, which were
repeated above; the budget guard no longer fit all 60): **97.92%**, 18/18 proposals
valid, no category below 93.75%, follow-ups 100%. Its misses are earlier known ones
(cases 13, 14, 16, 22, 23, 40, 41). Cases 14 and 16 had passed in today's first three
runs; summaries vary from run to run, and the fix doesn't touch them.

Total spent on 16 November, including the fix verification: **US$0.042** of the
US$0.50 approved.

## Still open
- **Rewrites change meaning** (as on 5 Nov): "now" becomes "when you have a chance" in all
  runs (case 22); "The teams is ready" becomes "The team is ready" in two of three
  (case 23).
- **Inferred causality** (case 13, all runs): "delayed because testing found a blocker".
- **Stale follow-up claim** (case 57, all runs): the answer cites Monday but never
  corrects the earlier "Friday" claim.
- **Canvas comparisons** use one table card rather than distinct cards (case 40, all
  runs).
- **Checklist completion** (case 41): "Draft is complete" becomes an unchecked todo. The
  canvas proposal schema has no `checked` field, so the model can't express completion.
  This is a gap in Knot, not in the model.
