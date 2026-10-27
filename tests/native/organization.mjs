import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/organization-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9243",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9243");
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
  await page.getByRole("button", { name, exact: true }).click();
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
async function manage() {
  if (
    !(await page.getByRole("heading", { name: "Folders & tags" }).isVisible())
  )
    await click("Manage folders & tags");
}
async function createLabel(kind, name) {
  await manage();
  await page.getByLabel("Organization type").selectOption(kind);
  await page.getByLabel("Folder or tag name").fill(name);
  await click("Create");
}
async function choose(label, name) {
  await page.getByLabel(label, { exact: true }).selectOption({ label: name });
  await ready();
}
try {
  await launch();
  await createLabel("folder", "Research");
  await createLabel("tag", "Important");
  await click("Close");
  await page.locator(".document-organization summary").click();
  await choose("Document folder", "Research");
  await page.getByRole("checkbox", { name: "Important" }).click();
  await ready();
  await choose("Filter by folder", "Research");
  await choose("Filter by tag", "Important");
  await page.waitForFunction(
    () => document.querySelectorAll(".document-row").length === 1,
  );
  console.log(
    "PASS folder and tag creation, assignment and combined filtering",
  );
  await page.getByLabel("Search titles").fill("No matching title");
  await page
    .getByText("No documents match these filters.", { exact: true })
    .waitFor();
  await page.getByLabel("Search titles").fill("");
  await page.waitForFunction(
    () => document.querySelectorAll(".document-row").length === 1,
  );
  await page.screenshot({ path: path.join(root, "organized.png") });
  await stop();
  await launch();
  await page.locator(".document-organization summary").click();
  assert.equal(
    await page
      .getByLabel("Document folder")
      .locator("option:checked")
      .innerText(),
    "Research",
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "Important" }).isChecked(),
    true,
  );
  console.log("PASS native restart preserves folders and tags");
  await manage();
  await click("Rename Research");
  await page.getByLabel("Folder or tag name").fill("Projects");
  await click("Save name");
  assert.equal(
    await page
      .getByLabel("Document folder")
      .locator("option:checked")
      .innerText(),
    "Projects",
  );
  await choose("Filter by folder", "Projects");
  await click("Delete Projects");
  assert.equal(await page.getByLabel("Document folder").inputValue(), "");
  assert.equal(await page.getByLabel("Filter by folder").inputValue(), "all");
  await page.getByLabel("Organization type").selectOption("tag");
  await choose("Filter by tag", "Important");
  await click("Delete Important");
  assert.equal(await page.getByLabel("Filter by tag").inputValue(), "");
  assert.equal(await page.locator(".document-row").count(), 1);
  await click("Close");
  await choose("Filter by folder", "Unfiled");
  await page.waitForFunction(
    () => document.querySelectorAll(".document-row").length === 1,
  );
  console.log("PASS rename, deletion and filter reset preserve documents");
  await page.screenshot({ path: path.join(root, "verified.png") });
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}

