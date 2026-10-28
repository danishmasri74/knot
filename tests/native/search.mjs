import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/search-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9264",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9264");
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

const panel = () => page.getByRole("region", { name: "Body search results" });
async function search(query) {
  await page.getByLabel("Search titles", { exact: true }).fill(query);
  await click("Search titles & body");
}
async function edit(text) {
  await page.evaluate((text) => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc.getBlocksByFlavour("affine:paragraph")[0].model.text.insert(text, 0);
  }, text);
}
try {
  await launch();
  await rename("Research source");
  await edit("Café quasar original body");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/knot.png"));
  await ready();
  await save();
  const source = await body();
  await click("Manage folders & tags");
  for (const [kind, name] of [
    ["folder", "Research"],
    ["tag", "Important"],
  ]) {
    await page.getByLabel("Organization type").selectOption(kind);
    await page.getByLabel("Folder or tag name").fill(name);
    await click("Create");
  }
  await click("Close");
  await page.locator(".document-organization summary").click();
  await page
    .getByLabel("Document folder", { exact: true })
    .selectOption({ label: "Research" });
  await ready();
  await page.getByRole("checkbox", { name: "Important", exact: true }).click();
  await ready();
  await page.getByRole("button", { name: /New note/ }).click();
  await ready();
  await rename("Other source");
  await edit("quasar second body");
  await save();
  const other = await body();
  await page.getByRole("button", { name: /New whiteboard/ }).click();
  await ready();
  await rename("Shared board");
  await place("Research source");
  await save();
  const board = await body();
  const db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  const records = () =>
    ["objects", "documents", "attachments", "object_attachments"].map((table) =>
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  const before = records();
  const asset = db.prepare("SELECT * FROM attachments LIMIT 1").get();
  const assetPath = path.join(
    root,
    "Workspace/assets",
    asset.sha256.slice(0, 2),
    asset.sha256,
  );
  const bytes = await readFile(assetPath);
  await page.context().setOffline(true);
  await search("QUASAR");
  assert.equal(await panel().locator("li").count(), 2);
  assert.equal(
    await panel()
      .getByRole("button", { name: "Shared board", exact: true })
      .count(),
    0,
  );
  await click("Refresh search");
  assert.deepEqual(records(), before);
  assert.deepEqual(await readFile(assetPath), bytes);
  await page.screenshot({ path: path.join(root, "search.png") });
  await page.context().setOffline(false);
  await page
    .getByLabel("Filter by folder", { exact: true })
    .selectOption({ label: "Research" });
  await panel().waitFor({ state: "detached" });
  await page
    .getByLabel("Filter by tag", { exact: true })
    .selectOption({ label: "Important" });
  await search("quasar");
  assert.equal(await panel().locator("li").count(), 1);
  await panel()
    .getByRole("button", { name: "Research source", exact: true })
    .click();
  await ready();
  assert.equal((await body()).id, source.id);
  assert.equal(await panel().count(), 0);
  await click("Go back");
  assert.equal((await body()).id, board.id);
  await page
    .getByLabel("Filter by folder", { exact: true })
    .selectOption("all");
  await page.getByLabel("Filter by tag", { exact: true }).selectOption("");
  await search("quasar");
  db.exec(
    "CREATE TRIGGER reject_search BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL, 'search save blocked'); END",
  );
  await edit("quasar pending ");
  await click("Refresh search");
  await page
    .getByRole("alert")
    .filter({ hasText: "search save blocked" })
    .waitFor();
  assert.equal(await panel().locator("li").count(), 0);
  db.exec("DROP TRIGGER reject_search");
  await click("Refresh search");
  assert.equal(await panel().locator("li").count(), 3);
  await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    const p = doc.getBlocksByFlavour("affine:paragraph")[0].model;
    p.text.delete(0, p.text.length);
  });
  await click("Refresh search");
  assert.equal(await panel().locator("li").count(), 2);
  const saved = db
    .prepare("SELECT document_state FROM documents WHERE object_id=?")
    .get(other.id).document_state;
  db.prepare("UPDATE documents SET document_state=x'FF' WHERE object_id=?").run(
    other.id,
  );
  await click("Refresh search");
  await panel()
    .getByText(/Partial results/)
    .waitFor();
  assert.equal(await panel().locator("li").count(), 1);
  assert.deepEqual(
    [
      ...db
        .prepare("SELECT document_state FROM documents WHERE object_id=?")
        .get(other.id).document_state,
    ],
    [255],
  );
  db.prepare("UPDATE documents SET document_state=? WHERE object_id=?").run(
    saved,
    other.id,
  );
  await search("Other source");
  await panel()
    .getByRole("button", { name: "Other source", exact: true })
    .click();
  await ready();
  await page.getByTitle("Delete document").click();
  await ready();
  await search("quasar");
  assert.equal(await panel().locator("li").count(), 1);
  assert.deepEqual(await readFile(assetPath), bytes);
  db.close();
  await stop();
  await launch();
  await search("café");
  assert.equal(await panel().locator("li").count(), 1);
  await panel()
    .getByRole("button", { name: "Research source", exact: true })
    .click();
  await ready();
  assert.equal((await body()).id, source.id);
  await search("quasar");
  await click("Manage backups");
  await click("Create backup");
  await page
    .getByRole("button", { name: "Restore archive", exact: true })
    .click();
  await ready();
  assert.equal(await panel().count(), 0);
  await search("quasar");
  assert.equal(await panel().locator("li").count(), 1);
  console.log(
    "PASS body/title search, combined filters, shared exclusion, offline, preservation, navigation, save retry, freshness, corruption, Trash, restart and workspace reset",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
