import { expect, test } from "vitest";
import {
  cleanAiProposal,
  stripAiSourceMarkers,
} from "../src/services/ai-generated-content";
import type { AiProposal } from "../src/features/editor/blocksuite/ai";

test("removes internal markers without damaging prose, formatting, or real references", () => {
  expect(
    stripAiSourceMarkers(
      "Founded in **2002**. [S3] [S5]\nShared [S15] concepts [s16].",
    ),
  ).toBe("Founded in **2002**.\nShared concepts.");
  expect(
    stripAiSourceMarkers(
      "Uses S3 storage, [3], (p. 3), [Spec](https://example.com), and [S1](https://example.com).",
    ),
  ).toBe(
    "Uses S3 storage, [3], (p. 3), [Spec](https://example.com), and [S1](https://example.com).",
  );
});

test("cleans every generated surface while retaining provenance, structure, and protected rewrites", () => {
  const input: AiProposal = {
    replacements: ["Existing [S1] text"],
    blocks: [
      {
        type: "paragraph",
        text: "Overview [S1]",
        sourceRefs: ["capture/s1"],
        children: [
          {
            type: "table",
            text: "Comparison [S2]",
            columns: ["Name [S3]"],
            rows: [["Value [S4]"]],
            sourceRefs: ["capture/s2"],
          },
          {
            type: "kanban",
            text: "Tasks [S5]",
            columns: ["Done [S6]"],
            rows: [["Task [S7]", "Done [S6]"]],
          },
        ],
      },
    ],
    connections: [
      { from: 0, to: 1, label: "Supports [S8]", sourceRefs: ["capture/s1"] },
    ],
    mindmap: [{ text: "Root [S9]", parent: -1, sourceRefs: ["capture/s1"] }],
  };
  const cleaned = cleanAiProposal(input);
  expect(cleaned.blocks[0]).toMatchObject({
    text: "Overview",
    sourceRefs: ["capture/s1"],
  });
  expect(cleaned.blocks[0].children).toMatchObject([
    {
      text: "Comparison",
      columns: ["Name"],
      rows: [["Value"]],
      sourceRefs: ["capture/s2"],
    },
    { text: "Tasks", columns: ["Done"], rows: [["Task", "Done"]] },
  ]);
  expect(cleaned.connections?.[0]).toMatchObject({
    from: 0,
    to: 1,
    label: "Supports",
    sourceRefs: ["capture/s1"],
  });
  expect(cleaned.mindmap?.[0]).toMatchObject({
    text: "Root",
    parent: -1,
    sourceRefs: ["capture/s1"],
  });
  expect(cleaned.replacements).toEqual(input.replacements);
  expect(input.blocks[0].text).toBe("Overview [S1]");
  expect(cleanAiProposal(cleaned)).toEqual(cleaned);
});
