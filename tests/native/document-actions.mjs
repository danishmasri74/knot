import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import assert from "node:assert/strict";
const root = path.resolve("test-results/document-actions-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9283",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9283");
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
  const trigger = page.locator(".document-menu > summary");
  const menu = page.locator(".document-menu .shell-menu-content");
  for (const [width, height] of [
    [1920, 1080],
    [1280, 800],
    [760, 540],
  ]) {
    await page.setViewportSize({ width, height });
    await page
      .locator(".topbar")
      .screenshot({ path: path.join(root, `header-${width}.png`) });
    for (const name of ["Browser", "Card Deck", "Delete document"])
      assert.equal(
        await page.getByRole("button", { name, exact: true }).isVisible(),
        false,
      );
    await trigger.click();
    for (const name of [
      "Open tools",
      "Add content",
      "Connections",
      "Read & export",
      "Trash",
    ])
      await menu.getByRole("group", { name, exact: true }).waitFor();
    assert.equal(
      await menu
        .getByRole("button", { name: "Properties", exact: true })
        .count(),
      0,
    );
    const bounds = await menu.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y + bounds.height <= height,
    );
    await page.screenshot({ path: path.join(root, `menu-${width}.png`) });
    await trigger.press("ArrowDown");
    assert.equal(
      await menu
        .getByRole("button", { name: "Browser", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.keyboard.press("End");
    assert.equal(
      await menu
        .getByRole("button", { name: "Delete document", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await menu
        .getByRole("button", { name: "Browser", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await trigger.evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(await page.locator(".document-menu[open]").count(), 0);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const action of ["Card Deck", "Backlinks", "PDF reader"]) {
    await click(action);
    await page.getByRole("tab", { name: action, exact: true }).waitFor();
    assert.equal(await page.locator(".document-menu[open]").count(), 0);
    await page
      .getByRole("button", { name: `Close ${action} tab`, exact: true })
      .click();
  }
  for (const [action, title] of [
    ["Reference", "References"],
    ["Export", "Export document"],
  ]) {
    await click(action);
    await page.getByLabel(title + " surface", { exact: true }).waitFor();
    assert.equal(await page.locator(".document-menu[open]").count(), 0);
    await page
      .getByRole("button", { name: "Close " + title + " panel", exact: true })
      .click();
  }
  await trigger.click();
  await menu
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(
    await trigger.evaluate((e) => e === document.activeElement),
    true,
  );
  await trigger.click();
  await page.locator(".section-label").click();
  assert.equal(await page.locator(".document-menu[open]").count(), 0);
  console.log(
    "PASS grouped document actions, responsive bounds, keyboard navigation/dismissal, outside click, and all panel destinations",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
