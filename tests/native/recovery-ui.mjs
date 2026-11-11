import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import assert from "node:assert/strict";
const root = path.resolve("test-results/recovery-ui-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9285",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9285");
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

try {
  await launch();
  await writeFile(
    path.join(root, "Workspace/assets/unused-file.tmp"),
    "sample",
  );
  await click("Check workspace");
  await page.getByText("Your workspace looks good", { exact: true }).waitFor();
  assert.equal(await page.locator(".health-report").getAttribute("open"), null);
  assert.equal(
    await page
      .getByText("SQLite integrity and stored relationships passed.")
      .isVisible(),
    false,
  );
  for (const [width, height] of [
    [1280, 800],
    [760, 540],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: path.join(root, `health-${width}.png`) });
  }
  await page.getByRole("button", { name: "Review files", exact: true }).click();
  await ready();
  await page.getByText("unused-file.tmp", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".recovery-explainer").getAttribute("open"),
    null,
  );
  for (const [width, height] of [
    [1280, 800],
    [760, 540],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: path.join(root, `files-${width}.png`) });
  }
  await page.getByRole("checkbox").check();
  await click("Quarantine selected files");
  await page
    .getByRole("button", { name: "Restore file unused-file.tmp", exact: true })
    .waitFor();
  await click("Restore file unused-file.tmp");
  console.log(
    "PASS concise health/file screens, collapsed diagnostics, responsive layout, review, set aside and restore",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
