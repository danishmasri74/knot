import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/ai-library-${Date.now()}`);
await mkdir(root, { recursive: true });
spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9297",
  },
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9297");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector("affine-editor-container", { timeout: 60000 });
  const ask = page.getByRole("button", { name: "Ask Knot", exact: true });
  await page.waitForFunction(
    () => !document.querySelector(".sidebar-ask")?.disabled,
  );
  await ask.click();
  await page.locator(".ask-knot").waitFor();
  await ask.click();
  for (const name of ["All Notebooks", "All Collections"]) {
    await page
      .locator(".sidebar")
      .getByRole("button", { name, exact: true })
      .click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    assert.equal(await ask.isEnabled(), true);
    await ask.click();
    await page.locator(".ask-knot").waitFor();
    assert.equal(await page.locator(".library-page").count(), 0);
    assert.equal(
      await page.getByLabel("Document title", { exact: true }).isVisible(),
      true,
    );
    await ask.click();
  }
  console.log(
    "PASS: Ask Knot reopens from both library pages and reveals its notebook context.",
  );
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }),
  );
} finally {
  await browser?.close();
}
