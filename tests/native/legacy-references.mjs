import { placeLegacyReference } from "./legacy-reference-fixture.mjs";
import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import assert from "node:assert/strict";
const root = path.resolve("test-results/legacy-references-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9245",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9245");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Native application did not start");
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
}
async function ready() {
  await page.waitForFunction(
    () => document.querySelector(".primary")?.disabled === false,
  );
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child?.pid)
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  child = null;
}
// Pass a closed pre-Milestone-2 workspace. The fixture is copied, never edited.
assert.ok(
  process.argv[2],
  "Usage: node tests/native/legacy-references.mjs <closed-workspace>",
);
await cp(path.resolve(process.argv[2]), path.join(root, "Workspace"), {
  recursive: true,
});
const db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
const notes = db
  .prepare(
    "SELECT o.id,o.title,d.document_state FROM objects o JOIN documents d ON d.object_id=o.id WHERE o.kind='note' AND o.deleted_at IS NULL",
  )
  .all();
assert.ok(notes.length, "Fixture requires a saved live note");
const source = notes[0];
const legacy = new Y.Doc();
Y.applyUpdate(legacy, source.document_state);
const expected = JSON.stringify(legacy.getMap("blocks").toJSON());
legacy.destroy();
db.close();
try {
  await launch();
  await page.locator(".document-row").filter({ hasText: source.title }).click();
  await ready();
  const actual = await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    return {
      id: doc.id,
      json: JSON.stringify(doc.spaceDoc.getMap("blocks").toJSON()),
    };
  });
  assert.equal(actual.id, source.id);
  assert.equal(actual.json, expected);
  await createNotebook(page, true);
  await placeLegacyReference(page, source.id);
  await page.waitForSelector("affine-embed-edgeless-synced-doc-block");
  assert.equal(
    await page.evaluate(
      (id) =>
        JSON.stringify(
          document
            .querySelector("affine-editor-container")
            .doc.collection.getDoc(id)
            .spaceDoc.getMap("blocks")
            .toJSON(),
        ),
      source.id,
    ),
    expected,
  );
  await page.screenshot({ path: path.join(root, "legacy-shared.png") });
  console.log(
    "PASS legacy UUID and full body preserved, shared placement resolves original snapshot",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
