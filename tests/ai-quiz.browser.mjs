// Applying a create_quiz proposal writes each question to the Card Deck and
// appends a question reference to the end of the captured note, in one undo
// step; Undo removes the references and moves the questions to Trash.
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
    const { CardDeck, cardMcq, mcqReferenceFlavour } =
      await import("/src/features/editor/blocksuite/card-deck.ts");
    const { McqSchema, McqReferenceSchema, mcqDecks } =
      await import("/src/features/editor/blocksuite/mcq-block.ts");
    const c = new DocCollection({
      // Notes may hold question references, as in adapter.ts.
      schema: new Schema().register([
        ...AffineSchemas.map((schema) =>
          schema.model.flavour === "affine:note"
            ? {
                ...schema,
                model: {
                  ...schema.model,
                  children: [
                    ...(schema.model.children ?? []),
                    mcqReferenceFlavour,
                  ],
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
    const root = d.addBlock("affine:page", { title: new Text("Biology") });
    d.addBlock("affine:surface", {}, root);
    const note = d.addBlock("affine:note", { xywh: "[0,0,448,200]" }, root);
    d.addBlock(
      "affine:paragraph",
      { text: new Text("Photosynthesis makes glucose from light.") },
      note,
    );
    d.resetHistory();
    let saves = 0;
    const deck = new CardDeck({}, () => saves++);
    mcqDecks.set(d.spaceDoc, deck);
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "page";
    document.querySelector(".editor-area").replaceChildren(editor);
    await editor.updateComplete;
    const context = captureAiContext(editor, "workspace", note);
    const questions = [
      {
        question: "What does photosynthesis make?",
        options: ["Glucose", "Protein", "Fat"],
        correct: 0,
        explanation: "The note says it makes glucose.",
      },
      {
        question: "What powers photosynthesis?",
        options: ["Heat", "Light"],
        correct: 1,
        explanation: "",
      },
    ];
    const attempt = (proposal) => {
      try {
        applyAiProposal(d, "workspace", context, proposal, "quiz");
        return "";
      } catch (error) {
        return String(error);
      }
    };
    const invalid = attempt({
      replacements: [],
      blocks: [],
      questions: [{ ...questions[0], correct: 3 }],
    });
    const mixed = attempt({
      replacements: [],
      blocks: [
        { type: "paragraph", text: "x", columns: [], rows: [], children: [] },
      ],
      questions,
    });
    const before = { cards: Object.keys(deck.data).length, saves };
    const undo = applyAiProposal(
      d,
      "workspace",
      context,
      { replacements: [], blocks: [], questions },
      "quiz",
    );
    const children = d.getBlock(note).model.children;
    const refs = children.filter((b) => b.flavour === mcqReferenceFlavour);
    const saved = refs.map((b) => cardMcq(deck.data[b.cardId]));
    const after = {
      last: children.at(-1)?.flavour,
      firstIsParagraph: children[0].flavour === "affine:paragraph",
      refs: refs.length,
      flavours: children.map((b) => b.flavour),
      questions: saved.map((q) => q?.question),
      correct: saved.map(
        (q) => q?.options.find((o) => o.id === q.correctOptionId)?.text,
      ),
      sources: saved[0]?.sources,
      saves,
    };
    undo();
    return {
      invalid,
      mixed,
      before,
      after,
      undone: {
        refs: d
          .getBlock(note)
          .model.children.filter((b) => b.flavour === mcqReferenceFlavour)
          .length,
        trashed: refs.every((b) => deck.data[b.cardId]?.deleted),
      },
    };
  });
  assert.match(result.invalid, /Invalid quiz questions/);
  assert.match(result.mixed, /Invalid quiz questions/, "questions only");
  assert.deepEqual(result.before, { cards: 0, saves: 0 }, "nothing written");
  assert.equal(result.after.refs, 2, JSON.stringify(result.after));
  assert.equal(result.after.last, "knot:mcq-reference", "added at the end");
  assert.ok(result.after.firstIsParagraph, "existing text kept first");
  assert.deepEqual(result.after.questions, [
    "What does photosynthesis make?",
    "What powers photosynthesis?",
  ]);
  assert.deepEqual(result.after.correct, ["Glucose", "Light"]);
  assert.equal(result.after.sources[0].notebookId.length > 0, true);
  assert.ok(result.after.saves >= 2, "deck changes are saved");
  assert.deepEqual(result.undone, { refs: 0, trashed: true });
  assert.deepEqual(errors, []);
  console.log(
    "AI quiz: questions saved to the deck, referenced at the note's end, undo removes them",
  );
} finally {
  await browser.close();
}
