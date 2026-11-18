// Phase 3 benchmark plumbing: an outlined scene built in stages, in a real
// editor page (for Knot's own functions), with no paid calls of its own.
//
//   sections <run> <label>    reads the outline in a run of scenes-big.v1.json
//                             and writes results/build-<label>-sections.json:
//                             one scene_section case per section.
//   connect <run> <label>     assembles the built sections and writes
//                             results/build-<label>-connect.json (scene_connect).
//   final <run> <label>       applies the connect step (frames only, as Ask Knot
//                             does) and writes results/<label>-final.jsonl in
//                             the scenes-run format for review-scenes.mjs and
//                             replay-scenes.mjs (KNOT_SCENES_SUITE=the big suite).
// Paid steps run with KNOT_BENCHMARK_SUITE=file KNOT_BENCHMARK_INPUT=<file>.
// Dev server running (pnpm dev).
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [command, run, label] = process.argv.slice(2);
if (!["sections", "connect", "final"].includes(command) || !run || !label)
  throw new Error("Usage: sections|connect|final <run> <label>");
const results = "tests/benchmarks/results";
const suite = JSON.parse(readFileSync("tests/benchmarks/scenes-big.v1.json", "utf8"));
const fixture = suite.cases[0];
const request = fixture.messages[0].content;
const rows = readFileSync(`${results}/${run}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).slice(1);
const json = (output) => JSON.parse(output.slice(output.indexOf("{")));

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420", { timeout: 300000 });
  await page.waitForSelector(".app-shell", { timeout: 300000 });
  const call = (fn, arg) =>
    page.evaluate(
      async ({ fn, arg }) => {
        const scene = await import("/src/features/editor/blocksuite/scene.ts");
        const build = await import("/src/features/editor/blocksuite/scene-build.ts");
        if (fn === "outline") return scene.readOutline(arg);
        if (fn === "message") return build.sectionMessage(arg.outline, arg.section);
        if (fn === "assemble") return scene.assembleSections(arg.outline, arg.built);
        if (fn === "connect") {
          const { scene: s, revision } = arg;
          const frames = new Set(s.objects.filter((o) => o.kind === "frame").map((o) => o.id));
          return scene.mergeScene(s, {
            ...revision,
            objects: revision.objects.filter((o) => frames.has(o?.id)),
            remove: [],
            arrangements: [],
            removeArrangements: [],
            removeConnectors: [],
          });
        }
      },
      { fn, arg },
    );

  if (command === "sections") {
    const outline = await call("outline", json(rows[0].output));
    if (!outline) throw new Error("That run has no outline.");
    const cases = [];
    for (const section of outline.sections)
      cases.push({
        id: `${fixture.id}:${section.id}`,
        category: "scene_section",
        mode: "scene_section",
        context: fixture.context,
        messages: [
          { role: "user", content: request },
          { role: "user", content: await call("message", { outline, section }) },
        ],
        rubric: fixture.rubric,
      });
    writeFileSync(`${results}/build-${label}-outline.json`, JSON.stringify(outline));
    writeFileSync(`${results}/build-${label}-sections.json`, JSON.stringify({ version: `knot-build-${label}-sections`, from: run, cases }));
    console.log(`wrote build-${label}-sections.json with ${cases.length} sections`);
  } else if (command === "connect") {
    const outline = JSON.parse(readFileSync(`${results}/build-${label}-outline.json`, "utf8"));
    const built = {};
    for (const row of rows) if (row.success) built[row.case.split(":")[1]] = json(row.output);
    const scene = await call("assemble", { outline, built });
    console.log(`assembled ${Object.keys(built).length} of ${outline.sections.length} sections: ${scene.objects.length} objects, ${scene.connectors.length} arrows`);
    writeFileSync(`${results}/build-${label}-assembled.json`, JSON.stringify(scene));
    writeFileSync(
      `${results}/build-${label}-connect.json`,
      JSON.stringify({
        version: `knot-build-${label}-connect`,
        from: run,
        cases: [
          {
            id: `${fixture.id}:connect`,
            category: "scene_connect",
            mode: "scene_connect",
            context: {
              request,
              outline: outline.sections,
              scene: { plan: scene.plan, anchor: scene.anchor, objects: scene.objects, arrangements: scene.arrangements, connectors: scene.connectors },
            },
            messages: [{ role: "user", content: "Connect and arrange the sections." }],
            rubric: ["Arrows between sections where the content relates them; sections arranged in a readable order; nothing else changed."],
          },
        ],
      }),
    );
  } else {
    const scene = JSON.parse(readFileSync(`${results}/build-${label}-assembled.json`, "utf8"));
    const revision = rows[0]?.success ? json(rows[0].output) : null;
    const final = revision ? await call("connect", { scene, revision }) : scene;
    const added = final.connectors.length - scene.connectors.length;
    console.log(`connect step: ${added} arrows between sections, summary: ${revision?.summary ?? ""}`);
    const args = { plan: final.plan, anchor: final.anchor, objects: final.objects, arrangements: final.arrangements, connectors: final.connectors };
    writeFileSync(
      `${results}/${label}-final.jsonl`,
      [{ run: `${label}-final`, suite: suite.version, kind: "built" }, { case: fixture.id, success: true, output: JSON.stringify(args) }]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    console.log(`wrote ${label}-final.jsonl`);
  }
} finally {
  await browser.close();
}
