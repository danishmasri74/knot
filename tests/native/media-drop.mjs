import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import assert from "node:assert/strict";
const root = path.resolve("test-results/media-drop-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9291",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9291");
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
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
      "false",
  );
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child?.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      /* The test app may already have exited. */
    }
  }
  child = null;
}
async function save() {
  await page.getByRole("button", { name: "Save now / retry", exact: true }).click();
  await ready();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
}
async function rename(title) {
  await page.getByLabel("Document title", { exact: true }).fill(title);
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
}
async function drop(paths, x, y) {
  const client = await page.context().newCDPSession(page);
  const data = { items: [], files: paths, dragOperationsMask: 1 };
  await client.send("Input.dispatchDragEvent", {
    type: "dragEnter",
    x,
    y,
    data,
  });
  await client.send("Input.dispatchDragEvent", {
    type: "dragOver",
    x,
    y,
    data,
  });
  await page.locator(".file-drop-active").waitFor();
  await page.screenshot({ path: path.join(root, "drop-overlay.png") });
  await client.send("Input.dispatchDragEvent", { type: "drop", x, y, data });
  await ready();
  await client.detach();
}
async function blocks() {
  return page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    return ["affine:image", "affine:attachment"].flatMap((flavour) =>
      doc.getBlocksByFlavour(flavour).map(({ model }) => ({
        id: model.id,
        flavour,
        parent: doc.getParent(model).flavour,
        name: model.name,
        source: model.sourceId,
        type: model.type,
        xywh: model.xywh,
      })),
    );
  });
}
try {
  const png = path.join(root, "image.png"),
    gif = path.join(root, "animation.gif"),
    pdf = path.join(root, "document.pdf"),
    txt = path.join(root, "readme.txt");
  await writeFile(png, await readFile("public/knot-icon.png"));
  await writeFile(
    gif,
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  );
  const doc = await PDFDocument.create();
  const fixturePage = doc.addPage();
  fixturePage.drawText("Dropped PDF — aspect ratio test", {
    x: 50,
    y: 740,
    size: 20,
  });
  fixturePage.drawRectangle({
    x: 50,
    y: 500,
    width: 150,
    height: 150,
    borderWidth: 3,
  });
  await writeFile(pdf, await doc.save());
  await writeFile(txt, "Dropped attachment");
  await launch();
  await rename("Dropped media");
  const area = await page.locator(".editor-area").boundingBox();
  await drop([png, gif, pdf, txt], area.x + 200, area.y + 210);
  await page.waitForFunction(
    () =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:image").length === 2,
  );
  let items = await blocks();
  assert.equal(items.length, 4);
  const order = await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    return doc
      .getBlocksByFlavour("affine:note")[0]
      .model.children.filter((model) =>
        ["affine:image", "affine:attachment"].includes(model.flavour),
      )
      .map((model) => model.id);
  });
  assert.deepEqual(
    order,
    items.map((item) => item.id),
    "Page batch must retain input order",
  );
  assert.ok(
    items.every((item) => item.parent === "affine:note" && item.source),
  );
  assert.ok(items.some((item) => item.type === "application/pdf"));
  await page.screenshot({ path: path.join(root, "page-media.png") });
  await save();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await ready();
  const canvasArea = await page.locator(".editor-area").boundingBox();
  const x = canvasArea.x + canvasArea.width * 0.7,
    y = canvasArea.y + canvasArea.height * 0.5;
  const expected = await page.evaluate(
    ({ x, y }) => {
      const viewport = document.querySelector("affine-edgeless-root").gfx
        .viewport;
      return viewport.toModelCoord(
        ...viewport.toViewCoordFromClientCoord([x, y]),
      );
    },
    { x, y },
  );
  await drop([png, pdf], x, y);
  items = await blocks();
  const placed = items.filter((item) => item.parent === "affine:surface");
  assert.equal(placed.length, 2);
  const image = placed.find((item) => item.flavour === "affine:image");
  const bounds = JSON.parse(image.xywh);
  assert.ok(Math.abs(bounds[0] + bounds[2] / 2 - expected[0]) < 2);
  assert.ok(Math.abs(bounds[1] + bounds[3] / 2 - expected[1]) < 2);
  const pdfId = placed.find((item) => item.type === "application/pdf").id;
  await page.evaluate((id) => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc.updateBlock(doc.getBlock(id).model, { embed: true });
  }, pdfId);
  await page.waitForFunction((id) => {
    const element = [
      ...document.querySelectorAll("affine-edgeless-attachment"),
    ].find((e) => e.model.id === id);
    const container = element?.querySelector(".affine-attachment-container");
    const frame = element?.querySelector(".knot-canvas-pdf canvas");
    if (!container || !frame) return false;
    const bounds = JSON.parse(element.model.xywh);
    return (
      bounds[3] > bounds[2] &&
      getComputedStyle(container).transform === "none" &&
      frame.getBoundingClientRect().height > 200
    );
  }, pdfId);
  await page.evaluate((id) => {
    const editor = document.querySelector("affine-editor-container");
    const bounds = JSON.parse(editor.doc.getBlock(id).model.xywh);
    editor
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setCenter(
        bounds[0] + bounds[2] / 2,
        bounds[1] + bounds[3] / 2,
      );
  }, pdfId);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(root, "canvas-embed.png") });
  const proportions = await page
    .locator(".knot-canvas-pdf canvas")
    .evaluate((canvas) => ({
      source: canvas.width / canvas.height,
      shown:
        canvas.getBoundingClientRect().width /
        canvas.getBoundingClientRect().height,
    }));
  assert.ok(
    Math.abs(proportions.source - proportions.shown) < 0.01,
    "PDF must preserve intrinsic page proportions",
  );
  // Bring the link above the transient import notice at the canvas bottom.
  await page.evaluate((id) => {
    const editor = document.querySelector("affine-editor-container");
    const bounds = JSON.parse(editor.doc.getBlock(id).model.xywh);
    editor
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setCenter(
        bounds[0] + bounds[2] / 2,
        bounds[1] + bounds[3] / 2 + 180,
      );
  }, pdfId);
  await page
    .getByRole("link", { name: "Open PDF reader", exact: true })
    .click();
  await page.getByLabel("PDF reader surface", { exact: true }).waitFor();
  assert.equal(await page.locator(".pdf-selection-panel").count(), 0);
  await page.getByRole("button", { name: "Fit width", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Close PDF reader tab", exact: true })
    .click();
  await page.evaluate((id) => {
    document
      .querySelector("affine-editor-container")
      .querySelector("affine-edgeless-root")
      .gfx.selection.set({ elements: [id], editing: false });
  }, pdfId);
  const splitAction = page
    .locator("edgeless-change-attachment-button")
    .getByRole("button", { name: "Open PDF reader", exact: true });
  await splitAction.focus();
  await splitAction.press("Enter");
  await page.getByLabel("PDF reader surface", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Close PDF reader tab", exact: true })
    .click();
  await page.evaluate((id) => {
    document
      .querySelector("affine-editor-container")
      .querySelector("affine-edgeless-root")
      .gfx.selection.set({ elements: [id], editing: false });
  }, image.id);
  await page
    .locator("edgeless-change-attachment-button")
    .waitFor({ state: "detached" });
  await page.evaluate((id) => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc.updateBlock(doc.getBlock(id).model, { embed: false });
  }, pdfId);
  await page.waitForFunction(
    (id) =>
      JSON.parse(
        document.querySelector("affine-editor-container").doc.getBlock(id).model
          .xywh,
      )[3] === 180,
    pdfId,
  );
  for (const style of ["horizontalThin", "cubeThick"]) {
    await page.evaluate(
      ({ id, style }) => {
        const doc = document.querySelector("affine-editor-container").doc;
        doc.updateBlock(doc.getBlock(id).model, {
          style,
          xywh: "[0,0,320,180]",
        });
        document
          .querySelector("affine-edgeless-root")
          .gfx.viewport.setCenter(160, 90);
      },
      { id: pdfId, style },
    );
    await page.waitForFunction((id) => {
      const element = [
        ...document.querySelectorAll("affine-edgeless-attachment"),
      ].find((e) => e.model.id === id);
      const container = element?.querySelector(".affine-attachment-container");
      const icon = element?.querySelector(".affine-attachment-banner svg");
      const rect = icon?.getBoundingClientRect();
      return (
        container &&
        getComputedStyle(container).transform === "none" &&
        rect &&
        Math.abs(rect.width - rect.height) < 1
      );
    }, pdfId);
    await page.screenshot({ path: path.join(root, `card-${style}.png`) });
  }
  await page.screenshot({ path: path.join(root, "canvas-media.png") });
  await save();
  await stop();
  await launch();
  items = await blocks();
  assert.equal(items.length, 6);
  assert.ok(items.every((item) => item.source));
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await ready();
  await page.waitForFunction(() => {
    const container = document.querySelector(
      "affine-edgeless-attachment .affine-attachment-container",
    );
    return container && getComputedStyle(container).transform === "none";
  });
  await page.locator('input[type="file"]').setInputFiles([png, txt]);
  await ready();
  assert.equal(
    (await blocks()).length,
    8,
    "Attach should accept multiple files too",
  );
  const bad = path.join(root, "broken.png");
  await writeFile(bad, "not an image");
  const nextArea = await page.locator(".editor-area").boundingBox();
  await drop([bad, txt], nextArea.x + 180, nextArea.y + 160);
  await page
    .getByRole("alert")
    .filter({ hasText: "Cannot display broken.png" })
    .waitFor();
  assert.equal((await blocks()).length, 9);
  assert.equal(await page.locator(".file-drop-active").count(), 0);
  console.log(
    "PASS native file drops: mixed PNG/GIF/PDF/file, Page and Canvas placement, no duplicates, restart persistence, per-file error recovery",
    root,
  );
} finally {
  await stop();
}
