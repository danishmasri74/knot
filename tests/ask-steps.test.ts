import { expect, it } from "vitest";
import {
  beginStep,
  endSteps,
  stepSummary,
  visibleSteps,
} from "../src/services/ask-steps";

it("runs steps one after another", () => {
  let steps = beginStep([], "files", "Reading files · 1 of 3", "Read 3 files", 0);
  steps = beginStep(steps, "files", "Reading files · 2 of 3", "Read 3 files", 100);
  expect(steps).toHaveLength(1);
  expect(steps[0].label).toBe("Reading files · 2 of 3");
  steps = beginStep(steps, "thinking", "Thinking", "Thought", 900);
  expect(steps[0]).toMatchObject({ state: "done", ms: 900 });
  steps = beginStep(steps, "writing", "Writing", "Wrote", 9900);
  steps = endSteps(steps, false, 12000);
  expect(steps.every((s) => s.state === "done")).toBe(true);
  expect(stepSummary(steps)).toBe("Read 3 files · Thought for 9 s");
});

it("hides quick model steps and marks failures", () => {
  let steps = beginStep([], "thinking", "Thinking", "Thought", 0);
  steps = beginStep(steps, "writing", "Writing", "Wrote", 120);
  expect(visibleSteps(steps).map((s) => s.id)).toEqual(["writing"]);
  expect(stepSummary(endSteps(steps, false, 500))).toBe("");
  const failed = endSteps(beginStep([], "search", "Searching your notes", "Searched your notes", 0), true, 50);
  expect(failed[0].state).toBe("failed");
  expect(stepSummary(failed)).toBe("Searching your notes (stopped)");
});
