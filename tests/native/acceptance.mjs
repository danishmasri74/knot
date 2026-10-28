import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import path from "node:path";
const root = path.resolve("test-results/acceptance-" + Date.now());
await mkdir(root, { recursive: true });
const exe = path.resolve("src-tauri/target/debug/knot.exe");
const port = 9241;
let child, browser, page;
const results = [];
const record = (name) => {
  results.push(name);
  console.log("PASS " + name);
};
async function launch() {
  const start = Date.now();
  child = spawn(exe, [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  await page.waitForSelector("affine-paragraph", { timeout: 30000 });
  console.log("Native open ms", Date.now() - start);
  page.on("dialog", (d) => d.accept());
}
async function saved() {
  await page.getByTitle("Save now / retry").click();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
}
async function state() {
  return page.evaluate(() => {
    const d = document.querySelector("affine-editor-container").doc;
    return {
      id: d.id,
      json: JSON.stringify(d.spaceDoc.getMap("blocks").toJSON()),
    };
  });
}
try {
  await launch();
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Knot automated recovery check.");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await saved();
  const note = await state();
  assert.match(note.json, /Knot automated recovery check/);
  assert.ok(
    await page.evaluate(() =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:paragraph")[0]
        .model.text.toDelta()
        .some((x) => x.attributes?.bold),
    ),
  );
  record("Native rich text and formatting");
  await page
    .getByRole("button", { name: "Canvas", exact: false })
    .first()
    .click();
  await page.waitForSelector("affine-edgeless-root");
  assert.equal((await state()).id, note.id);
  record("Page and Canvas share identity");
  const surface = await page.evaluate(() => {
    let s = document
      .querySelector("affine-editor-container")
      .doc.getBlocksByFlavour("affine:surface")[0].model;
    return { add: typeof s.addElement };
  });
  assert.equal(surface.add, "function");
  await page.evaluate(() => {
    const d = document.querySelector("affine-editor-container").doc;
    const s = d.getBlocksByFlavour("affine:surface")[0].model;
    d.captureSync();
    s.addElement({ type: "shape", shapeType: "rect", xywh: "[0,0,120,80]" });
    s.addElement({
      type: "connector",
      mode: 0,
      source: { position: [120, 40] },
      target: { position: [240, 120] },
      controllers: [],
    });
  });
  await saved();
  assert.match((await state()).json, /connector/);
  record("Shape and connector persist through supported surface model");
  await page.getByTitle("Undo (Ctrl+Z)").click();
  await page.getByTitle("Redo (Ctrl+Y)").click();
  await saved();
  assert.match((await state()).json, /connector/);
  record("Undo redo");
  await page
    .getByRole("button", { name: "Page", exact: false })
    .first()
    .click();
  for (const file of ["knot.png", "sample.pdf", "knot.png"]) {
    await page
      .locator("input[type=file]")
      .setInputFiles(path.resolve("tests/fixtures", file));
    await page.waitForFunction(() =>
      document.querySelector(".statusbar")?.textContent.includes("Stored"),
    );
    await saved();
  }
  let db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  assert.equal(
    db.prepare("SELECT COUNT(DISTINCT sha256) n FROM attachments").get().n,
    2,
  );
  record("Image PDF imports and physical deduplication");
  await page.getByRole("button", { name: "New whiteboard" }).click();
  await page.waitForSelector("affine-edgeless-root");
  assert.notEqual((await state()).id, note.id);
  await page.getByLabel("Document title").fill("Independent board");
  await page.getByLabel("Document title").press("Enter");
  await saved();
  record("Create and rename independent board");
  await page.getByRole("button", { name: "Welcome to Knot" }).click();
  await page.waitForSelector("affine-paragraph");
  assert.equal((await state()).id, note.id);
  db.exec(
    "CREATE TRIGGER fail_save BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT, 'Injected save failure'); END",
  );
  await page.locator("affine-paragraph [contenteditable=true]").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Retry survives.");
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("failed"),
  );
  await page.getByRole("button", { name: "Independent board" }).click();
  await page.waitForTimeout(300);
  assert.equal((await state()).id, note.id);
  db.exec("DROP TRIGGER fail_save");
  await saved();
  assert.match((await state()).json, /Retry survives/);
  record("Actual SQLite failure blocks navigation and retry preserves edits");
  db.close();
  await page.getByRole("button", { name: "New note" }).click();
  await page.waitForSelector("affine-paragraph");
  await page.getByTitle("Delete document").click();
  await page.waitForTimeout(400);
  db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM objects WHERE deleted_at IS NOT NULL")
      .get().n,
    1,
  );
  db.close();
  record("Confirmed soft delete");
  await page.getByRole("button", { name: "Welcome to Knot" }).click();
  await saved();
  await browser.close();
  browser = null;
  execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  await new Promise((r) => setTimeout(r, 500));
  await launch();
  await page.getByRole("button", { name: "Welcome to Knot" }).click();
  await page.waitForSelector("affine-paragraph");
  const restored = await state();
  assert.equal(restored.id, note.id);
  for (const text of [
    "Retry survives",
    "affine:image",
    "application/pdf",
    "connector",
  ])
    assert.ok(restored.json.includes(text));
  record(
    "Forced termination and restart recover committed text canvas and attachment references",
  );
  await browser.contexts()[0].setOffline(true);
  await page.locator("affine-paragraph [contenteditable=true]").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Offline edit.");
  await saved();
  assert.match((await state()).json, /Offline edit/);
  record("Editing and SQLite saves with WebView network offline");
  await browser.contexts()[0].setOffline(false);
  await page.getByRole("button", { name: "Check workspace" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".integrity-panel")
      ?.textContent.includes("0 missing, 0 corrupt"),
  );
  record("Workspace integrity UI");
  await page.screenshot({ path: path.join(root, "accepted.png") });
  await writeFile(
    "test-results/current-native.json",
    JSON.stringify({ root, exe, pid: child.pid, port }, null, 2),
  );
  await writeFile(
    path.join(root, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await browser?.close();
  if (!results.includes("Workspace integrity UI") && child?.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    } catch {
      // The test process may already have exited after a startup failure.
    }
  }
  child?.unref();
}
