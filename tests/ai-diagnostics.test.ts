import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  summarizeAttempts,
  summarizeCache,
  type AiAttempt,
} from "../src/services/ai-diagnostics";

describe("diagnostic summaries", () => {
  it("keeps missing usage unknown and does not add outcomes to cost", () => {
    const rows = [
      {
        cost_usd: null,
        usage: { input: null, output: null },
        status: "cancelled",
      },
      {
        cost_usd: 0.03,
        usage: { input: 100, output: 20 },
        status: "completed",
      },
      { cost_usd: null, usage: { input: 100, output: null }, status: "failed" },
    ] as AiAttempt[];
    expect(summarizeAttempts(rows)).toEqual({
      attempts: 3,
      priced: 1,
      usage: 1,
      cost: 0.03,
      failed: 1,
      cancelled: 1,
      input: 100,
      output: 20,
      p50: null,
      p95: null,
    });
  });
  it("separates cache write extra from read savings and counts follow-ups", () => {
    const row = (
      operation: string,
      messages: number,
      cached: number,
      cache: AiAttempt["cache"],
    ) =>
      ({
        operation,
        composition: { messages },
        usage: { input: 1000, cached },
        cache,
      }) as unknown as AiAttempt;
    const rows = [
      row("auto:answer", 1, 0, { extra_usd: 0.004, saved_usd: 0 }),
      row("auto:answer", 3, 900, { extra_usd: 0.0001, saved_usd: 0.002 }),
      row("auto:canvas", 1, 0, { extra_usd: 0, saved_usd: 0 }),
      row("auto:answer", 1, 0, null),
    ];
    const cache = summarizeCache(rows);
    expect(cache.priced).toBe(3);
    expect(cache.extra).toBeCloseTo(0.0041);
    expect(cache.net).toBeCloseTo(-0.0021);
    expect(cache.readShare).toBeCloseTo(0.3);
    expect([cache.firstWrites, cache.followUps, cache.followUpReads]).toEqual([
      1, 1, 1,
    ]);
    expect(cache.byOperation.map((r) => r.operation)).toEqual([
      "auto:answer",
      "auto:canvas",
    ]);
  });
  it("has 60 distinct, reviewable synthetic cases across all required categories", () => {
    const suite = JSON.parse(
      readFileSync("tests/benchmarks/cases.v1.json", "utf8"),
    );
    expect(suite.cases).toHaveLength(60);
    expect(new Set(suite.cases.map((c: { id: string }) => c.id)).size).toBe(60);
    expect(
      new Set(suite.cases.map((c: { category: string }) => c.category)).size,
    ).toBe(7);
    for (const c of suite.cases) {
      expect(c.messages.length).toBeGreaterThan(0);
      expect(c.expected.length).toBeGreaterThan(20);
      expect(c.rubric.length).toBeGreaterThanOrEqual(3);
    }
  });
});
