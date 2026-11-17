/**
 * What Ask Knot is doing for a message, step by step ("Reading 3 files",
 * "Searching your notes", "Writing"). Steps come from what Knot actually
 * does, never from the model, and run one after another: starting a step
 * finishes the one before. See docs/AI-RICH-ANSWERS-PLAN.md, part 5.
 */
export type AskStep = {
  id: string;
  /** While it runs: "Reading 3 files". */
  label: string;
  /** Once finished: "Read 3 files". */
  done: string;
  state: "active" | "done" | "failed";
  /** When it started, and how long it took once finished (ms). */
  at: number;
  ms?: number;
};

/** Steps quicker than this aren't drawn, so fast answers show only Writing. */
export const QUIET_STEP_MS = 300;
/** Steps that describe the model's own work, not something Knot read. */
const MODEL_STEPS = new Set(["thinking", "writing", "preview"]);

const finish = (step: AskStep, now: number, failed = false): AskStep =>
  step.state === "active"
    ? { ...step, state: failed ? "failed" : "done", ms: Math.max(0, now - step.at) }
    : step;

/** Starts a step, finishing the running one; the same step only relabels. */
export function beginStep(
  steps: AskStep[] | undefined,
  id: string,
  label: string,
  done: string,
  now = Date.now(),
): AskStep[] {
  const list = steps ?? [];
  const last = list.at(-1);
  if (last?.state === "active" && last.id === id)
    return [...list.slice(0, -1), { ...last, label, done }];
  return [
    ...list.map((step) => finish(step, now)),
    { id, label, done, state: "active", at: now },
  ];
}

/** Finishes every running step, marking it failed when the request failed. */
export function endSteps(
  steps: AskStep[] | undefined,
  failed = false,
  now = Date.now(),
): AskStep[] {
  return (steps ?? []).map((step) => finish(step, now, failed));
}

/** Steps worth drawing: running ones, and finished ones that took a moment. */
export function visibleSteps(steps: AskStep[] | undefined): AskStep[] {
  return (steps ?? []).filter(
    (step) =>
      step.state !== "done" ||
      (step.ms ?? 0) >= QUIET_STEP_MS ||
      !MODEL_STEPS.has(step.id),
  );
}

/** One line for a finished answer: "Read 3 files · Searched your notes ·
 * Thought for 8 s". Empty when Knot only wrote. */
export function stepSummary(steps: AskStep[] | undefined): string {
  const list = steps ?? [];
  const parts = list
    .filter((step) => step.state !== "active" && !MODEL_STEPS.has(step.id))
    .map((step) => (step.state === "failed" ? `${step.label} (stopped)` : step.done));
  const thinking = list
    .filter((step) => step.id === "thinking")
    .reduce((ms, step) => ms + (step.ms ?? 0), 0);
  if (thinking >= 1000) parts.push(`Thought for ${Math.round(thinking / 1000)} s`);
  return [...new Set(parts)].join(" · ");
}
