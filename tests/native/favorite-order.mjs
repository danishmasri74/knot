import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/favorite-order-${Date.now()}`);
await mkdir(root, { recursive: true });
let child, browser, page;
const errors = [];
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9296",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9296", {
        timeout: 1000,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await access(path.join(root, "Workspace", "knot.db"));
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
  if (child && child.exitCode === null) {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$testApp = Get-Process -Id ${child.pid}; if (-not $testApp.CloseMainWindow()) { throw 'Cannot close test app' }; if (-not $testApp.WaitForExit(30000)) { throw 'Test app did not close' }`,
      ],
      { windowsHide: true },
    );
  }
  child = null;
}
async function rename(title) {
  await page.getByLabel("Document title", { exact: true }).fill(title);
  await page.getByLabel("Document title", { exact: true }).press("Tab");
  await ready();
}
try {
  await launch();
  const favorites = () =>
    page.getByRole("region", { name: "Favorites", exact: true });
  const titles = () =>
    favorites().locator(".notebook-row .document-row").allTextContents();
  const section = await favorites().boundingBox();
  const recent = await page
    .getByText("Recently visited", { exact: true })
    .boundingBox();
  assert.ok(section.y < recent.y);
  for (const title of ["First favorite", "Second favorite", "Third favorite"]) {
    await createNotebook(page);
    await rename(title);
    await click("Add notebook to favorites");
    await favorites()
      .getByRole("button", { name: title, exact: true })
      .waitFor();
  }
  const row = (title) =>
    favorites()
      .locator(".notebook-row")
      .filter({ has: page.getByRole("button", { name: title, exact: true }) });
  await row("Third favorite").dragTo(row("First favorite"), {
    targetPosition: { x: 70, y: 2 },
  });
  await ready();
  assert.deepEqual(await titles(), [
    "Third favorite",
    "First favorite",
    "Second favorite",
  ]);
  await row("Third favorite").dragTo(row("Second favorite"), {
    targetPosition: { x: 70, y: 25 },
  });
  await ready();
  assert.deepEqual(await titles(), [
    "First favorite",
    "Second favorite",
    "Third favorite",
  ]);
  await row("Second favorite").dragTo(row("First favorite"), {
    targetPosition: { x: 70, y: 2 },
  });
  await ready();
  await page.screenshot({ path: path.join(root, "favorites-order.png") });
  await stop();
  await launch();
  assert.deepEqual(await titles(), [
    "Second favorite",
    "First favorite",
    "Third favorite",
  ]);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Favorites above Recently visited; drag reorder in both directions; saved order survives relaunch.",
  );
} finally {
  await stop();
}
