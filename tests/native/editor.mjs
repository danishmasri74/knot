import { placeLegacyReference } from "./legacy-reference-fixture.mjs";
import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { clickShellButton } from "./shell-navigation.mjs";
const root = path.resolve("test-results/editor-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
const results = [];
const record = (text) => {
  results.push(text);
  console.log("PASS", text);
};
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9274",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9274");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector("affine-editor-container", { timeout: 60000 });
  await ready();
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child?.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch (e) {
      console.log("Cleanup:", e.message);
    }
  }
  child = null;
}
async function ready() {
  await page.waitForFunction(
    () => document.querySelector(".primary")?.disabled === false,
  );
}
async function save() {
  await page.getByRole("button", { name: "Save now / retry", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
}
async function state() {
  return page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    return {
      id: doc.id,
      blocks: doc.spaceDoc.getMap("blocks").toJSON(),
      elements: doc
        .getBlocksByFlavour("affine:surface")[0]
        .model.elementModels.map((e) => ({
          id: e.id,
          type: e.type,
          xywh: e.xywh,
        })),
    };
  });
}
async function drag(x, y, dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(dx, dy, { steps: 15 });
  await page.mouse.up();
}
async function shot(name) {
  await page.screenshot({ path: path.join(root, name + ".png") });
}
async function mode(name) {
  await page.getByRole("button", { name, exact: false }).first().click();
  await page.waitForSelector(
    name === "Page" ? "affine-page-root" : "affine-edgeless-root",
  );
}
const nativeTools = {
  "Shape (S)": "edgeless-shape-tool-button .shapes",
  "Pen (P)": "edgeless-brush-tool-button .pen-wrapper",
  "Note (N)": "edgeless-note-senior-button .note-root",
  "Connector (C)": "edgeless-connector-tool-button",
  "Text and mind map": "edgeless-mindmap-tool-button",
  "Select / Hand (V / H)": "edgeless-default-tool-button",
  "Zoom controls": "zoom-bar-toggle-button",
  "Next tools": "edgeless-toolbar-widget .next icon-button",
};
const tool = (name) =>
  nativeTools[name]
    ? page.locator(nativeTools[name])
    : name === "Zoom in" || name === "Fit to screen"
      ? page
          .locator("edgeless-zoom-toolbar edgeless-tool-icon-button")
          .filter({ has: page.locator("affine-tooltip", { hasText: name }) })
      : page.getByRole("button", { name, exact: true });
