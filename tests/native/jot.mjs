import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/jot-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9266",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9266");
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

const panel = () => page.getByRole("dialog", { name: "Jot capture" });
async function capture(text, destination) {
  await click("Jot");
  if (destination)
    await panel().getByLabel("Jot destination").selectOption(destination);
  await panel().getByLabel("Jot text").fill(text);
  await panel()
    .getByRole("button", { name: "Save capture", exact: true })
    .click();
  await ready();
}
async function countText(text) {
  return page.evaluate((text) => {
    const doc = document.querySelector("affine-editor-container").doc;
    return doc
      .getBlocksByFlavour("affine:paragraph")
      .filter((p) => p.model.text.toString() === text).length;
  }, text);
}
try {
  await launch();
  await rename("Original source");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/knot.png"));
  await ready();
  await save();
  const source = await body();
  await page.getByRole("button", { name: /New whiteboard/ }).click();
  await ready();
  await rename("Capture destination");
  await place("Original source");
  await save();
  const target = await body();
  // Open the source, then explicitly capture into a different stable destination.
  await page
    .locator(".document-row")
    .filter({ hasText: "Original source" })
    .click();
  await ready();
  const db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  const assets = () =>
    ["attachments", "object_attachments"].map((table) =>
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  const beforeAssets = assets();
  const asset = beforeAssets[0][0];
  const assetPath = path.join(
    root,
    "Workspace/assets",
    asset.sha256.slice(0, 2),
    asset.sha256,
  );
  const bytes = await readFile(assetPath);
  const sourceRow = db
    .prepare("SELECT * FROM documents WHERE object_id=?")
    .get(source.id);
  await click("Jot");
  assert.equal(
    await panel().getByLabel("Jot destination").inputValue(),
    source.id,
  );
  await panel().getByLabel("Jot text").fill("   ");
  assert.equal(
    await panel()
      .getByRole("button", { name: "Save capture", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await panel().getByLabel("Jot text").getAttribute("maxlength"),
    "10000",
  );
  await click("Discard draft & close");
  const quote = "Jot café — 你好\nSecond line with <plain> text";
  await page.context().setOffline(true);
  await capture(quote, target.id);
  assert.equal(await panel().count(), 0);
  assert.equal((await body()).id, target.id);
  assert.equal(await countText(quote), 1);
  await page.context().setOffline(false);
  await save();
  const captured = await body();
  // Undo/redo affects the inserted native note only (canvas layout can change).
  await page.getByTitle("Undo (Ctrl+Z)").click();
  await save();
  assert.equal(await countText(quote), 0);
  await page.getByTitle("Redo (Ctrl+Y)").click();
  await save();
  assert.equal(await countText(quote), 1);
  const targetBlocks = JSON.parse(target.json),
    afterBlocks = JSON.parse(captured.json);
  for (const [id, block] of Object.entries(targetBlocks)) {
    if (
      block["sys:flavour"] !== "affine:page" &&
      block["sys:flavour"] !== "affine:note"
    )
      assert.deepEqual(afterBlocks[id], block);
  }
  await click("Jot");
  await panel().getByLabel("Jot text").fill("Retry retained capture");
  db.exec(
    "CREATE TRIGGER reject_jot BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL, 'jot save blocked'); END",
  );
  await panel()
    .getByRole("button", { name: "Save capture", exact: true })
    .click();
  await ready();
  await panel()
    .getByRole("alert")
    .filter({ hasText: "jot save blocked" })
    .waitFor();
  assert.equal(await countText("Retry retained capture"), 1);
  assert.equal(await panel().getByLabel("Jot text").isDisabled(), true);
  assert.equal(await panel().getByLabel("Jot destination").isDisabled(), true);
  await page.screenshot({ path: path.join(root, "retry.png") });
  db.exec("DROP TRIGGER reject_jot");
  await panel()
    .getByRole("button", { name: "Retry capture", exact: true })
    .click();
  await ready();
  assert.equal(await panel().count(), 0);
  assert.equal(await countText("Retry retained capture"), 1);
  await save();
  assert.deepEqual(assets(), beforeAssets);
  assert.deepEqual(await readFile(assetPath), bytes);
  assert.deepEqual(
    db.prepare("SELECT * FROM documents WHERE object_id=?").get(source.id),
    sourceRow,
  );
  await page.getByRole("button", { name: "▤ Page", exact: true }).click();
  await ready();
  await save();
  await page.screenshot({ path: path.join(root, "captured.png") });
  await page.getByLabel("Search titles").fill("Retry retained");
  await click("Search titles & body");
  await page
    .getByRole("region", { name: "Body search results" })
    .getByRole("button", { name: "Capture destination", exact: true })
    .waitFor();
  db.close();
  await stop();
  await launch();
  await page
    .locator(".document-row")
    .filter({ hasText: "Capture destination" })
    .click();
  await ready();
  assert.equal((await body()).id, target.id);
  assert.equal(await countText(quote), 1);
  assert.equal(await countText("Retry retained capture"), 1);
  await click("Manage backups");
  await click("Create backup");
  await click("Verify archive");
  await click("Restore archive");
  await page
    .locator(".document-row")
    .filter({ hasText: "Capture destination" })
    .click();
  await ready();
  assert.equal((await body()).id, target.id);
  assert.equal(await countText(quote), 1);
  assert.equal(await countText("Retry retained capture"), 1);
  console.log(
    "PASS Jot destination, Unicode/newlines, offline, append, undo/redo, idempotent save retry, preserved source/assets/references, search, restart and backup",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
