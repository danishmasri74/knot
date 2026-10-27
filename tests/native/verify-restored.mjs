import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright";
const { root, port } = JSON.parse(
  readFileSync("test-results/current-native.json"),
);
const selected = readFileSync(path.join(root, "active-workspace.txt"), "utf8");
assert.notEqual(selected, "Workspace");
const old = new DatabaseSync(path.join(root, "Workspace/knot.db"), {
    readOnly: true,
  }),
  restored = new DatabaseSync(path.join(root, selected, "knot.db"), {
    readOnly: true,
  });
for (const table of [
  "objects",
  "documents",
  "attachments",
  "object_attachments",
])
  assert.deepEqual(
    restored.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    old.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  );
old.close();
restored.close();
const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const p = b.contexts()[0].pages()[0];
await p.waitForFunction(() =>
  [...document.querySelectorAll("affine-image img")].some(
    (i) => i.complete && i.naturalWidth > 0,
  ),
);
assert.ok(await p.locator("affine-attachment iframe").count());
await p.screenshot({ path: path.join(root, "restored.png") });
console.log(
  "PASS UI backup/restore: IDs, snapshot bytes, metadata, references identical; image and PDF reloaded",
);
await b.close();
