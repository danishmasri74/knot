import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/backups-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9248",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9248");
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

try {
  await launch();
  await click("Manage backups");
  await page.getByText("No managed backups yet.", { exact: true }).waitFor();
  const db = new DatabaseSync(path.join(root, "Workspace", "knot.db"));
  db.exec(
    "CREATE TRIGGER reject_backup_save BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL,'backup save failure'); END;",
  );
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Saved inside managed backup.");
  await click("Create backup");
  await page
    .getByRole("alert")
    .filter({ hasText: "backup save failure" })
    .waitFor();
  assert.equal(await page.locator(".backup-row").count(), 0);
  db.exec("DROP TRIGGER reject_backup_save;");
  db.close();
  await click("Create backup");
  assert.equal(await page.locator(".backup-row").count(), 1);
  await click("Verify archive");
  await page.getByText(/Backup verified:/).waitFor();
  await page.screenshot({ path: path.join(root, "backups.png") });
  const original = await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    return {
      id: doc.id,
      json: JSON.stringify(doc.spaceDoc.getMap("blocks").toJSON()),
    };
  });
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Newer original edit.");
  await click("Restore archive");
  await page.waitForSelector("affine-paragraph");
  const restored = await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    return {
      id: doc.id,
      json: JSON.stringify(doc.spaceDoc.getMap("blocks").toJSON()),
    };
  });
  assert.deepEqual(restored, original);
  await click("Manage backups");
  await click("Delete archive");
  assert.equal(await page.locator(".backup-row").count(), 0);
  await click("Switch workspace");
  await click("Open Personal workspace");
  await page.waitForFunction(() =>
    JSON.stringify(
      document
        .querySelector("affine-editor-container")
        .doc.spaceDoc.getMap("blocks")
        .toJSON(),
    ).includes("Newer original edit."),
  );
  await stop();
  await launch();
  await click("Manage backups");
  assert.equal(await page.locator(".backup-row").count(), 0);
  console.log(
    "PASS managed backup creation, failed-save retry, validation, snapshot restore, deletion and restart",
    root,
  );
} finally {
  await stop();
}
