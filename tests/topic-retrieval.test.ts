import { expect, test } from "vitest";
import * as Y from "yjs";
import {
  outgoingSourceHistory,
  resolveSourceMode,
} from "../src/services/ai-source-scope";
import {
  extractTopicPassages,
  extractDeckPassages,
  splitPassage,
} from "../src/services/topic-extract";
import { ocrPassages } from "../src/services/ocr-passages";
const base = {
  scope: "auto" as const,
  mode: "ask",
  prompt: "What do my notes say about recall?",
  automatic: true,
  selected: false,
  attached: false,
  active: true,
};
test("routing distinguishes ambient, deliberate and inherited source intent", () => {
  expect(resolveSourceMode(base)).toBe("workspace");
  for (const override of [
    { selected: true },
    { prompt: "Explain this note" },
    { scope: "current" as const },
  ])
    expect(resolveSourceMode({ ...base, ...override })).toBe("current");
  expect(resolveSourceMode({ ...base, attached: true })).toBe("explicit");
  expect(resolveSourceMode({ ...base, scope: "none", attached: true })).toBe(
    "none",
  );
  expect(resolveSourceMode({ ...base, automatic: false })).toBe("legacy");
  expect(resolveSourceMode({ ...base, mode: "canvas" })).toBe("legacy");
  expect(resolveSourceMode({ ...base, active: false })).toBe("workspace");
  expect(resolveSourceMode({ ...base, inherited: "none" })).toBe("none");
  expect(
    resolveSourceMode({ ...base, scope: "workspace", inherited: "none" }),
  ).toBe("workspace");
});
function snapshot(shared = false) {
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  envelope.getMap("meta").set("pages", [{ id: "closed" }]);
  const blocks = body.getMap("blocks");
  function block(
    id: string,
    flavour: string,
    children: string[],
    text?: string,
  ) {
    const b = new Y.Map();
    b.set("sys:flavour", flavour);
    const c = new Y.Array();
    c.push(children);
    b.set("sys:children", c);
    if (text) b.set("prop:text", new Y.Text(text));
    blocks.set(id, b);
  }
  block("root", "affine:page", ["note"]);
  block("note", "affine:note", ["first", "second"]);
  block("second", "affine:paragraph", [], "Do not exceed 5 mg.");
  block("first", "affine:paragraph", [], "Use 10 mg only for adults.");
  block("orphan", "affine:paragraph", [], "UNREACHABLE-SENTINEL");
  if (shared) body.getMap("knot:card-links").set("note", "canonical");
  const result = {
    collection: Array.from(Y.encodeStateAsUpdate(envelope)),
    document: Array.from(Y.encodeStateAsUpdate(body)),
  };
  envelope.destroy();
  body.destroy();
  return result;
}
test("passages follow reachable tree order and preserve distinct qualifications", () => {
  const p = extractTopicPassages(
    { id: "closed", title: "Closed", revision: "r1" },
    snapshot(),
  );
  expect(p.map((v) => v.id)).toEqual(["first", "second"]);
  expect(p.map((v) => v.text)).toEqual([
    "Use 10 mg only for adults.",
    "Do not exceed 5 mg.",
  ]);
  expect(JSON.stringify(p)).not.toContain("UNREACHABLE");
});
test("shared content is owned once by the deck and tombstones are excluded", () => {
  expect(
    extractTopicPassages(
      { id: "closed", title: "Closed", revision: "r1" },
      snapshot(true),
    ),
  ).toEqual([]);
  expect(
    extractDeckPassages(
      { id: "deck:x", title: "Card", revision: "r1" },
      { id: "x", nodes: [], deleted: true },
    ).passages,
  ).toEqual([]);
});
test("chunk boundaries keep verbatim Unicode without dropping content", () => {
  const text = "A qualification. " + "😀 Some text. ".repeat(300);
  const parts = splitPassage(text);
  expect(parts.join("")).toBe(text);
  expect(
    parts.every((p) => p.length <= 900 && !/^[\uDC00-\uDFFF]/.test(p)),
  ).toBe(true);
});

test("scope narrowing discards unannotated legacy source-bearing answers", () => {
  const old = [
    { role: "assistant", content: "PRIVATE OLD EXCERPT", request: {} },
  ];
  for (const mode of ["none", "current", "explicit", "workspace"] as const)
    expect(outgoingSourceHistory(old, mode)).toEqual([]);
  expect(outgoingSourceHistory(old, "legacy")).toEqual([
    { role: "assistant", content: "PRIVATE OLD EXCERPT" },
  ]);
});

test("evidence selection reserves room for complementary sources and preserves numerical conditions", async () => {
  const { budgetEvidence } = await import("../src/services/workspace-evidence");
  const make = (document: string, n: number, text: string) => ({
    document,
    id: String(n),
    title: "Fixture",
    text,
    revision: "r1",
    vector: [],
  });
  const a = Array.from({ length: 8 }, (_, n) =>
    make("long-source", n, `Repetition ${n}. ` + "a".repeat(700)),
  );
  const other = make(
    "exception",
    0,
    "Do not use 19 watts unless peak load applies. " + "b".repeat(650),
  );
  const result = budgetEvidence(
    [...a, other],
    "workspace",
    { indexed: 2, total: 2, failed: 0 },
    true,
  );
  expect(result.citationSources.some((p) => p.document === "exception")).toBe(
    true,
  );
  expect(result.citationSources.map((p) => p.citation)).toEqual(
    result.citationSources.map((_, i) => `[S${i + 1}]`),
  );
  expect(JSON.stringify(result)).not.toContain('"vector"');
});
test("dirty overlays honor exact identifiers and do not match boilerplate question words", async () => {
  const { localRelevance } = await import("../src/services/workspace-evidence");
  const p = {
    document: "dirty",
    id: "b",
    title: "Variant",
    text: "My notes say product KNOT-QX-743 consumes 19 watts.",
    revision: "r1",
    vector: [],
  };
  expect(localRelevance("What do my notes say about KNOT-QX-742?", p, [])).toBe(
    false,
  );
  expect(localRelevance("What do my notes say about KNOT-QX-743?", p, [])).toBe(
    true,
  );
  expect(
    localRelevance("What do my notes say about quasar spectroscopy?", p, []),
  ).toBe(false);
});

