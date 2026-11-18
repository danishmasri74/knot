// A scene with every kind of object, in the light and dark themes, for a
// look at contrast: card colours, free text, filled shapes with labels,
// a mind map and arrows (the neutral grey and a chosen colour). Screenshots
// go to test-results/ai-scene-themes. Run against the dev server.
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
await mkdir("test-results/ai-scene-themes", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: theme });
    page.on("pageerror", (e) => console.error(e.message));
    await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420", { timeout: 300000 });
    await page.waitForSelector(".app-shell", { timeout: 300000 });
    await page.evaluate(async (theme) => {
      document.documentElement.dataset.theme = theme;
      const { DocCollection, Schema, Text } = await import("/node_modules/.vite/deps/@blocksuite_store.js");
      const { AffineSchemas } = await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
      const { AffineEditorContainer } = await import("/node_modules/.vite/deps/@blocksuite_presets.js");
      const { applyAiProposal, captureAiContext, validateProposal, revealCanvasObjects } = await import("/src/features/editor/blocksuite/ai.ts");
      const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
      c.meta.initialize();
      const d = c.createDoc();
      d.load();
      const root = d.addBlock("affine:page", { title: new Text("themes") });
      d.addBlock("affine:surface", {}, root);
      const editor = new AffineEditorContainer();
      editor.doc = d;
      editor.mode = "edgeless";
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:9999";
      document.body.append(host);
      host.append(editor);
      await editor.updateComplete;
      await new Promise((r) => setTimeout(r, 400));
      const empty = { rel: "", of: "", align: "", gap: 0 };
      const obj = (o) => ({ ref: "", text: "", content: [], nodes: [], shape: "", in: "", place: empty, cell: [], width: 0, color: "", direction: "", order: 0, role: "", ...o });
      const proposal = validateProposal({
        replacements: [], blocks: [],
        plan: "", anchor: { near: "", side: "" }, sections: [],
        objects: [
          obj({ id: "title", kind: "text", text: "Defect lifecycle" }),
          obj({ id: "f", kind: "frame", text: "Triage", place: { rel: "below", of: "title", align: "start", gap: 40 } }),
          obj({ id: "plain", kind: "card", text: "A plain card", in: "f", content: [{ type: "bulleted", text: "With a **bold** point" }] }),
          obj({ id: "blue", kind: "card", text: "A blue card", color: "blue", in: "f", place: { rel: "rightOf", of: "plain", align: "start", gap: 0 } }),
          obj({ id: "q", kind: "shape", shape: "diamond", text: "Duplicate?", color: "yellow", place: { rel: "rightOf", of: "f", align: "start", gap: 0 } }),
          obj({ id: "r", kind: "shape", shape: "roundedRect", text: "Assign to developer", place: { rel: "below", of: "q", align: "center", gap: 0 } }),
          obj({ id: "e", kind: "shape", shape: "ellipse", text: "Closed", color: "green", place: { rel: "rightOf", of: "q", align: "center", gap: 0 } }),
          obj({ id: "m", kind: "mindmap", direction: "right", nodes: [{ text: "Testing", parent: -1 }, { text: "Static", parent: 0 }, { text: "Dynamic", parent: 0 }], place: { rel: "below", of: "f", align: "start", gap: 0 } }),
        ],
        arrangements: [],
        connectors: [
          { from: "q", to: "e", label: "yes", heads: "to", style: "", color: "", reason: "" },
          { from: "q", to: "r", label: "no", heads: "to", style: "dashed", color: "red", reason: "" },
          { from: "plain", to: "blue", label: "leads to", heads: "to", style: "", color: "", reason: "" },
        ],
      });
      const undo = applyAiProposal(d, "test", captureAiContext(editor, "test", null), proposal, "canvas", {
        reveal: (ids) => revealCanvasObjects(editor, ids),
      });
      await undo.settled;
      revealCanvasObjects(editor, undo.created);
      await new Promise((r) => setTimeout(r, 900));
    }, theme);
    await page.screenshot({ path: `test-results/ai-scene-themes/${theme}.png` });
    await page.close();
  }
  console.log("ok: test-results/ai-scene-themes/light.png and dark.png");
} finally {
  await browser.close();
}
