import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/library-deck-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root" style="display:flex;height:100dvh"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/library-deck-test");
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    await import("/src/styles/dropdowns.css");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { CardDeck } =
      await import("/src/features/editor/blocksuite/card-deck.ts");
    const { LibraryPage } = await import("/src/app/LibraryPage.tsx");
    const { LibraryCardDeck } = await import("/src/app/LibraryCardDeck.tsx");
    const notebook = {
      id: "research",
      title: "Research notebook",
      kind: "note",
      updated_at: 0,
    };
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === "filter_objects")
          return [
            notebook,
            ...Array.from({ length: 25 }, (_, i) => ({
              ...notebook,
              id: `extra-${i}`,
              title: `Project notebook ${i + 1}`,
            })),
          ];
        if (cmd === "library_page") return { rows: [notebook], total: 1 };
        if (cmd === "load_card_deck") {
          if (window.failLoad) throw Error("Deck read failed");
          return JSON.stringify(window.deck.data);
        }
        if (cmd === "save_documents" || cmd === "list_blobs") return [];
        throw Error(cmd);
      },
    };
    const titles = [
      "Learning through connections",
      "A quieter workspace",
      "Reading notes",
      "The shape of an idea",
      "Building a second brain",
      "Thoughts in motion",
      "A useful question",
      "Writing to understand",
    ];
    const data = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => {
        const title =
          titles[index % titles.length] + ` ${String(index).padStart(2, "0")}`;
        return [
          `card-${index}`,
          {
            id: `card-${index}`,
            createdAt: 1700000000000 + index * 86400000,
            updatedAt: 1800000000000 - index * 86400000,
            nodes: [
              {
                props: {
                  "sys:flavour": { type: "json", value: "affine:paragraph" },
                  "prop:type": { type: "json", value: "h2" },
                  "prop:text": { type: "text", delta: [{ insert: title }] },
                },
                children: [],
              },
              {
                props: {
                  "sys:flavour": { type: "json", value: "affine:paragraph" },
                  "prop:text": {
                    type: "text",
                    delta: [
                      {
                        insert:
                          "Ideas become clearer when we give them room to grow. ",
                      },
                      {
                        insert: "Make connections",
                        attributes: { bold: true, background: "#ffd766" },
                      },
                      {
                        insert:
                          " between what you read and what you already know.\nA small observation can become the start of something larger.",
                      },
                    ],
                  },
                },
                children: [],
              },
            ],
          },
        ];
      }),
    );
    const longCard = data["card-2"];
    longCard.nodes[0].props["prop:type"].value = "text";
    longCard.nodes[0].props["prop:text"].delta[0].insert =
      "PrepToPresent is an AI-assisted presentation rehearsal and feedback system. For FYP1, the goal is to process a student’s recorded presentation locally.";
    longCard.nodes.push(
      ...Array.from({ length: 30 }, () => ({
        props: {
          "sys:flavour": { type: "json", value: "affine:paragraph" },
          "prop:text": {
            type: "text",
            delta: [
              {
                insert:
                  "A useful note should remain easy to read, even when it contains several paragraphs. Keep the original evidence together, connect related ideas, and revisit the details when they become relevant to your work.",
              },
            ],
          },
        },
        children: [],
      })),
    );
    data.deleted = { ...data["card-0"], id: "deleted", deleted: true };
    window.deck = new CardDeck(data, () => {});
    const { openEditor } =
      await import("/src/features/editor/blocksuite/adapter.ts");
    window.session = await openEditor(
      { id: "virtual", title: "Card Deck", kind: "note", updated_at: 0 },
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    window.deck = window.session.cardDeck;
    window.failLoad = false;
    window.fallback = false;
    window.revision = 0;
    const root = createRoot(document.querySelector("#root"));
    const { NavigationHistory } = await import("/src/services/navigation.ts");
    const history = new NavigationHistory();
    history.visit({ id: "library:notebooks", library: "notebooks" });
    history.visit({ id: "library:cardDeck", library: "cardDeck" });
    function Harness() {
      const [location, setLocation] = React.useState({
        id: "library:cardDeck",
        library: "cardDeck",
      });
      const navigate = async (next, record = true) => {
        await window.session.flush();
        setLocation(next);
        if (record) history.visit(next);
      };
      window.moveTestHistory = (delta) =>
        history.move(delta, (next) => navigate(next, false));
      window.testLocation = location;
      return React.createElement(LibraryPage, {
        key: location.library === "cardDeck" ? "library:cardDeck" : location.id,
        location,
        preferenceKey: location.id,
        catalog: { collections: [], favorites: [] },
        busy: false,
        run: async (task) => task(),
        onChanged: async () => {},
        onOpen: () => {},
        onNavigate: navigate,
        onCreate: async () => {},
        onFavorite: () => {},
        revision: window.revision,
        sidebarDrag: { start: () => ({}) },
        pinned: [],
        onTogglePin: () => {},
        cardDeck: React.createElement(LibraryCardDeck, {
          key: String(window.fallback),
          workspace: "test",
          revision: window.revision,
          cardId: location.cardId,
          onSelect: (cardId) =>
            navigate({
              id: cardId
                ? `library:cardDeck:card:${cardId}`
                : "library:cardDeck",
              library: "cardDeck",
              cardId,
            }),
          deck: window.fallback ? undefined : window.deck,
          onCreateEditor: (id, host) =>
            window.session.createCardPageView(id, host),
          onFlush: () => window.session.flush(),
          onOpen: async (id) => {
            window.opened = id;
            return window.canOpen ?? false;
          },
          onPlace: async (id, notebook, name) => {
            window.placed = { id, notebook, name };
          },
        }),
      });
    }
    window.render = () => root.render(React.createElement(Harness));
    window.render();
    document.documentElement.dataset.theme = "light";
  });
  const deck = page.getByRole("region", {
    name: "Library Card Deck",
    exact: true,
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".library-note-card").length === 60,
  );
  assert.equal(
    await page.getByRole("button", { name: "List view", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Grid view", exact: true }).count(),
    0,
  );
  assert.equal(await deck.getByText("65 cards", { exact: true }).count(), 1);
  await page.screenshot({
    path: "test-results/library-card-deck-light.png",
    fullPage: true,
  });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.screenshot({
    path: "test-results/library-card-deck-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sort cards", exact: true }).click();
  const sort = page.getByRole("group", { name: "Sort cards", exact: true });
  assert.equal(
    await sort
      .getByRole("button", { name: "Recently edited", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await sort.evaluate(
      (el) => getComputedStyle(el.parentElement).borderRadius,
    ),
    "6px",
  );
  const box = await sort.boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.x + box.width <= 1440 &&
      box.y >= 0 &&
      box.y + box.height <= 1000,
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.match(
    await page.locator(".library-note-card").first().getAttribute("aria-label"),
    /64$/,
  );
  await page.getByRole("button", { name: "Sort cards", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await sort.count(), 0);
  await deck.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(await page.locator(".library-note-card").count(), 5);
  const search = page.getByRole("textbox", { name: "Search Card Deck" });
  await search.fill("Learning through connections 00");
  await page
    .getByRole("button", {
      name: "Edit Learning through connections 00",
      exact: true,
    })
    .click();
  const preview = page.getByRole("region", {
    name: "Card note page",
    exact: true,
  });
  assert.equal(await page.getByRole("dialog").count(), 0);
  await preview
    .locator("affine-paragraph [contenteditable=true]")
    .first()
    .waitFor();
  await page.evaluate(() => window.moveTestHistory(-1));
  await deck.waitFor();
  assert.equal(await search.inputValue(), "Learning through connections 00");
  assert.equal(await preview.count(), 0);
  assert.equal(await page.locator(".library-note-card").count(), 1);
  await page.evaluate(() => window.moveTestHistory(1));
  await preview.waitFor();
  await preview
    .locator("affine-paragraph [contenteditable=true]")
    .first()
    .waitFor();
  assert.equal(await page.evaluate(() => window.testLocation.cardId), "card-0");
  await page.evaluate(() => window.moveTestHistory(-1));
  await deck.waitFor();
  await page.evaluate(() => window.moveTestHistory(-1));
  await page.getByRole("button", { name: "List view", exact: true }).waitFor();
  await page.evaluate(() => window.moveTestHistory(1));
  await deck.waitFor();
  await page.evaluate(() => window.moveTestHistory(1));
  await preview.waitFor();
  await preview
    .locator("affine-paragraph [contenteditable=true]")
    .first()
    .waitFor();
  await page.getByLabel("Note actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Open in notebook", exact: true })
    .click();
  await preview
    .getByText(/Choose a notebook to add this linked card/)
    .waitFor();
  await preview
    .getByRole("button", { name: "Research notebook", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.placed.notebook.id),
    "research",
  );
  assert.equal(await preview.count(), 0);
  await search.fill("Learning through connections 00");
  await page
    .getByRole("button", {
      name: "Edit Learning through connections 00",
      exact: true,
    })
    .click();
  await preview.waitFor();
  await preview.getByRole("button", { name: "Card Deck", exact: true }).click();
  await preview.waitFor({ state: "detached" });
  assert.equal(await preview.count(), 0);
  assert.equal(
    await page
      .getByRole("button", {
        name: "Edit Learning through connections 00",
        exact: true,
      })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await search.fill("No such content");
  await deck
    .getByText("No cards match your search.", { exact: true })
    .waitFor();
  await deck.getByRole("button", { name: "Clear search", exact: true }).click();
  await search.fill("PrepToPresent");
  await page.getByRole("button", { name: /^Edit PrepToPresent/ }).click();
  const longPreview = page.getByRole("region", {
    name: "Card note page",
    exact: true,
  });
  await longPreview
    .getByRole("navigation", { name: "Card note location", exact: true })
    .waitFor();
  async function assertPreviewBounds() {
    const geometry = await longPreview.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const body = el.querySelector(".affine-page-viewport");

      return {
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        vw: innerWidth,
        vh: innerHeight,
        bodyScroll: body.scrollHeight > body.clientHeight,

        ownScroll: el.scrollHeight > el.clientHeight,
      };
    });
    assert.ok(
      geometry.x >= 0 &&
        geometry.y >= 0 &&
        geometry.x + geometry.w <= geometry.vw &&
        geometry.y + geometry.h <= geometry.vh,
      JSON.stringify(geometry),
    );
    assert.ok(
      geometry.bodyScroll && !geometry.ownScroll,
      JSON.stringify(geometry),
    );
  }
  await longPreview
    .locator("affine-paragraph [contenteditable=true]")
    .first()
    .waitFor();
  await page.waitForTimeout(300);
  await assertPreviewBounds();
  assert.match(
    await longPreview
      .locator(".library-card-editor")
      .evaluate((el) => getComputedStyle(el).fontFamily),
    /Inter|Segoe UI|sans-serif/,
  );
  await page.screenshot({ path: "test-results/library-card-preview-dark.png" });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({
    path: "test-results/library-card-preview-light.png",
  });
  await page.setViewportSize({ width: 600, height: 800 });
  await assertPreviewBounds();
  await page.getByLabel("Note actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Add to notebook…", exact: true })
    .click();
  await longPreview
    .getByRole("heading", { name: "Add to notebook", exact: true })
    .waitFor();
  assert.equal(
    await longPreview.locator(".library-card-preview-body").count(),
    0,
  );
  await longPreview
    .getByRole("button", { name: "Research notebook", exact: true })
    .waitFor();
  assert.equal(
    await longPreview
      .locator("input")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  const picker = await longPreview.boundingBox();
  assert.ok(
    picker.width <= 600 && picker.height <= 800 && picker.y >= 0,
    JSON.stringify(picker),
  );
  assert.equal(
    await longPreview
      .locator(".note-destination-results")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
    true,
  );
  await page.screenshot({
    path: "test-results/library-card-notebook-picker.png",
  });
  await page
    .getByRole("button", { name: "Back to editor", exact: true })
    .click();
  await longPreview
    .getByRole("navigation", { name: "Card note location", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Card Deck", exact: true }).click();
  await longPreview.waitFor({ state: "detached" });
  assert.equal(await longPreview.count(), 0);
  await search.fill("");
  await page.setViewportSize({ width: 600, height: 800 });
  await page.screenshot({
    path: "test-results/library-card-deck-narrow.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "Notebooks", exact: true }).click();
  await page.getByRole("button", { name: "List view", exact: true }).waitFor();
  await page.getByRole("button", { name: "Card Deck", exact: true }).click();
  await deck.waitFor();
  assert.equal(
    await page.getByRole("button", { name: "List view", exact: true }).count(),
    0,
  );
  await page.evaluate(() => {
    window.fallback = true;
    window.failLoad = true;
    window.revision++;
    window.render();
  });
  await deck
    .getByRole("alert")
    .filter({ hasText: "Deck read failed" })
    .waitFor();
  await page.evaluate(() => (window.failLoad = false));
  await deck.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".library-note-card").length === 60,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS Library Card Deck grid-only navigation, content search, sort keyboard/checkmarks/bounds, pagination, card Back/Forward history, preview, notebook picker, focus restoration, light/dark/narrow layout, and saved-deck retry",
  );
} finally {
  await browser.close();
}
