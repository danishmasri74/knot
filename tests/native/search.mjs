import { placeLegacyReference } from "./legacy-reference-fixture.mjs";
import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
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
  if (name === "Refresh search") {
    await search(currentQuery);
    return;
  }
  await clickShellButton(page, name);
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
  await page.getByRole("button", { name: "Save now / retry", exact: true }).click();
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
  await placeLegacyReference(page, title, shared);
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

const panel = () =>
  page.getByRole("dialog", { name: "Search workspace", exact: true });
let currentQuery = "";
async function search(query) {
  currentQuery = query;
  if (await panel().count())
    await page
      .getByRole("button", { name: "Close search", exact: true })
      .click();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search workspace" }).fill(query);
  await page.waitForFunction(
    () =>
      document
        .querySelector("#global-search-results")
        ?.getAttribute("aria-busy") === "false",
  );
}
async function edit(text) {
  await page.evaluate((text) => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc.getBlocksByFlavour("affine:paragraph")[0].model.text.insert(text, 0);
  }, text);
}
try {
  await launch();
  const trigger = page.getByRole("button", { name: /^Search/ });
  await trigger.click();
  const input = page.getByRole("combobox", { name: "Search workspace" });
  assert.ok(
    await input.evaluate((element) => element === document.activeElement),
  );
  await page.keyboard.press("Tab");
  assert.ok(
    await panel().evaluate((element) =>
      element.contains(document.activeElement),
    ),
  );
  await page.keyboard.press("Escape");
  assert.ok(
    await trigger.evaluate((element) => element === document.activeElement),
  );
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  assert.equal(await panel().count(), 0);
  await rename("Research source");
  await edit("Café quasar original body");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/knot.png"));
  await ready();
  await save();
  const source = await body();
  await page
    .getByRole("button", {
      name: "Collections for Research source",
      exact: true,
    })
    .click();
  await page.getByLabel("Find or create collection").fill("Research");
  await page
    .getByRole("button", { name: "Create “Research”", exact: true })
    .click();
  await ready();
  await page.keyboard.press("Escape");
  await createNotebook(page);
  await ready();
  await rename("Other source");
  await edit("quasar second body");
  await save();
  const other = await body();
  await createNotebook(page, true);
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
  assert.equal(await panel().getByRole("option").count(), 2);
  assert.equal(
    await panel()
      .getByRole("option", { name: "Shared board", exact: true })
      .count(),
    0,
  );
  await click("Refresh search");
  assert.deepEqual(records(), before);
  assert.deepEqual(await readFile(assetPath), bytes);
  await page.screenshot({ path: path.join(root, "search.png") });
  await page.getByRole("combobox").focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await panel().getByRole("option", { selected: true }).count(),
    1,
  );
  await page.keyboard.press("Enter");
  await ready();
  assert.equal(await panel().count(), 0);
  await click("Go back");
  await search("QUASAR");
  await page.context().setOffline(false);
  await page
    .getByRole("region", { name: "Collection Research", exact: true })
    .getByRole("button", { name: "Research", exact: true })
    .click();
  await search("quasar");
  assert.equal(await panel().getByRole("option").count(), 2);
  await panel()
    .getByRole("option")
    .filter({ hasText: "Research source" })
    .click();
  await ready();
  assert.equal((await body()).id, source.id);
  assert.equal(await panel().count(), 0);
  await click("Go back");
  assert.equal((await body()).id, board.id);
  await search("quasar");
  db.exec(
    "CREATE TRIGGER reject_search BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL, 'search save blocked'); END",
  );
  await edit("quasar pending ");
  await click("Refresh search");
  await panel()
    .getByRole("alert")
    .filter({ hasText: "search save blocked" })
    .waitFor();
  assert.equal(await panel().getByRole("option").count(), 0);
  db.exec("DROP TRIGGER reject_search");
  await click("Refresh search");
  assert.equal(await panel().getByRole("option").count(), 3);
  await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    const p = doc.getBlocksByFlavour("affine:paragraph")[0].model;
    p.text.delete(0, p.text.length);
  });
  await click("Refresh search");
  assert.equal(await panel().getByRole("option").count(), 2);
  const saved = db
    .prepare("SELECT document_state FROM documents WHERE object_id=?")
    .get(other.id).document_state;
  db.prepare("UPDATE documents SET document_state=x'FF' WHERE object_id=?").run(
    other.id,
  );
  await click("Refresh search");
  await panel()
    .getByText(/Results may be incomplete/)
    .waitFor();
  assert.equal(await panel().getByRole("option").count(), 1);
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
    .getByRole("option", { name: "Other source", exact: true })
    .click();
  await ready();
  await clickShellButton(page, "Delete document");
  await ready();
  await search("quasar");
  assert.equal(await panel().getByRole("option").count(), 1);
  assert.deepEqual(await readFile(assetPath), bytes);
  db.close();
  await stop();
  await launch();
  await search("café");
  assert.equal(await panel().getByRole("option").count(), 1);
  await panel()
    .getByRole("option")
    .filter({ hasText: "Research source" })
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
  assert.equal(await panel().getByRole("option").count(), 1);
  console.log(
    "PASS global modal, shortcuts, focus, keyboard navigation, body/title search, filter independence, shared exclusion, offline, preservation, navigation, save retry, freshness, corruption, Trash, restart and workspace reset",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
