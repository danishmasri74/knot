// Arrows Knot made before 0.6.3 have BlockSuite's fixed black label colour,
// invisible on a dark canvas. repairArrowLabelColors (run when a notebook
// loads) gives them the theme-aware colour and leaves other labels alone.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 700 },
    colorScheme: "dark",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  const result = await page.evaluate(async () => {
    document.documentElement.dataset.theme = "dark";
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } =
      await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const Y = await import("/node_modules/.vite/deps/yjs.js");
    const { repairArrowLabelColors } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("t") });
    const surfaceId = d.addBlock("affine:surface", {}, root);
    const a = d.addBlock("affine:note", { xywh: "[0,0,300,120]" }, root);
    d.addBlock("affine:paragraph", { text: new Text("Analysis") }, a);
    const b = d.addBlock("affine:note", { xywh: "[600,0,300,120]" }, root);
    d.addBlock("affine:paragraph", { text: new Text("Design") }, b);
    const surface = d.getBlock(surfaceId).model;
    const style = (color) => ({
      color,
      fontFamily: "blocksuite:surface:Inter",
      fontSize: 16,
      fontStyle: "normal",
      fontWeight: "400",
      textAlign: "center",
    });
    // An arrow as Knot made it before 0.6.3: default black label.
    const old = surface.addElement({
      type: "connector",
      source: { id: a },
      target: { id: b },
      text: new Y.Text("leads to"),
      labelXYWH: [0, 0, 92, 26],
      labelStyle: style("#000000"),
    });
    // The same arrow as the real editor stores it: the default black token.
    const token = surface.addElement({
      type: "connector",
      source: { id: a },
      target: { id: b },
      text: new Y.Text("part of"),
      labelXYWH: [0, 0, 83, 26],
      labelStyle: style("--affine-palette-line-black"),
    });
    // A label given another colour on purpose: untouched.
    const typed = surface.addElement({
      type: "connector",
      source: { id: b },
      target: { id: a },
      text: new Y.Text("mine"),
      labelXYWH: [0, 0, 56, 26],
      labelStyle: style("--affine-palette-line-red"),
    });
    const repaired = repairArrowLabelColors(d);
    const again = repairArrowLabelColors(d);
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "edgeless";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99999";
    document.body.append(host);
    host.append(editor);
    await editor.updateComplete;
    await new Promise((r) => setTimeout(r, 800));
    return {
      repaired,
      again,
      old: surface.getElementById(old).labelStyle.color,
      token: surface.getElementById(token).labelStyle.color,
      typed: surface.getElementById(typed).labelStyle.color,
    };
  });
  await page.screenshot({ path: "test-results/arrow-label-repair-dark.png" });
  assert.equal(result.repaired, 2, "both default blacks");
  assert.equal(result.again, 0, "repairs once");
  assert.deepEqual(result.old, { light: "#2b2b2b", dark: "#e3e3e3" });
  assert.deepEqual(result.token, { light: "#2b2b2b", dark: "#e3e3e3" });
  assert.equal(result.typed, "--affine-palette-line-red");
  assert.deepEqual(errors, []);
  console.log("Arrow labels: default black labels (raw and token) get the theme colour once; chosen colours untouched");
} finally {
  await browser.close();
}
