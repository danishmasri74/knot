import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.env.KNOT_TEST_WORKSPACE;
if (!root)
  throw new Error(
    "Set KNOT_TEST_WORKSPACE to the closed verification workspace",
  );
const db = new DatabaseSync(path.join(root, "knot.db"), { readOnly: true });
const docs = db
  .prepare(
    "SELECT o.id,o.title,d.collection_state,d.document_state FROM objects o JOIN documents d ON o.id=d.object_id WHERE o.deleted_at IS NULL",
  )
  .all();
assert.ok(docs.length >= 2, "Expected the UI note and independent whiteboard");
let foundText = false,
  foundImage = false,
  foundPdf = false,
  foundSurface = false;
for (const row of docs) {
  const rootDoc = new Y.Doc();
  Y.applyUpdate(rootDoc, row.collection_state);
  assert.ok(
    rootDoc.getMap("spaces").has(row.id),
    "Collection must reference the matching subdocument",
  );
  const content = new Y.Doc();
  Y.applyUpdate(content, row.document_state);
  const blocks = content.getMap("blocks").toJSON();
  const serialized = JSON.stringify(blocks);
  foundText ||= serialized.includes("Knot recovery check");
  foundImage ||= serialized.includes("affine:image");
  foundPdf ||= serialized.includes("application/pdf");
  foundSurface ||= serialized.includes("brush") && serialized.includes("shape");
  assert.ok(Object.keys(blocks).length >= 3);
  rootDoc.destroy();
  content.destroy();
}
assert.ok(
  foundText && foundImage && foundPdf && foundSurface,
  "Expected formatted note, image, PDF, brush and shape",
);
const hashes = db.prepare("SELECT DISTINCT sha256 FROM attachments").all();
assert.ok(hashes.length >= 2);
db.close();
console.log(
  `Verified ${docs.length} native Yjs documents, collection references, text, image/PDF blocks, brush/shape elements and ${hashes.length} stored asset hashes.`,
);
