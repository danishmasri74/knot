import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/chat-add-card-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root" style="display:flex;height:760px;width:440px"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/chat-add-card-test");
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (t) => t;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { CardDeck, cardPreview } =
      await import("/src/features/editor/blocksuite/card-deck.ts");
    const collection = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    collection.meta.initialize();
    const doc = collection.createDoc();
    doc.load();
    const root = doc.addBlock("affine:page", { title: new Text("Chat cards") });
    doc.addBlock("affine:surface", {}, root);
    const note = doc.addBlock("affine:note", { xywh: "[0,0,400,200]" }, root);
    doc.addBlock("affine:paragraph", { text: new Text("Existing note") }, note);
    const deck = new CardDeck({}, () => {});
    deck.attach(doc.spaceDoc);
    doc.resetHistory();
    window.testDoc = doc;
    window.testDeck = deck;
    window.cardPreview = cardPreview;
    window.session = { doc, editor: new EventTarget(), imageSources: () => [] };
    localStorage.clear();
    localStorage.setItem(
      "knot.ai.chats.v1:chat-card:fixture",
      JSON.stringify({
        id: "fixture",
        documentId: doc.id,
        title: "Saved replies",
        updated: Date.now(),
        turns: [
          { role: "user", content: "Explain" },
          {
            role: "assistant",
            content: "A **saved** answer.\n\nAnother paragraph.",
          },
          {
            role: "assistant",
            content: "Preview",
            mode: "insert",
            proposal: {
              replacements: [],
              blocks: [
                { type: "h2", text: "Heading" },
                { type: "bulleted", text: "List item" },
              ],
            },
          },
          {
            role: "assistant",
            content: "Replacement",
            mode: "rewrite",
            proposal: {
              replacements: ["Rewritten text"],
              blocks: [],
            },
          },
          { role: "assistant", content: "" },
        ],
      }),
    );
    window.chatStore = new Map();
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        // Chats live in the workspace; the browser-stored seed is moved there.
        if (cmd === "ai_chats_list") return [...window.chatStore.values()];
        if (cmd === "ai_chat_save") return void window.chatStore.set(args.id, args.data);
        if (cmd === "ai_chat_delete") return void window.chatStore.delete(args.id);
        return cmd === "ai_connected"
          ? true
          : cmd === "ai_models"
            ? ["gpt-5.4-mini"]
            : undefined;
      },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { AskKnot } = await import("/src/app/AskKnot.tsx");
    createRoot(document.getElementById("root")).render(
      React.createElement(AskKnot, {
        workspace: "chat-card",
        documentId: doc.id,
        initial: null,
        suggestion: null,
        onBusy: () => {},
        getSession: () => window.session,
      }),
    );
  });
  const buttons = page.getByRole("button", {
    name: "Add as a card",
    exact: true,
  });
  await buttons.first().waitFor();
  assert.equal(await buttons.count(), 4, "each AI message has a card action");
  assert.equal(
    await page
      .locator(".ask-user")
      .getByRole("button", { name: "Add as a card" })
      .count(),
    0,
  );
  assert.equal(
    await buttons.last().isDisabled(),
    true,
    "empty response cannot create a card",
  );
  await buttons.nth(0).click();
  await page.getByRole("status").filter({ hasText: "Card added" }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => {
      const notes = window.testDoc.getBlocksByFlavour("affine:note");
      return {
        count: notes.length,
        text: notes[1].model.children[0].text.toString(),
        outsideExisting: JSON.parse(notes[1].model.xywh)[0] >= 480,
        deckHasReply: Object.values(window.testDeck.data).some((card) =>
          window.cardPreview(card).includes("A saved answer."),
        ),
      };
    }),
    {
      count: 2,
      text: "A saved answer.\n\nAnother paragraph.",
      outsideExisting: true,
      deckHasReply: true,
    },
  );
  await page.evaluate(() => window.testDoc.undo());
  assert.equal(
    await page.evaluate(
      () => window.testDoc.getBlocksByFlavour("affine:note").length,
    ),
    1,
    "Undo removes the added card only",
  );
  await buttons.nth(1).click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.testDoc
        .getBlocksByFlavour("affine:note")
        .at(-1)
        .model.children.map((b) => [b.flavour, b.type, b.text.toString()]),
    ),
    [
      ["affine:paragraph", "h2", "Heading"],
      ["affine:list", "bulleted", "List item"],
    ],
    "structured preview becomes a single card with editable blocks",
  );
  await buttons.nth(2).click();
  assert.equal(
    await page.evaluate(() =>
      window.testDoc
        .getBlocksByFlavour("affine:note")
        .at(-1)
        .model.children[0].text.toString(),
    ),
    "Rewritten text",
  );
  await page.evaluate(() => {
    window.session = null;
  });
  // Exercise the handler's current-session guard even before a parent rerender.
  await buttons.nth(0).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Open a notebook" })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => window.testDoc.getBlocksByFlavour("affine:note").length,
    ),
    3,
  );
  console.log(
    "Chat Add as a card: saved replies, one-card creation, Card Deck, layout, Undo, structured previews, rewrite, and unavailable-document guard passed.",
  );
} finally {
  await browser.close();
}
