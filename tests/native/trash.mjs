import { placeLegacyReference } from "./legacy-reference-fixture.mjs";
import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton, openShellMenu } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/trash-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
async function launch(expectEditor = true) {
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
  await page.waitForSelector(
    expectEditor ? "affine-editor-container" : ".app-shell",
    { timeout: 60000 },
  );
  await ready();
}
async function ready() {
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
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
try {
  await launch();
  await rename("Recover source");
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Retained authoritative content.");
  await save();
  const source = await body();
  await createNotebook(page, true);
  await rename("Recovery board");
  await place("Recover source");
  await save();
  await preview("Retained authoritative content.");
  await select("Recover source");
  await openShellMenu(page, "Document actions");
  await page
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  const moveDialog = page.locator("dialog.trash-confirmation");
  await moveDialog
    .getByRole("heading", { name: "Move “Recover source” to Trash?" })
    .waitFor();
  assert.equal(
    await moveDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(root, "move-confirmation.png") });
  await page.keyboard.press("Escape");
  await moveDialog.waitFor({ state: "detached" });
  assert.equal(
    await page.getByLabel("Document title", { exact: true }).inputValue(),
    "Recover source",
  );
  assert.equal(
    await page
      .getByLabel("Document actions", { exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await clickShellButton(page, "Delete document");
  await ready();
  await click("Trash & recovery");
  await page
    .getByRole("button", { name: "Restore Recover source", exact: true })
    .waitFor();
  const modal = page.getByRole("dialog", {
    name: "Trash & recovery",
    exact: true,
  });
  assert.equal(await modal.evaluate((el) => el.matches(":modal")), true);
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("button", { name: "Trash", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await click("Trash & recovery");
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(root, "trash-populated.png") });
  await page.setViewportSize({ width: 760, height: 640 });
  assert.equal(
    await page
      .locator(".trash-page")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.screenshot({ path: path.join(root, "trash-narrow.png") });
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByLabel("Search Trash", { exact: true }).fill("missing");
  await page.getByText("No matching items").waitFor();
  await page.getByLabel("Search Trash", { exact: true }).fill("recover");
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
  await page.getByText("No matching items").waitFor();
  await preview("Retained authoritative content.");
  assert.equal(
    db.prepare("SELECT deleted_at FROM objects WHERE id=?").get(source.id)
      .deleted_at,
    null,
  );
  db.close();
  await page.screenshot({ path: path.join(root, "restored.png") });
  await click("Close Trash & recovery panel");
  await select("Recover source");
  assert.equal((await body()).id, source.id);
  assert.equal((await body()).json, source.json);
  await stop();
  await launch();
  await select("Recovery board");
  await preview("Retained authoritative content.");
  await click("Trash & recovery");
  await page.getByText("Trash is empty.").waitFor();
  await click("Close Trash & recovery panel");
  await clickShellButton(page, "Delete document");
  await ready();
  await clickShellButton(page, "Delete document");
  await ready();
  assert.equal(await page.locator(".document-row").count(), 0);
  await click("Trash & recovery");
  await click("Restore Recover source");
  await click("Close Trash & recovery panel");
  await select("Recover source");
  assert.equal((await body()).json, source.json);
  await clickShellButton(page, "Delete document");
  await ready();
  await click("Trash & recovery");
  await page
    .getByRole("button", {
      name: "Delete permanently Recover source",
      exact: true,
    })
    .click();
  await page.keyboard.press("Escape");
  await page
    .locator("dialog.trash-confirmation")
    .waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("dialog", { name: "Trash & recovery", exact: true })
      .isVisible(),
    true,
  );
  await page
    .getByRole("button", { name: "Restore Recover source", exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: "Delete permanently Recover source",
      exact: true,
    })
    .click();
  const bounds = await page.locator("dialog.trash-confirmation").boundingBox();
  assert.ok(
    bounds.x > 100 && bounds.y > 100,
    "Confirmation should be centered",
  );
  await page.screenshot({ path: path.join(root, "delete-confirmation.png") });
  await page
    .locator("dialog.trash-confirmation")
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await page
    .locator("dialog.trash-confirmation")
    .waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("button", { name: "Restore Recover source", exact: true })
      .count(),
    0,
  );
  await page.getByLabel("Search Trash", { exact: true }).fill("no-match");
  await page.getByRole("button", { name: "Empty Trash", exact: true }).click();
  await page
    .locator("dialog.trash-confirmation")
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await page
    .locator("dialog.trash-confirmation")
    .waitFor({ state: "detached" });
  await page.getByLabel("Search Trash", { exact: true }).fill("");
  await page.getByText("Trash is empty.").waitFor();
  await page.screenshot({ path: path.join(root, "empty-trash.png") });
  await stop();
  const retentionDb = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  const insert = retentionDb.prepare(
    "INSERT INTO objects(id,title,kind,updated_at,deleted_at) VALUES(?,?,'note',?,?)",
  );
  const now = Date.now();
  insert.run(
    "expired-retention",
    "Expired retention",
    now,
    now - 31 * 86400000,
  );
  insert.run("recent-retention", "Recent retention", now, now - 29 * 86400000);
  await launch(false);
  // Startup cleanup must work without visiting Trash.
  for (
    let attempt = 0;
    attempt < 50 &&
    retentionDb
      .prepare("SELECT id FROM objects WHERE id='expired-retention'")
      .get();
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    retentionDb
      .prepare("SELECT id FROM objects WHERE id='expired-retention'")
      .get(),
    undefined,
  );
  assert.ok(
    retentionDb
      .prepare("SELECT id FROM objects WHERE id='recent-retention'")
      .get(),
  );
  insert.run("expired-on-open", "Expired on open", now, now - 31 * 86400000);
  await click("Trash & recovery");
  assert.equal(
    retentionDb
      .prepare("SELECT id FROM objects WHERE id='expired-on-open'")
      .get(),
    undefined,
  );
  await page
    .getByText(/Items in Trash are permanently deleted after 30 days/)
    .waitFor();
  retentionDb.close();
  console.log(
    "PASS trash search, failed restore/retry, original ID/body, live shared reference recovery, restart, permanent deletion, cancel, filtered Empty Trash",
    root,
  );
} finally {
  await stop();
}
