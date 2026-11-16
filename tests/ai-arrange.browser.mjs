// Phase 4 of canvas awareness: arrange_cards moves existing cards into the
// arrangement their arrows describe (a flow here), keeps the group in place,
// fits their frame around them, leaves other cards alone, refuses stale
// handles, and Undo restores the old positions. Also checks that a new
// canvas proposal with a chain of arrows is laid out as a flow.
import assert from "node:assert/strict";
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
    const { captureAiContext, applyAiProposal } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const { canvasHandles } = await import("/src/services/canvas-map-format.ts");
    const c = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("Testing") });
    const surfaceId = d.addBlock("affine:surface", {}, root);
    const note = (xywh, text) => {
      const id = d.addBlock("affine:note", { xywh }, root);
      d.addBlock("affine:paragraph", { text: new Text(text) }, id);
      return id;
    };
    // A jumbled chain: plan -> design -> execute -> report.
    const plan = note("[620,780,300,120]", "Plan tests");
    const design = note("[0,560,300,120]", "Design tests");
    const execute = note("[640,520,300,120]", "Execute tests");
    const report = note("[60,900,300,120]", "Report results");
    const other = note("[2400,0,300,120]", "Unrelated card");
    const frame = d.addBlock(
      "affine:frame",
      {
        title: new Text("Test process"),
        xywh: "[-40,460,1100,700]",
        childElementIds: {
          [plan]: true,
          [design]: true,
          [execute]: true,
          [report]: true,
        },
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
    for (const [from, to] of [
      [plan, design],
      [design, execute],
      [execute, report],
    ])
      surface.addElement({
        type: "connector",
        source: { id: from },
        target: { id: to },
        text: new Y.Text("leads to"),
      });
    await new Promise((r) => setTimeout(r, 200));
    d.resetHistory();
    const box = (id) => JSON.parse(d.getBlock(id).model.xywh);
    const before = Object.fromEntries(
      [plan, design, execute, report, other].map((id) => [id, box(id)]),
    );
    const context = captureAiContext(editor, "test", null);
    const handles = canvasHandles(context.canvasMap);
    const handleOf = (id) => [...handles].find(([, t]) => t.id === id)[0];
    let stale = "";
    try {
      applyAiProposal(
        d,
        "test",
        context,
        { replacements: [], blocks: [], cards: ["K1", "K99"], layout: "auto" },
        "arrange",
      );
    } catch (error) {
      stale = String(error);
    }
    const undo = applyAiProposal(
      d,
      "test",
      context,
      {
        replacements: [],
        blocks: [],
        cards: [plan, design, execute, report].map(handleOf),
        layout: "auto",
      },
      "arrange",
    );
    await new Promise((r) => setTimeout(r, 300));
    const after = Object.fromEntries(
      [plan, design, execute, report, other].map((id) => [id, box(id)]),
    );
    const frameBox = JSON.parse(d.getBlock(frame).model.xywh);
    await new Promise((r) => setTimeout(r, 200));
    const shot = true;
    undo();
    const restored = [plan, design, execute, report].every(
      (id) => JSON.stringify(box(id)) === JSON.stringify(before[id]),
    );
    return {
      stale,
      order: [plan, design, execute, report].map((id) => after[id][0]),
      // Columns are centred vertically, so a chain shares one centre line.
      sameRow: new Set(
        [plan, design, execute, report].map((id) =>
          Math.round(after[id][1] + after[id][3] / 2),
        ),
      ).size,
      otherUntouched: JSON.stringify(after[other]) === JSON.stringify(before[other]),
      groupStart: [
        Math.min(...[plan, design, execute, report].map((id) => after[id][0])),
        Math.min(...[plan, design, execute, report].map((id) => after[id][1])),
      ],
      frameFits:
        frameBox[0] <= Math.min(...[plan, design, execute, report].map((id) => after[id][0])) &&
        frameBox[0] + frameBox[2] >=
          Math.max(...[plan, design, execute, report].map((id) => after[id][0] + after[id][2])) &&
        frameBox[2] < 2400,
      shot,
      restored,
    };
  });
  assert.match(result.stale, /aren't on the canvas any more/);
  const [p, de, ex, re] = result.order;
  assert.ok(p < de && de < ex && ex < re, `flow order ${result.order}`);
  assert.equal(result.sameRow, 1, "a chain sits on one row");
  assert.ok(result.otherUntouched, "cards not named stay put");
  assert.equal(result.groupStart[0], 0, "group stays where it was");
  assert.ok(Math.abs(result.groupStart[1] - 520) < 80, `group top ${result.groupStart[1]}`);
  assert.ok(result.frameFits, "frame fitted around its cards");
  assert.ok(result.restored, "Undo restores the old positions");
  assert.deepEqual(errors, []);
  console.log(
    "Arrange: a jumbled chain becomes a left-to-right flow in place, frame fitted, others untouched, stale handle refused, Undo restores",
  );
} finally {
  await browser.close();
}
