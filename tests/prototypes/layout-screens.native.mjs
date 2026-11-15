// Development aid for the tabbed layout: opens the debug build with a
// disposable data dir and saves screenshots of a few layouts.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("test-results/layout-screens-" + Date.now());
await mkdir(root, { recursive: true });
const env = {
  ...process.env,
  KNOT_TEST_DATA_DIR: root,
  KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9294",
  KNOT_TEST_REMOTE_ARGS: "--remote-debugging-port=9295",
};
delete env.WEBVIEW2_USER_DATA_FOLDER;
delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, shell;
const errors = [];
const ready = () =>
  shell.waitForFunction(
    () => document.querySelector(".app-shell")?.getAttribute("aria-busy") === "false",
  );
const shot = async (name) => {
  await wait(700);
  const file = path.join(root, `${name}.png`);
  await shell.screenshot({ path: file });
  console.log("screenshot", file);
};
try {
  for (let i = 0; i < 150 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9294", { timeout: 700 });
    } catch {
      await wait(200);
    }
  }
  shell = browser.contexts()[0].pages()[0];
  shell.on("pageerror", (e) => errors.push(e.message));
  await shell.setViewportSize({ width: 1400, height: 860 }).catch(() => {});
  await shell
    .getByRole("button", { name: "New notebook…", exact: true })
    .first()
    .waitFor({ timeout: 90000 });
  await shell.getByRole("button", { name: "New notebook…", exact: true }).first().click();
  await shell.getByLabel("Notebook name", { exact: true }).fill("Layout");
  await shell.getByLabel("Notebook name", { exact: true }).press("Enter");
  await shell.waitForSelector("affine-editor-container", { timeout: 60000 });
  await ready();
  await shot("1-new-notebook");
  // Open tabs from the column menu (no + button any more).
  await shell.locator('summary[aria-label="Pane actions"]').first().click();
  await shot("2-column-menu");
  await shell.getByRole("button", { name: "Card Deck", exact: true }).click();
  await ready();
  await shell.locator('summary[aria-label="Pane actions"]').last().click();
  await shell.getByRole("button", { name: "Note", exact: true }).click();
  await shell.locator("[data-note-pane]").waitFor();
  await shot("3-header");
  // Collapse the tools column from its header.
  await shell.locator('.pane-header button[aria-label="Collapse column"]').last().click();
  await shell.waitForTimeout(400);
  await shot("4-rail");
  // Choosing a tab on the rail brings the column back showing it.
  await shell.getByRole("button", { name: "Show Card Deck", exact: true }).click();
  await shell.waitForTimeout(400);
  console.log("after rail click: rails", await shell.locator(".pane-rail").count(), "columns", await shell.locator(".pane-group").count(),
    "tools tab", JSON.stringify(await shell.locator('.pane-group').last().locator('[role="tab"][aria-selected="true"]').textContent()));
  // Export is a dialog.
  await shell.locator('summary[aria-label="Notebook actions"]').click();
  await shell.getByRole("button", { name: "Export", exact: true }).click();
  await shell.locator(".export-dialog").waitFor();
  await shot("5-export");
  console.log(JSON.stringify({ errors }, null, 2));
} catch (error) {
  console.log("FAILED", error.message.slice(0, 200), JSON.stringify(errors));
  if (shell) await shell.screenshot({ path: path.join(root, "failure.png") }).catch(() => {});
  console.log("failure screenshot", path.join(root, "failure.png"));
} finally {
  if (shell)
    await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close")).catch(() => {});
  await browser?.close().catch(() => {});
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
    process.exit(0);
  }, 3000);
}
