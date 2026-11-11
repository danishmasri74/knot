import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:1420");
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
    const { SaveCoordinator } = await import("/src/services/persistence.ts");
    const c = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("AI proof") });
    d.addBlock("affine:surface", {}, root);
    const note = d.addBlock("affine:note", {}, root);
    const id = d.addBlock(
      "affine:paragraph",
      {
        text: new Text([
          { insert: "Hello ", attributes: { bold: true } },
          { insert: "world" },
        ]),
      },
      note,
    );
    d.resetHistory();
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "page";
    document.querySelector(".editor-area").replaceChildren(editor);
    await editor.updateComplete;
    editor.std.selection.setGroup("note", [
      editor.std.selection.create("text", {
        from: { blockId: id, index: 0, length: 6 },
        to: null,
      }),
    ]);
    const { observeAiToolbar } =
      await import("/src/features/editor/blocksuite/ai-toolbar.ts");
    let toolbarContext;
    const stopToolbar = observeAiToolbar(
      () => editor,
      () => {
        toolbarContext = captureAiContext(editor, "workspace", null);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bar = editor.querySelector("affine-format-bar-widget");
    const action = bar?.configItems.find((item) => item.id === "knot-ask-ai");
    if (!action) throw Error("native AI toolbar action missing");
    action.action();
    if (toolbarContext?.text !== "Hello ")
      throw Error("toolbar lost selection");
    stopToolbar();
    if (bar.configItems.some((item) => item.id === "knot-ask-ai"))
      throw Error("toolbar cleanup failed");
    const context = captureAiContext(editor, "workspace", null);
    if (
      context.structure.length !== 1 ||
      context.structure[0].text !== "Hello " ||
      context.structure[0].note !== note
    )
      throw Error(
        "structured selection must retain note ownership and selected text only",
      );
    if (
      !context.surrounding.some((b) => b.id === id && b.text === "Hello world")
    )
      throw Error("selection must include read-only paragraph context");
    if (context.surrounding.reduce((n, b) => n + b.text.length, 0) > 4000)
      throw Error("surrounding context exceeded budget");
    if (context.text !== "Hello ")
      throw Error("selection capture: " + context.text);
    editor.std.selection.clear();
    const undo = applyAiProposal(
      d,
      "workspace",
      context,
      { replacements: ["Welcome "], blocks: [] },
      "rewrite",
    );
    const replaced = d.getBlock(id).model.text.toDelta();
    undo();
    const restored = d.getBlock(id).model.text.toDelta();
    let saved;
    const saver = new SaveCoordinator(
      async () => {
        saved = Y.encodeStateAsUpdate(d.spaceDoc);
      },
      () => {},
    );
    saver.changed();
    await saver.flush();
    saver.dispose();
    const c2 = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c2.meta.initialize();
    const reopened = c2.createDoc({ id: d.id });
    Y.applyUpdate(reopened.spaceDoc, saved);
    reopened.load();
    const reopenedText = reopened.getBlock(id).model.text.toDelta();
    let stale = false;
    try {
      applyAiProposal(
        d,
        "other",
        context,
        { replacements: ["bad"], blocks: [] },
        "rewrite",
      );
    } catch {
      stale = true;
    }
    const rejects = (fn) => {
      try {
        fn();
        return false;
      } catch {
        return true;
      }
    };
    const fresh = captureAiContext(editor, "workspace", null);
    const insertion = {
      replacements: [],
      blocks: [
        { type: "h2", text: "Heading" },
        { type: "paragraph", text: "Paragraph" },
        { type: "bulleted", text: "Bullet" },
        { type: "numbered", text: "Number" },
        { type: "todo", text: "Task" },
      ],
    };
    const wrongInstance = rejects(() =>
      applyAiProposal(reopened, "workspace", fresh, insertion, "insert"),
    );
    const malformed = rejects(() =>
      applyAiProposal(
        d,
        "workspace",
        fresh,
        { replacements: [], blocks: [{ type: "image", text: "bad" }] },
        "insert",
      ),
    );
    const undoInsert = applyAiProposal(
      d,
      "workspace",
      fresh,
      insertion,
      "insert",
    );
    const inserted = d
      .getBlock(note)
      .model.children.map((m) => ({ type: m.type, text: m.text.toString() }))
      .slice(-5);
    d.getBlock(id).model.text.delete(0, 1);
    const staleDelete = rejects(() =>
      applyAiProposal(
        d,
        "workspace",
        captureAiContext(editor, "workspace", null),
        { replacements: [], blocks: [] },
        "rewrite",
      ),
    );
    const guardedUndo = rejects(undoInsert);
    const staleInsertion = rejects(() =>
      applyAiProposal(d, "workspace", fresh, insertion, "insert"),
    );
    const beforeDelete = captureAiContext(editor, "workspace", null);
    d.getBlock(id).model.text.delete(0, 1);
    const deletionRevision = rejects(() =>
      applyAiProposal(d, "workspace", beforeDelete, insertion, "insert"),
    );
    const text = d.getBlock(id).model.text;
    text.format(0, 2, { reference: { type: "LinkedPage", pageId: "target" } });
    editor.std.selection.setGroup("note", [
      editor.std.selection.create("text", {
        from: { blockId: id, index: 0, length: 2 },
        to: null,
      }),
    ]);
    const linked = captureAiContext(editor, "workspace", null);
    const protectedReference = rejects(() =>
      applyAiProposal(
        d,
        "workspace",
        linked,
        { replacements: ["changed"], blocks: [] },
        "rewrite",
      ),
    );
    return {
      replaced,
      restored,
      reopenedText,
      stale,
      wrongInstance,
      malformed,
      inserted,
      staleDelete,
      guardedUndo,
      staleInsertion,
      deletionRevision,
      protectedReference,
    };
  });
  assert.deepEqual(result.replaced, [
    { insert: "Welcome ", attributes: { bold: true } },
    { insert: "world" },
  ]);
  assert.deepEqual(result.restored, [
    { insert: "Hello ", attributes: { bold: true } },
    { insert: "world" },
  ]);
  assert.deepEqual(result.reopenedText, result.restored);
  assert.ok(result.stale);
  for (const key of [
    "wrongInstance",
    "malformed",
    "staleDelete",
    "guardedUndo",
    "staleInsertion",
    "deletionRevision",
    "protectedReference",
  ])
    assert.ok(result[key], key);
  assert.deepEqual(
    result.inserted.map((b) => b.type),
    ["h2", "text", "bulleted", "numbered", "todo"],
  );
  console.log(
    "PASS selection → replacement → undo → save/reopen; formatting and workspace guard",
  );
} finally {
  await browser.close();
}
