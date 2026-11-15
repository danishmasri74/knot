import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";

const live = process.env.KNOT_LIVE_PREVIEW === "1";
const url = live ? "https://pitchmesg.com/" : "https://preview.example/page";
const response = live ? await fetch(url) : null;
const body = response
  ? await response.text()
  : `<html><head>
  <meta property="og:title" content="Speaking &amp; confidence">
  <meta property="og:description" content="A useful website preview.">
  <meta property="og:image" content="/cover.svg">
  <link rel="icon" href="/icon.svg"></head></html>`;
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const imagePolicy = config.app.security.csp
  .split(";")
  .filter((s) => /img-src|object-src/.test(s))
  .join(";");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/bookmark-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": imagePolicy },
      body: '<html><body><div id="editor" style="height:850px"></div></body></html>',
    }),
  );
  if (!live)
    await page.route("https://preview.example/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#2563eb"/><text x="50" y="160" fill="white" font-size="36">Website preview</text></svg>',
      }),
    );
  await page.goto(
    `${process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420"}/bookmark-test`,
  );
  await page.evaluate(
    async ({ url, body, live }) => {
      const RefreshRuntime = (await import("/@react-refresh")).default;
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import("/src/styles/app.css");
      await import("/node_modules/@toeverything/theme/dist/style.css?import");
      const catalog = [
        {
          id: "preview-board",
          title: "Website previews",
          kind: "whiteboard",
          updated_at: 1,
        },
      ];
      window.saved = {};
      window.deck = "{}";
      window.fetches = 0;
      window.failPreview = !live;
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
          if (cmd === "canvas_preview_load")
            return new Uint8Array(args.keys.length * 4).buffer;
          if (cmd === "canvas_preview_save" || cmd === "canvas_preview_prune")
            return;
          if (cmd === "link_preview_fetch") {
            window.fetches++;
            if (window.failPreview) return { message: "Offline" };
            return { body, finalUrl: url, contentType: "text/html" };
          }
          throw Error("Unexpected " + cmd);
        },
      };
      const { openEditor } =
        await import("/src/features/editor/blocksuite/adapter.ts");
      window.reopen = async () => {
        window.session = await openEditor(catalog[0], () => {});
        document
          .querySelector("#editor")
          .replaceChildren(window.session.editor);
      };
      await window.reopen();
      const doc = window.session.doc;
      const surface = doc.getBlocksByFlavour("affine:surface")[0].model;
      window.bookmarkId = doc.addBlock(
        "affine:bookmark",
        { url, style: "vertical", xywh: "[100,100,364,390]" },
        surface.id,
      );
    },
    { url, body, live },
  );
  // Existing failed cards must recover automatically when their notebook reopens.
  if (!live) {
    await page.waitForFunction(
      () => document.querySelector("affine-edgeless-bookmark")?.error,
    );
    await page.evaluate(async () => {
      await window.session.flush();
      window.session.destroy();
      window.failPreview = false;
      await window.reopen();
    });
  }
  const bookmark = page.locator("affine-edgeless-bookmark").first();
  const banner = bookmark.locator(".affine-bookmark-banner img");
  await banner.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const image = document.querySelector(".affine-bookmark-banner img");
    return image?.complete && image.naturalWidth > 0;
  });
  const details = await bookmark.evaluate((el) => {
    const banner = el
      .querySelector(".affine-bookmark-banner")
      .getBoundingClientRect();
    const card = el
      .querySelector(".affine-bookmark-card")
      .getBoundingClientRect();
    const content = el
      .querySelector(".affine-bookmark-content")
      .getBoundingClientRect();
    return {
      text: el.textContent,
      objects: el.querySelectorAll("object").length,
      banner: { top: banner.top, bottom: banner.bottom, height: banner.height },
      card: { top: card.top, bottom: card.bottom },
      contentTop: content.top,
    };
  });
  assert.match(details.text, live ? /pitchMe/ : /Speaking & confidence/);
  assert.equal(details.objects, 0);
  assert.ok(details.banner.height > 60, JSON.stringify(details));
  assert.ok(
    details.banner.top >= details.card.top - 2,
    JSON.stringify(details),
  );
  assert.ok(
    details.banner.bottom <= details.card.bottom + 2,
    JSON.stringify(details),
  );
  assert.ok(
    details.contentTop >= details.banner.bottom - 2,
    JSON.stringify(details),
  );
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: `test-results/bookmark-${live ? "live" : "fixture"}.png`,
  });

  // A failed manual refresh retains the saved preview; retry clears its error.
  await page.evaluate(() => {
    window.failPreview = true;
    document.querySelector("affine-edgeless-bookmark").refreshData();
  });
  await page.waitForFunction(
    () => document.querySelector("affine-edgeless-bookmark").error,
  );
  assert.match(
    await bookmark.textContent(),
    live ? /pitchMe/ : /Speaking & confidence/,
  );
  await page.evaluate(() => {
    window.failPreview = false;
    document.querySelector("affine-edgeless-bookmark").refreshData();
  });
  await page.waitForFunction(
    () =>
      !document.querySelector("affine-edgeless-bookmark").error &&
      !document.querySelector("affine-edgeless-bookmark").loading,
  );
  const before = await page.evaluate(async () => {
    await window.session.flush();
    window.session.destroy();
    const count = window.fetches;
    await window.reopen();
    return count;
  });
  await page
    .locator(".affine-bookmark-banner img")
    .first()
    .waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() => window.fetches),
    before,
    "saved metadata should reopen without refetching",
  );
  // The Card Deck must reuse the canvas preview, including metadata changes.
  await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { CardDeckPanel } = await import("/src/app/CardDeckPanel.tsx");
    const host = document.createElement("div");
    host.id = "deck-test";
    host.style.cssText =
      "position:fixed;right:0;top:0;width:320px;height:850px;overflow:auto";
    document.body.append(host);
    window.deckRoot = createRoot(host);
    window.deckRoot.render(
      React.createElement(CardDeckPanel, {
        deck: window.session.cardDeck,
        canvas: "preview-board",
        onPlace: async () => {},
      }),
    );
  });
  const deckImage = page.locator(
    "#deck-test .card-media-thumb[data-kind=link] img",
  );
  await deckImage.waitFor({ state: "visible" });
  assert.equal(
    await deckImage.getAttribute("src"),
    await banner.getAttribute("src"),
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#deck-test .card-media-thumb img")?.naturalWidth >
      0,
  );
  if (!live) {
    await page.route("https://preview.example/broken.png", (route) =>
      route.fulfill({ status: 404, body: "Not found" }),
    );
    await page.evaluate(() => {
      const doc = window.session.doc;
      const model = doc.getBlocksByFlavour("affine:bookmark")[0].model;
      window.savedPreviewImage = model.image;
      doc.updateBlock(model, { image: "https://preview.example/broken.png" });
    });
    await page
      .locator("#deck-test .card-media-thumb[data-kind=link] .shell-icon")
      .waitFor({ state: "visible" });
    await page.evaluate(() => {
      const doc = window.session.doc;
      doc.updateBlock(doc.getBlocksByFlavour("affine:bookmark")[0].model, {
        image: window.savedPreviewImage,
      });
    });
    await deckImage.waitFor({ state: "visible" });
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${live ? "pitchmesg.com" : "fixture"} metadata, image CSP, vertical layout, retry, saved preview, and Card Deck thumbnail`,
  );
} finally {
  await browser.close();
}