test("explicit and loading attachment intent takes precedence over automatic workspace choice", () => {
  expect(
    resolveSourceMode({ ...base, scope: "workspace", attached: true }),
  ).toBe("explicit");
  expect(
    resolveSourceMode({ ...base, scope: "workspace", selected: true }),
  ).toBe("current");
});

test("YouTube cards are reported so their saved transcripts are indexed", async () => {
  const { extractTopicContent } = await import("../src/services/topic-extract");
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  envelope.getMap("meta").set("pages", [{ id: "doc" }]);
  const blocks = body.getMap("blocks");
  const add = (id: string, flavour: string, children: string[], props: Record<string, string> = {}) => {
    const b = new Y.Map();
    b.set("sys:flavour", flavour);
    const c = new Y.Array();
    c.push(children);
    b.set("sys:children", c);
    for (const [k, v] of Object.entries(props)) b.set(`prop:${k}`, v);
    blocks.set(id, b);
  };
  add("root", "affine:page", ["note", "surface"]);
  add("note", "affine:note", ["yt", "yt2"]);
  add("yt", "affine:embed-youtube", [], { videoId: "aircAruvnKk", url: "https://www.youtube.com/watch?v=aircAruvnKk", title: "NN" });
  add("yt2", "affine:embed-youtube", [], { url: "https://youtu.be/jNQXAC9IVRw" });
  add("surface", "affine:surface", ["yt3"]);
  add("yt3", "affine:embed-youtube", [], { videoId: "bad" });
  const snap = {
    collection: Array.from(Y.encodeStateAsUpdate(envelope)),
    document: Array.from(Y.encodeStateAsUpdate(body)),
  };
  const { videos } = extractTopicContent({ id: "doc", title: "Doc", revision: "r" }, snap);
  expect(videos).toEqual([
    { videoId: "aircAruvnKk", blockId: "yt", title: "NN" },
    { videoId: "jNQXAC9IVRw", blockId: "yt2", title: "YouTube video" },
  ]);
});

test("YouTube cards inside Card Deck cards are reported too", async () => {
  const { extractDeckPassages } = await import("../src/services/topic-extract");
  const json = (value: string) => ({ type: "json" as const, value });
  const node = (props: Record<string, string>, children: never[] = []) => ({
    props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, json(v)])),
    children,
  });
  const { videos } = extractDeckPassages(
    { id: "deck:c1", title: "Card", revision: "r" },
    {
      id: "c1",
      nodes: [
        node({ "sys:flavour": "affine:embed-youtube", "prop:url": "https://www.youtube.com/watch?v=aircAruvnKk", "prop:title": "NN" }),
      ],
    } as never,
  );
  expect(videos).toEqual([{ videoId: "aircAruvnKk", blockId: "0", title: "NN" }]);
});

test("images are listed for OCR once each, with captions, up to the cap", () => {
  const json = (value: string) => ({ type: "json" as const, value });
  const node = (props: Record<string, string>) => ({
    props: Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, json(v)]),
    ),
    children: [],
  });
  const card = {
    id: "x",
    nodes: [
      node({ "sys:flavour": "affine:image", "prop:sourceId": "a", "prop:caption": "Whiteboard" }),
      node({ "sys:flavour": "affine:image", "prop:sourceId": "a" }),
      node({ "sys:flavour": "affine:attachment", "prop:sourceId": "b", "prop:type": "image/png", "prop:name": "scan.png" }),
      node({ "sys:flavour": "affine:attachment", "prop:sourceId": "c", "prop:type": "application/pdf" }),
      node({ "sys:flavour": "affine:image" }),
      ...Array.from({ length: 60 }, (_, i) =>
        node({ "sys:flavour": "affine:image", "prop:sourceId": `k${i}` }),
      ),
    ],
  };
  const { images } = extractDeckPassages(
    { id: "deck:x", title: "Card", revision: "r1" },
    card as never,
  );
  expect(images.slice(0, 2)).toEqual([
    { key: "a", blockId: "0", caption: "Whiteboard" },
    { key: "b", blockId: "2", caption: "scan.png" },
  ]);
  expect(images).toHaveLength(50);
  expect(images.some((image) => image.key === "c")).toBe(false);
});

test("OCR passages carry the boxes of the lines they came from", () => {
  const line = (text: string, y: number) => ({ text, x: 0.1, y, w: 0.95, h: 0.05 });
  const lines = [
    line("Quarterly whiteboard notes", 0.1),
    line("Photosynthesis needs chlorophyll", 0.3),
    ...Array.from({ length: 40 }, (_, i) =>
      line(`Line ${i} of a long scanned page about cells`, 0.4 + i * 0.01),
    ),
  ];
  const parts = ocrPassages(lines);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.map((p) => p.text).join("")).toBe(
    lines.map((l) => l.text).join("\n"),
  );
  // Clamped to the image: x + w never exceeds 1.
  expect(parts[0].rects[0]).toEqual([0.1, 0.1, 0.9, 0.05]);
  expect(parts[0].rects).toHaveLength(
    parts[0].text.split("\n").filter((t) => t.trim()).length,
  );
  expect(ocrPassages([])).toEqual([]);
});
