// Replays a canvas-suite run's proposals in a real editor without paid calls:
// rebuilds the suite's canvas, checks the captured canvas map matches the one
// the model saw, then validates and applies each proposal and undoes it.
// Usage: node tests/benchmarks/replay-canvas.mjs <run-uuid> (dev server running)
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const run = process.argv[2];
if (!run) throw new Error("Pass the run UUID");
const rows = readFileSync(`tests/benchmarks/results/${run}.jsonl`, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const suite = JSON.parse(readFileSync("tests/benchmarks/canvas.v1.json", "utf8"));
const modes = {
  connect_cards: "connect",
  arrange_cards: "arrange",
  create_quiz: "quiz",
  create_on_canvas: "canvas",
};
const jobs = rows.slice(1).flatMap((row) => {
  const fixture = suite.cases.find((c) => c.id === row.case);
  const mode = fixture.mode === "canvas" ? "canvas" : modes[row.route];
  if (!mode || !row.success) return [];
  return [{ id: row.case, mode, output: row.output, map: fixture.context.canvasMap, long: fixture.mode === "canvas" }];
});

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  const results = await page.evaluate(async (jobs) => {
    const { DocCollection, Schema, Text } = await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } = await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } = await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const Y = await import("/node_modules/.vite/deps/yjs.js");
    const { captureAiContext, applyAiProposal, validateProposal } = await import("/src/features/editor/blocksuite/ai.ts");
    const { CardDeck, mcqReferenceFlavour } = await import("/src/features/editor/blocksuite/card-deck.ts");
    const { McqSchema, McqReferenceSchema, mcqDecks } = await import("/src/features/editor/blocksuite/mcq-block.ts");
    const { formatCanvasMap } = await import("/src/services/canvas-map-format.ts");
    // The suite's canvas (see the generator in the suite's history).
    const cards = [
      ["plan", [0, 0, 360, 200], ["Course plan", "Study chapter 1 this week, chapter 2 next week, then take the mock exam on 20 May."]],
      ["presence", [1000, 0, 360, 180], ["Testing shows the presence of defects", "Testing can show that defects are present, but cannot prove that there are none."]],
      ["exhaustive", [1420, 0, 360, 180], ["Exhaustive testing is impossible", "Testing every combination of inputs is not feasible except in trivial cases; risk and priorities focus the effort."]],
      ["early", [1000, 240, 360, 180], ["Early testing saves time and money", "Defects removed early, for example by reviewing requirements, cost far less to fix than defects found late."]],
      ["cluster", [1420, 240, 360, 180], ["Defects cluster together", "A small number of modules usually contains most of the defects found before release."]],
      ["static", [0, 600, 360, 180], ["Static testing", "Static testing examines work products such as requirements and code without executing them, for example in reviews."]],
      ["dynamic", [500, 600, 360, 180], ["Dynamic testing", "Dynamic testing executes the software and compares actual with expected results."]],
      ["levels", [0, 1000, 360, 180], ["Test levels", "Component, integration, system and acceptance testing, each with its own objectives."]],
    ];
    const LONG = "Testing principles help testers plan their work. Testing shows the presence of defects but cannot prove their absence. Exhaustive testing is impossible except in trivial cases, so risk analysis and priorities focus the effort. Early testing saves time and money because defects found in requirements cost far less to fix than defects found in production. Defects cluster together: a small number of modules usually contains most defects. Repeating the same tests finds fewer new defects over time, so tests must be reviewed and revised. Testing is context dependent: safety-critical software is tested differently from a mobile game. Finally, the absence of defects is a fallacy if the system does not meet users' needs.";
    const build = async (withLong) => {
      const c = new DocCollection({
        schema: new Schema().register([
          ...AffineSchemas.map((s) =>
            s.model.flavour === "affine:note"
              ? { ...s, model: { ...s.model, children: [...(s.model.children ?? []), mcqReferenceFlavour] } }
              : s,
          ),
          McqSchema,
          McqReferenceSchema,
        ]),
      });
      c.meta.initialize();
      const d = c.createDoc();
      d.load();
      const root = d.addBlock("affine:page", { title: new Text("Software Testing") });
      const surfaceId = d.addBlock("affine:surface", {}, root);
      const ids = {};
      for (const [key, box, [title, body]] of [...cards, ...(withLong ? [["long", [2400, 0, 400, 600], [LONG]]] : [])]) {
        const id = d.addBlock("affine:note", { xywh: `[${box.join(",")}]` }, root);
        if (body) d.addBlock("affine:paragraph", { type: "h2", text: new Text(title) }, id);
        d.addBlock("affine:paragraph", { text: new Text(body ?? title) }, id);
        ids[key] = id;
      }
      const frame = d.addBlock("affine:frame", {
        title: new Text("Testing principles"),
        xywh: "[960,-60,860,520]",
        childElementIds: Object.fromEntries(["presence", "exhaustive", "early", "cluster"].map((k) => [ids[k], true])),
      }, surfaceId);
      mcqDecks.set(d.spaceDoc, new CardDeck({}, () => {}));
      const editor = new AffineEditorContainer();
      editor.doc = d;
      editor.mode = "edgeless";
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff";
      document.body.replaceChildren(host);
      host.append(editor);
      await editor.updateComplete;
      await new Promise((r) => setTimeout(r, 300));
      const surface = d.getBlock(surfaceId).model;
      for (const [from, to, label] of [["early", "static", "requires"], ["presence", "exhaustive", "contrasts with"], ["plan", frame, ""], ["static", "dynamic", "part of"]])
        surface.addElement({ type: "connector", source: { id: ids[from] ?? from }, target: { id: ids[to] ?? to }, text: new Y.Text(label) });
      await new Promise((r) => setTimeout(r, 200));
      d.resetHistory();
      return { d, editor, ids, surface };
    };
    const out = [];
    for (const job of jobs) {
      const { d, editor, ids, surface } = await build(job.long);
      const context = captureAiContext(editor, "replay", job.long ? ids.long : null);
      // Handles only resolve if the canvas reads like the one the model saw.
      const handles = (text) => text.split("\n").filter((l) => /^[KF]\d/.test(l)).map((l) => l.split(" ").slice(0, 2).join(" "));
      const captured = formatCanvasMap(context.canvasMap);
      const same = JSON.stringify(handles(captured)) === JSON.stringify(handles(job.map));
      const mismatch = same
        ? undefined
        : { captured: handles(captured), seen: handles(job.map) };
      const before = {
        notes: d.getBlocksByFlavour("affine:note").length,
        arrows: surface.elementModels.filter((e) => e.type === "connector").length,
      };
      try {
        const args = JSON.parse(job.output);
        const proposal = validateProposal({ replacements: [], blocks: [], ...args });
        const undo = applyAiProposal(d, "replay", context, proposal, job.mode, job.long ? { replaces: ids.long } : undefined);
        await new Promise((r) => setTimeout(r, 100));
        const after = {
          notes: d.getBlocksByFlavour("affine:note").length,
          arrows: surface.elementModels.filter((e) => e.type === "connector").length,
        };
        undo();
        const undone = d.getBlocksByFlavour("affine:note").length === before.notes &&
          surface.elementModels.filter((e) => e.type === "connector").length === before.arrows;
        out.push({ id: job.id, mode: job.mode, same, mismatch, applied: true, before, after, undone });
      } catch (error) {
        out.push({ id: job.id, mode: job.mode, same, mismatch, applied: false, error: String(error) });
      }
    }
    return out;
  }, jobs);
  for (const r of results) console.log(JSON.stringify(r));
  if (errors.length) console.log("page errors:", errors);
} finally {
  await browser.close();
}
