import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/sidebar-drag-${Date.now()}`);
await mkdir(root, { recursive: true });
let child, browser, page;
const errors = [];
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9243",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9243", {
        timeout: 1000,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await access(path.join(root, "Workspace", "knot.db"));
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
  await page.getByRole("button", { name, exact: true }).click();
  await ready();
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child && child.exitCode === null) {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$testApp = Get-Process -Id ${child.pid}; if (-not $testApp.CloseMainWindow()) { throw 'Cannot close test app' }; if (-not $testApp.WaitForExit(30000)) { throw 'Test app did not close' }`,
      ],
      { windowsHide: true },
    );
  }
  child = null;
}
async function rename(title) {
  await page.getByLabel("Document title", { exact: true }).fill(title);
  await page.getByLabel("Document title", { exact: true }).press("Tab");
  await ready();
}
async function add(title, name) {
  await click(`Collections for ${title}`);
  await page.getByLabel("Find or create collection").fill(name);
  await click(`Create “${name}”`);
  await page
    .getByRole("region", { name: `Collection ${name}`, exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
}
const group = (name) =>
  page.getByRole("region", { name: `Collection ${name}`, exact: true });
async function expand(name) {
  const toggle = group(name).getByRole("button", { name, exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}
try {
  await launch();
  await createNotebook(page);
  await rename("Dragged notebook");
  await add("Dragged notebook", "Work");
  await expand("Work");
  await add("Dragged notebook", "Research");
  await expand("Research");
  await click("New collection");
  await page.getByLabel("Collection name", { exact: true }).fill("Personal");
  await click("Create collection");
  await expand("Personal");
  const row = (name) =>
    group(name)
      .locator(".notebook-row")
      .filter({ hasText: "Dragged notebook" });
  const heading = (name) => group(name).locator(".collection-group-heading");
  await row("Work").dragTo(heading("Personal"));
  await ready();
  assert.equal(await row("Work").count(), 0);
  assert.equal(await row("Research").count(), 1);
  assert.equal(await row("Personal").count(), 1);
  await page.keyboard.down("Control");
  await row("Personal").dragTo(heading("Work"));
  await page.keyboard.up("Control");
  await ready();
  assert.equal(await row("Personal").count(), 1);
  assert.equal(await row("Work").count(), 1);
  // Actual pointer drag exposes and highlights the temporary removal target.
  const box = await row("Work").boundingBox();
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 75, box.y + box.height / 2, { steps: 5 });
  const remove = page.locator(".sidebar-remove-drop");
  await remove.waitFor();
  const target = await remove.boundingBox();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 12 },
  );
  await page.mouse.move(
    target.x + target.width / 2 + 1,
    target.y + target.height / 2,
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector(".sidebar-remove-drop")
        ?.getAttribute("data-drop") === "inside",
  );
  await page.screenshot({ path: path.join(root, "remove-indicator.png") });
  await page.mouse.up();
  await ready();
  assert.equal(await row("Work").count(), 0);
  assert.equal(await row("Research").count(), 1);
  const favorites = page.getByRole("region", {
    name: "Favorites",
    exact: true,
  });
  const favoriteRow = favorites
    .locator(".notebook-row")
    .filter({ hasText: "Dragged notebook" });
  await row("Research").dragTo(favorites.locator(".collection-group-heading"));
  await ready();
  assert.equal(await favoriteRow.count(), 1);
  assert.equal(await row("Research").count(), 1);
  assert.equal(await row("Personal").count(), 1);
  await favoriteRow.dragTo(heading("Work"));
  await ready();
  assert.equal(await favoriteRow.count(), 1);
  assert.equal(await row("Work").count(), 1);
  // Favorites has its own removal target; memberships stay untouched.
  const favoriteBox = await favoriteRow.boundingBox();
  await page.mouse.move(
    favoriteBox.x + 60,
    favoriteBox.y + favoriteBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    favoriteBox.x + 75,
    favoriteBox.y + favoriteBox.height / 2,
    { steps: 5 },
  );
  const unfavorite = page.getByRole("button", {
    name: "Remove from Favorites",
    exact: true,
  });
  await unfavorite.waitFor();
  const unfavoriteBox = await unfavorite.boundingBox();
  await page.mouse.move(
    unfavoriteBox.x + 60,
    unfavoriteBox.y + unfavoriteBox.height / 2,
    { steps: 12 },
  );
  await page.mouse.move(
    unfavoriteBox.x + 61,
    unfavoriteBox.y + unfavoriteBox.height / 2,
  );
  await page.mouse.up();
  await ready();
  assert.equal(await favoriteRow.count(), 0);
  assert.equal(await row("Research").count(), 1);
  assert.equal(await row("Work").count(), 1);
  await favorites
    .getByRole("button", { name: "Favorites", exact: true })
    .click();
  await row("Research").dragTo(favorites.locator(".collection-group-heading"));
  await ready();
  await favorites
    .getByRole("button", { name: "Favorites", exact: true })
    .click();
  assert.equal(await favoriteRow.count(), 1);
  await heading("Personal").dragTo(heading("Work"), {
    targetPosition: { x: 70, y: 2 },
  });
  await ready();
  const order = await page.locator(".collection-name").allTextContents();
  assert.ok(order.indexOf("Personal") < order.indexOf("Work"));
  await row("Personal").dragTo(
    page.getByRole("button", { name: "Trash", exact: true }),
  );
  await page
    .getByRole("dialog")
    .filter({ hasText: "Move “Dragged notebook” to Trash?" })
    .waitFor();
  await click("Cancel");
  assert.equal(await row("Research").count(), 1);
  await stop();
  await launch();
  assert.deepEqual(
    await page.locator(".collection-name").allTextContents(),
    order,
  );
  assert.equal(
    await page
      .getByRole("region", { name: "Favorites", exact: true })
      .locator(".notebook-row")
      .filter({ hasText: "Dragged notebook" })
      .count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, root }));
} finally {
  await stop();
}
