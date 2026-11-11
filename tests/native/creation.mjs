import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/creation-${Date.now()}`);
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9297",
  },
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9297", {
        timeout: 1000,
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(browser);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
        "false",
    );
  await ready();
  await access(path.join(root, "Workspace", "knot.db"));
  const snapshot = () =>
    page.evaluate(() => {
      const doc = document.querySelector("affine-editor-container").doc;
      return {
        id: doc.id,
        notes: doc
          .getBlocksByFlavour("affine:note")
          .map(({ model }) => model.id),
      };
    });
  const before = await snapshot();
  assert.equal(
    await page
      .getByRole("button", { name: "New whiteboard", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await ready();
  const added = await snapshot();
  assert.equal(added.id, before.id);
  assert.equal(added.notes.length, before.notes.length + 1);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await ready();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await ready();
  assert.equal((await snapshot()).id, before.id);
  assert.equal((await snapshot()).notes.length, before.notes.length + 2);
  assert.equal(
    await page
      .getByRole("button", { name: "Page", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "New notebook…", exact: true }).click();
  await page
    .getByLabel("Notebook name", { exact: true })
    .fill("Separate project");
  await page.screenshot({ path: path.join(root, "new-notebook.png") });
  await page.getByLabel("Notebook name", { exact: true }).press("Escape");
  assert.equal((await snapshot()).id, before.id);
  await page.getByRole("button", { name: "New notebook…", exact: true }).click();
  await page.getByLabel("Notebook name", { exact: true }).press("Enter");
  await ready();
  const created = await snapshot();
  assert.notEqual(created.id, before.id);
  assert.equal(created.notes.length, 1);
  assert.equal(
    await page.getByLabel("Document title", { exact: true }).inputValue(),
    "Separate project",
  );
  await page.reload();
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
  assert.equal((await snapshot()).id, created.id);
  await page.screenshot({ path: path.join(root, "created.png") });
  console.log("Creation actions passed:", root);
} finally {
  if (browser) {
    await browser.close();
  }
  if (child.pid) {
    const { execFileSync } = await import("node:child_process");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-Process -Id ${child.pid}).CloseMainWindow()`,
      ],
      { stdio: "ignore", windowsHide: true },
    );
  }
}
