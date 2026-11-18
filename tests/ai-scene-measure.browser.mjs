// A scene applied while the canvas is still moving, as it is in the app when
// Knot reveals new content: Knot draws cards lazily and not while the view
// moves, so this checks that the second layout pass still gets every card's
// real size (a table card that wraps, here), that nothing overlaps or grows
// later, that table cards get room for their columns, and that labelled
// arrows between grid neighbours attach to facing sides with room for their
// labels. Run against the dev server (pnpm dev).
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420", { timeout: 300000 });
  await page.waitForSelector(".app-shell", { timeout: 300000 });
  const result = await page.evaluate(async () => {
    const { DocCollection, Schema, Text } = await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } = await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } = await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const { applyAiProposal, captureAiContext, validateProposal, revealCanvasObjects } = await import("/src/features/editor/blocksuite/ai.ts");
    const { arrowRoute, labelBox } = await import("/src/features/editor/blocksuite/scene-report.ts");
    const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("measure") });
    d.addBlock("affine:surface", {}, root);
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
    // The app's "canvas is moving" gate: lazy cards wait while it holds.
    editor._knotCanvasMovingUntil = performance.now() + 4000;

    const empty = { rel: "", of: "", align: "", gap: 0 };
    const obj = (o) => ({ ref: "", text: "", content: [], nodes: [], shape: "", in: "", place: empty, cell: [], width: 0, color: "", direction: "", order: 0, role: "", ...o });
    const para = (text) => ({ type: "paragraph", text });
    const table = {
      type: "table",
      text: "Maintenance categories",
      columns: ["Category", "Purpose"],
      rows: [
        ["Corrective Maintenance", "Address identified defects and issues in the software reported by users."],
        ["Adaptive Maintenance", "Adapt software to environment or requirement changes, such as a new operating system."],
        ["Perfective Maintenance", "Improve software performance or maintainability without changing behaviour."],
        ["Preventive Maintenance", "Reduce the chance of future failures by restructuring risky parts of the code."],
      ],
    };
    const cards = ["t", "a", "b", "c", "e", "f"];
    const proposal = validateProposal({
      replacements: [], blocks: [],
      plan: "", anchor: { near: "", side: "" },
      objects: [
        obj({ id: "s", kind: "frame", text: "Maintenance testing" }),
        obj({ id: "t", kind: "card", in: "s", width: 400, text: "Three categories address different maintenance needs", content: [table] }),
        ...cards.slice(1).map((id) => obj({ id, kind: "card", in: "s", text: `Card ${id}`, content: [para(`About ${id}, in a sentence or two that wraps onto a second line.`)] })),
      ],
      arrangements: [{ id: "g", kind: "grid", members: cards, center: "", columns: 2, in: "s", place: empty, gap: 0, align: "" }],
      connectors: [
        { from: "t", to: "a", label: "supports early defect detection", heads: "to", style: "", color: "", reason: "" },
        { from: "b", to: "c", label: "informs alignment", heads: "to", style: "", color: "", reason: "" },
        { from: "a", to: "c", label: "", heads: "to", style: "", color: "", reason: "" },
      ],
    });
    const undo = applyAiProposal(d, "test", captureAiContext(editor, "test", null), proposal, "canvas", {
      view: [0, 0, 1600, 1000],
      reveal: (ids) => revealCanvasObjects(editor, ids),
    });
    await undo.settled;
    const byScene = Object.fromEntries(proposal.scene.objects.map((o, i) => [o.id, undo.created[i]]));
    const box = (id) => JSON.parse(d.getBlock(id).model.xywh);
    const boxes = Object.fromEntries(cards.map((k) => [k, box(byScene[k])]));
    const zoom = editor.querySelector("affine-edgeless-root").gfx.viewport.zoom;
    const problems = [];
    // 1. Every card was drawn and its model has the drawn height.
    for (const k of cards) {
      const view = editor.querySelector(`affine-edgeless-note[data-block-id="${byScene[k]}"]`);
      if (!view) { problems.push(`${k} isn't on the canvas`); continue; }
      if (view._knotRich === false) problems.push(`${k} was never drawn`);
      const drawn = view.querySelector(".affine-note-mask")?.getBoundingClientRect().height / zoom;
      if (drawn && Math.abs(drawn - boxes[k][3]) > 6) problems.push(`${k}: model ${Math.round(boxes[k][3])} px, drawn ${Math.round(drawn)} px`);
    }
    // 2. The table card is wide enough for its two columns.
    if (boxes.t[2] < 600) problems.push(`table card is ${boxes.t[2]} px wide`);
    // 3. No card overlaps another.
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++) {
        const [p, q] = [boxes[cards[i]], boxes[cards[j]]];
        if (p[0] < q[0] + q[2] && q[0] < p[0] + p[2] && p[1] < q[1] + q[3] && q[1] < p[1] + p[3])
          problems.push(`${cards[i]} overlaps ${cards[j]}`);
      }
    // 4. Arrows attach to facing sides, and labels clear every card.
    const surface = d.getBlocksByFlavour("affine:surface")[0].model;
    const arrows = surface.elementModels.filter((e) => e.type === "connector");
    const byId = Object.fromEntries(Object.entries(byScene).map(([k, v]) => [v, k]));
    for (const arrow of arrows) {
      const [from, to] = [byId[arrow.source.id], byId[arrow.target.id]];
      const route = arrowRoute(boxes[from], boxes[to], "elbowed");
      if (`${arrow.source.position}` !== `${route.from}` || `${arrow.target.position}` !== `${route.to}`)
        problems.push(`${from}→${to} attaches at ${arrow.source.position} / ${arrow.target.position}, not ${route.from} / ${route.to}`);
      const label = String(arrow.text ?? "");
      if (!label) continue;
      const l = labelBox(label, route.points);
      for (const k of cards) {
        const b = boxes[k];
        if (l[0] < b[0] + b[2] - 4 && b[0] + 4 < l[0] + l[2] && l[1] < b[1] + b[3] - 4 && b[1] + 4 < l[1] + l[3])
          problems.push(`label "${label}" covers ${k}`);
      }
    }
    // 5. Nothing grows once the canvas stops moving.
    await new Promise((r) => setTimeout(r, 4500));
    for (const k of cards) {
      const now = box(byScene[k]);
      if (Math.abs(now[3] - boxes[k][3]) > 6) problems.push(`${k} grew later: ${Math.round(boxes[k][3])} → ${Math.round(now[3])} px`);
    }
    undo();
    return problems.length ? `FAIL\n${problems.join("\n")}` : `ok: ${cards.length} cards measured, ${arrows.length} arrows on facing sides`;
  });
  console.log(result);
  if (result.startsWith("FAIL")) process.exitCode = 1;
} finally {
  await browser.close();
}
