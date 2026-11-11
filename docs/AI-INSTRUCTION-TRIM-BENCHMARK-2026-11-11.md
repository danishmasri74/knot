# Instruction trimming benchmark — 11 November 2026

Model: `gpt-6-luna`. Suite: `knot-quality-v1` (60 synthetic cases). Approved limit: **US$1
total**. Spent: **US$0.031** across five runs (all costs known, pricing
`openai-standard-2026-11-11-v2`). Outputs were compared case by case by the assistant
(not an independent human grader). Edit proposals were replayed in Knot's editor without
paid calls.

## What changed

- **Conditional base instructions** (`base_instructions` in `src-tauri/src/ai.rs`). The
  former single instruction string is split into sections, keeping its wording and order.
  Visual/PDF rules are sent only with an image/PDF input or PDF-sourced context.
  Read-only surrounding rules are sent only when surrounding context exists. Rewrite,
  insert and edit-JSON rules are sent only for their operations. A request that needs
  every section gets the former text unchanged. A plain note question's base instructions
  drop from 2,920 to 1,145 bytes.
- **Rewrite blocks rule:** "For rewrite, leave blocks empty." In runs 3–4, case 21
  returned a replacement plus a duplicate block, which Knot correctly refused to apply.
- **Shorter compact-format legend** (686 → 501 bytes). It notes that block text can state
  status too, which fixes case 4 ("Draft complete." read as "no tasks done").
- **Edit marker rule** (edit operations only): never copy `#`, `-`, `[ ]`, `[x]` line
  markers into generated text. Run 3 produced `[x] Draft is complete` as card text.
- **Runner reservation:** the per-case input reservation is 20,000 tokens instead of
  272,000 (largest v1 case: 1,219). The run still stops on any larger request. The full
  suite reserves US$0.48 on Luna.

## Results

| Run | Label | Input tokens | Output | Cost (USD) | p50 / p95 ms |
|---|---|---:|---:|---:|---|
| `c8ce1850` | 5 Nov baseline (old format) | 50,309 | 3,011 | 0.0051* | 1575 / 3826 |
| `fe0cb875` | full instructions + compact context | 57,295 | 3,568 | 0.0075 | 1629 / 2867 |
| `82bdaa05` | trimmed | 42,876 | 3,471 | 0.0060 | 1469 / 3178 |
| `6381a99f` | + shorter legend | 41,014 | 3,297 | 0.0058 | 1669 / 2602 |
| `1e26d29b` | + edit marker rule | 41,572 | 3,562 | 0.0059 | 1606 / 2854 |
| `2e30be72` | + rewrite blocks rule (**shipped**) | 41,628 | 3,517 | 0.0059 | 1687 / 3116 |

\*11 of 60 Nov 5 costs were unknown; the known sum is partial.

Shipped vs. full instructions: **−27% input tokens, −22% cost**, 60/60 successful.
Proposal replay: 18/18 valid, applied and undone (the Nov 5 run had 17/18).

Synthetic contexts are tiny (~460 bytes). On them, the compact format's legend outweighed
the duplicate text it removed (+14% input in run `fe0cb875`). Real notes are far larger:
a live 10 KB note context fell ~85% in the installed app. Synthetic token totals therefore
understate the real-note effect.

## Quality notes

- Fixed relative to earlier runs: case 4 (completed task), case 21 (rewrite applies).
  No marker leaks in the final run. Injection case 8 stays safe in all runs.
- Run-to-run noise is substantial. Canvas and image cases received identical instructions
  in every run, yet varied (for example case 52 counted the arrow as a shape in two runs;
  case 41 checklists differed). In the final run, follow-up case 58 declined to compare
  although ask instructions were unchanged since the previous run, which answered
  correctly. Case 16 (risk mitigation) is still dropped in most runs, as on Nov 5.
- Single runs per configuration are not statistical estimates; independent human grading
  remains pending, as for the Nov 5 baseline.

Logs: `test-results/bench-*.log`, `test-results/replay-*.log`. Raw results live in
`tests/benchmarks/results/` (git-ignored).
