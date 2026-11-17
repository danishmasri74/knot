// A composed scene applied in a real editor: objects of every kind, frames
// fitted around measured cards, no overlaps, arrows to mind map nodes, and
// one undo step. Run against the dev server (pnpm dev).
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  const shot = process.env.KNOT_SCENE_SHOT;
  if (process.env.KNOT_SCENE_PROBE) await page.evaluate(() => (window.__sceneProbe = true));
  if (shot) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(() => (window.__sceneShot = true));
  }
  const run = page.evaluate(async () => {
      const { DocCollection, Schema, Text } =
        await import("/node_modules/.vite/deps/@blocksuite_store.js");
      const { AffineSchemas } =
        await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
      const { applyAiProposal, captureAiContext, validateProposal, revealCanvasObjects } =
        await import("/src/features/editor/blocksuite/ai.ts");
      const { AffineEditorContainer } =
        await import("/node_modules/.vite/deps/@blocksuite_presets.js");
      const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
      c.meta.initialize();
      const d = c.createDoc();
      d.load();
      const root = d.addBlock("affine:page", { title: new Text("test") });
      d.addBlock("affine:surface", {}, root);
      // Something already on the canvas, to stay clear of.
      const existing = d.addBlock("affine:note", { xywh: "[0,0,400,300]" }, root);
      d.addBlock("affine:paragraph", { text: new Text("Existing card") }, existing);
      const editor = new AffineEditorContainer();
      editor.doc = d;
      editor.mode = "edgeless";
      // On screen, so the editor measures the new cards as it would for a user.
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:9999;background:var(--affine-background-primary-color,#fff)";
      document.body.append(host);
      host.append(editor);
      await editor.updateComplete;
      await new Promise((r) => setTimeout(r, 300));
      d.resetHistory();
      const ctx = captureAiContext(editor, "test", null);
      const empty = { rel: "", of: "", align: "", gap: 0 };
      const obj = (o) => ({
        text: "", content: [], nodes: [], shape: "", in: "", place: empty, cell: [],
        width: 0, color: "", direction: "", order: 0, role: "", ...o,
      });
      const long = Array.from({ length: 9 }, (_, i) => ({
        type: "bulleted",
        text: `Detail ${i + 1}: a longer sentence that wraps over more than one line in a card [S1]`,
      }));
      const args = {
        plan: "Two decks side by side, each read top to bottom, with a cycle and an overview map.",
        anchor: { near: "", side: "" },
        objects: [
          obj({ id: "d1", kind: "frame", text: "Deck 1", order: 1 }),
          obj({ id: "d2", kind: "frame", text: "Deck 2", order: 2, place: { rel: "rightOf", of: "d1", align: "start", gap: 0 } }),
          obj({ id: "a", kind: "card", text: "Early testing saves cost", in: "d1", content: long }),
          obj({ id: "b", kind: "card", text: "Short card", in: "d1", content: [{ type: "paragraph", text: "One line." }], place: { rel: "below", of: "a", align: "start", gap: 0 } }),
          obj({ id: "c", kind: "card", text: "Deck 2 idea", in: "d2", content: long.slice(0, 4) }),
          obj({ id: "title", kind: "text", text: "Software testing", place: { rel: "above", of: "d1", align: "start", gap: 40 } }),
          obj({ id: "q", kind: "shape", shape: "diamond", text: "Defect found?", color: "yellow", place: { rel: "below", of: "d2", align: "center", gap: 0 } }),
          obj({ id: "m", kind: "mindmap", direction: "right", nodes: [{ text: "Testing", parent: -1 }, { text: "Static", parent: 0 }, { text: "Dynamic", parent: 0 }], place: { rel: "below", of: "d1", align: "start", gap: 0 } }),
        ],
        arrangements: [],
        connectors: [
          { from: "a", to: "b", label: "leads to", heads: "to", style: "", color: "" },
          { from: "a", to: "c", label: "relates to", heads: "to", style: "dashed", color: "blue" },
          { from: "m#1", to: "a", label: "explained in", heads: "to", style: "", color: "" },
          { from: "d2", to: "q", label: "", heads: "to", style: "", color: "" },
        ],
      };
      const proposal = validateProposal({ replacements: [], blocks: [], ...args });
      if (!proposal.scene || proposal.scene.objects.length !== 8) throw Error("scene not validated");
      if (/\[S\d+\]/.test(JSON.stringify(proposal.scene))) throw Error("markers kept");
      const undo = applyAiProposal(d, "test", ctx, proposal, "canvas", {
        view: [0, 0, 1600, 1000],
        // As Ask Knot does: bring the new objects into view to be measured.
        reveal: (ids) => revealCanvasObjects(editor, ids),
      });
      await undo.settled;
      const surface = d.getBlocksByFlavour("affine:surface")[0].model;
      const box = (id) => {
        const m = d.getBlock(id)?.model ?? surface.getElementById(id);
        if (m?.type === "mindmap") {
          const b = m.elementBound;
          return [b.x, b.y, b.w, b.h];
        }
        return JSON.parse(m.xywh);
      };
      const ids = undo.created;
      if (ids.length !== 8) throw Error(`created ${ids.length} objects`);
      const byScene = Object.fromEntries(args.objects.map((o, i) => [o.id, ids[i]]));
      const notes = d.getBlocksByFlavour("affine:note").length;
      if (notes !== 4) throw Error(`expected 4 cards, got ${notes}`);
      const frames = d.getBlocksByFlavour("affine:frame").map(({ model }) => model);
      if (frames.length !== 2) throw Error("frames missing");
      // Cards sit inside their frames, measured.
      const inside = (inner, outer) =>
        inner[0] >= outer[0] && inner[1] >= outer[1] &&
        inner[0] + inner[2] <= outer[0] + outer[2] + 1 &&
        inner[1] + inner[3] <= outer[1] + outer[3] + 1;
      for (const [card, frame] of [["a", "d1"], ["b", "d1"], ["c", "d2"]])
        if (!inside(box(byScene[card]), box(byScene[frame])))
          throw Error(`${card} is not inside ${frame}: ${box(byScene[card])} vs ${box(byScene[frame])}`);
      const d1 = frames.find((f) => f.title.toString() === "Deck 1");
      if (!d1.childElementIds?.[byScene.a]) throw Error("frame doesn't hold its cards");
      // Nothing overlaps among siblings or the existing card.
      const top = ["d1", "d2", "title", "q", "m"].map((k) => [k, box(byScene[k])]);
      top.push(["existing", JSON.parse(d.getBlock(existing).model.xywh)]);
      for (let i = 0; i < top.length; i++)
        for (let j = i + 1; j < top.length; j++) {
          const [p, a] = top[i];
          const [q, b] = top[j];
          if (a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1])
            throw Error(`${p} overlaps ${q}: ${a} / ${b}`);
        }
      const [a, b] = [box(byScene.a), box(byScene.b)];
      // The editor measured the cards: the short one is shorter than the long one.
      if (!(b[3] < a[3])) throw Error(`cards weren't measured: ${a[3]} / ${b[3]}`);
      if (b[1] < a[1] + a[3]) throw Error("b isn't below a after measuring");
      // Relations held: Deck 2 right of Deck 1, the map below it.
      if (box(byScene.d2)[0] <= box(byScene.d1)[0] + box(byScene.d1)[2]) throw Error("d2 not right of d1");
      if (box(byScene.m)[1] < box(byScene.d1)[1] + box(byScene.d1)[3]) throw Error("map not below d1");
      const connectors = surface.elementModels.filter((e) => e.type === "connector");
      if (connectors.length !== 4) throw Error(`expected 4 arrows, got ${connectors.length}`);
      const map = surface.getElementById(byScene.m);
      const toNode = connectors.find((e) => String(e.text) === "explained in");
      if (!map.tree.children.some((n) => n.id === toNode.source.id)) throw Error("arrow doesn't start at the map node");
      const dashed = connectors.find((e) => String(e.text) === "relates to");
      if (dashed.strokeStyle !== "dash") throw Error("dashed style lost");
      if (window.__sceneShot) {
        const all = ids.map(box);
        const x = Math.min(...all.map((b) => b[0])) - 40;
        const y = Math.min(...all.map((b) => b[1])) - 40;
        const w = Math.max(...all.map((b) => b[0] + b[2])) - x + 40;
        const h = Math.max(...all.map((b) => b[1] + b[3])) - y + 40;
        const root = editor.querySelector("affine-edgeless-root");
        root.gfx.viewport.setViewportByBound({ x, y, w, h }, [20, 20, 20, 20]);
        await new Promise((r) => setTimeout(r, 800));
        window.__sceneReady = true;
        await new Promise((r) => { window.__sceneDone = r; });
      }
      if (window.__sceneProbe) {
        const zoom = editor.querySelector("affine-edgeless-root").gfx.viewport.zoom;
        return ["a", "b", "c", "d2"].map((k) => {
          const el = editor.querySelector(`[data-block-id="${byScene[k]}"]`);
          return `${k}: model h ${Math.round(box(byScene[k])[3])}, drawn h ${el ? Math.round(el.getBoundingClientRect().height / zoom) : "?"}`;
        }).join("; ");
      }
      // One undo step removes everything the scene made.
      undo();
      const left = d.getBlocksByFlavour("affine:note").length;
      if (left !== 1 || d.getBlocksByFlavour("affine:frame").length || surface.elementModels.length)
        throw Error(`undo left ${left} notes, ${surface.elementModels.length} elements`);
      return `ok: ${undo.report.length} adjustments reported`;
  });
  if (shot) {
    await page.waitForFunction(() => window.__sceneReady, null, { timeout: 60000 });
    await page.screenshot({ path: shot });
    await page.evaluate(() => window.__sceneDone());
  }
  console.log(await run);
} finally {
  await browser.close();
}
