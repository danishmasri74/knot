import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/deck-editor-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<body style="height:100vh;display:flex;flex-direction:column"><header class="topbar"><span>Library</span><div id="library-card-chrome"></div></header><div id="root" style="flex:1;min-height:0"></div><div id="other" hidden></div></body>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/deck-editor-test");
  await page.evaluate(async () => {
    const runtime = (await import("/@react-refresh")).default;
    runtime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/src/styles/dropdowns.css");
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { openEditor } =
      await import("/src/features/editor/blocksuite/adapter.ts");
    const { LibraryCardDeck } = await import("/src/app/LibraryCardDeck.tsx");
    window.writes = [];
    window.savedDeck = JSON.stringify({
      standalone: {
        id: "standalone",
        nodes: [
          {
            props: {
              "sys:flavour": { type: "json", value: "affine:paragraph" },
              "prop:type": { type: "json", value: "h2" },
              "prop:text": {
                type: "text",
                delta: [{ insert: "Shared standalone note" }],
              },
            },
            children: [],
          },
        ],
      },
    });
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd === "filter_objects" || cmd === "list_blobs") return [];
        if (cmd === "load_card_deck") return window.savedDeck;
        if (cmd === "save_documents") {
          window.writes.push(...args.documents);
          window.savedDeck = args.deck;
          return;
        }
        throw Error(`Unexpected ${cmd}`);
      },
    };
    window.open = () =>
      openEditor(
        { id: "virtual-deck", title: "Card Deck", kind: "note", updated_at: 0 },
        () => {},
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );
    window.session = await window.open();
    window.root = createRoot(document.getElementById("root"));
    window.root.render(
      React.createElement(LibraryCardDeck, {
        deck: window.session.cardDeck,
        workspace: "test",
        revision: 0,
        onCreateEditor: (id, host) =>
          window.session.createCardPageView(id, host),
        onFlush: () => window.session.flush(),
        onOpen: async () => false,
        onPlace: async () => {},
      }),
    );
  });
  await page
    .getByRole("button", { name: "Edit Shared standalone note", exact: true })
    .click();
  const dialog = page.getByRole("region", {
    name: "Card note page",
    exact: true,
  });
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator(".library-note-card").count(), 0);
  await dialog.locator("affine-paragraph [contenteditable=true]").waitFor();
  await page.evaluate(async () => {
    window.other = await window.session.createCardPageView(
      "standalone",
      document.getElementById("other"),
    );
  });
  const text = dialog
    .locator("affine-paragraph [contenteditable=true]")
    .first();
  await text.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited");
  await page.waitForFunction(() =>
    JSON.parse(window.savedDeck).standalone.nodes[0].props[
      "prop:text"
    ].delta.some((run) => run.insert.includes("edited")),
  );
  await page.waitForFunction(() =>
    window.other.editor.textContent.includes("edited"),
  );
  assert.equal(
    await page.evaluate(() => window.session.cardDeck.placements().size),
    0,
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    () => !window.other.editor.textContent.includes("edited"),
  );
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() =>
    window.other.editor.textContent.includes("edited"),
  );
  assert.equal(
    await dialog.locator(":scope > header, :scope > footer").count(),
    0,
  );
  await page
    .locator(".topbar .card-page-current")
    .getByText("Shared standalone note edited", { exact: true })
    .waitFor();
  const toc = dialog.getByRole("navigation", { name: "Table of contents" });
  await toc.waitFor();
  assert.equal(await toc.getByRole("button").count(), 1);
  await page.evaluate(() => {
    const { doc } = window.other.editor;
    const note = doc.getBlocksByFlavour("affine:note")[0].model;
    for (let i = 0; i < 35; i++) {
      const id = doc.addBlock("affine:paragraph", {}, note.id);
      doc
        .getBlock(id)
        .model.text.insert(
          "Body paragraph for table of contents navigation.",
          0,
        );
    }
    const heading = doc.addBlock("affine:paragraph", { type: "h2" }, note.id);
    doc.getBlock(heading).model.text.insert("Last section", 0);
  });
  await toc
    .getByRole("button", { name: "Last section", exact: true })
    .waitFor();
  await toc.hover();
  await toc.getByRole("button", { name: "Last section", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".library-card-editor .affine-page-viewport")
        .scrollTop > 100,
  );
  await toc.getByRole("button").last().focus();
  await page.keyboard.press("Home");
  assert.equal(
    await toc
      .getByRole("button")
      .first()
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await toc.getAttribute("data-expanded"), null);
  await page.evaluate(() =>
    document
      .querySelector(".library-card-editor .affine-page-viewport")
      .scrollTo(0, 0),
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    const box = await dialog.boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 1440 &&
        box.y + box.height <= 1000,
    );
    const actions = page.getByLabel("Note actions", { exact: true });
    await actions.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.locator(".card-page-menu .shell-menu-content");
    await menu.waitFor();
    assert.equal(
      await menu
        .getByRole("button")
        .first()
        .evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await menu.evaluate((el) => getComputedStyle(el).borderRadius),
      "6px",
    );
    const bounds = await menu.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= 1440 &&
        bounds.y + bounds.height <= 1000,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".card-page-menu").getAttribute("open"),
      null,
    );
    await page.screenshot({ path: `test-results/card-editor-${theme}.png` });
  }
  await page.setViewportSize({ width: 600, height: 800 });
  await page.getByLabel("Note actions", { exact: true }).click();
  const narrowMenu = await page
    .locator(".card-page-menu .shell-menu-content")
    .boundingBox();
  assert.ok(narrowMenu.x >= 0 && narrowMenu.x + narrowMenu.width <= 600);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Card Deck", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page
    .getByRole("button", {
      name: "Edit Shared standalone note edited",
      exact: true,
    })
    .waitFor();
  await page.evaluate(async () => {
    window.other.dispose();
    window.root.unmount();
    await window.session.flush();
    window.session.destroy();
    window.session = await window.open();
    window.reopened = await window.session.createCardPageView(
      "standalone",
      document.getElementById("other"),
    );
  });
  await page.waitForFunction(() =>
    window.reopened.editor.textContent.includes("edited"),
  );
  assert.deepEqual(
    await page.evaluate(() => window.writes),
    [],
    "Editing must not create a notebook",
  );
  await page.evaluate(() => {
    window.reopened.dispose();
    window.session.destroy();
  });
  assert.deepEqual(errors, []);
  console.log(
    "Standalone card editor: edit, live sync, undo/redo, light/dark bounds, save/reopen passed",
  );
} finally {
  await browser.close();
}
