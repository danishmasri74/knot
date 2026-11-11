import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/ai-diagnostics-${Date.now()}`);
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9291",
  },
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9291");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.waitForSelector(".app-shell", { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    await invoke("ai_diagnostics_enabled", { enabled: true });
    await invoke("ai_diagnostics_clear");
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    const attempt = async (id, link) => {
      try {
        await invoke("ai_respond", {
          id,
          link,
          model: "invalid-model",
          mode: "ask",
          context: JSON.stringify({
            text: "PRIVATE_SENTINEL",
            title: "PRIVATE_SENTINEL",
          }),
          messages: [{ role: "user", content: "PRIVATE_SENTINEL" }],
          onEvent: "__CHANNEL__:99999",
        });
      } catch {
        /* Backend validation must fail before credentials/network access. */
      }
    };
    await attempt(first);
    await attempt(second, { parent: first, kind: "retry" });
    await invoke("ai_diagnostics_outcome", { id: first, outcome: "dismiss" });
    await invoke("ai_diagnostics_outcome", { id: first, outcome: "dismiss" });
    const on = await invoke("ai_diagnostics");
    await invoke("ai_diagnostics_enabled", { enabled: false });
    await attempt(crypto.randomUUID());
    const off = await invoke("ai_diagnostics");
    return { on, off };
  });
  assert.equal(result.on.attempts.length, 2);
  assert.equal(result.on.outcomes.length, 1);
  assert.equal(result.on.attempts[0].link.kind, "retry");
  assert.equal(result.off.attempts.length, 2);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_SENTINEL"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const panel = page.getByRole("region", { name: "Usage & diagnostics" });
  const disclosure = panel.locator(":scope > details > summary");
  assert.equal(await panel.getByRole("switch").count(), 0);
  await disclosure.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "diagnostics-collapsed.png") });
  await disclosure.focus();
  await disclosure.press("Enter");
  await panel.getByText("2 attempts", { exact: true }).waitFor();
  assert.equal(
    await panel.getByRole("switch").getAttribute("aria-checked"),
    "false",
  );
  await panel.getByLabel("Status", { exact: true }).selectOption("completed");
  await panel.getByText("No attempts match these filters.").waitFor();
  await panel.getByLabel("Status", { exact: true }).selectOption("failed");
  await panel.locator(".diagnostics-overview").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "diagnostics-expanded.png") });
  await panel.locator(".diagnostics-attempt summary").first().click();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, "diagnostics.png"),
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Clear diagnostics", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Clear all records", exact: true })
    .click();
  await panel.getByText("No diagnostics have been recorded yet.").waitFor();
  console.log(
    "PASS real diagnostics IPC, retry links, privacy, outcome deduplication, collection toggle, filters and clear",
    root,
  );
} finally {
  if (browser) await browser.close();
  // Close only this isolated test instance through its normal window close flow.
  if (child.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p = Get-Process -Id ${child.pid}; $null = $p.CloseMainWindow(); if (-not $p.WaitForExit(30000)) { throw 'Test app did not close normally' }`,
      ],
      { windowsHide: true },
    );
}
