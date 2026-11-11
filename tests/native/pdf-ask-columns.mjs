import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";
import { clickShellButton } from "./shell-navigation.mjs";

const root = path.resolve(`test-results/pdf-ask-columns-${Date.now()}`);
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9288",
  },
});
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9288");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(browser);
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
      "false",
  );
  await clickShellButton(page, "PDF reader");
  const pdf = page.getByRole("region", { name: "PDF reader", exact: true });
  const ask = pdf.getByRole("button", { name: "Ask Knot", exact: true });
  await ask.waitFor();
  await page.waitForFunction(
    () => document.querySelector(".pdf-ai-controls button")?.disabled === false,
  );
  await ask.click();
  const aiTab = page.getByRole("tab", { name: "Ask Knot", exact: true });
  await aiTab.waitFor();
  const pdfTab = page.getByRole("tab", { name: "PDF reader", exact: true });
  const group = (locator) =>
    locator.evaluate(
      (el) =>
        el.closest(".pane-group-header")?.getAttribute("data-group") ??
        el.closest(".pane-header")?.outerHTML,
    );
  // Tabs must belong to different headers and both contents remain visible.
  assert.notEqual(await group(pdfTab), await group(aiTab));
  assert.equal(await pdf.isVisible(), true);
  assert.equal(
    await page.getByLabel("Ask Knot message", { exact: true }).isVisible(),
    true,
  );
  const before = await page
    .locator(".pane-tabs")
    .evaluateAll((nodes) => nodes.map((n) => n.textContent));
  await ask.click();
  await page.getByLabel("Ask Knot message", { exact: true }).waitFor();
  assert.equal(await aiTab.count(), 1);
  assert.deepEqual(
    await page
      .locator(".pane-tabs")
      .evaluateAll((nodes) => nodes.map((n) => n.textContent)),
    before,
  );
  assert.equal(await pdf.isVisible(), true);
  await page.screenshot({ path: path.join(root, "pdf-beside-ai.png") });
  console.log(
    "PASS PDF Ask Knot opens an adjacent AI column, preserves the PDF and reuses existing AI without changing tab membership",
  );
} finally {
  if (child.pid)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$app = Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if ($app) { $null = $app.CloseMainWindow(); $null = $app.WaitForExit(30000) }`,
      ],
      { windowsHide: true },
    );
  await browser?.close();
}
