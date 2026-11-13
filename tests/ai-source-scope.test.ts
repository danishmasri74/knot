import { expect, test } from "vitest";
import {
  editIntent,
  exchangeHistory,
  resolveSourceMode,
  usesNoteSources,
} from "../src/services/ai-source-scope";
test("standalone canvas creation omits canvas sources", () => {
  expect(
    usesNoteSources(
      "auto",
      "canvas",
      "Can you create a card that explains ISTQB",
      false,
      false,
    ),
  ).toBe(false);
});
test("explicit sources and source-based requests are preserved", () => {
  for (const prompt of [
    "Summarize this canvas",
    "Create cards based on my notes",
  ])
    expect(usesNoteSources("auto", "canvas", prompt, false, false)).toBe(true);
  expect(usesNoteSources("auto", "canvas", "Explain ISTQB", true, false)).toBe(
    true,
  );
  expect(usesNoteSources("auto", "canvas", "Explain ISTQB", false, true)).toBe(
    true,
  );
  expect(
    usesNoteSources("current", "canvas", "Explain ISTQB", false, false),
  ).toBe(true);
  expect(usesNoteSources("none", "rewrite", "Rewrite", true, false)).toBe(true);
});
test("automatic messages read what is open; Knot searches by itself", () => {
  const base = {
    scope: "auto" as const,
    automatic: true,
    selected: false,
    attached: false,
    active: true,
  };
  for (const prompt of [
    "Shorten this",
    "What did I write about spaced repetition?",
    "Who owns support?",
  ])
    expect(resolveSourceMode({ ...base, mode: "auto", prompt })).toBe(
      "current",
    );
  expect(
    resolveSourceMode({ ...base, active: false, mode: "auto", prompt: "Hi" }),
  ).toBe("none");
  expect(
    resolveSourceMode({ ...base, attached: true, mode: "auto", prompt: "Hi" }),
  ).toBe("explicit");
  expect(
    resolveSourceMode({ ...base, scope: "none", mode: "auto", prompt: "Hi" }),
  ).toBe("none");
  // Ask keeps searching first; forced edits stay legacy.
  expect(
    resolveSourceMode({ ...base, mode: "ask", prompt: "Who owns support?" }),
  ).toBe("workspace");
  expect(
    resolveSourceMode({ ...base, mode: "rewrite", prompt: "Shorten this" }),
  ).toBe("legacy");
  expect(editIntent("Turn this into a mind map")).toBe(true);
  expect(editIntent("What did I write about spaced repetition?")).toBe(false);
});
test("follow-ups replay the user's messages, never answers or proposals", () => {
  const turns = [
    { role: "user", content: "What are the launch risks?" },
    { role: "assistant", content: "PRIVATE ANSWER [S1]" },
    { role: "user", content: "Shorten this" },
    {
      role: "assistant",
      content: "Suggested rewrite",
      proposal: { replacements: ["PRIVATE"] },
      mode: "rewrite",
      status: "applied",
    },
    { role: "user", content: "Failed one" },
    { role: "assistant", content: "Interrupted", failed: true },
  ];
  const history = exchangeHistory(turns);
  expect(history).toEqual([
    { role: "user", content: "What are the launch risks?" },
    {
      role: "assistant",
      content: "(Answered in chat; the answer is not repeated here.)",
    },
    { role: "user", content: "Shorten this" },
    {
      role: "assistant",
      content:
        "(Proposed a rewrite of the selected text. The user applied it.)",
    },
  ]);
  expect(JSON.stringify(history)).not.toContain("PRIVATE");
  expect(exchangeHistory(turns, 1)).toEqual(history.slice(2));
  expect(exchangeHistory([])).toEqual([]);
});
