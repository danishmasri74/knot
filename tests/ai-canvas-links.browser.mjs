// Phase 2 of canvas awareness: a canvas proposal can link new cards to
// existing ones through canvas map handles (placed beside them, typed arrow
// color, one undo step), stale handles are refused, and a quiz about a
// frame goes beside that frame with an arrow from it.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
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
    const { captureAiContext, applyAiProposal } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const { CardDeck, mcqReferenceFlavour } =
      await import("/src/features/editor/blocksuite/card-deck.ts");
    const { McqSchema, McqReferenceSchema, mcqDecks } =
      await import("/src/features/editor/blocksuite/mcq-block.ts");
    const { canvasHandles } = await import("/src/services/canvas-map-format.ts");
    const { ATOMIZE_RELATIONS } = await import("/src/services/ai-atomize.ts");
    const c = new DocCollection({
      schema: new Schema().register([
        ...AffineSchemas.map((schema) =>
          schema.model.flavour === "affine:note"
            ? {
                ...schema,
                model: {
                  ...schema.model,
                  children: [...(schema.model.children ?? []), mcqReferenceFlavour],
                },
              }
            : schema,
        ),
        McqSchema,
        McqReferenceSchema,
      ]),
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
    const statik = note("[0,0,300,150]", "Static testing");
    const defects = note("[1040,560,300,150]", "Testing finds defects");
    const frame = d.addBlock(
      "affine:frame",
      {
        title: new Text("Testing principles"),
        xywh: "[1000,500,400,300]",
        childElementIds: { [defects]: true },
      },
      surfaceId,
    );
    mcqDecks.set(d.spaceDoc, new CardDeck({}, () => {}));
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "edgeless";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff";
    document.body.append(host);
    host.append(editor);
    await editor.updateComplete;
    await new Promise((r) => setTimeout(r, 300));
    d.resetHistory();
    const surface = d.getBlock(surfaceId).model;
    const capture = () => captureAiContext(editor, "test", null);
    const handleOf = (context, id) =>
      [...canvasHandles(context.canvasMap)].find(([, t]) => t.id === id)?.[0];
    const block = (text) => ({
      type: "paragraph",
      text,
      columns: [],
      rows: [],
      children: [],
    });

    // A new card that requires an existing one.
    let context = capture();
    const statikHandle = handleOf(context, statik);
    let stale = "";
    try {
      applyAiProposal(
        d,
        "test",
        context,
        {
          replacements: [],
          blocks: [block("Early testing is cheaper")],
          connections: [],
          links: [{ card: 0, existing: "K99", label: "requires", toExisting: true }],
        },
        "canvas",
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
        blocks: [block("Early testing is cheaper")],
        connections: [],
        links: [
          { card: 0, existing: statikHandle, label: "requires", toExisting: true },
        ],
      },
      "canvas",
    );
    const created = d.getBlock(undo.noteId).model;
    const arrow = surface.elementModels.find((e) => e.type === "connector");
    const link = {
      stale,
      from: arrow?.source.id === created.id,
      to: arrow?.target.id === statik,
      label: String(arrow?.text ?? ""),
      color: arrow?.stroke,
      besideTarget: JSON.parse(created.xywh)[0] >= 300 + 160,
    };
    // BlockSuite re-centres arrow labels shortly after; Undo must still work.
    await new Promise((r) => setTimeout(r, 600));
    undo();
    const undone = {
      cards: d.getBlocksByFlavour("affine:note").length,
      arrows: surface.elementModels.filter((e) => e.type === "connector").length,
    };

    // A quiz about the frame.
    context = capture();
    const quizUndo = applyAiProposal(
      d,
      "test",
      context,
      {
        replacements: [],
        blocks: [],
        target: "card",
        about: handleOf(context, frame),
        questions: [
          {
            question: "What does testing show?",
            options: ["Defects are present", "Defects are absent"],
            correct: 0,
            explanation: "",
          },
        ],
      },
      "quiz",
    );
    const quiz = d.getBlock(quizUndo.noteId).model;
    const quizArrow = surface.elementModels.find((e) => e.type === "connector");
    const aboutFrame = {
      title: quiz.children[0].text.toString(),
      rightOfFrame: JSON.parse(quiz.xywh)[0] >= 1000 + 400 + 120,
      arrowFromFrame: quizArrow?.source.id === frame,
    };
    quizUndo();
    return { link, undone, aboutFrame, requires: ATOMIZE_RELATIONS.requires };
  });
  assert.match(result.link.stale, /isn't on the canvas any more/);
  assert.deepEqual(
    { ...result.link, stale: undefined },
    {
      stale: undefined,
      from: true,
      to: true,
      label: "requires",
      color: result.requires,
      besideTarget: true,
    },
  );
  assert.deepEqual(result.undone, { cards: 2, arrows: 0 });
  assert.deepEqual(result.aboutFrame, {
    title: "Quiz: Testing principles",
    rightOfFrame: true,
    arrowFromFrame: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Canvas links: new card linked to an existing card beside it, stale handle refused, undo; quiz about a frame sits beside it",
  );
} finally {
  await browser.close();
}
