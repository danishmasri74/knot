import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  auditDocuments,
  type AuditDocument,
} from "../src/features/editor/blocksuite/integrity";

function fixture(id: string, targets: string[] = []): AuditDocument {
  const collection = new Y.Doc();
  const pages = new Y.Array();
  collection.getMap("meta").set("pages", pages);
  pages.push([{ id }]);
  const body = new Y.Doc();
  const root = new Y.Map();
  root.set("sys:flavour", "affine:page");
  body.getMap("blocks").set("root", root);
  for (const target of targets) {
    const card = new Y.Map();
    card.set("prop:pageId", target);
    body.getMap("blocks").set(target, card);
  }
  const row = {
    id,
    title: id,
    deleted: false,
    snapshot: {
      collection: [...Y.encodeStateAsUpdate(collection)],
      document: [...Y.encodeStateAsUpdate(body)],
    },
  };
  collection.destroy();
  body.destroy();
  return row;
}

it("accepts cycles and self references without modifying snapshots", () => {
  const rows = [fixture("a", ["a", "b"]), fixture("b", ["a"])];
  const before = JSON.stringify(rows);
  expect(auditDocuments(rows)).toEqual({
    checked: 2,
    issues: [],
    recoverableTargets: [],
  });
  expect(JSON.stringify(rows)).toBe(before);
});

it("offers one recovery action per healthy trashed target and counts distinct sources", () => {
  const target = fixture("target");
  target.deleted = true;
  const damaged = fixture("damaged");
  damaged.deleted = true;
  damaged.snapshot!.document = [255];
  const unopened: AuditDocument = {
    id: "unopened",
    title: "unopened",
    deleted: true,
    snapshot: null,
  };
  const sources = [
    fixture("a", ["target", "damaged", "unopened", "absent"]),
    fixture("b", ["target"]),
  ];
  sources[1].deleted = true;
  const rows = [...sources, target, damaged, unopened];
  const before = JSON.stringify(rows);
  expect(auditDocuments(rows).recoverableTargets).toEqual([
    { id: "target", title: "target", sources: 2 },
  ]);
  expect(JSON.stringify(rows)).toBe(before);
  target.deleted = false;
  expect(auditDocuments(rows).recoverableTargets).toEqual([]);
});

it("distinguishes absent, trashed and unreadable targets and includes trashed sources", () => {
  const source = fixture("source", ["missing", "trash", "broken"]);
  source.deleted = true;
  const trash = fixture("trash");
  trash.deleted = true;
  const broken = fixture("broken");
  broken.snapshot!.document = [255];
  const rows = [source, trash, broken];
  const before = JSON.stringify(rows);
  const report = auditDocuments(rows);
  expect(report.issues.map((issue) => issue.message).join("\n")).toMatch(
    /cannot be decoded/,
  );
  expect(report.issues.filter((issue) => issue.id === "source")).toHaveLength(
    3,
  );
  expect(
    report.issues.some((issue) => issue.message.includes("in Trash")),
  ).toBe(true);
  expect(
    report.issues.some((issue) => issue.message.includes("missing from")),
  ).toBe(true);
  expect(JSON.stringify(rows)).toBe(before);
});

it("reports missing snapshots, mismatched envelopes and empty bodies independently", () => {
  const row = fixture("a");
  row.id = "wrong";
  row.snapshot!.document = [0, 0];
  const report = auditDocuments([
    row,
    { id: "new", title: "new", deleted: false, snapshot: null },
  ]);
  expect(report.issues).toHaveLength(3);
});

it("finds inline targets and incomplete Yjs updates", () => {
  const row = fixture("inline");
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.snapshot!.document));
  const text = new Y.Text();
  doc.getMap("blocks").set("text", text);
  text.insert(0, " ", { reference: { pageId: "absent", type: "LinkedPage" } });
  row.snapshot!.document = [...Y.encodeStateAsUpdate(doc)];
  expect(auditDocuments([row]).issues[0].message).toContain(
    "Reference target absent",
  );
  const vector = Y.encodeStateVector(doc);
  text.insert(1, "later");
  row.snapshot!.document = [...Y.encodeStateAsUpdate(doc, vector)];
  expect(
    auditDocuments([row]).issues.some((issue) =>
      issue.message.includes("dependencies are missing"),
    ),
  ).toBe(true);
  doc.destroy();
});
