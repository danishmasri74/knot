import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import assert from "node:assert/strict";
const root = path.resolve("test-results/identity-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9284",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9284");
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
  const mark = page.locator(".brand-mark");
  assert.equal(await mark.getAttribute("src"), "/knot-mark.svg");
  await page.waitForFunction(() => {
    const img = document.querySelector(".brand-mark");
    return img.complete && img.naturalWidth > 0;
  });
  assert.equal(await mark.evaluate((e) => getComputedStyle(e).filter), "none");
  assert.equal(
    await page.locator('link[rel="icon"]').getAttribute("href"),
    "/knot.svg",
  );
  await page.screenshot({ path: path.join(root, "linked-k-app.png") });
  console.log(
    "PASS Linked K sidebar loads, no color filter, SVG favicon and native app launch",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
