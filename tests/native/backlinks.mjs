import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/backlinks-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9258",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9258");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Native application did not start");
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
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
async function click(name) {
  await page.getByRole("button", { name, exact: true }).click();
  await ready();
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
async function save() {
  await page.getByTitle("Save now / retry").click();
  await ready();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
}
async function rename(title) {
  await page.getByLabel("Document title", { exact: true }).fill(title);
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
}
async function select(title) {
  await page.locator(".document-row").filter({ hasText: title }).click();
  await ready();
}
async function place(title, shared = true) {
  await click("＋ Reference");
  await page.getByLabel("Reference document").selectOption({ label: title });
  await click(shared ? "Place shared note" : "Insert link");
}
async function body(id) {
  return page.evaluate((id) => {
    const editor = document.querySelector("affine-editor-container");
    const doc = id ? editor.doc.collection.getDoc(id) : editor.doc;
    return {
      id: doc.id,
      json: JSON.stringify(doc.spaceDoc.getMap("blocks").toJSON()),
    };
  }, id);
}
try {
  await launch();
  await rename("Target note");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/knot.png"));
  await ready();
  await save();
  const target = await body();
  await click("◇ New whiteboard");
  await rename("Board source");
  await place("Target note");
  await place("Target note", false);
  await save();
  const source = await body();
  await select("Target note");
  await save();
  const db = new DatabaseSync(path.join(root, "Workspace", "knot.db"));
  const records = () => ({
    documents: db.prepare("SELECT * FROM documents ORDER BY object_id").all(),
    objects: db.prepare("SELECT * FROM objects ORDER BY id").all(),
    attachments: db.prepare("SELECT * FROM attachments ORDER BY id").all(),
    associations: db
      .prepare(
        "SELECT * FROM object_attachments ORDER BY object_id,attachment_id",
      )
      .all(),
  });
  const before = records();
  const asset = before.attachments[0];
  const assetPath = path.join(
    root,
    "Workspace/assets",
    asset.sha256.slice(0, 2),
    asset.sha256,
  );
  const bytes = await readFile(assetPath);
  await click("Backlinks");
  let panel = page.getByRole("region", { name: "Backlinks", exact: true });
  assert.equal(
    await panel
      .getByRole("button", { name: "Board source", exact: true })
      .count(),
    1,
  );
  await click("Refresh backlinks");
  assert.deepEqual(records(), before);
  assert.deepEqual(await readFile(assetPath), bytes);
  await page.screenshot({ path: path.join(root, "backlinks.png") });
  await panel
    .getByRole("button", { name: "Board source", exact: true })
    .click();
  await ready();
  assert.equal((await body()).id, source.id);
  assert.equal(await panel.count(), 0);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await ready();
  assert.equal((await body()).id, target.id);
  await click("Backlinks");
  // Saved content changes must flush before a new scan; a real rejected write blocks it.
  db.exec(
    "CREATE TRIGGER reject_backlinks BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL, 'backlink save blocked'); END",
  );
  await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    const paragraph = doc.getBlocksByFlavour("affine:paragraph")[0].model;
    paragraph.text.insert("Pending backlink check", 0);
  });
  await click("Refresh backlinks");
  await page
    .getByRole("alert")
    .filter({ hasText: "backlink save blocked" })
    .waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: "Board source", exact: true })
      .count(),
    0,
  );
  await panel.getByText("Scan unavailable. Refresh to retry.").waitFor();
  db.exec("DROP TRIGGER reject_backlinks");
  await click("Refresh backlinks");
  await panel
    .getByRole("button", { name: "Board source", exact: true })
    .waitFor();
  // Corrupt source is explicitly reported; bytes remain untouched by scanning.
  const saved = db
    .prepare("SELECT document_state FROM documents WHERE object_id=?")
    .get(source.id).document_state;
  db.prepare("UPDATE documents SET document_state=x'FF' WHERE object_id=?").run(
    source.id,
  );
  await click("Refresh backlinks");
  await panel.getByText(/Partial results/).waitFor();
  assert.deepEqual(
    [
      ...db
        .prepare("SELECT document_state FROM documents WHERE object_id=?")
        .get(source.id).document_state,
    ],
    [255],
  );
  db.prepare("UPDATE documents SET document_state=? WHERE object_id=?").run(
    saved,
    source.id,
  );
  await click("Refresh backlinks");
  await panel
    .getByRole("button", { name: "Board source", exact: true })
    .click();
  await ready();
  await rename("Renamed source");
  await select("Target note");
  await click("Backlinks");
  await panel
    .getByRole("button", { name: "Renamed source", exact: true })
    .waitFor();
  await select("Renamed source");
  await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    for (const flavour of [
      "affine:embed-synced-doc",
      "affine:embed-linked-doc",
    ])
      for (const block of [...doc.getBlocksByFlavour(flavour)])
        doc.deleteBlock(block.model);
  });
  await save();
  await select("Target note");
  await click("Backlinks");
  await panel.getByText("No backlinks found.", { exact: true }).waitFor();
  await select("Renamed source");
  await page.evaluate((id) => {
    const doc = document.querySelector("affine-editor-container").doc;
    const paragraph = doc.getBlocksByFlavour("affine:paragraph")[0].model;
    paragraph.text.insert("Inline target", 0, {
      reference: { type: "LinkedPage", pageId: id },
    });
  }, target.id);
  await save();
  await select("Target note");
  await click("Backlinks");
  await panel
    .getByRole("button", { name: "Renamed source", exact: true })
    .waitFor();
  await select("Renamed source");
  await page.getByTitle("Delete document").click();
  await ready();
  await select("Target note");
  await click("Backlinks");
  await panel.getByText("No backlinks found.", { exact: true }).waitFor();
  assert.deepEqual(records().attachments, before.attachments);
  assert.deepEqual(records().associations, before.associations);
  assert.deepEqual(await readFile(assetPath), bytes);
  db.close();
  await stop();
  await launch();
  panel = page.getByRole("region", { name: "Backlinks", exact: true });
  await select("Target note");
  await click("Backlinks");
  await panel.getByText("No backlinks found.", { exact: true }).waitFor();
  assert.equal((await body()).id, target.id);
  await click("Trash & recovery");
  await page
    .getByRole("button", { name: "Restore Renamed source", exact: true })
    .click();
  await ready();
  await click("Backlinks");
  await panel
    .getByRole("button", { name: "Renamed source", exact: true })
    .waitFor();
  await stop();
  await launch();
  await select("Target note");
  await click("Backlinks");
  panel = page.getByRole("region", { name: "Backlinks", exact: true });
  await panel
    .getByRole("button", { name: "Renamed source", exact: true })
    .waitFor();
  console.log("PASS native backlinks", root);
} finally {
  await stop();
}
