import { placeLegacyReference } from "./legacy-reference-fixture.mjs";
import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/notebooks-${Date.now()}`);
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9278",
  },
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9278", {
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
  const resizer = page.getByRole("separator", {
    name: "Resize sidebar",
    exact: true,
  });
  await resizer.focus();
  await page.keyboard.press("End");
  assert.equal(await resizer.getAttribute("aria-valuenow"), "400");
  await page.keyboard.press("ArrowRight");
  assert.equal(await resizer.getAttribute("aria-valuenow"), "400");
  await page.keyboard.press("Home");
  assert.equal(await resizer.getAttribute("aria-valuenow"), "200");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await resizer.getAttribute("aria-valuenow"), "200");
  await page.keyboard.press("ArrowRight");
  await page.getByLabel("Collapse sidebar", { exact: true }).click();
  await page.locator(".sidebar").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator(".sidebar-frame").evaluate((el) => el.inert),
    true,
  );
  await page.getByLabel("Expand sidebar", { exact: true }).click();
  await resizer.waitFor({ state: "visible" });
  assert.equal(await resizer.getAttribute("aria-valuenow"), "216");
  await page.waitForTimeout(260);
  const handle = await resizer.boundingBox();
  await page.mouse.move(handle.x + 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x + 800, handle.y + 100, { steps: 8 });
  await page.mouse.up();
  assert.equal(await resizer.getAttribute("aria-valuenow"), "400");
  await page.reload();
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
  assert.equal(await resizer.getAttribute("aria-valuenow"), "400");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".sidebar-frame")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Fail before any edits if the executable does not honor test isolation.
  await access(path.join(root, "Workspace", "knot.db"));
  // The first-run tour lives in a collapsed collection. Use an explicit,
  // uncollected notebook so this suite does not depend on onboarding state.
  await createNotebook(page);
  await ready();
  const ids = await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    const add = (text, displayMode, xywh) => {
      const id = doc.addBlock("affine:note", { displayMode, xywh }, doc.root);
      doc.addBlock("affine:paragraph", { text: new doc.Text(text) }, id);
      return id;
    };
    return [
      add("Research details", "both", "[800,0,448,200]"),
      add("Canvas brainstorm", "edgeless", "[2000,1000,448,200]"),
    ];
  });
  const contents = page.locator(".notebook-contents");
  assert.equal(
    await contents
      .getByRole("button", { name: "Page view", exact: true })
      .count(),
    0,
  );
  const notebookToggle = page.locator('.notebook-toggle[aria-expanded="true"]');
  await notebookToggle.click();
  await contents.waitFor({ state: "detached" });
  await page.locator(".notebook-row:has(.selected) .notebook-toggle").click();
  await contents.waitFor();
  assert.equal(
    await contents
      .getByRole("button", { name: "Whiteboard", exact: true })
      .locator("svg")
      .count(),
    1,
  );
  await page.evaluate(() => {
    window.originalEditor = document.querySelector("affine-editor-container");
    window.originalChildren = document.querySelector(".notebook-contents");
    window.sidebarDisables = 0;
    window.sidebarObserver = new MutationObserver((records) => {
      window.sidebarDisables += records.filter(
        (r) =>
          r.attributeName === "disabled" &&
          r.target.matches(
            ".notebook-contents button, .document-row, .notebook-toggle",
          ),
      ).length;
    });
    window.sidebarObserver.observe(document.querySelector(".sidebar"), {
      attributes: true,
      subtree: true,
    });
  });
  await contents
    .getByRole("button", { name: "Research details", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.notebook-contents button[data-tooltip="Research details"]',
        )
        ?.getAttribute("aria-pressed") === "true",
  );
  await page.locator(".document-row.selected").click();
  await page.waitForTimeout(150);
  assert.deepEqual(
    await page.evaluate(() => ({
      editor:
        window.originalEditor ===
        document.querySelector("affine-editor-container"),
      children:
        window.originalChildren ===
        document.querySelector(".notebook-contents"),
      disables: window.sidebarDisables,
    })),
    { editor: true, children: true, disables: 0 },
  );
  await page.evaluate(() => window.sidebarObserver.disconnect());

  await ready();
  assert.equal(
    await page.evaluate(
      () => document.querySelector("affine-editor-container").mode,
    ),
    "page",
  );
  assert.ok(await page.locator(`[data-block-id="${ids[0]}"]`).isVisible());
  assert.equal(await page.locator("affine-page-root affine-note").count(), 1);
  assert.equal(await page.locator("doc-title").isVisible(), true);
  assert.equal(await contents.getByText("Hidden in page").count(), 0);
  assert.equal(await contents.getByText(/Viewing one note/).count(), 0);
  const titleEditor = page.locator("doc-title [contenteditable=true]");
  await titleEditor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Focused notebook title");
  await page
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
  await ready();
  assert.equal(
    await page.getByLabel("Document title", { exact: true }).inputValue(),
    "Focused notebook title",
  );
  await contents.getByRole("button", { name: "Canvas brainstorm" }).click();
  await ready();
  assert.equal(
    await page.evaluate(
      () => document.querySelector("affine-editor-container").mode,
    ),
    "page",
  );
  const canvasNote = page.locator(`[data-block-id="${ids[1]}"]`);
  assert.ok(await canvasNote.isVisible());
  assert.equal(await page.locator(`[data-block-id="${ids[0]}"]`).count(), 0);
  assert.equal(await page.locator("affine-page-root affine-note").count(), 1);
  const visibility = () =>
    page.evaluate(
      (id) =>
        document.querySelector("affine-editor-container").doc.getBlock(id).model
          .displayMode,
      ids[1],
    );
  assert.equal(await visibility(), "edgeless");
  await canvasNote.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited in Page");
  await page
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
  await ready();
  assert.equal(await visibility(), "edgeless");
  await page.screenshot({ path: path.join(root, "revealed-note.png") });
  await page
    .locator(".mode-switch")
    .getByRole("button", { name: "Page", exact: true })
    .click();
  await ready();
  await canvasNote.waitFor({ state: "detached" });
  assert.ok(await page.locator(`[data-block-id="${ids[0]}"]`).isVisible());
  assert.ok(await page.locator("doc-title").isVisible());
  await contents
    .getByRole("button", { name: "Whiteboard", exact: true })
    .click();
  await ready();
  await page.evaluate((id) => {
    document
      .querySelector("affine-edgeless-root")
      .gfx.selection.set({ elements: [id], editing: false });
  }, ids[1]);
  await page
    .locator(".mode-switch")
    .getByRole("button", { name: "Page", exact: true })
    .click();
  await ready();
  assert.ok(await canvasNote.isVisible());
  assert.equal(await visibility(), "edgeless");
  assert.ok((await canvasNote.textContent()).includes("edited in Page"));
  await canvasNote.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.press("Control+a");
  assert.ok(
    await page.evaluate((id) => {
      const editor = document.querySelector("affine-editor-container");
      const childId = editor.doc.getBlock(id).model.children[0].id;
      return (
        editor.std.selection.value.length === 1 &&
        editor.std.selection.value.every(
          (selection) => selection.blockId === childId,
        )
      );
    }, ids[1]),
  );
  await contents
    .getByRole("button", { name: "Research details", exact: true })
    .click();
  await ready();
  await canvasNote.waitFor({ state: "detached" });
  await page.reload();
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
  await canvasNote.waitFor({ state: "detached" });
  assert.equal(await visibility(), "edgeless");
  await contents
    .getByRole("button", {
      name: "Canvas brainstorm edited in Page",
      exact: true,
    })
    .waitFor();
  await page.evaluate((id) => {
    const doc = document.querySelector("affine-editor-container").doc;
    const paragraph = doc.getBlock(id).model.children[0];
    paragraph.text.replace(0, paragraph.text.length, "Updated research");
  }, ids[0]);
  await contents
    .getByRole("button", { name: "Updated research", exact: true })
    .waitFor();
  await page.evaluate((id) => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc.deleteBlock(doc.getBlock(id).model);
  }, ids[1]);
  await contents
    .getByRole("button", {
      name: "Canvas brainstorm edited in Page",
    })
    .waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
  await ready();
  await page.screenshot({ path: path.join(root, "notebook.png") });
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Research notebook");
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
  await createNotebook(page, true);
  await ready();
  await placeLegacyReference(page, "Research notebook");
  await ready();
  await contents
    .getByRole("button", { name: "Research notebook Linked", exact: true })
    .click();
  await ready();
  assert.equal(
    await page.getByLabel("Document title", { exact: true }).inputValue(),
    "Research notebook",
  );
  await contents
    .getByRole("button", { name: "Updated research", exact: true })
    .waitFor();
  await page.reload();
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
  await page
    .locator(".document-row")
    .filter({ hasText: "Research notebook" })
    .click();
  await ready();
  await contents
    .getByRole("button", { name: "Updated research", exact: true })
    .waitFor();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc.transact(() => {
      for (let i = 0; i < 150; i++) {
        const id = doc.addBlock("affine:note", {}, doc.root);
        doc.addBlock(
          "affine:paragraph",
          { text: new doc.Text(`Long list ${i}`) },
          id,
        );
      }
    });
  });
  await contents
    .getByRole("button", { name: "Long list 149", exact: true })
    .waitFor();
  await page.locator('.notebook-toggle[aria-expanded="true"]').click();
  await contents.waitFor({ state: "detached" });
  await page.locator(".notebook-row:has(.selected) .notebook-toggle").click();
  await contents
    .getByRole("button", { name: "Long list 149", exact: true })
    .waitFor();
  assert.equal(
    await contents.locator('button[data-tooltip^="Long list "]').count(),
    150,
  );
  await page.screenshot({ path: path.join(root, "long-notebook.png") });
  await page.evaluate(() => {
    const old = document.querySelector(
      '.animated-disclosure[data-expanded="true"]',
    );
    window.foldSamples = [];
    const observer = new MutationObserver(() => {
      if (old.getAttribute("data-expanded") !== "false") return;
      observer.disconnect();
      const sample = () => {
        window.foldSamples.push({
          height: old.getBoundingClientRect().height,
          connected: old.isConnected,
          text: old.textContent,
        });
        if (window.foldSamples.length < 30) requestAnimationFrame(sample);
      };
      sample();
    });
    observer.observe(old, {
      attributes: true,
      attributeFilter: ["data-expanded"],
    });
  });
  await createNotebook(page);
  await ready();
  await page.waitForFunction(() => window.foldSamples.length >= 30);
  const samples = await page.evaluate(() => window.foldSamples);
  assert.ok(
    samples[0].height === 0,
    "Previous notebook closes without animating the entire list height",
  );
  assert.ok(
    samples[0].text.includes("Updated research"),
    "Previous notebook keeps its own contents while closing",
  );
  assert.ok(
    samples.every((sample) => sample.connected),
    "Disclosure stays mounted during navigation",
  );
  assert.ok(
    samples.every((sample) => sample.height === 0),
    "Closing does not repeatedly relayout a long notebook list",
  );
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(
        '.animated-disclosure[data-expanded="false"]',
      ),
    ].every((el) => el.getBoundingClientRect().height === 0),
  );
  console.log("Notebook navigation passed:", root);
} finally {
  await browser?.close();
  if (child.pid)
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
}
