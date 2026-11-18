// Replays a scenes-suite run (tests/benchmarks/scenes.v1.json) in a real
// editor without paid calls: applies each old-path proposal and new-path
// scene to a fresh canvas, measures the result and saves a screenshot.
// Usage (dev server running):
//   node tests/benchmarks/replay-scenes.mjs <run-uuid>
//   node tests/benchmarks/replay-scenes.mjs --map   (prints the anchoring case's canvas map)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const arg = process.argv[2];
if (!arg) throw new Error("Pass the run UUID or --map");
const printMap = arg === "--map";
const suite = JSON.parse(readFileSync(process.env.KNOT_SCENES_SUITE ?? "tests/benchmarks/scenes.v1.json", "utf8"));
const rows = printMap
  ? []
  : readFileSync(`tests/benchmarks/results/${arg}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const jobs = rows.slice(1).flatMap((row) => {
  const fixture = suite.cases.find((c) => c.id === row.case);
  if (!fixture || !row.success) return [];
  // An automatic response may put a sentence before the tool's arguments.
  const start = row.output.indexOf("{");
  return start < 0
    ? [{ id: row.case, path: fixture.path, prompt: fixture.prompt, error: "No proposal in the response", sources: [] }]
    : [{
        id: row.case,
        path: fixture.path,
        prompt: fixture.prompt,
        output: row.output.slice(start),
        map: fixture.context.canvasMap ?? "",
        sources: fixture.context.citationSources.map((s) => s.text),
      }];
});
const outDir = printMap ? "" : `tests/benchmarks/results/${arg}`;
if (outDir) mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420", { timeout: 300000 });
  await page.waitForSelector(".app-shell", { timeout: 300000 });
  await page.evaluate(async () => {
    const { DocCollection, Schema, Text } = await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } = await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } = await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const ai = await import("/src/features/editor/blocksuite/ai.ts");
    const { formatCanvasMap } = await import("/src/services/canvas-map-format.ts");
    const { uncoveredPassages } = await import("/src/services/ai-atomize.ts");
    const { chooseLayout } = await import("/src/features/editor/blocksuite/ai-layout.ts");
    const { aiBlockText } = await import("/src/features/editor/blocksuite/ai-content.ts");
    const { sceneTexts } = await import("/src/features/editor/blocksuite/scene.ts");
    // The anchoring case's canvas: a chapter card and an unrelated card.
    const CHAPTER = "Testing in the software development lifecycle";
    const build = async (withChapter) => {
      const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
      c.meta.initialize();
      const d = c.createDoc();
      d.load();
      const root = d.addBlock("affine:page", { title: new Text("Software Testing") });
      d.addBlock("affine:surface", {}, root);
      const existing = {};
      if (withChapter) {
        const chapter = d.addBlock("affine:note", { xywh: "[0,0,420,560]" }, root);
        d.addBlock("affine:paragraph", { type: "h2", text: new Text(CHAPTER) }, chapter);
        d.addBlock("affine:paragraph", { text: new Text("Every development activity has a matching test activity; sequential and iterative models, shift left, retrospectives and DevOps.") }, chapter);
        const dates = d.addBlock("affine:note", { xywh: "[-900,700,360,180]" }, root);
        d.addBlock("affine:paragraph", { type: "h2", text: new Text("Exam dates") }, dates);
        d.addBlock("affine:paragraph", { text: new Text("Mock exam on 20 May, final on 3 June.") }, dates);
        existing.chapter = chapter;
        existing.dates = dates;
      }
      const editor = new AffineEditorContainer();
      editor.doc = d;
      editor.mode = "edgeless";
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff";
      document.body.replaceChildren(host);
      host.append(editor);
      await editor.updateComplete;
      await new Promise((r) => setTimeout(r, 300));
      d.resetHistory();
      if (withChapter) {
        // The chapter card is selected, as when a user asks about it.
        try {
          editor.std.selection.setGroup("gfx", [{ type: "surface", elements: [existing.chapter], editing: false }]);
        } catch {
          /* Selection is optional for the map. */
        }
      }
      return { d, editor, existing };
    };
    window.__replay = { build, ai, formatCanvasMap, uncoveredPassages, chooseLayout, aiBlockText, sceneTexts };
  });

  if (printMap) {
    const map = await page.evaluate(async () => {
      const { build, ai, formatCanvasMap } = window.__replay;
      const { editor, existing } = await build(true);
      return formatCanvasMap(ai.captureAiContext(editor, "replay", existing.chapter).canvasMap);
    });
    console.log(map);
  } else {
    const summary = [];
    for (const job of jobs) {
      if (job.error) {
        summary.push({ id: job.id, applied: false, error: job.error });
        continue;
      }
      const result = await page.evaluate(async (job) => {
        const { build, ai, formatCanvasMap, uncoveredPassages, chooseLayout, aiBlockText, sceneTexts } = window.__replay;
        const { d, editor, existing } = await build(!!job.map);
        const context = ai.captureAiContext(editor, "replay", existing.chapter ?? null);
        const captured = context.canvasMap ? formatCanvasMap(context.canvasMap) : "";
        const sameMap = !job.map || captured === job.map;
        const surface = d.getBlocksByFlavour("affine:surface")[0].model;
        const before = new Set([
          ...d.getBlocksByFlavour("affine:note").map((b) => b.id),
          ...d.getBlocksByFlavour("affine:frame").map((b) => b.id),
          ...surface.elementModels.map((e) => e.id),
        ]);
        let proposal;
        try {
          proposal = ai.validateProposal(
            { replacements: [], blocks: [], ...JSON.parse(job.output) },
            undefined,
            context.canvasMap ? new Set((await import("/src/services/canvas-map-format.ts")).canvasHandles(context.canvasMap).keys()) : undefined,
          );
          const undo = ai.applyAiProposal(d, "replay", context, proposal, "canvas", {
            view: [-200, -200, 1600, 1000],
            reveal: (ids) => ai.revealCanvasObjects(editor, ids),
          });
          if (undo.settled) await undo.settled;
          else {
            ai.revealCanvasObjects(editor, undo.created ?? []);
            await new Promise((r) => setTimeout(r, 900));
          }
          window.__lastReport = undo.report ?? [];
        } catch (error) {
          return { applied: false, error: String(error), sameMap };
        }
        const box = (m) => {
          if (m.type === "mindmap") {
            const b = m.elementBound;
            return [b.x, b.y, b.w, b.h];
          }
          return JSON.parse(m.xywh);
        };
        const fresh = [
          ...d.getBlocksByFlavour("affine:note").map((b) => ({ id: b.id, kind: "card", box: box(b.model) })),
          ...d.getBlocksByFlavour("affine:frame").map((b) => ({ id: b.id, kind: "frame", box: box(b.model), members: Object.keys(b.model.childElementIds ?? {}) })),
          ...surface.elementModels.filter((e) => e.type !== "connector" && !(e.group && e.group.type === "mindmap")).map((e) => ({ id: e.id, kind: e.type, box: box(e) })),
        ].filter((o) => !before.has(o.id));
        const arrows = surface.elementModels.filter((e) => e.type === "connector" && !before.has(e.id));
        const solid = fresh.filter((o) => o.kind !== "frame");
        const hit = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
        let overlaps = 0;
        const all = [...solid, ...Object.values(existing).map((id) => ({ id, box: box(d.getBlock(id).model) }))];
        for (let i = 0; i < all.length; i++)
          for (let j = i + 1; j < all.length; j++) if (hit(all[i].box, all[j].box)) overlaps++;
        // Arrows drawn straight between centres that pass over another object.
        const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
        const crosses = (p, q, b) => {
          for (let t = 0.04; t < 0.96; t += 0.02) {
            const x = p[0] + (q[0] - p[0]) * t;
            const y = p[1] + (q[1] - p[1]) * t;
            if (x > b[0] && x < b[0] + b[2] && y > b[1] && y < b[1] + b[3]) return true;
          }
          return false;
        };
        const boxOf = (id) => {
          const m = d.getBlock(id)?.model ?? surface.getElementById(id);
          if (!m) return undefined;
          if (m.group?.type === "mindmap") return box(m);
          return box(m);
        };
        let crossings = 0;
        for (const a of arrows) {
          const s = boxOf(a.source.id);
          const t = boxOf(a.target.id);
          if (!s || !t) continue;
          for (const o of solid)
            if (o.id !== a.source.id && o.id !== a.target.id && crosses(centre(s), centre(t), o.box)) crossings++;
        }
        const texts = proposal.scene
          ? sceneTexts(proposal.scene)
          : [
              ...proposal.blocks.map(aiBlockText),
              ...(proposal.connections ?? []).map((c) => c.label),
              ...(proposal.mindmap ?? []).map((n) => n.text),
            ];
        const uncovered = uncoveredPassages(job.sources, texts);
        const passages = uncoveredPassages(job.sources, []).length;
        const extent = solid.length
          ? (() => {
              const x = Math.min(...solid.map((o) => o.box[0]));
              const y = Math.min(...solid.map((o) => o.box[1]));
              return [x, y, Math.max(...solid.map((o) => o.box[0] + o.box[2])) - x, Math.max(...solid.map((o) => o.box[1] + o.box[3])) - y];
            })()
          : [0, 0, 0, 0];
        const gap = (a, b) => Math.max(0, a[0] - (b[0] + b[2]), b[0] - (a[0] + a[2]), a[1] - (b[1] + b[3]), b[1] - (a[1] + a[3]));
        const nearChapter = existing.chapter ? Math.round(gap(extent, box(d.getBlock(existing.chapter).model))) : null;
        // Fit everything in view for the screenshot.
        const root = editor.querySelector("affine-edgeless-root");
        // Only real boxes: one bad bound (NaN) would leave the view where it was.
        const everything = [...all.map((o) => o.box), ...fresh.map((o) => o.box)].filter(
          (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite),
        );
        const x = Math.min(...everything.map((b) => b[0])) - 60;
        const y = Math.min(...everything.map((b) => b[1])) - 60;
        const w = Math.max(...everything.map((b) => b[0] + b[2])) - x + 60;
        const h = Math.max(...everything.map((b) => b[1] + b[3])) - y + 60;
        root.gfx.viewport.setViewportByBound({ x, y, w, h }, [10, 10, 10, 10]);
        await new Promise((r) => setTimeout(r, 900));
        return {
          applied: true,
          sameMap,
          plan: proposal.scene?.plan ?? "",
          layout: proposal.scene ? "scene" : chooseLayout(proposal.blocks.length, proposal.connections ?? []).kind,
          counts: {
            cards: fresh.filter((o) => o.kind === "card").length,
            frames: fresh.filter((o) => o.kind === "frame").length,
            shapes: fresh.filter((o) => o.kind === "shape").length,
            texts: fresh.filter((o) => o.kind === "text").length,
            mindmaps: fresh.filter((o) => o.kind === "mindmap").length,
            arrows: arrows.length,
          },
          overlaps,
          crossings,
          uncovered: uncovered.length,
          passages,
          extent: extent.map(Math.round),
          nearChapter,
          report: window.__lastReport,
        };
      }, job);
      if (result.applied) await page.screenshot({ path: `${outDir}/${job.id}.png` });
      summary.push({ id: job.id, ...result });
      console.log(JSON.stringify({ id: job.id, ...result, report: undefined }));
    }
    writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 1));
  }
  if (errors.length) console.log("page errors:", errors.slice(0, 5));
} finally {
  await browser.close();
}
