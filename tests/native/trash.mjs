import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/trash-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9246",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9246");
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
async function preview(text) {
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
  await rename("Recover source");
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Retained authoritative content.");
  await save();
  const source = await body();
  await click("◇ New whiteboard");
  await rename("Recovery board");
  await place("Recover source");
  await save();
  await preview("Retained authoritative content.");
  await select("Recover source");
  await page.getByTitle("Delete document").click();
  await ready();
  await click("Trash & recovery");
  await page
    .getByRole("button", { name: "Restore Recover source", exact: true })
    .waitFor();
  await page.getByLabel("Search Trash", { exact: true }).fill("missing");
  await click("Search Trash");
  await page.getByText("No deleted documents match this search.").waitFor();
  await page.getByLabel("Search Trash", { exact: true }).fill("recover");
  await click("Search Trash");
  const db = new DatabaseSync(path.join(root, "Workspace", "knot.db"));
  db.exec(
    "CREATE TRIGGER reject_restore BEFORE UPDATE ON objects WHEN OLD.deleted_at IS NOT NULL BEGIN SELECT RAISE(FAIL,'restore failure'); END;",
  );
  await click("Restore Recover source");
  await page
    .getByRole("alert")
    .filter({ hasText: "restore failure" })
    .waitFor();
  assert.ok(
    db.prepare("SELECT deleted_at FROM objects WHERE id=?").get(source.id)
      .deleted_at,
  );
  db.exec("DROP TRIGGER reject_restore;");
  await page.screenshot({ path: path.join(root, "trash-retry.png") });
  await click("Restore Recover source");
  await page.getByText("No deleted documents match this search.").waitFor();
  await preview("Retained authoritative content.");
  assert.equal(
    db.prepare("SELECT deleted_at FROM objects WHERE id=?").get(source.id)
      .deleted_at,
    null,
  );
  db.close();
  await page.screenshot({ path: path.join(root, "restored.png") });
  await click("Close Trash");
  await select("Recover source");
  assert.equal((await body()).id, source.id);
  assert.equal((await body()).json, source.json);
  await stop();
  await launch();
  await select("Recovery board");
  await preview("Retained authoritative content.");
  await click("Trash & recovery");
  await page.getByText("Trash is empty.").waitFor();
  await click("Close Trash");
  await page.getByTitle("Delete document").click();
  await ready();
  await page.getByTitle("Delete document").click();
  await ready();
  assert.equal(await page.locator(".document-row").count(), 0);
  await click("Trash & recovery");
  await click("Restore Recover source");
  await click("Close Trash");
  await select("Recover source");
  assert.equal((await body()).json, source.json);
  console.log(
    "PASS trash search, failed restore/retry, original ID/body, live shared reference recovery, restart",
    root,
  );
} finally {
  await stop();
}
