import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/panels-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9271",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9271", {
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
  await clickShellButton(page, name);
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
    await ready();
    return;
  }
  await page.getByLabel(label, { exact: true }).click();
  await click(action);
}
async function rename(title) {
  await page.getByLabel("Document title", { exact: true }).fill(title);
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
}
const id = () =>
  page.evaluate(() => document.querySelector("affine-editor-container").doc.id);
async function geometry(label) {
  const result = await page.evaluate(() => {
    const rect = (s) =>
      document.querySelector(s).getBoundingClientRect().toJSON();
    return {
      header: rect(".topbar"),
      editor: rect(".editor-area"),
      footer: rect(".sidebar-footer"),
      overflow: document.documentElement.scrollWidth > innerWidth,
      sidebar:
        document.querySelector(".sidebar").scrollHeight >
        document.querySelector(".sidebar").clientHeight,
    };
  });
  assert.equal(result.editor.y, result.header.bottom, label);
  assert.equal(result.overflow, false);
  assert.equal(result.sidebar, false);
  assert.ok(result.footer.bottom <= page.viewportSize().height);
  await page.screenshot({ path: path.join(root, label + ".png") });
}
try {
  await launch();
  for (const name of ["Undo", "Redo"]) {
    assert.equal(
      await page
        .locator(".topbar")
        .getByRole("button", { name, exact: true })
        .isVisible(),
      true,
    );
  }
  await page.setViewportSize({ width: 760, height: 540 });
  for (const name of ["Undo", "Redo"]) {
    const box = await page
      .locator(".topbar")
      .getByRole("button", { name, exact: true })
      .boundingBox();
    assert.ok(
      box && box.x >= 0 && box.x + box.width <= 760,
      `${name} fits the smallest window`,
    );
  }
  await page.screenshot({ path: path.join(root, "quick-actions-narrow.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await createNotebook(page);
  await ready();
  const first = await id();
  await rename("Panel continuity");
  const snapshot = () =>
    page.evaluate(() =>
      JSON.stringify(
        document
          .querySelector("affine-editor-container")
          .doc.spaceDoc.getMap("blocks")
          .toJSON(),
      ),
    );
  const before = await snapshot();
  await click("Switch workspace");
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal(await page.locator(".workspace-surface").count(), 1);
  await click("Close Workspaces panel");
  assert.equal(await id(), first);
  assert.equal(await snapshot(), before);
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await geometry(`default-${width}`);
    await menu("Document actions", "Backlinks");
    await page.locator(".backlinks-panel").waitFor();
    assert.equal(
      await page.locator('.workspace-panes[data-collapsed="false"]').count(),
      1,
    );
    const bounds = await page.evaluate(() => {
      const rect = (s) =>
        document.querySelector(s).getBoundingClientRect().toJSON();
      return {
        panel: rect(".workspace-panes"),
        editor: rect(".editor-area"),
        header: rect(".topbar"),
      };
    });
    assert.equal(bounds.panel.y, bounds.header.bottom);
    assert.equal(bounds.editor.y, bounds.header.bottom);
    assert.ok(bounds.editor.right <= bounds.panel.x + 1);
    const handle = page.getByRole("separator", {
      name: "Resize supporting pane",
    });
    const previousWidth = Number(await handle.getAttribute("aria-valuenow"));
    await handle.focus();
    await handle.press("ArrowLeft");
    assert.ok(
      Number(await handle.getAttribute("aria-valuenow")) > previousWidth,
    );
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + 4, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 80, { steps: 8 });
    await page.mouse.up();
    assert.equal(await id(), first);
    assert.equal(await snapshot(), before);
    await page.screenshot({ path: path.join(root, `properties-${width}.png`) });
    await click("Canvas");
    await page.screenshot({
      path: path.join(root, `canvas-panel-${width}.png`),
    });
    await click("Page");
    await click("Close Links tab");
    assert.equal(
      await page
        .locator(".document-menu summary")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await menu("Document actions", "PDF reader");
    await page
      .getByText("Attach a PDF to this document first.", { exact: true })
      .waitFor();
    await menu("Document actions", "PDF reader");
    assert.equal(await page.locator(".pdf-reader").count(), 0);
    assert.equal(
      await page.locator('.workspace-panes[data-collapsed="false"]').count(),
      1,
    );
    await page
      .getByText("Attach a PDF to this document first.", {
        exact: true,
      })
      .waitFor();
    await page.getByRole("button", { name: "Close PDF reader tab" }).click();
    assert.equal(await page.locator(".tool-surface").count(), 0);
  }
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search workspace" })
    .fill("no match");
  await page.getByText("No results found.").waitFor();
  await page.screenshot({ path: path.join(root, "empty-search.png") });
  await page.getByRole("combobox", { name: "Search workspace" }).fill("");
  await click("Close search");
  await menu("Workspace actions", "Trash & recovery");
  await page.getByText("Trash is empty.", { exact: true }).waitFor();
  assert.equal(await page.locator(".management-surface").count(), 1);
  await page.screenshot({ path: path.join(root, "empty-trash.png") });
  await click("Close Trash & recovery panel");
  assert.equal(
    await page
      .getByRole("button", { name: "Trash", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await menu("Document actions", "Links");
  await page.getByRole("searchbox", { name: "Find a notebook" }).waitFor();
  await createNotebook(page);
  assert.equal(await page.locator(".tool-surface").count(), 0);
  await click("Go back");
  assert.equal(await id(), first);
  assert.equal(await snapshot(), before);
  await menu("Document actions", "Export");
  await createNotebook(page, true);
  assert.equal(await page.locator(".tool-surface").count(), 0);
  await rename("Surface recovery target");
  await menu("Workspace actions", "Check workspace");
  await click("Close Workspace health panel");
  await click("Delete document");
  await menu("Workspace actions", "Trash & recovery");
  await click("Restore Surface recovery target");
  assert.equal(
    await page.getByLabel("Trash & recovery surface", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("region", { name: "Workspace integrity", exact: true })
      .count(),
    0,
  );
  await page.screenshot({ path: path.join(root, "restored-trash.png") });
  console.log(
    "PASS exclusive panels, resize, focus restoration, editor continuity, empty readers/search/Trash, and destination clearing",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