async function view() {
  return page.evaluate(() => {
    const r = document.querySelector("affine-edgeless-root");
    const v = r.gfx.viewport;
    return {
      zoom: v.zoom,
      center: [v.centerX, v.centerY],
      id: document.querySelector("affine-editor-container").doc.id,
    };
  });
}
try {
  await launch();
  await mode("Page");
  await page.waitForSelector("affine-paragraph");
  await shot("page-empty");
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Editor refinement");
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
  const editable = page
    .locator("affine-paragraph [contenteditable=true]")
    .first();
  await editable.click();
  await page.keyboard.type("A readable page with native formatting.");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  assert.ok(
    await page.evaluate(() =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:paragraph")[0]
        .model.text.toDelta()
        .some((d) => d.attributes?.bold),
    ),
  );
  await editable.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/heading");
  await page.locator("inner-slash-menu").getByTestId("Heading 2").click();
  await page.keyboard.type("A native heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type(
    "Body text keeps a comfortable measure beside contextual tools.",
  );
  await save();
  assert.ok(
    Object.values((await state()).blocks).some(
      (b) => b["prop:type"] === "h2" && b["prop:text"] === "A native heading",
    ),
  );
  await shot("page-populated");
  const pageState = await state();
  const width = await page
    .locator(".doc-title-container")
    .evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(width <= 800);
  record(
    "Visible page typing, keyboard bold, slash heading insertion and reading width",
  );
  // Activate the actual attachment entry point; setInputFiles supplies the native chooser result.
  await page.getByLabel("Document actions",{exact:true}).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    tool("Attach").click(),
  ]);
  await chooser.setFiles(path.resolve("tests/fixtures/knot.png"));
  await save();
  assert.ok(
    Object.values((await state()).blocks).some(
      (b) => b["sys:flavour"] === "affine:image",
    ),
  );
  record("Attachment entry point imports an image");
  await mode("Canvas");
  assert.equal((await state()).id, pageState.id);
  await createNotebook(page, true);
  await ready();
  await page.waitForSelector("affine-edgeless-root");
  const boardId = (await state()).id;
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Refinement board");
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
  await shot("canvas-empty");
  const toolbar = page.locator(
    "edgeless-toolbar-widget .edgeless-toolbar-container",
  );
  assert.equal(Math.round((await toolbar.boundingBox()).height), 64);
  for (const selector of [
    ".note-root",
    ".pen-wrapper",
    ".eraser-button",
    ".edgeless-shape-draggable",
    ".partial-clip",
    ".template-cards",
  ]) {
    assert.equal(
      await toolbar
        .locator(selector)
        .evaluate((el) => getComputedStyle(el, "::after").content),
      "none",
    );
  }
  assert.ok(await toolbar.locator(".pen-wrapper svg").isVisible());
  record(
    "Default BlockSuite toolbar height and illustrations, without custom labels",
  );
  await tool("Shape (S)").click();
  await drag(580, 220, 740, 320);
  await page.keyboard.press("Escape");
  let shapes = (await state()).elements.filter((e) => e.type === "shape");
  assert.equal(shapes.length, 1);
  const shapeId = shapes[0].id;
  await tool("Pen (P)").click();
  await drag(580, 580, 740, 620);
  await page.keyboard.press("Escape");
  assert.equal(
    (await state()).elements.filter((e) => e.type === "brush").length,
    1,
  );
  await tool("Note (N)").click();
  await page.mouse.click(900, 240);
  await page.keyboard.type("Pointer note card");
  await page.keyboard.press("Escape");
  assert.ok(
    JSON.stringify((await state()).blocks).includes("Pointer note card"),
  );
  await tool("Connector (C)").click();
  await drag(660, 270, 930, 270);
  await page.keyboard.press("Escape");
  assert.equal(
    (await state()).elements.filter((e) => e.type === "connector").length,
    1,
  );
  const textTool = page.locator(
    "edgeless-mindmap-tool-button .basket-tool-item.current.text",
  );
  await textTool.hover();
  await page.waitForTimeout(350);
  const text = await textTool.boundingBox();
  await drag(text.x + text.width / 2, text.y + text.height / 2, 950, 550);
  await page.waitForFunction(
    () =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:edgeless-text").length > 0,
  );
  await page.keyboard.type("Canvas text");
  await page.keyboard.press("Escape");
  assert.ok(
    Object.values((await state()).blocks).some(
      (b) => b["sys:flavour"] === "affine:edgeless-text",
    ),
  );
  record(
    "Pointer shape, connector, note and text creation; native Pen/Note activation and freehand stroke",
  );
  // Selection and movement use actual canvas coordinates, never model mutation.
  const [shapeX, shapeY] = await page.evaluate((id) => {
    const root = document.querySelector("affine-edgeless-root");
    const shape = root.gfx.getElementById(id);
    const [x, y, width, height] = JSON.parse(shape.xywh);
    const [vx, vy] = root.gfx.viewport.toViewCoord(
      x + width / 2,
      y + height / 2,
    );
    const rect = root.getBoundingClientRect();
    return [vx + rect.left, vy + rect.top];
  }, shapeId);
  await page.mouse.click(shapeX, shapeY);
  await shot("canvas-selected");
  const oldBounds = (await state()).elements.find((e) => e.id === shapeId).xywh;
  await drag(shapeX, shapeY, shapeX + 40, shapeY + 60);
  assert.notEqual(
    (await state()).elements.find((e) => e.id === shapeId).xywh,
    oldBounds,
  );
  await save();
  const movedBounds = (await state()).elements.find(
    (e) => e.id === shapeId,
  ).xywh;
  await clickShellButton(page, "Undo");
  await save();
  assert.equal(
    (await state()).elements.find((e) => e.id === shapeId).xywh,
    oldBounds,
  );
  await clickShellButton(page, "Redo");
  await save();
  assert.equal(
    (await state()).elements.find((e) => e.id === shapeId).xywh,
    movedBounds,
  );
  record(
    "Pointer selection/movement and visible Undo/Redo preserve the same object",
  );
  await page.keyboard.press("Escape");
  await tool("Zoom controls").click();
  const zoomBefore = (await view()).zoom;
  await tool("Zoom in").filter({ visible: true }).click();
  await page.waitForTimeout(400);
  assert.ok((await view()).zoom > zoomBefore);
  if (!(await tool("Fit to screen").filter({ visible: true }).count()))
    await tool("Zoom controls").click();
  await tool("Fit to screen").filter({ visible: true }).click();
  await page.waitForTimeout(500);
  await page.mouse.click(400, 110);
  // The native Select/Hand control toggles pan without leaving a text caret active.
  await tool("Select / Hand (V / H)").click();
  await page.waitForFunction(
    () =>
      document.querySelector("affine-edgeless-root").gfx.tool.currentToolOption$
        .value.type === "pan",
  );
  const beforePan = await view();
  await drag(400, 140, 440, 180);
  assert.notDeepEqual((await view()).center, beforePan.center);
  await page.keyboard.press("Escape");
  await save();
  const stable = await state();
  const viewport = await view();
  await clickShellButton(page, "Backlinks");
  await page.waitForTimeout(500);
  const panelView = await view();
  assert.equal(panelView.zoom, viewport.zoom);
  assert.deepEqual(panelView.center, viewport.center);
  await shot("canvas-panel");
  await tool("Close Links tab").click();
  await page.waitForTimeout(500);
  assert.deepEqual(await view(), viewport);
  await tool("Collapse sidebar").click();
  await page.waitForTimeout(500);
  assert.deepEqual(await view(), viewport);
  await tool("Expand sidebar").click();
  await page.waitForTimeout(500);
  assert.deepEqual(await view(), viewport);
  assert.deepEqual((await state()).blocks, stable.blocks);
  record(
    "Visible zoom/fit and hand pan; panels/sidebar preserve center, zoom, identity and content",
  );
  // Narrower editor pages native tools without dropping access.
  await page.setViewportSize({ width: 1280, height: 720 });
  await clickShellButton(page, "Backlinks");
  await page.waitForTimeout(500);
  await shot("canvas-panel-1280");
  const next = tool("Next tools");
  if (await next.isVisible()) {
    await next.click();
    await tool("Shape (S)").waitFor({ state: "visible" });
  }
  await tool("Close Links tab").click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await shot("canvas-populated-1920");
  // Open an existing shared reference by pointer.
  await placeLegacyReference(page, "Editor refinement");
  await ready();
  await tool("Fit to screen").filter({ visible: true }).click();
  await page.waitForTimeout(500);
  const card = page.locator("affine-embed-edgeless-synced-doc-block");
  await card.click();
  await page.getByLabel("Open", { exact: true }).click();
  await page
    .getByRole("button", { name: "Open this doc", exact: true })
    .click();
  await ready();
  await page.waitForFunction(
    (id) => document.querySelector("affine-editor-container").doc.id === id,
    pageState.id,
  );
  await tool("Go back").click();
  await ready();
  assert.equal((await state()).id, boardId);
  record(
    "Shared-reference placement and visible Open source navigation with Back history",
  );
  await save();
  const finalState = await state();
  await shot("canvas-shared");
  await stop();
  await launch();
  await page
    .locator(".document-row")
    .filter({ hasText: "Refinement board" })
    .click();
  await ready();
  assert.equal((await state()).id, boardId);
  const reopened = (await state()).blocks;
  // Native text measurement varies by subpixel rounding after a viewport/restart
  // change. Compare bounds within 0.001 model pixels, all other fields exactly.
  for (const [id, block] of Object.entries(finalState.blocks)) {
    if (block["sys:flavour"] === "affine:edgeless-text") {
      const expected = JSON.parse(block["prop:xywh"]);
      const actual = JSON.parse(reopened[id]["prop:xywh"]);
      expected.forEach((value, i) =>
        assert.ok(Math.abs(actual[i] - value) < 0.001),
      );
      reopened[id]["prop:xywh"] = block["prop:xywh"];
    }
  }
  assert.deepEqual(reopened, finalState.blocks);
  record("Native restart retains complete board blocks and stable identity");
  await writeFile(
    path.join(root, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(root);
} catch (e) {
  await shot("failure").catch(() => {});
  throw e;
} finally {
  await stop();
}
