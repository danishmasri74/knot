import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/collections-${Date.now()}`);
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
  assert.equal(await page.locator(".section-label .library-count").count(), 0);
  await click("New collection");
  assert.equal(
    await page
      .getByRole("button", { name: "Create collection", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel("Collection name", { exact: true })
    .fill("Empty collection");
  await page.getByLabel("Collection name", { exact: true }).press("Enter");
  await ready();
  await group("Empty collection").waitFor();
  assert.equal(
    await page
      .getByRole("dialog", { name: "New collection", exact: true })
      .count(),
    0,
  );
  await click("New collection");
  await page
    .getByLabel("Collection name", { exact: true })
    .fill("Empty collection");
  await click("Create collection");
  await page
    .getByRole("dialog", { name: "New collection", exact: true })
    .getByRole("alert")
    .waitFor();
  await page.keyboard.press("Escape");
  await click("Options for Empty collection");
  assert.deepEqual(
    await page.locator(".collection-action-list button").allTextContents(),
    ["Rename collection", "Delete collection"],
  );
  await page.screenshot({ path: path.join(root, "collection-menu.png") });
  await click("Delete collection");
  await click("Delete collection and keep notebooks");
  await createNotebook(page);
  await rename("Research notebook");
  await add("Research notebook", "Website project");
  await expand("Website project");
  await add("Research notebook", "Customer research");
  await expand("Customer research");
  assert.equal(
    await group("Website project").locator(".document-row").count(),
    1,
  );
  assert.equal(
    await group("Customer research").locator(".document-row").count(),
    1,
  );
  assert.equal(
    await page.locator(".uncollected-notebooks .document-row").count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "All notebooks", exact: true })
      .count(),
    0,
  );
  const website = group("Website project").getByRole("button", {
    name: "Website project",
    exact: true,
  });
  await website.focus();
  await page.keyboard.press("Enter");
  assert.equal(await website.getAttribute("aria-expanded"), "false");
  assert.equal(
    await group("Customer research").locator(".document-row").count(),
    1,
  );
  await expand("Website project");
  await createNotebook(page);
  await rename("Loose notebook");
  assert.equal(
    await page.locator(".uncollected-notebooks .document-row").count(),
    1,
  );
  await createNotebook(page);
  await rename("Design notebook");
  await click("Collections for Design notebook");
  await page
    .getByRole("checkbox", { name: "Website project", exact: true })
    .click();
  await ready();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".collection-group")]
        .find(
          (el) =>
            el.getAttribute("aria-label") === "Collection Website project",
        )
        ?.querySelectorAll(".document-row").length === 2,
  );
  assert.equal(
    await group("Customer research").locator(".document-row").count(),
    1,
  );
  await group("Website project")
    .locator(".document-row")
    .filter({ hasText: "Research notebook" })
    .click();
  await ready();
  assert.equal(
    await group("Website project")
      .getByRole("button", { name: "Whiteboard", exact: true })
      .isVisible(),
    true,
  );
  await website.click();
  assert.equal(
    await page.getByLabel("Document title", { exact: true }).inputValue(),
    "Research notebook",
  );
  await expand("Website project");
  await page.waitForTimeout(300); // Let notebook disclosure finish before visual capture.
  await page.screenshot({ path: path.join(root, "collection-tree.png") });
  await group("Website project")
    .getByRole("button", {
      name: "Collections for Research notebook",
      exact: true,
    })
    .click();
  await page
    .getByRole("checkbox", { name: "Website project", exact: true })
    .click();
  await ready();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".collection-group")]
        .find(
          (el) =>
            el.getAttribute("aria-label") === "Collection Website project",
        )
        ?.querySelectorAll(".document-row").length === 1,
  );
  assert.equal(
    await group("Customer research").locator(".document-row").count(),
    1,
  );
  await click("Options for Website project");
  await click("Rename collection");
  await page.getByLabel("Collection name", { exact: true }).fill("Design work");
  await click("Save name");
  await page.keyboard.press("Escape");
  await stop();
  await launch();
  await expand("Design work");
  await expand("Customer research");
  assert.equal(await group("Design work").locator(".document-row").count(), 1);
  assert.equal(
    await group("Customer research").locator(".document-row").count(),
    1,
  );
  await click("Options for Design work");
  await click("Delete collection");
  await click("Delete collection and keep notebooks");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".uncollected-notebooks .document-row").length ===
      2,
  );
  assert.equal(
    await group("Customer research").locator(".document-row").count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS collection tree: independent expansion, nested notebooks and contents, shared membership, uncollected notebooks, contextual creation, rename, removal, deletion, keyboard and restart",
    root,
  );
} catch (error) {
  if (page && !page.isClosed()) {
    console.log((await page.locator("body").innerText()).slice(0, 5000));
    await page.screenshot({ path: path.join(root, "failure.png") });
  }
  throw error;
} finally {
  await stop();
}
