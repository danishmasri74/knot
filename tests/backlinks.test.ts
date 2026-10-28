import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  findBacklinks,
  savedReferences,
} from "../src/features/editor/blocksuite/backlinks";
import type { KnowledgeObject } from "../src/services/workspace";
function fixture(id: string) {
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  envelope.getMap("meta").set("pages", [{ id }]);
  const root = new Y.Map();
  root.set("sys:flavour", "affine:page");
  body.getMap("blocks").set("root", root);
  for (const flavour of [
    "affine:embed-linked-doc",
    "affine:embed-synced-doc",
  ]) {
    const card = new Y.Map();
    card.set("sys:flavour", flavour);
    card.set("prop:pageId", "target");
    body.getMap("blocks").set(flavour, card);
  }
  const text = new Y.Text();
  root.set("prop:text", text);
  text.insert(0, "link", { reference: { pageId: "inline" } });
  const snapshot = {
    collection: [...Y.encodeStateAsUpdate(envelope)],
    document: [...Y.encodeStateAsUpdate(body)],
  };
  envelope.destroy();
  body.destroy();
  return snapshot;
}
const row = (id: string, title = id): KnowledgeObject => ({
  id,
  title,
  kind: "note",
  updated_at: 0,
});
it("extracts shared/link cards and inline references without changing bytes", () => {
  const snapshot = fixture("source"),
    before = JSON.stringify(snapshot);
  expect([...savedReferences("source", snapshot)].sort()).toEqual([
    "inline",
    "target",
  ]);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(() => savedReferences("wrong", snapshot)).toThrow();
});
it("deduplicates sources, excludes self, orders titles and handles unopened documents", async () => {
  const catalog = [
    row("b", "same"),
    row("a", "same"),
    row("b", "same"),
    row("target"),
    row("unopened"),
  ];
  const result = await findBacklinks("target", catalog, async (id) =>
    id === "unopened" ? null : fixture(id),
  );
  expect(result.sources.map((r) => r.id)).toEqual(["a", "b"]);
  expect(result.unreadable).toEqual([]);
  expect(
    (await findBacklinks("absent", catalog, async (id) => fixture(id))).sources,
  ).toEqual([]);
});
it("reports corrupt snapshots as partial results but propagates storage failures", async () => {
  const result = await findBacklinks(
    "target",
    [row("bad"), row("good")],
    async (id) =>
      id === "bad" ? { collection: [], document: [255] } : fixture(id),
  );
  expect(result.sources.map((r) => r.id)).toEqual(["good"]);
  expect(result.unreadable.map((r) => r.id)).toEqual(["bad"]);
  await expect(
    findBacklinks("target", [row("bad")], async () => {
      throw new Error("read failed");
    }),
  ).rejects.toThrow("read failed");
});
it("rejects incomplete updates and missing page roots", () => {
  const snapshot = fixture("source");
  expect(() =>
    savedReferences("source", { ...snapshot, document: [0, 0] }),
  ).toThrow();
  const body = new Y.Doc();
  body.getMap("blocks").set("a", 1);
  const vector = Y.encodeStateVector(body);
  body.getMap("blocks").set("b", 2);
  expect(() =>
    savedReferences("source", {
      ...snapshot,
      document: [...Y.encodeStateAsUpdate(body, vector)],
    }),
  ).toThrow("Incomplete");
  body.destroy();
});
