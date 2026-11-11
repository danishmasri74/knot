import { placeLegacyReference } from "./legacy-reference-fixture.mjs";
import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/shared-notes-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9244",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9244");
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
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
        "false" &&
      document.querySelector(".editor-area")?.getAttribute("aria-busy") ===
        "false",
  );
}
async function click(name) {
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
  await page
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
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
  const row = page.locator(".document-row").filter({ hasText: title });
  if (await row.count()) await row.click();
  else {
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search workspace" }).fill(title);
    await page.getByRole("option", { name: title, exact: true }).click();
  }
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
async function preview(text) {
  if (!(await page.locator("affine-edgeless-root").count()))
    await click("Canvas");
  await page.waitForFunction(
    (text) =>
      [
        ...document.querySelectorAll("affine-embed-edgeless-synced-doc-block"),
      ].some((node) => node.textContent.includes(text)),
    text,
  );
}
try {
  await launch();
  const fixtureDb = new DatabaseSync(path.join(root, "Workspace/knot.db"), {
    readOnly: true,
  });
  const initialBodies = fixtureDb
    .prepare("SELECT count(*) n FROM documents")
    .get().n;
  fixtureDb.close();
  await createNotebook(page);
  await rename("Shared source");
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("One authoritative thought.");
  await save();
  const source = await body();
  await createNotebook(page, true);
  await rename("Board Alpha");
  await place("Shared source");
  const alpha = await body();
  assert.match(alpha.json, new RegExp(source.id));
  assert.doesNotMatch(alpha.json, /One authoritative thought/);
  await preview("One authoritative thought.");
  await createNotebook(page, true);
  await rename("Board Beta");
  await place("Shared source");
  await preview("One authoritative thought.");
  const beta = await body();
  await select("Shared source");
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Updated at source.");
  await rename("Renamed source");
  await save();
  for (const title of ["Board Alpha", "Board Beta"]) {
    await select(title);
    await preview("Updated at source.");
    assert.match((await body(source.id)).json, /Updated at source/);
    assert.doesNotMatch((await body()).json, /Updated at source/);
  }
  console.log(
    "PASS two boards resolve one authoritative body and renamed title",
  );
  await page.screenshot({ path: path.join(root, "shared-board.png") });
  await stop();
  await launch();
  await select("Board Alpha");
  await preview("Updated at source.");
  await select("Board Beta");
  await preview("Updated at source.");
  console.log("PASS references and content survive native restart");
  // Native card navigation must use the app's save-before-switch/history path.
  await page
    .locator("affine-embed-edgeless-synced-doc-block")
    .evaluate((element) => element.open());
  await ready();
  await page.waitForFunction(
    (id) => document.querySelector("affine-editor-container").doc.id === id,
    source.id,
  );
  await ready();
  await click("Go back");
  await page.waitForFunction(
    (id) =>
      document.querySelector(".editor-area > affine-editor-container").doc
        .id === id,
    beta.id,
  );
  assert.equal((await body()).id, beta.id);
  console.log("PASS native card navigation and Back history");
  // Removing a placement leaves its source and the other placement intact.
  await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc.captureSync();
    doc.deleteBlock(doc.getBlocksByFlavour("affine:embed-synced-doc")[0].model);
  });
  await save();
  await select("Board Alpha");
  await preview("Updated at source.");
  await select("Renamed source");
  await place("Board Alpha", false);
  assert.match((await body()).json, /affine:embed-linked-doc/);
  await select("Board Alpha");
  await preview("Updated at source.");
  console.log("PASS placement removal and reciprocal workspace references");
  // BlockSuite's own create-linked-doc flow can introduce a new collection doc.
  // It and its parent must enter SQLite in the same durable save.
  await select("Board Beta");
  const createdId = await page.evaluate(() => {
    const board = document.querySelector("affine-editor-container").doc;
    const linked = board.collection.createDoc();
    linked.load();
    const root = linked.addBlock("affine:page", {
      title: new board.Text("Native linked note"),
    });
    linked.addBlock("affine:surface", {}, root);
    const note = linked.addBlock("affine:note", {}, root);
    linked.addBlock(
      "affine:paragraph",
      { text: new board.Text("Created by BlockSuite") },
      note,
    );
    board.addBlock(
      "affine:embed-synced-doc",
      { pageId: linked.id, style: "syncedDoc", xywh: "[0,200,364,390]" },
      board.getBlocksByFlavour("affine:surface")[0].model,
    );
    return linked.id;
  });
  await save();
  await select("Board Alpha");
  await select("Board Beta");
  await preview("Created by BlockSuite");
  assert.match((await body(createdId)).json, /Created by BlockSuite/);
  console.log(
    "PASS native-created linked document persists with its parent and enters library",
  );

  await select("Renamed source");
  await clickShellButton(page, "Delete document");
  await ready();
  await select("Board Alpha");
  if (!(await page.locator("affine-edgeless-root").count()))
    await click("Canvas");
  await page.waitForFunction(
    () =>
      document.querySelector("affine-embed-edgeless-synced-doc-block")
        ?.blockState.isDeleted,
  );
  const db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM documents WHERE object_id=?")
      .get(source.id).n,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM documents").get().n,
    initialBodies + 4,
  );
  assert.ok(
    db.prepare("SELECT deleted_at FROM objects WHERE id=?").get(source.id)
      .deleted_at,
  );
  db.close();
  assert.match((await body()).json, new RegExp(source.id));
  console.log(
    "PASS deleted source stays retained, unresolved placement does not duplicate content",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
