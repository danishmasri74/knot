import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/shell-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9270",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9270", {
        timeout: 1000,
      });
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
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
      "false",
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
async function menu(label, action) {
  if (label === "Workspace actions") {
    await clickShellButton(page, action);
    return;
  }
  await page.locator("summary").filter({ hasText: label }).click();
  await click(action);
}
async function rename(title) {
  await page.getByLabel("Document title", { exact: true }).fill(title);
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
}
const id = () =>
  page.evaluate(() => document.querySelector("affine-editor-container").doc.id);
async function geometry(label) {
  const result = await page.evaluate(() => {
    const rect = (s) =>
      document.querySelector(s).getBoundingClientRect().toJSON();
    return {
      header: rect(".topbar"),
      editor: rect(".editor-area"),
      footer: rect(".sidebar-footer"),
      overflow: document.documentElement.scrollWidth > innerWidth,
      sidebar:
        document.querySelector(".sidebar").scrollHeight >
        document.querySelector(".sidebar").clientHeight,
    };
  });
  assert.equal(result.editor.y, result.header.bottom, label);
  assert.equal(result.overflow, false);
  assert.equal(result.sidebar, false);
  assert.ok(result.footer.bottom <= page.viewportSize().height);
  await page.screenshot({ path: path.join(root, label + ".png") });
}
let db;
try {
  await launch();
  db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  const first = await id();
  await rename("Long title for the workspace shell ".repeat(12));
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await geometry(`page-${width}`);
    await click("Canvas");
    await geometry(`canvas-${width}`);
    await click("Page");
  }
  await page.getByLabel("Collapse sidebar").click();
  await page.locator(".sidebar").waitFor({ state: "hidden" });
  assert.equal(await id(), first);
  await page.getByLabel("Expand sidebar").click();
  await page.locator("summary").filter({ hasText: "Document actions" }).focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .getByRole("button", { name: "Delete document", exact: true })
      .isVisible(),
    true,
  );
  await page.screenshot({ path: path.join(root, "document-menu.png") });
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("summary")
      .filter({ hasText: "Document actions" })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await createNotebook(page, true);
  const board = await id();
  await rename("Shell board");
  await page.getByLabel("Go back", { exact: true }).click();
  await ready();
  assert.equal(await id(), first);
  await page.getByLabel("Go forward", { exact: true }).click();
  await ready();
  assert.equal(await id(), board);
  db.exec(
    "CREATE TRIGGER reject_shell BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL, 'shell save blocked'); END",
  );
  await page.evaluate(() => {
    const d = document.querySelector("affine-editor-container").doc;
    const p = d.getBlocksByFlavour("affine:paragraph")[0].model;
    p.text.insert(" pending", p.text.length);
  });
  await page.locator(".document-row").filter({ hasText: "Long title" }).click();
  await ready();
  assert.equal(await id(), board);
  await page.waitForFunction(() =>
    document.querySelector(".save-status").textContent.includes("Save failed"),
  );
  await page.screenshot({ path: path.join(root, "failed-save.png") });
  db.exec("DROP TRIGGER reject_shell");
  await page.getByRole("button", { name: "Save now / retry", exact: true }).click();
  await ready();
  if (await page.locator(".error-banner").count()) await click("Dismiss");
  await page.locator(".document-row").filter({ hasText: "Long title" }).click();
  await ready();
  assert.equal(await id(), first);
  for (let n = 0; n < 22; n++) {
    await createNotebook(page);
    await rename(`Library note ${n}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await geometry("long-library");
  assert.ok(
    await page
      .locator(".library")
      .evaluate((e) => e.scrollHeight > e.clientHeight),
  );
  await page.locator(".library").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: path.join(root, "workspace-settings.png") });
  await page.keyboard.press("Escape");
  await menu("Workspace actions", "Trash & recovery");
  await click("Close Trash & recovery panel");
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search workspace" })
    .fill("no matching title");
  await page.getByText("No results found.").waitFor();
  await page.screenshot({ path: path.join(root, "empty-search.png") });
  await page.keyboard.press("Escape");
  await page.locator(".document-row").first().waitFor();
  while (await page.locator(".document-row").count())
    await menu("Document actions", "Delete document");
  await page.getByText("Create a note or whiteboard to begin.").waitFor();
  await geometry("empty-library");
  await createNotebook(page);
  await page.waitForSelector("affine-paragraph");
  await writeFile(
    path.join(root, "results.json"),
    JSON.stringify(
      {
        passed: true,
        viewports: [
          [1280, 720],
          [1920, 1080],
        ],
        checks: [
          "single header",
          "Page/Canvas",
          "long titles",
          "collapse preserves identity",
          "keyboard menu dismissal",
          "create/open/rename/soft-delete",
          "Back/Forward",
          "failed-save navigation",
          "long library independent scroll",
          "empty library",
        ],
      },
      null,
      2,
    ),
  );
  console.log("PASS shell acceptance " + root);
} finally {
  db?.close();
  await stop();
}
