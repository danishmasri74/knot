import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/scaling-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9275",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9275", {
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
  const surface = page.locator(".tool-surface");
  if (await surface.isVisible()) {
    assert.equal(
      await surface.getByRole("button", { name: /^Close/ }).count(),
      1,
      "Each tool surface has one shared close action",
    );
  }
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
// No viewport or device-metrics emulation: Windows Settings supplies the scale.
const expectedScale = Number(process.argv[2]);
assert.ok(
  [1, 1.5].includes(expectedScale),
  "Pass the actual Windows scale: 1 or 1.5",
);
const measurements = [];
async function capture(name) {
  await page.waitForTimeout(750); // Native toolbar resize animation settles.
  const metrics = await page.evaluate(async () => {
    const box = (s) =>
      document.querySelector(s)?.getBoundingClientRect().toJSON();
    return {
      scale: await window.__TAURI_INTERNALS__.invoke(
        "plugin:window|scale_factor",
        { label: "main" },
      ),
      physical: await window.__TAURI_INTERNALS__.invoke(
        "plugin:window|inner_size",
        { label: "main" },
      ),
      dpr: devicePixelRatio,
      width: innerWidth,
      height: innerHeight,
      screen: { width: screen.width, height: screen.height },
      overflow: document.documentElement.scrollWidth > innerWidth,
      header: box(".topbar"),
      editor: box(".editor-area"),
      panel: box(".tool-surface"),
      hidden:
        getComputedStyle(document.querySelector(".editor-area")).visibility ===
        "hidden",
      dialog: box("dialog[open]"),
    };
  });
  assert.equal(metrics.scale, expectedScale);
  assert.equal(metrics.dpr, expectedScale);
  assert.equal(metrics.overflow, false);
  if (metrics.panel) {
    assert.ok(metrics.panel.x >= 0 && metrics.panel.right <= metrics.width + 1);
    assert.ok(metrics.hidden || metrics.editor.right <= metrics.panel.x + 1);
  }
  if (metrics.dialog)
    assert.ok(
      metrics.dialog.x >= 0 && metrics.dialog.bottom <= metrics.height + 1,
    );
  measurements.push({ name, ...metrics });
  await page.screenshot({ path: path.join(root, name + ".png") });
}
try {
  await launch();
  await capture("page");
  await click("Canvas");
  await capture("canvas");
  await menu("Document actions", "Backlinks");
  await page.locator(".backlinks-panel").waitFor();
  await capture("canvas-inspector");
  await click("Close Links tab");
  await click("Page");

  await capture("library");
  await page.keyboard.press("Escape");
  await menu("Workspace actions", "Trash & recovery");
  await capture("trash-empty");
  await click("Close Trash & recovery panel");
  await menu("Document actions", "PDF reader");
  await capture("pdf-empty");
  await click("Close PDF reader tab");
  await menu("Document actions", "PDF reader");
  await capture("pdf-split-empty");
  await writeFile(
    path.join(root, "metrics.json"),
    JSON.stringify(measurements, null, 2),
  );
  console.log(
    "PASS actual Windows scale",
    expectedScale,
    JSON.stringify(measurements[0]),
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
