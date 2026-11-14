import { expect, test } from "vitest";
import {
  legacyAttachments,
  sentAttachments,
} from "../src/services/sent-attachments";

const video = {
  videoId: "abc",
  documentId: "doc",
  blockId: "yt",
  start: 72000,
  title: "Switching to Obsidian",
};

test("lists the sent context, excerpts, notes, image, videos and pages in order", () => {
  const chips = sentAttachments({
    context: {
      label: "Selection",
      title: "Weekly review",
      document: "doc",
      first: { id: "b1", text: "  ideas got lost between apps " },
    },
    passages: [
      {
        document: "p",
        title: "Guide",
        block: {
          id: "b2",
          text: "One home for every idea, always and forever.",
        },
      },
    ],
    notes: [{ document: "n", title: "Spaced repetition" }],
    image: { key: "img", name: "screenshot.png" },
    videos: [video, { ...video, start: 5000 }],
    web: [
      { url: "https://www.obsidian.md/pricing", title: "" },
      { url: "https://www.obsidian.md/pricing" },
      { url: "https://example.com/a", title: "Example article" },
    ],
  });
  expect(chips.map((c) => [c.kind, c.label, c.detail])).toEqual([
    ["selection", "Weekly review", "Selection"],
    ["excerpt", "“One home for every idea, always and for…”", undefined],
    ["note", "Spaced repetition", undefined],
    ["image", "screenshot.png", undefined],
    ["video", "Switching to Obsidian", undefined],
    ["web", "obsidian.md", undefined],
    ["web", "Example article", "example.com"],
  ]);
  expect(chips[0]).toMatchObject({
    document: "doc",
    block: "b1",
    text: "ideas got lost between apps",
  });
  expect(chips[1].from).toBe("Guide");
  expect(chips[4].video?.start).toBe(0);
});

test("a PDF context opens the PDF at its page instead of a block", () => {
  const [chip] = sentAttachments({
    context: {
      label: "Zettelkasten guide.pdf",
      document: "owner",
      pdf: { key: "pdf1", page: 4 },
      first: { id: "x", text: "ignored" },
    },
  });
  expect(chip).toEqual({
    kind: "pdf",
    label: "Zettelkasten guide.pdf",
    detail: "p. 4",
    document: "owner",
    pdf: { key: "pdf1", page: 4 },
  });
});

test("older saved messages recover their note, added notes and videos", () => {
  const chips = legacyAttachments({
    context: JSON.stringify({
      scope: "Page",
      title: "Apple Notes review",
      document: "doc",
      addedNotes: [{ document: "n2", title: "Spaced repetition" }],
      citationSources: [
        { document: "doc", id: "b1", text: "First paragraph" },
        { document: "n2", id: "c1", text: "Review before forgetting" },
        {
          kind: "video",
          document: "doc",
          id: "yt",
          text: "[1:12] hello",
          title: "Switching to Obsidian",
          video,
        },
      ],
    }),
    image: { key: "img", name: "photo.png" },
  });
  expect(chips.map((c) => [c.kind, c.label, c.block])).toEqual([
    ["note", "Apple Notes review", "b1"],
    ["note", "Spaced repetition", "c1"],
    ["image", "photo.png", undefined],
    ["video", "Switching to Obsidian", undefined],
  ]);
});

test("workspace, attachment-only and unreadable requests show no note chip", () => {
  expect(legacyAttachments({ context: "{}", sourceMode: "workspace" })).toEqual(
    [],
  );
  expect(legacyAttachments({ context: "not json" })).toEqual([]);
  expect(
    legacyAttachments({
      context: JSON.stringify({
        scope: "Explicit attachments only",
        structure: [],
        addedNotes: [],
      }),
    }),
  ).toEqual([]);
});

test("a selected YouTube card shows once, as its video", () => {
  const chips = sentAttachments({
    context: {
      label: "Switching to Obsidian",
      document: "doc",
      selectionKind: "website",
      blocks: ["yt"],
    },
    videos: [video],
  });
  expect(chips.map((c) => c.kind)).toEqual(["video"]);
});
