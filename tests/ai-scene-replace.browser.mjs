// Break this into ideas on the scene path, in a real editor: the scene takes
// the card's place in a frame with its title, arrows to the card move to the
// frame, uncovered passages go on "Other details", and one undo restores it.
// Run against the dev server (pnpm dev).
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420", { timeout: 300000 });
  await page.waitForSelector(".app-shell", { timeout: 300000 });
  console.log(
    await page.evaluate(async () => {
      const { DocCollection, Schema, Text } = await import("/node_modules/.vite/deps/@blocksuite_store.js");
      const { AffineSchemas } = await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
      const { AffineEditorContainer } = await import("/node_modules/.vite/deps/@blocksuite_presets.js");
      const Y = await import("/node_modules/.vite/deps/yjs.js");
      const { applyAiProposal, captureCardContext, validateProposal, revealCanvasObjects } = await import("/src/features/editor/blocksuite/ai.ts");
      const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
      c.meta.initialize();
      const d = c.createDoc();
      d.load();
      const root = d.addBlock("affine:page", { title: new Text("test") });
      const surfaceId = d.addBlock("affine:surface", {}, root);
      const original = d.addBlock("affine:note", { xywh: "[600,100,420,400]" }, root);
      d.addBlock("affine:paragraph", { type: "h2", text: new Text("Testing principles") }, original);
      d.addBlock("affine:paragraph", { text: new Text("Early testing saves time and money because defects found early cost less to fix.") }, original);
      d.addBlock("affine:paragraph", { text: new Text("Defects cluster together in a small number of modules that contain most defects.") }, original);
      const other = d.addBlock("affine:note", { xywh: "[0,100,360,200]" }, root);
      d.addBlock("affine:paragraph", { text: new Text("Course plan") }, other);
      const editor = new AffineEditorContainer();
      editor.doc = d;
      editor.mode = "edgeless";
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:9999;background:#fff";
      document.body.append(host);
      host.append(editor);
      await editor.updateComplete;
      await new Promise((r) => setTimeout(r, 300));
      const surface = d.getBlock(surfaceId).model;
      const arrow = surface.addElement({ type: "connector", source: { id: other }, target: { id: original }, text: new Y.Text("leads to") });
      await new Promise((r) => setTimeout(r, 100));
      d.resetHistory();
      const ctx = captureCardContext(d, "test", d.getBlock(original).model);
      const empty = { rel: "", of: "", align: "", gap: 0 };
      const obj = (o) => ({ text: "", content: [], nodes: [], shape: "", in: "", place: empty, cell: [], width: 0, color: "", direction: "", order: 0, role: "", ...o });
      // Covers early testing only: the clustering passage must survive.
      const proposal = validateProposal({
        replacements: [], blocks: [],
        plan: "Two ideas.", anchor: { near: "", side: "" }, sections: [],
        objects: [
          obj({ id: "early", kind: "card", text: "Early testing saves time and money", content: [{ type: "paragraph", text: "Defects found early cost less to fix." }] }),
          obj({ id: "why", kind: "card", text: "Late defects are expensive", place: { rel: "below", of: "early", align: "", gap: 0 } }),
        ],
        arrangements: [],
        connectors: [{ from: "why", to: "early", label: "explains", heads: "to", style: "", color: "" }],
      });
      const undo = applyAiProposal(d, "test", ctx, proposal, "canvas", {
        replaces: original,
        reveal: (ids) => revealCanvasObjects(editor, ids),
      });
      await undo.settled;
      if (d.getBlock(original)) throw Error("the original card is still there");
      const frames = d.getBlocksByFlavour("affine:frame").map(({ model }) => model);
      if (frames.length !== 1 || frames[0].title.toString() !== "Testing principles") throw Error("no frame titled like the card");
      const frame = frames[0];
      const fb = JSON.parse(frame.xywh);
      if (fb[0] !== 600 || fb[1] !== 100) throw Error(`frame not where the card was: ${fb}`);
      const notes = d.getBlocksByFlavour("affine:note").map(({ model }) => model).filter((m) => m.id !== other);
      const titles = notes.map((m) => m.children[0]?.text?.toString());
      if (!titles.includes("Other details")) throw Error(`uncovered passage not kept: ${titles}`);
      const details = notes.find((m) => m.children[0]?.text?.toString() === "Other details");
      const readable = (m) => [m.text?.toString() ?? "", ...m.children.map(readable)].join(" ");
      if (!readable(details).includes("Defects cluster together"))
        throw Error("the clustering passage is missing from Other details");
      for (const m of notes) if (!frame.childElementIds?.[m.id]) throw Error("a new card is outside the frame");
      const moved = surface.getElementById(arrow);
      if (moved.target.id !== frame.id) throw Error("the arrow to the card didn't move to the frame");
      undo();
      if (!d.getBlock(original)) throw Error("undo didn't bring the card back");
      if (surface.getElementById(arrow).target.id !== original) throw Error("undo didn't restore the arrow");
      if (d.getBlocksByFlavour("affine:frame").length) throw Error("undo left the frame");
      return "ok: replaced in place, arrow moved, uncovered kept, undo restored";
    }),
  );
} finally {
  await browser.close();
}
