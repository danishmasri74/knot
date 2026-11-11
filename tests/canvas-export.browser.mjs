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

  const result = await page.evaluate(async () => {
    const d = window.session.doc;
    d.updateBlock(d.getBlocksByFlavour("affine:note")[0].model, {
      xywh: "[0,0,448,200]",
    });
    const id = d.addBlock(
      "affine:note",
      { xywh: "[1200,0,448,200]", index: "b1" },
      d.root,
    );
    d.addBlock(
      "affine:paragraph",
      { text: new d.Text("OFFSCREEN EXPORT TEXT"), type: "h2" },
      id,
    );
    document
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setViewport(1, [0, 0]);
    const files = await window.session.exportFiles("png");
    const root = document.querySelector("affine-edgeless-root");
    root.gfx.viewport.setZoom(0.1);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (
      [...root.querySelectorAll("affine-edgeless-note")].some(
        (note) => note._knotForced || note._knotDetailed,
      )
    )
      throw Error("Export did not restore zoom-based previews");
    const bmp = await createImageBitmap(
      new Blob([new Uint8Array(files[0].bytes)], { type: "image/png" }),
    );
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const p = ctx.getImageData(1250, 50, 448, 200).data;
    let dark = 0;
    for (let i = 0; i < p.length; i += 4)
      if (p[i] < 100 && p[i + 1] < 100 && p[i + 2] < 100 && p[i + 3] > 0)
        dark++;
    return { dark, width: bmp.width, height: bmp.height };
  });
  console.log(result);
  assert.ok(result.dark > 100, "offscreen exported note must contain text");
} finally {
  await browser.close();
}
