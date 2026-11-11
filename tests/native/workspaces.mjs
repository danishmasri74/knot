import { placeLegacyReference } from "./legacy-reference-fixture.mjs";
import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/workspaces-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
async function launch(recovery = false) {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9247",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9247");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Native application did not start");
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("dialog", (d) => d.accept());
  if (!recovery)
    await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
}
async function ready() {
  await page.waitForFunction(
    () => document.querySelector(".primary")?.disabled === false,
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
async function select(title) {
  await page.locator(".document-row").filter({ hasText: title }).click();
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
  await page.waitForFunction(
    (text) =>
      [
        ...document.querySelectorAll("affine-embed-edgeless-synced-doc-block"),
      ].some((node) => node.textContent.includes(text)),
    text,
  );
}
async function switchTo(name) {
  await click("Switch workspace");
  await click(`Open ${name}`);
}
try {
  await launch();
  await rename("Original source");
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Original workspace content.");
  await save();
  const original = await body();
  await createNotebook(page, true);
  await rename("Original board");
  await place("Original source");
  await save();
  await preview("Original workspace content.");
  await stop();
  // A closed native fixture with the same IDs models a restored archive.
  await cp(path.join(root, "Workspace"), path.join(root, "restored-fixture"), {
    recursive: true,
  });
  await launch();
  await click("Trash & recovery");
  await switchTo("Restored workspace · fixture");
  assert.equal(await page.getByLabel("Trash and recovery").count(), 0);
  assert.ok(
    await page
      .getByRole("button", { name: "Go back", exact: true })
      .isDisabled(),
  );
  await select("Original source");
  assert.equal((await body()).id, original.id);
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Restored-only change.");
  await save();
  await switchTo("Personal workspace");
  await select("Original source");
  assert.equal((await body()).json, original.json);
  const db = new DatabaseSync(path.join(root, "Workspace", "knot.db"));
  db.exec(
    "CREATE TRIGGER reject_switch_save BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL,'save before switch failure'); END;",
  );
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Pending edit.");
  await switchTo("Restored workspace · fixture");
  await page
    .getByRole("alert")
    .filter({ hasText: "save before switch failure" })
    .waitFor();
  assert.equal((await body()).id, original.id);
  assert.match((await body()).json, /Pending edit/);
  await page
    .getByLabel("Workspace picker")
    .getByText("Current", { exact: true })
    .waitFor();
  db.exec("DROP TRIGGER reject_switch_save;");
  db.close();
  await click("Open Restored workspace · fixture");
  await select("Original source");
  assert.match((await body()).json, /Restored-only change/);
  assert.doesNotMatch((await body()).json, /Pending edit/);
  await click("Switch workspace");
  await page.screenshot({ path: path.join(root, "picker.png") });
  await click("Close Workspaces panel");
  await stop();
  await launch();
  assert.match((await body()).json, /Restored-only change/);
  await switchTo("Personal workspace");
  await select("Original source");
  assert.match((await body()).json, /Pending edit/);
  await stop();
  await writeFile(path.join(root, "active-workspace.txt"), "missing");
  await launch(true);
  await page.getByRole("alert").waitFor();
  await page.screenshot({ path: path.join(root, "startup-recovery.png") });
  await switchTo("Personal workspace");
  await select("Original source");
  assert.match((await body()).json, /Pending edit/);
  console.log(
    "PASS workspace isolation, saved-selection restart, history/panel reset, failed-save retry, startup recovery",
    root,
  );
} finally {
  await stop();
}
