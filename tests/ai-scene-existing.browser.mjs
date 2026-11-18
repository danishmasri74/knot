// Scenes that edit what's already on the canvas (phase 5), in a real editor:
// cards in a frame are tidied into a row and the frame fits them again, a
// card moves into a new section, an arrow joins two existing cards, cards the
// scene doesn't list stay put, and one undo puts everything back.
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
      const { applyAiProposal, captureAiContext, validateProposal, revealCanvasObjects } = await import("/src/features/editor/blocksuite/ai.ts");
      const { canvasHandles } = await import("/src/services/canvas-map-format.ts");
      const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
      c.meta.initialize();
      const d = c.createDoc();
      d.load();
      const root = d.addBlock("affine:page", { title: new Text("test") });
      const surfaceId = d.addBlock("affine:surface", {}, root);
      const card = (title, xywh) => {
        const id = d.addBlock("affine:note", { xywh }, root);
        d.addBlock("affine:paragraph", { text: new Text(title) }, id);
        return id;
      };
      // A messy frame of three cards, a loose card and one the scene ignores.
      const a = card("Static testing", "[1000,40,360,160]");
      const b = card("Reviews find defects early", "[1500,420,360,160]");
      const k = card("Static analysis", "[1080,700,360,160]");
      const loose = card("Test levels", "[0,1200,360,160]");
      const untouched = card("Course plan", "[0,0,360,160]");
      const frame = d.addBlock("affine:frame", {
        title: new Text("Static testing"),
        xywh: "[960,-40,960,960]",
        childElementIds: { [a]: true, [b]: true, [k]: true },
      }, surfaceId);
      const editor = new AffineEditorContainer();
      editor.doc = d;
      editor.mode = "edgeless";
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:9999;background:#fff";
      document.body.append(host);
      host.append(editor);
      await editor.updateComplete;
      await new Promise((r) => setTimeout(r, 400));
      d.resetHistory();
      const ctx = captureAiContext(editor, "test", null);
      const handles = canvasHandles(ctx.canvasMap);
      const handleOf = (id) => [...handles].find(([, t]) => t.id === id)[0];
      const empty = { rel: "", of: "", align: "", gap: 0 };
      const obj = (o) => ({ ref: "", text: "", content: [], nodes: [], shape: "", in: "", place: empty, cell: [], width: 0, color: "", direction: "", order: 0, role: "", ...o });
      const proposal = validateProposal(
        {
          replacements: [], blocks: [],
          plan: "Tidy the static testing frame into a row and file test levels under a new section.",
          anchor: { near: "", side: "" }, sections: [],
          objects: [
            obj({ id: "a", kind: "existing", ref: handleOf(a) }),
            obj({ id: "b", kind: "existing", ref: handleOf(b) }),
            obj({ id: "k", kind: "existing", ref: handleOf(k) }),
            obj({ id: "levels", kind: "frame", text: "Levels", place: { rel: "below", of: handleOf(frame), align: "start", gap: 0 } }),
            obj({ id: "l", kind: "existing", ref: handleOf(loose), in: "levels" }),
            obj({ id: "f", kind: "existing", ref: handleOf(frame), place: { rel: "rightOf", of: "levels", align: "", gap: 0 } }),
          ],
          arrangements: [{ id: "row", kind: "row", members: ["a", "b", "k"], center: "", columns: 0, in: "", place: empty, gap: 0, align: "start" }],
          connectors: [{ from: "b", to: handleOf(a), label: "part of", heads: "to", style: "", color: "", reason: "Reviews are a kind of static testing." }],
        },
        undefined,
        new Set(handles.keys()),
      );
      const s = proposal.scene;
      if (s.notes.length !== 1 || !s.notes[0].includes("stays where it is")) throw Error(`expected the frame-move note: ${s.notes}`);
      const box = (id) => JSON.parse(d.getBlock(id).model.xywh);
      const before = { untouched: box(untouched), frame: box(frame) };
      const undo = applyAiProposal(d, "test", ctx, proposal, "canvas", { reveal: (ids) => revealCanvasObjects(editor, ids) });
      await undo.settled;
      const [ba, bb, bk] = [box(a), box(b), box(k)];
      if (!(ba[1] === bb[1] && bb[1] === bk[1] && ba[0] < bb[0] && bb[0] < bk[0])) throw Error(`not a row: ${ba} ${bb} ${bk}`);
      const fb = box(frame);
      const inside = (c) => c[0] >= fb[0] && c[1] >= fb[1] && c[0] + c[2] <= fb[0] + fb[2] && c[1] + c[3] <= fb[1] + fb[3];
      if (![ba, bb, bk].every(inside)) throw Error("the frame doesn't fit its cards");
      const held = d.getBlock(frame).model.childElementIds;
      if (!held[a] || !held[b] || !held[k]) throw Error("tidied cards left their frame");
      const levels = d.getBlocksByFlavour("affine:frame").map(({ model }) => model).find((m) => m.title.toString() === "Levels");
      if (!levels?.childElementIds?.[loose]) throw Error("test levels isn't in the new section");
      // The editor measures heights; positions are what must not change.
      const at = (b) => JSON.stringify(b.slice(0, 2));
      if (at(box(untouched)) !== at(before.untouched)) throw Error(`an unlisted card moved: ${box(untouched)} vs ${before.untouched}`);
      const surface = d.getBlock(surfaceId).model;
      const arrow = surface.elementModels.find((e) => e.type === "connector");
      if (!arrow || arrow.source.id !== b || arrow.target.id !== a) throw Error("the arrow between existing cards is missing");
      undo();
      if (JSON.stringify(box(frame)) !== JSON.stringify(before.frame)) throw Error("undo didn't restore the frame");
      if (at(box(a)) !== "[1000,40]") throw Error(`undo didn't restore a card: ${box(a)}`);
      if (surface.elementModels.some((e) => e.type === "connector")) throw Error("undo left the arrow");
      return "ok: tidied in its frame, regrouped, connected, unlisted untouched, undo restored";
    }),
  );
} finally {
  await browser.close();
}
