import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("test-results/tour-captures-" + Date.now());
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9257",
  },
});
let browser;
try {
  for (let i = 0; i < 120; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9257");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector(".app-shell", { timeout: 60000 });
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
        "false",
    );
  await ready();
  await page.getByRole("button", { name: "New notebook…", exact: true }).click();
  await page.getByLabel("Notebook name", { exact: true }).fill("Reading corner");
  await page.getByLabel("Notebook name", { exact: true }).press("Enter");
  await ready();
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Reading corner");
  await page.getByLabel("Document title", { exact: true }).press("Tab");
  await ready();
  async function crop(name, locators) {
    const boxes = await Promise.all(locators.map((l) => l.boundingBox()));
    const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 12),
      y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 12);
    const right = Math.max(...boxes.map((b) => b.x + b.width)) + 12,
      bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 12;
    await page.screenshot({
      path: `public/getting-started/${name}.png`,
      clip: {
        x,
        y,
        width: Math.min(right, await page.evaluate(() => innerWidth)) - x,
        height: Math.min(bottom, await page.evaluate(() => innerHeight)) - y,
      },
    });
  }
  await crop("views", [
    page.getByRole("button", { name: "Page", exact: true }),
    page.getByRole("button", { name: "Canvas", exact: true }),
  ]);
  await page
    .getByRole("button", { name: "New collection", exact: true })
    .click();
  await page.getByLabel("Collection name", { exact: true }).fill("My projects");
  await crop("create-collection", [
    page.locator(".section-label").first(),
    page.getByRole("dialog", { name: "New collection", exact: true }),
  ]);
  await page
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  await ready();
  await page
    .getByRole("button", {
      name: "Collections for Reading corner",
      exact: true,
    })
    .click();
  await crop("collection-membership", [
    page.getByRole("dialog", {
      name: "Collections for Reading corner",
      exact: true,
    }),
  ]);
  await page.keyboard.press("Escape");
  await page.locator(".document-menu > summary").click();
  await crop("document-actions", [
    page.locator(".document-menu > summary"),
    page.locator(".document-menu .shell-menu-content"),
  ]);
  await page.keyboard.press("Escape");
  console.log(root);
} finally {
  await browser?.close();
  if (child.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$tourApp=Get-Process -Id ${child.pid}; if(-not $tourApp.CloseMainWindow()){throw 'Could not close test app'}; if(-not $tourApp.WaitForExit(30000)){throw 'Test app still saving'}`,
      ],
      { windowsHide: true },
    );
}
