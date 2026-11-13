// Opening an Ask Knot source on the canvas: the cited card stays on the
// canvas, the viewport moves to the cited paragraph, and it is highlighted.
// App.tsx (focusCitedCard) uses focusCanvasCard + revealSearchMatch with the
// citation's captured text; this checks that pair with a whole paragraph.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/citation-reveal-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><div id="editor" class="editor-area" style="width:1000px;height:100vh"></div></body></html>',
    }),
  );
  await page.goto(
    `${process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420"}/citation-reveal-test`,
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
      { id: "a", title: "Launch board", kind: "whiteboard", updated_at: 1 },
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
    const { openEditor } =
      await import("/src/features/editor/blocksuite/adapter.ts");
    window.session = await openEditor(catalog[0], () => {});
    document.querySelector("#editor").append(window.session.editor);
    const doc = window.session.doc;
    const note = doc.getBlocksByFlavour("affine:note")[0].model;
    window.noteId = note.id;
    // A tall card, so the cited paragraph is far from the card's center.
    const { Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    for (let i = 0; i < 30; i++)
      doc.addBlock(
        "affine:paragraph",
        { text: new Text(`Filler line ${i}`) },
        note,
      );
    window.excerpt =
      "We ship the beta in March, after the security review is complete.";
    doc.addBlock("affine:paragraph", { text: new Text(window.excerpt) }, note);
    await window.session.flush();
    await window.session.focusCanvasCard(window.noteId);
    const canvas = window.session.editor.querySelector("affine-edgeless-root");
    canvas.service.viewport.setViewport(0.3, [5000, -5000]);
  });
  await page.evaluate(async () => {
    await window.session.focusCanvasCard(window.noteId);
    await window.session.revealSearchMatch(window.excerpt, window.noteId);
  });
  assert.equal(
    await page.evaluate(() => window.session.editor.mode),
    "edgeless",
    "the source opens on the canvas, not as a page",
  );
  await page.locator(".search-match-overlay span").first().waitFor();
  const placed = await page.evaluate(() => {
    const editor = window.session.editor.getBoundingClientRect();
    const mark = document
      .querySelector(".search-match-overlay span")
      .getBoundingClientRect();
    return {
      inside:
        mark.top >= editor.top &&
        mark.bottom <= editor.bottom &&
        mark.left >= editor.left &&
        mark.right <= editor.right,
      zoom: window.session.editor.querySelector("affine-edgeless-root").service
        .viewport.zoom,
    };
  });
  assert.ok(placed.inside, "the highlighted excerpt is in view");
  assert.ok(placed.zoom >= 1, "reading zoom, not the whole-board view");
  await page.screenshot({ path: "test-results/citation-reveal.png" });
  assert.deepEqual(errors, []);
  console.log("Citation reveal: canvas kept, excerpt centered and highlighted");
} finally {
  await browser.close();
}
