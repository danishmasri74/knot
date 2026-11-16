// Typing an arrow label on a dark canvas: the canvas root is no longer one
// big contenteditable (so the label editor gets the typing and its
// placeholder goes), the label uses the local canvas font instead of the
// default serif, and a newly drawn arrow's label is light on dark. Typing in
// a note on the canvas still works.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ colorScheme: "dark", reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(`${e.message} ${e.stack?.split("\n").slice(1, 5).join(" ")}`),
  );
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  const point = await page.evaluate(async () => {
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } = await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } =
      await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const { editorModeExtension } = await import("/src/features/editor/blocksuite/editor-mode.ts");
    const { observeArrowLabelColors } = await import("/src/features/editor/blocksuite/ai.ts");
    const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("T") });
    const surfaceId = d.addBlock("affine:surface", {}, root);
    const note = (xywh, text) => {
      const id = d.addBlock("affine:note", { xywh }, root);
      d.addBlock("affine:paragraph", { text: new Text(text) }, id);
      return id;
    };
    const a = note("[0,0,240,90]", "Analysis");
    const b = note("[600,300,240,90]", "Design");
    observeArrowLabelColors(d);
    const editor = new AffineEditorContainer();
    editor.edgelessSpecs = [...editor.edgelessSpecs, editorModeExtension("edgeless")];
    editor.doc = d;
    editor.mode = "edgeless";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99999";
    document.body.append(host);
    host.append(editor);
    await editor.updateComplete;
    await new Promise((r) => setTimeout(r, 500));
    const surface = d.getBlock(surfaceId).model;
    // As the connector tool draws it: the editor's default black label.
    const id = surface.addElement({
      type: "connector",
      source: { id: a },
      target: { id: b },
      labelStyle: {
        color: "--affine-palette-line-black",
        fontFamily: "blocksuite:surface:Inter",
        fontSize: 16,
        fontStyle: "normal",
        fontWeight: "400",
        textAlign: "center",
      },
    });
    const canvas = editor.querySelector("affine-edgeless-root");
    canvas.gfx.viewport.setViewport(1, [420, 195]);
    await new Promise((r) => setTimeout(r, 300));
    window.__label = { surface, id, canvas, a };
    const p = surface.getElementById(id).getPointByOffsetDistance(0.5);
    const [vx, vy] = canvas.gfx.viewport.toViewCoord(p[0], p[1]);
    return [vx + canvas.gfx.viewport.left, vy + canvas.gfx.viewport.top];
  });

  assert.equal(
    await page.evaluate(() => window.__label.canvas.getAttribute("contenteditable")),
    null,
    "the canvas root is not an editing host",
  );
  assert.equal(
    await page.evaluate(() => document.fonts.check('16px "blocksuite:surface:Inter"')),
    true,
    "the canvas font is available locally",
  );

  await page.mouse.dblclick(point[0], point[1]);
  await page.waitForSelector("edgeless-connector-label-editor", { state: "attached" });
  await page.waitForTimeout(200);
  await page.keyboard.type("part of");
  await page.waitForTimeout(200);
  const editing = await page.evaluate(() => {
    const e = document.querySelector("edgeless-connector-label-editor");
    const box = e.querySelector(".edgeless-connector-label-editor");
    return {
      text: String(window.__label.surface.getElementById(window.__label.id).text),
      placeholder: !!e.querySelector(".edgeless-connector-label-editor-placeholder"),
      color: getComputedStyle(box).color,
    };
  });
  assert.equal(editing.text, "part of", "typing reaches the label");
  assert.equal(editing.placeholder, false, "the placeholder goes once there is text");
  assert.equal(editing.color, "rgb(227, 227, 227)", "light label text on a dark canvas");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => document.querySelectorAll("edgeless-connector-label-editor").length),
    0,
    "Escape finishes editing",
  );
  assert.equal(
    await page.evaluate(() => String(window.__label.surface.getElementById(window.__label.id).text)),
    "part of",
  );

  // A note on the canvas still takes typing.
  const notePoint = await page.evaluate(() => {
    const el = document.querySelector(`[data-block-id="${window.__label.a}"] rich-text`);
    const r = el.getBoundingClientRect();
    return [r.right - 4, r.top + r.height / 2];
  });
  await page.mouse.dblclick(notePoint[0], notePoint[1]);
  await page.waitForTimeout(300);
  await page.keyboard.press("End");
  await page.keyboard.type(" phase");
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() =>
      document.querySelector(`[data-block-id="${window.__label.a}"] rich-text`).textContent.replace(/​/g, ""),
    ),
    "Analysis phase",
    "notes on the canvas still take typing",
  );

  assert.deepEqual(errors, []);
  console.log(
    "Arrow labels: typing reaches the label, placeholder hides, local font, light on dark; notes still editable",
  );
} finally {
  await browser.close();
}
