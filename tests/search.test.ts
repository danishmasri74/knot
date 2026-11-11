import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  savedSearchText,
  savedSearchContent,
  searchSavedDocuments,
  SEARCH_BYTES,
} from "../src/features/editor/blocksuite/search";
import type { KnowledgeObject } from "../src/services/workspace";
const row = (id: string, title = id): KnowledgeObject => ({
  id,
  title,
  kind: "note",
  updated_at: 0,
});
function fixture(id: string, text = "Café needle") {
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  envelope.getMap("meta").set("pages", [{ id }]);
  for (const flavour of [
    "page",
    "paragraph",
    "list",
    "code",
    "attachment",
    "surface",
    "embed-synced-doc",
  ]) {
    const block = new Y.Map();
    block.set("sys:flavour", `affine:${flavour}`);
    block.set(
      "prop:text",
      new Y.Text(
        ["paragraph", "list", "code"].includes(flavour) ? text : "excluded",
      ),
    );
    body.getMap("blocks").set(flavour, block);
  }
  const snapshot = {
    collection: [...Y.encodeStateAsUpdate(envelope)],
    document: [...Y.encodeStateAsUpdate(body)],
  };
  envelope.destroy();
  body.destroy();
  return snapshot;
}
const extract = async (
  id: string,
  snapshot: Parameters<typeof savedSearchText>[1],
) => savedSearchText(id, snapshot);
it("extracts only supported native text and retains snapshot bytes", () => {
  const snapshot = fixture("a"),
    before = JSON.stringify(snapshot);
  expect(savedSearchText("a", snapshot)).toBe(
    "Café needle\nCafé needle\nCafé needle",
  );
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(() => savedSearchText("wrong", snapshot)).toThrow("identity");
  expect(() => savedSearchText("a", fixture("a", "x".repeat(40000)))).toThrow(
    "100,000",
  );
  expect(() =>
    savedSearchText("a", {
      collection: [],
      document: new Array(SEARCH_BYTES + 1).fill(0),
    }),
  ).toThrow("1 MiB");
});
it("finds title/body literal substrings, deduplicates and orders stable results", async () => {
  const result = await searchSavedDocuments(
    " CAFÉ ",
    async () => [
      row("b"),
      row("a"),
      row("a"),
      row("title", "Café title"),
      row("empty"),
    ],
    async (id) => (id === "title" || id === "empty" ? null : fixture(id)),
    extract,
  );
  expect(result.results.map((r) => r.source.id)).toEqual(["a", "b", "title"]);
  expect(result.results[2].excerpt).toBe("Title match");
  expect(result.skipped).toEqual([]);
  expect(
    (
      await searchSavedDocuments(
        ".*",
        async () => [row("a")],
        async (id) => fixture(id),
        extract,
      )
    ).results,
  ).toEqual([]);
});
it("warns on corruption while retaining title matches; storage failures abort", async () => {
  const result = await searchSavedDocuments(
    "bad",
    async () => [row("bad")],
    async () => ({ collection: [], document: [255] }),
    extract,
  );
  expect(result.skipped).toEqual(["bad"]);
  expect(result.results[0].source.id).toBe("bad");
  await expect(
    searchSavedDocuments(
      "bad",
      async () => [row("bad")],
      async () => {
        throw new Error("read failed");
      },
      extract,
    ),
  ).rejects.toThrow("read failed");
  await expect(
    searchSavedDocuments(
      " ",
      async () => [],
      async () => null,
      extract,
    ),
  ).rejects.toThrow("1–200");
});
it("bounds catalog reads and aggregate decoding and reports omissions", async () => {
  const loaded: string[] = [],
    offsets: number[] = [];
  const result = await searchSavedDocuments(
    "note",
    async (offset) => {
      offsets.push(offset);
      return Array.from({ length: 100 }, (_, i) =>
        row(String(offset + i), "note"),
      );
    },
    async (id) => {
      loaded.push(id);
      return { collection: [], document: new Array(SEARCH_BYTES).fill(0) };
    },
    async () => "",
  );
  expect(offsets).toEqual([0, 100, 200]);
  expect(loaded).toHaveLength(16);
  expect(result.results).toHaveLength(200);
  expect(result.skipped).toHaveLength(184);
  expect(result.limited).toBe(true);
});
it("fresh scans reflect changed saved bodies and incomplete updates are refused", async () => {
  let text = "old";
  const scan = () =>
    searchSavedDocuments(
      "old",
      async () => [row("a")],
      async (id) => fixture(id, text),
      extract,
    );
  expect((await scan()).results).toHaveLength(1);
  text = "new";
  expect((await scan()).results).toHaveLength(0);
  const doc = new Y.Doc();
  doc.getText("t").insert(0, "first");
  const vector = Y.encodeStateVector(doc);
  doc.getText("t").insert(5, "second");
  const snapshot = fixture("a");
  snapshot.document = [...Y.encodeStateAsUpdate(doc, vector)];
  expect(() => savedSearchText("a", snapshot)).toThrow("Incomplete");
  doc.destroy();
});
it("structured context follows tree order and retains note ownership and task state", async () => {
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  envelope.getMap("meta").set("pages", [{ id: "doc" }]);
  const add = (
    id: string,
    flavour: string,
    children: string[],
    text?: string,
    type?: string,
    checked?: boolean,
  ) => {
    const b = new Y.Map();
    b.set("sys:flavour", `affine:${flavour}`);
    b.set("sys:children", Y.Array.from(children));
    if (text !== undefined) b.set("prop:text", new Y.Text(text));
    if (type) b.set("prop:type", type);
    if (checked !== undefined) b.set("prop:checked", checked);
    body.getMap("blocks").set(id, b);
  };
  add("done", "list", [], "Finished", "todo", true);
  add("open", "list", [], "Remaining", "todo", false);
  add("heading", "paragraph", [], "Tasks", "h2");
  add("note", "note", ["heading", "open", "done"]);
  add("nested", "list", [], "Remaining nested", "bulleted");
  add("second-heading", "paragraph", ["nested"], "Other tasks");
  add("second-note", "note", ["second-heading"]);
  add("attachment", "attachment", [], "Remaining excluded");
  add("root", "page", ["note", "second-note", "attachment"]);
  const snapshot = {
    collection: [...Y.encodeStateAsUpdate(envelope)],
    document: [...Y.encodeStateAsUpdate(body)],
  };
  const blocks = JSON.parse(savedSearchText("doc", snapshot, true));
  expect(blocks.map((b: { id: string }) => b.id)).toEqual([
    "heading",
    "open",
    "done",
    "second-heading",
    "nested",
    "attachment",
  ]);
  expect(blocks[0]).toMatchObject({ type: "h2", note: "note", parent: "note" });
  expect(blocks[1].checked).toBe(false);
  expect(blocks[2].checked).toBe(true);
  const before = JSON.stringify(snapshot);
  const content = savedSearchContent("doc", snapshot);
  expect(content.notes).toEqual([
    { id: "note", title: "Tasks", text: "Tasks\nRemaining\nFinished" },
    {
      id: "second-note",
      title: "Other tasks",
      text: "Other tasks\nRemaining nested",
    },
  ]);
  const report = await searchSavedDocuments(
    "remaining",
    async () => [row("doc")],
    async () => snapshot,
    async (id, saved) => savedSearchContent(id, saved),
  );
  expect(
    report.results.map(({ noteId, noteTitle }) => ({ noteId, noteTitle })),
  ).toEqual([
    { noteId: "note", noteTitle: "Tasks" },
    { noteId: "second-note", noteTitle: "Other tasks" },
  ]);
  const title = await searchSavedDocuments(
    "doc",
    async () => [row("doc")],
    async () => snapshot,
    async (id, saved) => savedSearchContent(id, saved),
  );
  expect(title.results).toEqual([
    { source: row("doc"), excerpt: "Title match" },
  ]);
  expect(JSON.stringify(snapshot)).toBe(before);
  envelope.destroy();
  body.destroy();
});
