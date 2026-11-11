import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/canvas-recovery-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
const errors = [];
async function ready() {
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
      "false",
  );
}
async function launch(scale = 1) {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=9269 --force-device-scale-factor=${scale}`,
    },
  });
  for (let i = 0; i < 120; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9269");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".app-shell", { timeout: 60000 });
  await ready();
  await page.waitForSelector("affine-editor-container", { timeout: 30000 });
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child?.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$tourApp=Get-Process -Id ${child.pid}; if(-not $tourApp.CloseMainWindow()){throw 'Could not close test app'}; if(-not $tourApp.WaitForExit(30000)){throw 'Test app still saving'}`,
      ],
      { windowsHide: true },
    );
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
async function settings() {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await ready();
}
async function view(name) {
  await page.getByRole("button", { name, exact: true }).click();
  await ready();
}
try {
  await launch();
  let button = page.getByRole("button", {
    name: "Find my content",
    exact: true,
  });
  await button.waitFor();
  // Render the full board once so lazy note/image measurements settle.
  await button.click();
  await page.waitForTimeout(1500);
  const snapshot = () =>
    page.evaluate(() =>
      JSON.stringify(
        document
          .querySelector("affine-editor-container")
          .doc.spaceDoc.getMap("blocks")
          .toJSON(),
      ),
    );
  await save();
  const before = await snapshot();
  const lose = () =>
    page.evaluate(() => {
      const v = document.querySelector("affine-edgeless-root").service.viewport;
      v.setZoom(2);
      v.setCenter(100000, -100000);
    });
  const position = () =>
    page.evaluate(() => {
      const r = document.querySelector("affine-edgeless-root");
      return {
        x: r.service.viewport.center.x,
        y: r.service.viewport.center.y,
        zoom: r.service.viewport.zoom,
      };
    });
  await lose();
  await button.click();
  const recovered = await position();
  assert.ok(Math.abs(recovered.x) < 10000 && Math.abs(recovered.y) < 10000);
  assert.ok(recovered.zoom < 1);
  assert.equal(
    await snapshot(),
    before,
    "Finding content must not edit document content",
  );
  await page.screenshot({ path: path.join(root, "recovered.png") });
  await lose();
  await page.getByLabel("Document title", { exact: true }).focus();
  await page.keyboard.press("Control+Shift+Home");
  assert.equal(
    (await position()).x,
    100000,
    "Text editing shortcut stays with the input",
  );
  await page.getByLabel("Document title", { exact: true }).press("Tab");
  await page.keyboard.press("Control+Shift+Home");
  assert.ok(Math.abs((await position()).x) < 10000);
  await view("Page");
  assert.equal(await button.count(), 0);
  await view("Canvas");
  await button.waitFor();
  await settings();
  assert.equal(await button.count(), 0);
  await page
    .getByRole("button", { name: "Open Getting Started", exact: true })
    .click();
  await ready();
  await createNotebook(page, true);
  await ready();
  await lose();
  await button.click();
  const empty = await position();
  assert.ok(Number.isFinite(empty.zoom) && Number.isFinite(empty.x));
  await save();
  await stop();
  await launch(1.5);
  button = page.getByRole("button", { name: "Find my content", exact: true });
  await settings();
  await page
    .getByRole("button", { name: "Open Getting Started", exact: true })
    .click();
  await ready();
  await lose();
  await button.click();
  assert.ok(
    await page.evaluate(() => {
      const root = document.querySelector("affine-edgeless-root");
      const bounds = root.gfx.elementsBound;
      const viewport = root.service.viewport;
      const top =
        (bounds.y - viewport.center.y) * viewport.zoom + viewport.height / 2;
      const bottom = top + bounds.h * viewport.zoom;
      return top >= 64 && bottom <= viewport.height - 112;
    }),
    "The entire large board must fit above the toolbar at 150% scaling",
  );
  await page.screenshot({ path: path.join(root, "recovered-150.png") });
  assert.ok(await button.isVisible());
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(root, "results.json"),
    JSON.stringify({ recovered, empty, errors }, null, 2),
  );
  console.log(
    "PASS far-away recovery, keyboard shortcut, text-input protection, unchanged content, Page/Settings visibility, empty board and 150% scaling",
  );
  console.log(root);
} catch (error) {
  console.error(error);
  console.error(errors);
  process.exitCode = 1;
  if (page)
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
} finally {
  await stop();
}
