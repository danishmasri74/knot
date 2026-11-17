import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/card-deck-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="editor" style="width:1000px;height:850px"></div><div id="panel" style="position:absolute;left:1000px;top:0;width:380px"></div></body></html>',
    }),
  );
  await page.goto(
    `${process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420"}/card-deck-test`,
  );
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    const catalog = [
      { id: "a", title: "Board A", kind: "whiteboard", updated_at: 1 },
      { id: "b", title: "Board B", kind: "whiteboard", updated_at: 1 },
    ];
    window.saved = {};
    window.deck = "{}";
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd === "filter_objects") return args.offset === 0 ? catalog : [];
        if (cmd === "load_document") return window.saved[args.id] ?? null;
        if (cmd === "load_card_deck") return window.deck;
        if (cmd === "save_documents") {
          for (const write of args.documents)
            window.saved[write.id] = write.snapshot;
          window.deck = args.deck;
          return;
        }
        if (cmd === "list_blobs") return [];
        throw Error("Unexpected " + cmd);
      },
    };
    window.openEditor = (
      await import("/src/features/editor/blocksuite/adapter.ts")
    ).openEditor;
    window.session = await window.openEditor(catalog[0], () => {});
    document.querySelector("#editor").append(window.session.editor);
    const text =
      window.session.doc.getBlocksByFlavour("affine:paragraph")[0].model.text;
    text.insert("Reusable knowledge", 0);
    await window.session.flush();
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { CardDeckPanel } = await import("/src/app/CardDeckPanel.tsx");
    window.panel = createRoot(document.querySelector("#panel"));
    window.renderDeck = (deck) =>
      window.panel.render(
        React.createElement(CardDeckPanel, {
          deck,
          onPlace: async (id) => window.session.placeCard(id),
        }),
      );
    window.renderDeck(window.session.cardDeck);
  });
  await page.getByText("Reusable knowledge", { exact: true }).last().waitFor();
  await page
    .locator(".card-deck-card")
    .filter({ hasText: "Reusable knowledge" })
    .getByRole("button", { name: "Card actions" })
    .click();
  await page.getByRole("menuitem", { name: "Add to canvas" }).first().click();
  await page.waitForTimeout(500);
  const result = await page.evaluate(async () => {
    const s = window.session;
    const notes = s.doc.getBlocksByFlavour("affine:note");
    const original = notes.find(
      ({ model }) =>
        model.children[0]?.text?.toString() === "Reusable knowledge",
    );
    original.model.children[0].text.insert(" updated", 18);
    await s.flush();
    return {
      texts: s.doc
        .getBlocksByFlavour("affine:note")
        .map(({ model }) =>
          model.children.map((c) => c.text?.toString()).join(""),
        ),
      deck: JSON.parse(window.deck),
    };
  });
  assert.equal(
    result.texts.filter((t) => t === "Reusable knowledge updated").length,
    2,
  );
  await page.screenshot({ path: "test-results/card-deck-browser.png" });
  await page
    .locator("affine-edgeless-note")
    .first()
    .dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await page
    .getByRole("menuitem", { name: "Remove from this whiteboard", exact: true })
    .click();
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(
      () => window.session.doc.getBlocksByFlavour("affine:note").length,
    ),
    1,
  );
  await page.locator(".card-deck-card").first().dispatchEvent("contextmenu");
  await page.getByRole("textbox", { name: "Search Card Deck" }).focus();
  assert.equal(await page.getByRole("menu").count(), 0);
  await page.evaluate(() => window.renderDeck(undefined));
  await page.locator(".deck-placeholder").first().waitFor();
  await page.evaluate(async () => {
    const { CardDeck } =
      await import("/src/features/editor/blocksuite/card-deck.ts");
    const cards = Array.from({ length: 3000 }, (_, i) => ({
      id: "c" + i,
      nodes: [
        {
          props: {
            "prop:type": { type: "json", value: "h2" },
            "prop:text": {
              type: "text",
              delta: [{ insert: "Card " + i, attributes: { bold: true } }],
            },
          },
          children: [],
        },
      ],
    }));
    window.renderDeck(
      new CardDeck(
        Object.fromEntries(cards.map((card) => [card.id, card])),
        () => {},
      ),
    );
  });
  await page.getByText("1 of 75", { exact: true }).waitFor();
  assert.equal(await page.locator(".card-deck-grid article").count(), 40);
  await page.getByRole("button", { name: /^Filter and sort/ }).click();
  await page
    .getByRole("group", { name: "Sort cards", exact: true })
    .getByRole("button", { name: "Name Z–A", exact: true })
    .click();
  assert.equal(
    await page.locator(".card-deck-preview").first().innerText(),
    "Card 2999",
  );
  await page
    .getByRole("group", { name: "Placement", exact: true })
    .getByRole("button", { name: /^Not on any canvas/ })
    .click();
  await page.getByText("No matching cards.").waitFor();
  await page
    .getByRole("button", { name: "Filter and sort, 1 filter on", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByLabel("Clear filter: Not on any canvas").click();
  await page.getByRole("button", { name: "Filter and sort", exact: true }).click();
  await page
    .getByRole("group", { name: "Type", exact: true })
    .getByRole("button", { name: /^Quizzes/ })
    .click();
  await page.getByText("No matching cards.").waitFor();
  await page
    .getByRole("group", { name: "Type", exact: true })
    .getByRole("button", { name: /^Quizzes/ })
    .click();
  await page
    .getByRole("group", { name: "Sort cards", exact: true })
    .getByRole("button", { name: "Newest first", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Card 40", { exact: true }).waitFor();
  await page.getByLabel("Search Card Deck").fill("CARD 2999");
  await page
    .locator('.card-deck-preview [data-kind="h2"] strong')
    .filter({ hasText: "Card 2999" })
    .waitFor();
  assert.equal(await page.locator(".card-deck-grid article").count(), 1);
  await page.evaluate(async () => {
    const s = window.session;
    await s.flush();
    window.panel.unmount();
    s.destroy();
    window.session = await window.openEditor(
      { id: "b", title: "Board B", kind: "whiteboard", updated_at: 1 },
      () => {},
    );
    document.querySelector("#editor").append(window.session.editor);
  });
  await page.waitForTimeout(500);
  const persisted = await page.evaluate(async () => {
    const s = window.session;
    const id = Object.values(s.cardDeck.data).find((c) =>
      JSON.stringify(c).includes("Reusable knowledge updated"),
    ).id;
    s.placeCard(id);
    await s.flush();
    return s.doc
      .getBlocksByFlavour("affine:note")
      .map(({ model }) =>
        model.children.map((c) => c.text?.toString()).join(""),
      );
  });
  assert.ok(persisted.includes("Reusable knowledge updated"));
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    const id = Object.values(window.session.cardDeck.data).find((c) =>
      JSON.stringify(c).includes("Reusable knowledge updated"),
    ).id;
    data.setData("application/x-knot-card", id);
    return data;
  });
  await page
    .locator("affine-editor-container")
    .dispatchEvent("dragover", { dataTransfer: transfer });
  await page.locator("affine-editor-container").dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: 200,
    clientY: 200,
  });
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(
      () =>
        window.session.doc
          .getBlocksByFlavour("affine:note")
          .filter(({ model }) =>
            model.children.some(
              (c) => c.text?.toString() === "Reusable knowledge updated",
            ),
          ).length,
    ),
    2,
  );
  const sharedNote = page
    .locator("affine-edgeless-note")
    .filter({ hasText: "Reusable knowledge updated" })
    .first();
  await sharedNote.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await page
    .getByRole("menuitem", {
      name: "Move to Trash",
      exact: true,
    })
    .click();
  await page.evaluate(async () => {
    await window.session.flush();
  });
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(
      () =>
        window.session.doc
          .getBlocksByFlavour("affine:note")
          .filter(({ model }) =>
            model.children.some(
              (c) => c.text?.toString() === "Reusable knowledge updated",
            ),
          ).length,
    ),
    0,
  );

  const restored = await page.evaluate(async () => {
    const deck = window.session.cardDeck;
    const card = Object.values(deck.data).find(
      (card) =>
        card.deleted &&
        JSON.stringify(card).includes("Reusable knowledge updated"),
    );
    deck.restore(card.id);
    window.session.placeCard(card.id);
    await window.session.flush();
    return window.session.doc
      .getBlocksByFlavour("affine:note")
      .some(({ model }) =>
        model.children.some(
          (child) => child.text?.toString() === "Reusable knowledge updated",
        ),
      );
  });
  assert.equal(restored, true);

  console.log(
    "PASS: actual BlockSuite repeated instances, live edits, panel, save/reload, cross-board reuse",
  );
} finally {
  await browser.close();
}
