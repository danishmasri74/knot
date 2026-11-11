// Replays ONLY the synthetic benchmark's live edit proposals into an isolated
// browser editor. No API calls and no access to the user's installed workspace.
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const run = process.argv[2];
assert.match(run ?? "", /^[0-9a-f-]{36}$/);
const root = new URL("./", import.meta.url);
const suite = JSON.parse(
  await readFile(new URL("cases.v1.json", root), "utf8"),
);
const rows = (await readFile(new URL(`results/${run}.jsonl`, root), "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse)
  .slice(1);
const cases = suite.cases
  .filter((c) => c.mode !== "ask")
  .map((c) => ({
    ...c,
    result: rows.findLast((r) => r.case === c.id && r.success),
  }));
assert.ok(
  cases.every((c) => c.result),
  "Every edit case must have a live successful response",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  const results = await page.evaluate(async (cases) => {
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } =
      await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const { validateProposal, captureAiContext, applyAiProposal } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const results = [];
    for (const fixture of cases) {
      const collection = new DocCollection({
        schema: new Schema().register(AffineSchemas),
      });
      collection.meta.initialize();
      const doc = collection.createDoc();
      doc.load();
      const root = doc.addBlock("affine:page", {
        title: new Text("Synthetic benchmark"),
      });
      doc.addBlock("affine:surface", {}, root);
      const note =
        fixture.mode === "canvas"
          ? null
          : doc.addBlock("affine:note", {}, root);
      const ranges = fixture.context.runs.map((run) => {
        const attributes = run.protected
          ? { link: "https://example.invalid/synthetic" }
          : {};
        const id = doc.addBlock(
          "affine:paragraph",
          { text: new Text([{ insert: run.text, attributes }]) },
          note,
        );
        return {
          id,
          start: 0,
          length: run.text.length,
          text: run.text,
          attributes,
        };
      });
      if (note && !ranges.length)
        doc.addBlock(
          "affine:paragraph",
          { text: new Text("Synthetic unchanged original") },
          note,
        );
      const editor = new AffineEditorContainer();
      editor.doc = doc;
      editor.mode = fixture.mode === "canvas" ? "edgeless" : "page";
      document.querySelector(".editor-area").replaceChildren(editor);
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 100));
      doc.resetHistory();
      const before = Object.keys(doc.blocks.peek()).sort();
      const result = {
        case: fixture.id,
        valid: false,
        applied: false,
        undo: false,
        error: null,
      };
      try {
        const proposal = validateProposal(JSON.parse(fixture.result.output));
        result.valid = true;
        const context = captureAiContext(editor, "synthetic-benchmark", null);
        context.ranges = ranges;
        context.note = note;
        const undo = applyAiProposal(
          doc,
          "synthetic-benchmark",
          context,
          proposal,
          fixture.mode,
        );
        result.applied = true;
        await new Promise((resolve) => setTimeout(resolve, 100));
        undo();
        const after = Object.keys(doc.blocks.peek()).sort();
        result.undo =
          JSON.stringify(before) === JSON.stringify(after) &&
          ranges.every(
            (r) => doc.getBlock(r.id).model.text.toString() === r.text,
          );
      } catch (error) {
        result.error = String(error);
      }
      results.push(result);
      editor.remove();
      collection.dispose();
    }
    return results;
  }, cases);
  await writeFile(
    new URL(`results/${run}.editor.json`, root),
    JSON.stringify(
      { kind: "live-output-offline-editor-replay", results },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
