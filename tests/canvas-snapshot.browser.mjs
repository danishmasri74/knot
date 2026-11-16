// Phase 5 of canvas awareness: view_canvas renders what the user sees of
// the canvas to a JPEG on the device, within the image limits, with the
// shapes drawn; nothing in view falls back to the whole canvas, and Page
// view refuses.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(`${e.message} ${e.stack?.split("\n").slice(1, 4).join(" ")}`),
  );
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  const result = await page.evaluate(async () => {
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } =
      await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const Y = await import("/node_modules/.vite/deps/yjs.js");
    const { renderVisibleCanvas, visibleCanvasBound, snapshotSize } =
      await import("/src/features/editor/blocksuite/canvas-snapshot.ts");
    const c = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("Sketch") });
    const surfaceId = d.addBlock("affine:surface", {}, root);
    const n = d.addBlock("affine:note", { xywh: "[0,0,300,120]" }, root);
    d.addBlock("affine:paragraph", { text: new Text("Plan tests") }, n);
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "edgeless";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff";
    document.body.append(host);
    host.append(editor);
    await editor.updateComplete;
    await new Promise((r) => setTimeout(r, 300));
    const surface = d.getBlock(surfaceId).model;
    surface.addElement({
      type: "shape",
      shapeType: "ellipse",
      xywh: "[400,0,300,300]",
      fillColor: "#ff0000",
      filled: true,
      text: new Y.Text("Risk"),
    });
    await new Promise((r) => setTimeout(r, 300));
    const url = await renderVisibleCanvas(editor);
    const image = new Image();
    image.src = url;
    await image.decode();
    // Red pixels prove the shape was drawn, not just a blank background.
    const probe = document.createElement("canvas");
    probe.width = image.width;
    probe.height = image.height;
    const ctx = probe.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    let red = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 200 && data[i + 1] < 90 && data[i + 2] < 90) red++;
    const pageEditor = new AffineEditorContainer();
    pageEditor.doc = d;
    pageEditor.mode = "page";
    host.replaceChildren(pageEditor);
    await pageEditor.updateComplete;
    let pageView = "";
    try {
      await renderVisibleCanvas(pageEditor);
    } catch (error) {
      pageView = String(error);
    }
    return {
      jpeg: url.startsWith("data:image/jpeg;base64,"),
      bytes: url.length,
      size: [image.width, image.height],
      red,
      url,
      pageView,
      fallback: visibleCanvasBound(
        { x: 5000, y: 5000, w: 100, h: 100 },
        { x: 0, y: 0, w: 700, h: 300 },
      ),
      clipped: visibleCanvasBound(
        { x: 100, y: 0, w: 200, h: 1000 },
        { x: 0, y: 0, w: 700, h: 300 },
      ),
      scaled: snapshotSize(4000, 2000),
    };
  });
  writeFileSync(
    "test-results/canvas-snapshot.jpg",
    Buffer.from(result.url.split(",")[1], "base64"),
  );
  assert.ok(result.jpeg, "JPEG data URL");
  assert.ok(result.bytes < 8_000_000, "under the image size limit");
  assert.ok(Math.max(...result.size) <= 1600, `size ${result.size}`);
  assert.ok(result.red > 500, `shape drawn (${result.red} red pixels)`);
  assert.match(result.pageView, /Open the canvas/);
  assert.deepEqual(result.fallback, { x: 0, y: 0, w: 700, h: 300 });
  assert.deepEqual(result.clipped, { x: 100, y: 0, w: 200, h: 300 });
  assert.deepEqual(result.scaled, { width: 1600, height: 800 });
  assert.deepEqual(errors, []);
  console.log(
    "Canvas snapshot: visible canvas rendered to a JPEG within limits with shapes drawn; fallback and clipping; Page view refused",
  );
} finally {
  await browser.close();
}
