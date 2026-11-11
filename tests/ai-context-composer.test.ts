import { expect, test } from "vitest";
import { dropCoveredCopies } from "../src/services/ai-context-composer";
import type { CitationSource } from "../src/services/web-source-types";

const cite = (document: string, id: string, text: string, n: number) =>
  ({ document, id, text, citation: `[S${n}]` }) as CitationSource;

test("covered structure and text are stored once, in the citation table", () => {
  const data: Record<string, unknown> & { citationSources: CitationSource[] } = {
    document: "a",
    text: "Goals\n  Ship beta  \n",
    structure: [
      { id: "1", text: "Goals" },
      { id: "2", text: "Ship beta" },
    ],
    addedNotes: [{ document: "b", title: "B", structure: [{ id: "1", text: "Other" }] }],
    citationSources: [cite("a", "1", "Goals", 1), cite("a", "2", "Ship beta", 2), cite("b", "1", "Other", 3)],
  };
  dropCoveredCopies(data);
  expect(data.structure).toBeUndefined();
  expect(data.text).toBeUndefined();
  expect(data.addedNotes).toEqual([{ document: "b", title: "B" }]);
  expect(data.document).toBe("a");
});

test("uncovered text, blocks from other documents and source-less contexts are kept", () => {
  const data: Record<string, unknown> & { citationSources: CitationSource[] } = {
    document: "a",
    text: "Card\nFree canvas text",
    structure: [{ id: "1", text: "Card" }],
    addedNotes: [{ document: "b", structure: [{ id: "1", text: "Same ID, other note" }] }],
    citationSources: [cite("a", "1", "Card", 1)],
  };
  dropCoveredCopies(data);
  expect(data.structure).toBeUndefined();
  expect(data.text).toBe("Card\nFree canvas text");
  expect((data.addedNotes as { structure?: unknown }[])[0].structure).toHaveLength(1);

  const none: Record<string, unknown> & { citationSources: CitationSource[] } = {
    text: "",
    structure: [],
    citationSources: [],
  };
  dropCoveredCopies(none);
  expect(none).toEqual({ text: "", structure: [], citationSources: [] });
});
