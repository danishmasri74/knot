import { expect, test } from "vitest";
import {
  editIntent,
  proposalHistory,
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
test("edit requests use the open note instead of workspace search", () => {
  const base = {
    scope: "auto" as const,
    automatic: true,
    selected: false,
    attached: false,
    active: true,
  };
  for (const prompt of [
    "Shorten this",
    "Can you rewrite the intro?",
    "Turn this into a mind map",
    "Add a summary at the end",
    "Put the steps on the canvas",
  ]) {
    expect(editIntent(prompt), prompt).toBe(true);
    expect(resolveSourceMode({ ...base, mode: "auto", prompt })).toBe(
      "current",
    );
  }
  for (const prompt of [
    "What did I write about spaced repetition?",
    "Explain the launch plan",
    "Who owns support?",
  ]) {
    expect(editIntent(prompt), prompt).toBe(false);
    expect(resolveSourceMode({ ...base, mode: "auto", prompt })).toBe(
      "workspace",
    );
  }
  // Edit intent never widens Ask, and needs an open document.
  expect(
    resolveSourceMode({ ...base, mode: "ask", prompt: "Shorten this" }),
  ).toBe("workspace");
  expect(
    resolveSourceMode({
      ...base,
      active: false,
      mode: "auto",
      prompt: "Shorten this",
    }),
  ).toBe("workspace");
  expect(
    resolveSourceMode({ ...base, mode: "rewrite", prompt: "Shorten this" }),
  ).toBe("legacy");
});
test("follow-ups after a proposal describe it without its content", () => {
  const turns = [
    { role: "user", content: "Shorten this" },
    {
      role: "assistant",
      content: "Suggested rewrite",
      proposal: { replacements: ["PRIVATE"] },
      mode: "rewrite",
      status: "applied",
    },
  ];
  const history = proposalHistory(turns);
  expect(history).toEqual([
    { role: "user", content: "Shorten this" },
    {
      role: "assistant",
      content:
        "(Proposed a rewrite of the selected text. The user applied it.)",
    },
  ]);
  expect(JSON.stringify(history)).not.toContain("PRIVATE");
  expect(
    proposalHistory([turns[0], { role: "assistant", content: "An answer" }]),
  ).toEqual([]);
  expect(proposalHistory([turns[0], { ...turns[1], failed: true }])).toEqual(
    [],
  );
});
