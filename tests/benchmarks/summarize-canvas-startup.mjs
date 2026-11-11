import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [beforeFile, afterFile] = process.argv.slice(2);
assert.ok(
  beforeFile && afterFile,
  "Pass before.json and after.json trial arrays",
);
const before = JSON.parse(await readFile(beforeFile, "utf8"));
const after = JSON.parse(await readFile(afterFile, "utf8"));
const stats = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? {
        n: sorted.length,
        median: sorted[Math.floor(sorted.length / 2)],
        worst: sorted.at(-1),
      }
    : null;
};
const key = (row) => (row.rich ? "rich" : String(row.size));
const board = (rows, fixture) => {
  const trials = rows.filter((r) => r.kind === "board" && key(r) === fixture);
  return {
    panMs: stats(trials.map((r) => r.panInput.inputMs)),
    characterMs: stats(trials.map((r) => r.typeInput.inputMs)),
    settledPanMs: stats(trials.map((r) => r.panInput.settleMs)),
    settledCharacterMs: stats(trials.map((r) => r.typeInput.settleMs)),
    pageMs: stats(trials.map((r) => r.pageMs)),
    pdfLoadingDuringPan: trials.filter((r) => r.panInput.pdfPendingDuringPan)
      .length,
    phases: Object.fromEntries(
      [
        "knot:canvas-layer-watch",
        "knot:canvas-layer-init",
        "knot:canvas-note-mount",
        "knot:canvas-viewport-ready",
        "knot:canvas-input-unlocked",
      ].map((name) => [
        name,
        stats(
          trials.flatMap((r) => {
            const events =
              r.panInput.phases?.filter((p) => p.name === name) ?? [];
            return events.length
              ? [
                  name.includes("layer")
                    ? Math.max(...events.map((p) => p.duration))
                    : Math.min(...events.map((p) => p.startMs)),
                ]
              : [];
          }),
        ),
      ]),
    ),
  };
};
const direct = (rows) =>
  rows
    .filter((r) => r.kind === "direct-canvas")
    .map((r) => ({
      fixture: key(r),
      panMs: r.panInput.inputMs,
      characterMs: r.typeInput?.inputMs ?? null,
      settledPanMs: r.panInput.settleMs,
      settledCharacterMs: r.typeInput?.settleMs ?? null,
      typeFailure: r.typeFailure ?? null,
      phases: r.panInput.phases,
    }));
console.log(
  JSON.stringify(
    {
      fixtures: Object.fromEntries(
        ["100", "1000", "5000", "rich"].map((f) => [
          f,
          { before: board(before, f), after: board(after, f) },
        ]),
      ),
      direct: { before: direct(before), after: direct(after) },
      saveReopen: after.filter((r) => r.kind === "save-reopen"),
    },
    null,
    2,
  ),
);
