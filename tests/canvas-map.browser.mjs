// The canvas map read from a real canvas: notes, page-only notes left out,
// a frame and its members, a labelled arrow and one to the frame, a mind map
// tree, a shape with text, and the selection. captureAiContext attaches it
// only while the canvas is open.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(`${e.message} ${e.stack?.split("\n").slice(1, 5).join(" ")}`),
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
    const { captureAiContext } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const { formatCanvasMap } = await import("/src/services/canvas-map-format.ts");
    const c = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("Testing") });
    const surfaceId = d.addBlock("affine:surface", {}, root);
    const note = (xywh, text, extra = {}) => {
      const id = d.addBlock("affine:note", { xywh, ...extra }, root);
      d.addBlock("affine:paragraph", { text: new Text(text) }, id);
      return id;
    };
    const plan = note("[0,600,300,200]", "Course plan");
    const defects = note("[1040,560,300,150]", "Testing finds defects");
    const early = note("[1400,560,300,150]", "Early testing is cheaper");
    note("[0,0,300,200]", "Page only", { displayMode: "doc" });
    const frame = d.addBlock(
      "affine:frame",
      {
        title: new Text("Testing principles"),
        xywh: "[1000,500,760,400]",
        childElementIds: { [defects]: true, [early]: true },
      },
      surfaceId,
    );
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
      type: "connector",
      source: { id: early },
      target: { id: defects },
      text: new Y.Text("requires"),
    });
    surface.addElement({
      type: "connector",
      source: { id: plan },
      target: { id: frame },
    });
    surface.addElement({
      type: "shape",
      shapeType: "rect",
      xywh: "[1500,1400,200,50]",
      text: new Y.Text("Exam in May"),
    });
    surface.addElement({
      type: "mindmap",
      children: {
        text: "Testing",
        xywh: "[0,1200,180,50]",
        children: [{ text: "Methods", children: [{ text: "Unit" }] }],
      },
    });
    await new Promise((r) => setTimeout(r, 300));
    const root2 = editor.querySelector("affine-edgeless-root");
    root2.gfx.selection.set({ elements: [early] });
    const context = captureAiContext(editor, "test", null);
    const map = context.canvasMap;
    // Page view is its own editor in Knot (a Note tab), not a mode switch.
    const pageEditor = new AffineEditorContainer();
    pageEditor.doc = d;
    pageEditor.mode = "page";
    host.replaceChildren(pageEditor);
    await pageEditor.updateComplete;
    await new Promise((r) => setTimeout(r, 300));
    const pageContext = captureAiContext(pageEditor, "test", null);
    return {
      text: map ? formatCanvasMap(map) : "",
      cards: map?.cards.map((card) => card.title),
      pageHasMap: !!pageContext.canvasMap,
    };
  });
  const lines = result.text.split("\n");
  assert.deepEqual(
    result.cards.sort(),
    ["Course plan", "Early testing is cheaper", "Testing finds defects"],
    "page-only notes are not on the canvas",
  );
  assert.ok(lines.some((l) => /^F1 frame "Testing principles" .*: K\d K\d$/.test(l)), result.text);
  const handleOf = (title) =>
    lines.find((l) => l.includes(`"${title}"`))?.split(" ")[0];
  assert.ok(
    lines.includes(
      `arrow ${handleOf("Early testing is cheaper")} -requires-> ${handleOf("Testing finds defects")}`,
    ),
    result.text,
  );
  assert.ok(lines.includes(`arrow ${handleOf("Course plan")} -> F1`), result.text);
  assert.ok(lines.some((l) => l.startsWith("M1 mind map")), result.text);
  assert.ok(lines.includes("    Methods") && lines.includes("      Unit"), result.text);
  assert.ok(lines.some((l) => /^T1 text "Exam in May"/.test(l)), result.text);
  assert.ok(
    lines.includes(`selected: ${handleOf("Early testing is cheaper")}`),
    result.text,
  );
  assert.equal(result.pageHasMap, false, "no map when the canvas isn't open");
  assert.deepEqual(errors, []);
  console.log(
    "Canvas map: notes, frame, arrows, mind map, shape text and selection read from a real canvas; none in Page view",
  );
} finally {
  await browser.close();
}
