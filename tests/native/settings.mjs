import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import assert from "node:assert/strict";
const root = path.resolve("test-results/settings-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9282",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9282");
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
  // Use a plain note: the onboarding document begins with a scaled heading.
  await createNotebook(page);
  const id = await page.evaluate(
    () => document.querySelector("affine-editor-container").doc.id,
  );
  await click("Settings");
  await page.getByRole("heading", { name: "General", exact: true }).waitFor();
  const modal = page.getByRole("dialog", { name: "Settings", exact: true });
  await modal.waitFor();
  assert.equal(await modal.evaluate((el) => el.matches(":modal")), true);
  assert.equal(
    await page
      .locator(".editor-area")
      .evaluate((el) => getComputedStyle(el).visibility),
    "visible",
  );
  await modal.getByRole("button", { name: "Dark", exact: true }).click();
  assert.equal(
    await modal
      .getByRole("button", { name: "Dark", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(".surface-body").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: path.join(root, "settings-dark.png") });
  await modal.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings panel" }).focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await modal.evaluate((el) => el.contains(document.activeElement)),
    true,
  );
  assert.equal(
    await page.getByText("Workspace actions", { exact: true }).count(),
    0,
  );
  for (const [width, height] of [
    [1280, 800],
    [760, 540],
    [480, 640],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator(".surface-body").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: path.join(root, `settings-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.mouse.click(8, 8);
  assert.equal(await page.locator(".settings-modal").count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.querySelector("affine-editor-container").doc.id,
    ),
    id,
  );
  await click("Settings");
  await modal.waitFor();
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await page.getByRole("heading", { name: "Editor", exact: true }).waitFor();
  const originalBlocks = await page.evaluate(() =>
    JSON.stringify(
      document
        .querySelector("affine-editor-container")
        .doc.spaceDoc.getMap("blocks")
        .toJSON(),
    ),
  );
  await page.getByRole("button", { name: "Serif", exact: true }).click();
  const editor = page.locator("affine-editor-container");
  assert.match(
    await editor.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--affine-font-family"),
    ),
    /Georgia/,
  );
  await page.getByLabel("Font size", { exact: true }).fill("20");
  assert.equal(
    await editor.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--affine-font-base"),
    ),
    "20px",
  );
  const paragraphStyle = await page.locator("affine-paragraph rich-text").first().evaluate(el => ({ font: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize }));
  assert.match(paragraphStyle.font, /Georgia/);
  assert.equal(paragraphStyle.size, "20px");
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("Custom font family").fill("Consolas");
  assert.match(
    await editor.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--affine-font-family"),
    ),
    /Consolas/,
  );
  await page.getByRole("switch", { name: "Automatic spell check" }).click();
  assert.equal(await editor.evaluate((el) => el.spellcheck), false);
  assert.equal(
    await editor
      .locator('[contenteditable="true"]')
      .evaluateAll((els) => els.every((el) => !el.spellcheck)),
    true,
  );
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(
        document
          .querySelector("affine-editor-container")
          .doc.spaceDoc.getMap("blocks")
          .toJSON(),
      ),
    ),
    originalBlocks,
  );
  await page.screenshot({ path: path.join(root, "editor-settings.png") });
  await page.getByRole("button", { name: "Close Editor panel" }).click();
  await page.reload();
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
  await click("Settings");
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  assert.equal(
    await page.getByLabel("Custom font family").inputValue(),
    "Consolas",
  );
  assert.equal(
    await page.getByLabel("Font size", { exact: true }).inputValue(),
    "20",
  );
  assert.equal(
    await page.getByRole("switch").getAttribute("aria-checked"),
    "false",
  );
  await page.getByRole("switch").click();
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll('affine-paragraph [contenteditable="true"]'),
    ].every((el) => el.spellcheck),
  );
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await ready();
  await page.getByText("No managed backups yet.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Back up workspace", exact: true })
    .waitFor();
  await click("Create backup");
  assert.equal(await page.locator(".backup-row").count(), 1);
  await click("Verify archive");
  await page.getByText(/Backup verified:/).waitFor();
  await page.screenshot({ path: path.join(root, "settings-backups.png") });
  await page
    .getByRole("button", { name: "Workspace health", exact: true })
    .click();
  await ready();
  await page
    .getByRole("region", { name: "Workspace integrity", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "File recovery", exact: true })
    .click();
  await ready();
  await page
    .getByRole("button", { name: "Close File recovery panel" })
    .press("Escape");
  assert.equal(await page.locator(".tool-surface").count(), 0);
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Settings",
  );
  await click("Trash");
  await page.getByText("Trash is empty.", { exact: true }).waitFor();
  await click("Close Trash & recovery panel");
  assert.equal(
    await page.evaluate(
      () => document.querySelector("affine-editor-container").doc.id,
    ),
    id,
  );
  console.log(
    "PASS settings navigation, backup creation/verification, recovery, Trash, Escape, focus and document continuity",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
