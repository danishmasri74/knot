// Phase 2 benchmark plumbing for scene reviews, in a real editor, no paid calls.
//
//   prepare <run> <label>   measures each new-path scene of a scenes run (or a
//                           merged run), draws its schematic and writes
//                           results/review-<label>.json for the paid runner
//                           (KNOT_BENCHMARK_SUITE=review KNOT_BENCHMARK_INPUT=...).
//   merge <review-run> <label>
//                           applies that review run's changes, keeps a scene's
//                           change only when it measures better (as Ask Knot
//                           does), and writes results/<label>-merged.jsonl in
//                           the scenes-run format, ready for replay-scenes.mjs
//                           or another prepare.
// Dev server running (pnpm dev).
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [command, run, label] = process.argv.slice(2);
if (!["prepare", "merge"].includes(command) || !run || !label)
  throw new Error("Usage: prepare <run> <label> | merge <review-run> <label>");
const results = "tests/benchmarks/results";
const suite = JSON.parse(readFileSync(process.env.KNOT_SCENES_SUITE ?? "tests/benchmarks/scenes.v1.json", "utf8"));
const readRun = (id) =>
  readFileSync(`${results}/${id}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420", { timeout: 300000 });
  await page.waitForSelector(".app-shell", { timeout: 300000 });
  await page.evaluate(async () => {
    const { DocCollection, Schema, Text } = await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } = await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } = await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const ai = await import("/src/features/editor/blocksuite/ai.ts");
    const review = await import("/src/features/editor/blocksuite/scene-review.ts");
    const scene = await import("/src/features/editor/blocksuite/scene.ts");
    const { sceneSchematic } = await import("/src/features/editor/blocksuite/scene-schematic.ts");
    const { canvasHandles } = await import("/src/services/canvas-map-format.ts");
    // The same canvases as replay-scenes.mjs.
    const build = async (withChapter) => {
      const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
      c.meta.initialize();
      const d = c.createDoc();
      d.load();
      const root = d.addBlock("affine:page", { title: new Text("Software Testing") });
      d.addBlock("affine:surface", {}, root);
      let chapter = null;
      if (withChapter) {
        chapter = d.addBlock("affine:note", { xywh: "[0,0,420,560]" }, root);
        d.addBlock("affine:paragraph", { type: "h2", text: new Text("Testing in the software development lifecycle") }, chapter);
        d.addBlock("affine:paragraph", { text: new Text("Every development activity has a matching test activity; sequential and iterative models, shift left, retrospectives and DevOps.") }, chapter);
        const dates = d.addBlock("affine:note", { xywh: "[-900,700,360,180]" }, root);
        d.addBlock("affine:paragraph", { type: "h2", text: new Text("Exam dates") }, dates);
        d.addBlock("affine:paragraph", { text: new Text("Mock exam on 20 May, final on 3 June.") }, dates);
      }
      const editor = new AffineEditorContainer();
      editor.doc = d;
      editor.mode = "edgeless";
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff";
      document.body.replaceChildren(host);
      host.append(editor);
      await editor.updateComplete;
      await new Promise((r) => setTimeout(r, 200));
      const context = ai.captureAiContext(editor, "replay", chapter);
      const handles = context.canvasMap ? new Set(canvasHandles(context.canvasMap).keys()) : new Set();
      const existing = context.canvasMap
        ? [...canvasHandles(context.canvasMap).values()].flatMap((t) => (t.box ? [{ box: t.box, title: t.title }] : []))
        : [];
      return { d, context, handles, existing };
    };
    const VIEW = [-200, -200, 1600, 1000];
    const measure = async (job, sceneValue) => {
      const { d, context, existing } = await build(job.withChapter);
      const m = review.measureScene(d, context, sceneValue, { view: VIEW, sources: job.sources });
      return { m, existing };
    };
    window.__review = {
      async prepare(job) {
        const { handles } = await build(job.withChapter);
        const s = ai.validateProposal({ replacements: [], blocks: [], ...JSON.parse(job.output) }, undefined, handles).scene;
        const { m, existing } = await measure(job, s);
        const { issues, ...report } = m.report;
        return {
          issues,
          scene: s,
          context: {
            request: job.request,
            scene: { plan: s.plan, anchor: s.anchor, objects: s.objects, arrangements: s.arrangements, connectors: s.connectors },
            report,
          },
          image: sceneSchematic(s, m.planned.boxes, existing),
        };
      },
      async merge(job) {
        const { handles } = await build(job.withChapter);
        const before = (await measure(job, job.scene)).m.report;
        let revision;
        try {
          revision = JSON.parse(job.output);
        } catch {
          return { kept: false, reason: "unreadable", before: before.issues, after: before.issues, scene: job.scene };
        }
        if (!scene.revisionChanges(revision))
          return { kept: false, reason: "no changes", before: before.issues, after: before.issues, scene: job.scene, summary: revision.summary };
        const next = scene.mergeScene(job.scene, revision, handles);
        const after = (await measure(job, next)).m.report;
        const kept = after.issues < before.issues;
        return {
          kept,
          reason: kept ? "better" : "not better",
          before: before.issues,
          after: kept ? after.issues : before.issues,
          tried: after.issues,
          detail: { before: summary(before), after: summary(after) },
          summary: revision.summary,
          scene: kept ? next : job.scene,
        };
        function summary(r) {
          return { crossings: r.crossings.length, arrowCrossings: r.arrowCrossings.length, order: r.order.length, adjustments: r.adjustments.length, missing: r.missing.length };
        }
      },
    };
  });

  const fixtureOf = (caseId) => suite.cases.find((c) => c.id === caseId);
  const jobFor = (caseId) => {
    const f = fixtureOf(caseId);
    return {
      id: caseId,
      withChapter: !!f.context.canvasMap,
      sources: f.context.citationSources.map((s) => s.text),
      request: f.messages[0].content,
    };
  };

  if (command === "prepare") {
    const rows = readRun(run).slice(1).filter((r) => r.success && fixtureOf(r.case)?.path === "new");
    const cases = [];
    const scenes = {};
    for (const row of rows) {
      const start = row.output.indexOf("{");
      const job = { ...jobFor(row.case), output: row.output.slice(start) };
      const prepared = await page.evaluate((job) => window.__review.prepare(job), job);
      scenes[row.case] = prepared.scene;
      console.log(`${row.case}: ${prepared.issues} issues`);
      if (!prepared.issues) continue;
      cases.push({
        id: row.case,
        category: "scene_review",
        mode: "scene_review",
        context: prepared.context,
        messages: [{ role: "user", content: "Review the draft of your scene." }],
        image_data: prepared.image,
        rubric: ["Fewer crossings, order problems and missing passages; nothing invented; nothing the source relates disconnected."],
        issues: prepared.issues,
      });
    }
    writeFileSync(`${results}/review-${label}.json`, JSON.stringify({ version: `knot-scene-review-${label}`, from: run, cases }));
    writeFileSync(`${results}/review-${label}.scenes.json`, JSON.stringify(scenes));
    console.log(`wrote review-${label}.json with ${cases.length} cases`);
  } else {
    const scenes = JSON.parse(readFileSync(`${results}/review-${label}.scenes.json`, "utf8"));
    const reviewed = new Map(readRun(run).slice(1).filter((r) => r.success).map((r) => [r.case, r.output]));
    const out = [{ run: `${label}-merged`, suite: "knot-scenes-v1", kind: "merged", from: run }];
    const summary = [];
    for (const [caseId, sceneValue] of Object.entries(scenes)) {
      let final = sceneValue;
      if (reviewed.has(caseId)) {
        const result = await page.evaluate((job) => window.__review.merge(job), {
          ...jobFor(caseId),
          scene: sceneValue,
          output: reviewed.get(caseId),
        });
        final = result.scene;
        summary.push({ id: caseId, ...result, scene: undefined });
        console.log(JSON.stringify({ id: caseId, ...result, scene: undefined }));
      }
      const args = { plan: final.plan, anchor: final.anchor, objects: final.objects, arrangements: final.arrangements, connectors: final.connectors };
      out.push({ case: caseId, success: true, output: JSON.stringify(args) });
    }
    writeFileSync(`${results}/${label}-merged.jsonl`, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(`${results}/${label}-merge-summary.json`, JSON.stringify(summary, null, 1));
    console.log(`wrote ${label}-merged.jsonl`);
  }
} finally {
  await browser.close();
}
