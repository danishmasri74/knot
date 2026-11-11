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
    window.notePadding = (
      await import("/node_modules/@blocksuite/affine-shared/dist/consts/index.js")
    ).EDGELESS_BLOCK_CHILD_PADDING;
    window.openEditor = (
      await import("/src/features/editor/blocksuite/adapter.ts")
    ).openEditor;
    window.session = await window.openEditor(catalog[0], () => {});
    document.querySelector("#editor").append(window.session.editor);
    const text =
      window.session.doc.getBlocksByFlavour("affine:paragraph")[0].model.text;
    text.insert("Reusable knowledge", 0);
    await window.session.flush();
  });
  await page.waitForSelector(
    "affine-edgeless-note .affine-note-block-container",
  );
  const checkHeight = async () => {
    await page.waitForFunction(() => {
      const note = document.querySelector("affine-edgeless-note");
      const content = note?.querySelector(".affine-note-block-container");
      if (!content) return false;
      const expected =
        content.getBoundingClientRect().height /
          note.gfx.viewport.zoom /
          (note.model.edgeless.scale ?? 1) +
        2 * window.notePadding;
      return Math.abs(note._noteFullHeight - expected) < 1;
    });
  };
  await checkHeight();
  await page.evaluate(() => {
    const note = document.querySelector("affine-edgeless-note");
    const doc = window.session.doc;
    doc.transact(() => {
      for (let i = 0; i < 20; i++)
        doc.addBlock(
          "affine:paragraph",
          {
            text: new doc.Text(
              "Text that grows the canvas note and wraps at a narrow width.",
            ),
          },
          note.model,
        );
    });
  });
  await checkHeight();
  for (const zoom of [0.25, 1.5]) {
    await page.evaluate((zoom) => {
      const note = document.querySelector("affine-edgeless-note");
      window.session.doc.updateBlock(note.model, {
        edgeless: { ...note.model.edgeless, scale: 0.7 },
      });
      note.gfx.viewport.setZoom(zoom);
    }, zoom);
    await checkHeight();
  }
  await page.evaluate(async () => {
    await window.session.setMode("page");
    await window.session.setMode("edgeless");
  });
  await checkHeight();
  assert.deepEqual(errors, []);
  console.log(
    "PASS canvas height after content growth, scale, zoom, and view remount",
  );
} finally {
  await browser.close();
}
