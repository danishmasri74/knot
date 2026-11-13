// Applying a create_note proposal adds one new note to the open notebook,
// titled by its first block, after the existing notes; Undo removes it.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  const result = await page.evaluate(async () => {
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } =
      await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const { captureAiContext, applyAiProposal } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const c = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("Team") });
    d.addBlock("affine:surface", {}, root);
    const existing = d.addBlock("affine:note", { xywh: "[0,0,448,200]" }, root);
    d.addBlock(
      "affine:paragraph",
      { text: new Text("Existing note") },
      existing,
    );
    d.resetHistory();
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "page";
    document.querySelector(".editor-area").replaceChildren(editor);
    await editor.updateComplete;
    const context = captureAiContext(editor, "workspace", null);
    const block = (type, text) => ({
      type,
      text,
      columns: [],
      rows: [],
      children: [],
    });
    let empty = "";
    try {
      applyAiProposal(
        d,
        "workspace",
        context,
        { replacements: [], blocks: [] },
        "note",
      );
    } catch (error) {
      empty = String(error);
    }
    const undo = applyAiProposal(
      d,
      "workspace",
      context,
      {
        replacements: [],
        blocks: [
          block("h1", "Onboarding"),
          block("bulleted", "Set up the laptop"),
        ],
      },
      "note",
    );
    const notes = d.getBlocksByFlavour("affine:note").map((b) => b.model);
    const created = d.getBlock(undo.noteId)?.model;
    const after = {
      notes: notes.length,
      first: created?.children[0]
        ? {
            flavour: created.children[0].flavour,
            type: created.children[0].type,
            text: created.children[0].text.toString(),
          }
        : null,
      second: created?.children[1]?.text?.toString(),
      x: JSON.parse(created.xywh)[0],
      existingUntouched:
        d.getBlock(existing).model.children[0].text.toString() ===
        "Existing note",
    };
    undo();
    return {
      empty,
      after,
      undone: d.getBlocksByFlavour("affine:note").length,
    };
  });
  assert.match(result.empty, /Open a notebook to add the new note/);
  assert.equal(result.after.notes, 2, "one new note");
  assert.deepEqual(result.after.first, {
    flavour: "affine:paragraph",
    type: "h1",
    text: "Onboarding",
  });
  assert.equal(result.after.second, "Set up the laptop");
  assert.ok(result.after.x >= 488, "placed after the existing note");
  assert.ok(result.after.existingUntouched);
  assert.equal(result.undone, 1, "Undo removes the new note");
  assert.deepEqual(errors, []);
  console.log(
    "AI create note: new titled note after the others, undo removes it",
  );
} finally {
  await browser.close();
}
