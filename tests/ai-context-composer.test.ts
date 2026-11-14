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

test("saved YouTube transcripts become video citations, most relevant first", async () => {
  const { composeAiContext } = await import("../src/services/ai-context-composer");
  const { readCitationSources } = await import("../src/services/ai-citations");
  const base = JSON.stringify({
    sourceMode: "current",
    document: "doc",
    text: "My notes",
    structure: [{ id: "b1", text: "My notes" }],
    citationSources: [{ document: "doc", id: "b1", text: "My notes", citation: "[S1]" }],
  });
  const seg = (start: number, text: string) => ({ start, duration: 2000, text });
  const result = JSON.parse(
    composeAiContext(base, [], "explain backpropagation", [
      {
        location: { videoId: "aircAruvnKk", documentId: "doc", blockId: "yt", title: "Card title" },
        transcript: {
          title: "Neural networks",
          track: { id: ".en", language: "en", name: "English", kind: "manual" },
          chapters: [],
          segments: [seg(0, "Intro to neurons."), seg(60_000, "Now backpropagation adjusts the weights.")],
        },
      },
    ]),
  );
  const videos = result.citationSources.filter((s: { kind?: string }) => s.kind === "video");
  expect(videos.map((s: { text: string }) => s.text)).toEqual([
    "[1:00] Now backpropagation adjusts the weights.",
    "[0:00] Intro to neurons.",
  ]);
  expect(videos[0]).toMatchObject({
    citation: "[S2]",
    document: "doc",
    title: "Neural networks · YouTube transcript",
    video: { videoId: "aircAruvnKk", blockId: "yt", start: 60_000, title: "Card title" },
  });
  // Saved chats read them back; the note entry still drops its copies.
  expect(readCitationSources(JSON.stringify(result)).filter((s) => s.kind === "video")).toHaveLength(2);
  expect(result.structure).toBeUndefined();
});

test("text OCR read from pictures in the notes becomes image citations", async () => {
  const { composeAiContext } = await import("../src/services/ai-context-composer");
  const { readCitationSources } = await import("../src/services/ai-citations");
  const base = JSON.stringify({
    sourceMode: "current",
    document: "doc",
    text: "My notes",
    structure: [{ id: "b1", text: "My notes" }],
    citationSources: [{ document: "doc", id: "b1", text: "My notes", citation: "[S1]" }],
  });
  const line = (text: string, y: number) => ({ text, x: 0.1, y, w: 0.5, h: 0.05 });
  const result = JSON.parse(
    composeAiContext(base, [], "when is the deadline?", [], [
      {
        location: { key: "k", documentId: "doc", blockId: "img", caption: "Whiteboard" },
        lines: [line("Quarterly notes", 0.1), line("Deadline: 12 March", 0.3)],
      },
    ]),
  );
  const images = result.citationSources.filter((s: { kind?: string }) => s.kind === "image");
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({
    citation: "[S2]",
    document: "doc",
    id: "img",
    title: "Whiteboard · text in image",
    text: "Quarterly notes\nDeadline: 12 March",
    image: { key: "k", blockId: "img", rects: [[0.1, 0.1, 0.5, 0.05], [0.1, 0.3, 0.5, 0.05]] },
  });
  // Saved chats read them back as citable sources.
  expect(readCitationSources(JSON.stringify(result)).filter((s) => s.kind === "image")).toHaveLength(1);
});
