// Break this into ideas: applying the suggestion's proposal replaces the
// original canvas card with idea cards in a frame at its place, keeps
// uncovered passages on an "Other details" card, moves arrows that pointed
// at the original to the frame, colors typed arrows, and sends the
// original's card to Trash. Undo brings everything back.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
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
    const { applyAiProposal, captureCardContext } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const { CardDeck } =
      await import("/src/features/editor/blocksuite/card-deck.ts");
    const { mcqDecks } =
      await import("/src/features/editor/blocksuite/mcq-block.ts");
    const { ATOMIZE_RELATIONS } = await import("/src/services/ai-atomize.ts");
    const c = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("Testing") });
    const surfaceId = d.addBlock("affine:surface", {}, root);
    const original = d.addBlock(
      "affine:note",
      { xywh: "[1000,500,448,400]" },
      root,
    );
    for (const text of [
      "Testing principles",
      "Testing shows the presence of defects, not their absence.",
      "Exhaustive testing is impossible except for trivial cases.",
      "Early testing saves time and money because late defects cost more.",
    ])
      d.addBlock("affine:paragraph", { text: new Text(text) }, original);
    const other = d.addBlock("affine:note", { xywh: "[0,500,300,200]" }, root);
    d.addBlock("affine:paragraph", { text: new Text("Course plan") }, other);
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "edgeless";
    document.querySelector(".editor-area").replaceChildren(editor);
    await editor.updateComplete;
    const surface = d.getBlock(surfaceId).model;
    const incoming = surface.addElement({
      type: "connector",
      source: { id: other },
      target: { id: original },
    });
    // The original is a Card Deck card.
    const deck = new CardDeck({}, () => {});
    mcqDecks.set(d.spaceDoc, deck);
    deck.data.card1 = { id: "card1", nodes: [], createdAt: 1, updatedAt: 1 };
    d.spaceDoc.getMap("knot:card-links").set(original, "card1");
    d.resetHistory();
    const context = captureCardContext(d, "test", d.getBlock(original).model);
    const card = (text, detail) => ({
      type: "paragraph",
      text,
      columns: [],
      rows: [],
      children: [
        { type: "paragraph", text: detail, columns: [], rows: [] },
      ],
    });
    const undo = applyAiProposal(
      d,
      "test",
      context,
      {
        replacements: [],
        mindmap: [],
        blocks: [
          card(
            "Testing finds defects",
            "Testing shows defects are present, never that they are absent.",
          ),
          card(
            "Early testing is cheaper",
            "Early testing saves money: late defects cost more time.",
          ),
        ],
        connections: [{ from: 1, to: 0, label: "requires" }],
      },
      "canvas",
      { replaces: original },
    );
    const notes = d.getBlocksByFlavour("affine:note").map((b) => b.model);
    const frame = d.getBlocksByFlavour("affine:frame")[0]?.model;
    const firstLines = notes
      .filter((n) => n.id !== other)
      .map((n) => n.children[0]?.text?.toString());
    const details = notes.find(
      (n) => n.children[0]?.text?.toString() === "Other details",
    );
    const arrows = surface.elementModels.filter((e) => e.type === "connector");
    const typed = arrows.find((e) => e.id !== incoming);
    const frameBox = frame && JSON.parse(frame.xywh);
    const after = {
      originalGone: !d.getBlock(original),
      firstLines,
      otherDetails: details?.children[0]?.children
        ?.map((b) => b.text.toString())
        .concat(details.children.slice(1).map((b) => b.text.toString())),
      frameTitle: frame?.title.toString(),
      frameHolds: frame ? Object.keys(frame.childElementIds).length : 0,
      frameAtOriginal: frameBox?.[0] === 1000 && frameBox?.[1] === 500,
      incomingToFrame: arrows.find((e) => e.id === incoming)?.target.id === frame?.id,
      typedColor: typed?.stroke,
      openCard: d.getBlock(undo.noteId)?.model.children[0]?.text?.toString(),
      cardTrashed: deck.data.card1.deleted === true,
    };
    undo();
    return {
      after,
      undone: {
        original: !!d.getBlock(original),
        frames: d.getBlocksByFlavour("affine:frame").length,
        notes: d.getBlocksByFlavour("affine:note").length,
        incomingToOriginal:
          surface.elementModels.find((e) => e.id === incoming)?.target.id ===
          original,
        cardBack: !deck.data.card1.deleted,
      },
      requires: ATOMIZE_RELATIONS.requires,
    };
  });
  const { after, undone } = result;
  assert.equal(after.originalGone, true, "original removed");
  assert.deepEqual(after.firstLines.sort(), [
    "Early testing is cheaper",
    "Other details",
    "Testing finds defects",
  ]);
  assert.ok(
    JSON.stringify(after.otherDetails).includes(
      "Exhaustive testing is impossible except for trivial cases.",
    ),
    `uncovered passage kept: ${JSON.stringify(after.otherDetails)}`,
  );
  assert.equal(after.frameTitle, "Testing principles");
  assert.equal(after.frameHolds, 3, "frame holds the new cards");
  assert.ok(after.frameAtOriginal, "group takes the original's place");
  assert.ok(after.incomingToFrame, "arrow to the original now hits the frame");
  assert.deepEqual(after.typedColor, result.requires, "typed arrow color");
  assert.equal(after.openCard, "Testing finds defects", "Open cards target");
  assert.ok(after.cardTrashed, "original card in Trash");
  assert.deepEqual(undone, {
    original: true,
    frames: 0,
    notes: 2,
    incomingToOriginal: true,
    cardBack: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Break into ideas: replaced in place in a frame, details kept, arrows moved and typed, Trash and Undo work",
  );
} finally {
  await browser.close();
}
