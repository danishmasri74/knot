import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/favorites-${Date.now()}`);
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9294",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9294", {
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
  const favorites = () =>
    page.getByRole("region", { name: "Favorites", exact: true });
  await favorites().getByText("No favorites", { exact: true }).waitFor();
  await createNotebook(page);
  await rename("Favorite notebook");
  await add("Favorite notebook", "Projects");
  await expand("Projects");
  const library = await page.locator(".library").elementHandle();
  const collection = await group("Projects").elementHandle();
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.favoriteCalls = [];
    window.__TAURI_INTERNALS__.invoke = function (command, ...args) {
      window.favoriteCalls.push(command);
      return original.call(this, command, ...args);
    };
  });
  await click("Add notebook to favorites");
  await favorites()
    .getByRole("button", { name: "Favorite notebook", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Remove notebook from favorites" })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await library.evaluate((el) => el === document.querySelector(".library")),
    true,
  );
  assert.equal(await collection.evaluate((el) => el.isConnected), true);
  assert.equal(
    await group("Projects")
      .getByRole("button", { name: "Projects", exact: true })
      .getAttribute("aria-expanded"),
    "true",
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.favoriteCalls.filter((c) =>
        ["filter_objects", "collection_catalog"].includes(c),
      ),
    ),
    [],
  );
  const board = favorites().getByRole("button", {
    name: "Whiteboard",
    exact: true,
  });
  await board.waitFor({ state: "visible" });
  await favorites()
    .getByRole("button", { name: "Collapse Favorite notebook", exact: true })
    .click();
  await board.waitFor({ state: "hidden" });
  await favorites()
    .getByRole("button", { name: "Expand Favorite notebook", exact: true })
    .click();
  await board.waitFor({ state: "visible" });
  await board.click();
  await ready();
  assert.equal(await board.getAttribute("aria-pressed"), "true");
  await click("Favorites");
  await group("Projects")
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await expand("Projects");
  assert.equal(
    await favorites()
      .getByRole("button", { name: "Favorites", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  await click("Favorites");
  await rename("Renamed favorite");
  await favorites()
    .getByRole("button", { name: "Renamed favorite", exact: true })
    .waitFor();
  assert.equal(
    await favorites()
      .getByRole("button", { name: "Favorite notebook", exact: true })
      .count(),
    0,
  );
  await createNotebook(page);
  await favorites()
    .getByRole("button", { name: "Renamed favorite", exact: true })
    .click();
  await ready();
  assert.equal(
    await page.getByLabel("Document title", { exact: true }).inputValue(),
    "Renamed favorite",
  );
  await stop();
  await launch();
  await favorites()
    .getByRole("button", { name: "Renamed favorite", exact: true })
    .click();
  await ready();
  await click("Remove notebook from favorites");
  await favorites().getByText("No favorites", { exact: true }).waitFor();
  await click("Add notebook to favorites");
  await click("Delete document");
  await click("Move to Trash");
  await favorites().getByText("No favorites", { exact: true }).waitFor();
  await click("Trash");
  await click("Restore Renamed favorite");
  await click("Close Trash & recovery panel");
  await favorites()
    .getByRole("button", { name: "Renamed favorite", exact: true })
    .waitFor();
  await favorites()
    .getByRole("button", { name: "Renamed favorite", exact: true })
    .click();
  await ready();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: path.join(root, "favorites.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS favorites: independent expansion, targeted updates, rename, navigation, restart, removal, trash and restore",
    root,
  );
} finally {
  await stop();
}
