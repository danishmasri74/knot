// Native-app regression, using a debug build for isolated data and normal close/save.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createNotebook } from "./create-notebook.mjs";

const root = path.resolve(`test-results/search-location-${Date.now()}`);
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9274",
    KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9274",
  },
});
let browser;
let page;
const ready = () =>
  page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".editor-area")?.getAttribute("aria-busy") !== "true",
  );
async function search(query) {
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search workspace" }).fill(query);
  await page.waitForFunction(
    () =>
      document
        .querySelector("#global-search-results")
        ?.getAttribute("aria-busy") === "false",
  );
}
async function assertLocation(id) {
  await ready();
  await page.waitForFunction((id) => {
    const editor = document.querySelector("affine-editor-container");
    const canvas = editor?.querySelector("affine-edgeless-root");
    return (
      editor?.mode === "edgeless" &&
      canvas?.gfx.selection.selectedElements.some(
        (element) => element.id === id,
      )
    );
  }, id);
  const state = await page.evaluate((id) => {
    const editor = document.querySelector("affine-editor-container");
    const canvas = editor.querySelector("affine-edgeless-root");
    const [x, y, w, h] = JSON.parse(editor.doc.getBlock(id).model.xywh);
    const center = canvas.service.viewport.center;
    return { actual: [center.x, center.y], expected: [x + w / 2, y + h / 2] };
  }, id);
  assert.ok(
    Math.abs(state.actual[0] - state.expected[0]) < 1,
    JSON.stringify(state),
  );
  assert.ok(
    Math.abs(state.actual[1] - state.expected[1]) < 1,
    JSON.stringify(state),
  );
  assert.equal(
    await page.getByRole("dialog", { name: "Search workspace" }).count(),
    0,
  );
}
async function assertPageNote(id) {
  await page.waitForFunction((id) => {
    const editor = document.querySelector("affine-editor-container");
    const notes = editor?.querySelectorAll("affine-page-root affine-note");
    return (
      editor?.mode === "page" &&
      notes?.length === 1 &&
      notes[0].getAttribute("data-block-id") === id
    );
  }, id);
  await ready();
}
try {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9274");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(browser, "Packaged app did not start");
  page = browser.contexts()[0].pages()[0];
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
  await access(path.join(root, "Workspace", "knot.db"));
  await createNotebook(page);
  const title = page.getByLabel("Document title", { exact: true });
  await title.fill("Location notebook");
  await title.press("Enter");
  await ready();
  const fixture = await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    const add = (text, xywh, displayMode) => {
      const id = doc.addBlock("affine:note", { xywh, displayMode }, doc.root);
      doc.addBlock("affine:paragraph", { text: new doc.Text(text) }, id);
      return id;
    };
    return {
      notebook: doc.id,
      first: add("Quasar first note", "[9000,-4000,448,200]", "both"),
      second: add("Quasar canvas note", "[-8000,6000,448,200]", "edgeless"),
    };
  });
  await search("quasar");
  const options = page
    .getByRole("dialog", { name: "Search workspace" })
    .getByRole("option");
  assert.equal(await options.count(), 2);
  await page.getByRole("combobox").press("Enter");
  await assertPageNote(fixture.first);
  await search("Quasar first");
  await page.getByRole("button", { name: "Show on canvas", exact: true }).click();
  await assertLocation(fixture.first);
  await search("Quasar first");
  await page.getByRole("combobox").press("Enter");
  await assertPageNote(fixture.first);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
    const picker = page.getByLabel("Open notes in", { exact: true });
    await picker.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    assert.equal(await picker.inputValue(), "page");
    await picker.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.equal(await picker.inputValue(), "edgeless");
    await picker.click();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: path.join(root, `note-view-${colorScheme}.png`) });
  }
  await page.getByLabel("Open notes in", { exact: true }).selectOption("edgeless");
  await page.getByRole("button", { name: "Close Settings panel", exact: true }).click();
  await search("Quasar first");
  await page.getByRole("combobox").press("Enter");
  await assertLocation(fixture.first);
  await page.locator(".notebook-contents").getByRole("button", { name: "Quasar canvas note", exact: true }).click();
  await assertLocation(fixture.second);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Open notes in", { exact: true }).selectOption("page");
  await page.getByRole("button", { name: "Close Settings panel", exact: true }).click();
  await page.locator(".notebook-contents").getByRole("button", { name: "Quasar first note", exact: true }).click();
  await assertPageNote(fixture.first);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Open notes in", { exact: true }).selectOption("edgeless");
  await page.getByRole("button", { name: "Close Settings panel", exact: true }).click();
  await search("Quasar first");
  await page.getByRole("combobox").press("Enter");
  await assertLocation(fixture.first);
  // Search can restore focus to shell controls while leaving the card selected.
  await page
    .locator(".mode-switch")
    .getByRole("button", { name: "Canvas", exact: true })
    .focus();
  await page.keyboard.press("Control+Enter");
  await assertPageNote(fixture.first);
  await search("quasar");
  await options.filter({ hasText: "Quasar canvas note" }).click();
  await assertLocation(fixture.second);
  // The shortcut also opens the note while editing its text.
  const originalText = await page.evaluate((id) => {
    const editor = document.querySelector("affine-editor-container");
    const canvas = editor.querySelector("affine-edgeless-root");
    canvas.gfx.selection.set({ elements: [id], editing: true });
    const block = editor.doc.getBlock(id).model.children[0];
    return block.text.toString();
  }, fixture.second);
  await page
    .locator(`[data-block-id="${fixture.second}"] [contenteditable=true]`)
    .first()
    .focus();
  await page.keyboard.press("Control+Enter");
  await assertPageNote(fixture.second);
  assert.equal(
    await page.evaluate(
      (id) =>
        document
          .querySelector("affine-editor-container")
          .doc.getBlock(id)
          .model.children[0].text.toString(),
      fixture.second,
    ),
    originalText,
  );
  // Selection may clear as the canvas blurs, before the transition paints.
  await search("Quasar first");
  await page.getByRole("combobox").press("Enter");
  await assertLocation(fixture.first);
  await page.evaluate(() => {
    const editor = document.querySelector("affine-editor-container");
    const canvas = editor.querySelector("affine-edgeless-root");
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    canvas.gfx.selection.clear();
  });
  await assertPageNote(fixture.first);
  // Navigate away, then exercise the cross-notebook route from page view.
  await createNotebook(page);
  await search("Quasar first");
  await page.getByRole("combobox").press("Enter");
  await assertLocation(fixture.first);
  assert.equal(
    await page.evaluate(
      () => document.querySelector("affine-editor-container").doc.id,
    ),
    fixture.notebook,
  );
  await page.getByLabel("Document title", { exact: true }).focus();
  await page.keyboard.press("Control+Enter");
  assert.equal(
    await page.evaluate(
      () => document.querySelector("affine-editor-container").mode,
    ),
    "edgeless",
  );
  await page.evaluate(({ first, second }) => {
    const editor = document.querySelector("affine-editor-container");
    editor
      .querySelector("affine-edgeless-root")
      .gfx.selection.set({ elements: [first, second], editing: false });
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
  }, fixture);
  assert.equal(
    await page.evaluate(
      () => document.querySelector("affine-editor-container").mode,
    ),
    "edgeless",
  );
  await search("Location notebook");
  assert.equal(await options.count(), 1);
  await options.first().click();
  await ready();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.getByRole("button", { name: "Card Deck", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview Quasar canvas note", exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: "List view", exact: true }).count(),
    0,
  );
  const previewBounds = await page
    .getByRole("dialog", { name: "Quasar canvas note", exact: true })
    .evaluate(async (el) => {
      await Promise.all(
        el
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      );
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        vw: innerWidth,
        vh: innerHeight,
      };
    });
  assert.ok(
    Math.abs(previewBounds.x + previewBounds.w / 2 - previewBounds.vw / 2) < 2,
    JSON.stringify(previewBounds),
  );
  assert.ok(
    Math.abs(previewBounds.y + previewBounds.h / 2 - previewBounds.vh / 2) < 2,
    JSON.stringify(previewBounds),
  );
  await page
    .getByRole("dialog", { name: "Quasar canvas note", exact: true })
    .getByRole("button", { name: "Open in notebook", exact: true })
    .click();
  await assertLocation(fixture.second);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.getByRole("button", { name: "Card Deck", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview Quasar canvas note", exact: true })
    .click();
  const preview = page.getByRole("dialog", {
    name: "Quasar canvas note",
    exact: true,
  });
  await preview
    .getByRole("button", { name: "Add to notebook…", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Location notebook", exact: true })
    .click();
  await ready();
  await page.waitForFunction((id) => {
    const editor = document.querySelector("affine-editor-container");
    const links = editor.doc.spaceDoc.getMap("knot:card-links");
    const shared = links.get(id);
    const selected = editor.querySelector("affine-edgeless-root")?.gfx.selection
      .selectedElements[0];
    return (
      editor.mode === "edgeless" &&
      selected &&
      selected.id !== id &&
      links.get(selected.id) === shared &&
      [...links.values()].filter((value) => value === shared).length === 2
    );
  }, fixture.second);
  const placed = await page.evaluate((id) => {
    const editor = document.querySelector("affine-editor-container");
    const selected = editor.querySelector("affine-edgeless-root").gfx.selection
      .selectedElements[0];
    return {
      id: selected.id,
      text: selected.children[0].text.toString(),
      original: editor.doc.getBlock(id).model.children[0].text.toString(),
    };
  }, fixture.second);
  assert.notEqual(placed.id, fixture.second);
  assert.equal(placed.text, placed.original);
  console.log(
    "PASS search canvas navigation, Ctrl+Enter focus/races, Library Card Deck grid, opening exact notes, and adding a shared card to a notebook",
  );
  console.log(`TEST WORKSPACE ${root}`);
} finally {
  // React may paint aria-busy=false before the operation's finally unlocks close.
  if (page && !page.isClosed()) await page.waitForTimeout(300);
  if (page && !page.isClosed())
    await page
      .evaluate(async () => {
        const { getCurrentWindow } = window.__TAURI__?.window ?? {};
        if (getCurrentWindow) await getCurrentWindow().close();
        else
          await window.__TAURI_INTERNALS__.invoke("plugin:window|close", {
            label: "main",
          });
      })
      .catch(() => {});
  await browser?.close();
  if (child.exitCode === null)
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 10000).unref();
    });
}

