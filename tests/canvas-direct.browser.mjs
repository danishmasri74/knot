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
  assert.equal(
    await page.evaluate(
      () => document.querySelector("affine-edgeless-root").gfx.viewport.zoom,
    ),
    0.5,
  );

  await page.evaluate(async () => {
    document.querySelector("#editor").style.marginLeft = "200px";
    document.querySelector("#editor").style.marginTop = "56px";
    const root = document.querySelector("affine-edgeless-root");
    root.gfx.viewport.setViewport(1, [0, 0]);
    await (
      await import("/src/app/view-readiness.ts")
    ).waitForEditorView(window.session.editor, "edgeless");
  });
  await page.evaluate(() => {
    const root = document.querySelector("affine-edgeless-root"),
      rect = root.host.getBoundingClientRect(),
      v = root.gfx.viewport;
    if (Math.abs(v.left - rect.left) > 0.5 || Math.abs(v.top - rect.top) > 0.5)
      throw Error("Stale viewport origin");
  });
  const text = page.locator("affine-paragraph [contenteditable=true]").first();
  const b = await text.boundingBox();
  await page.mouse.dblclick(b.x + 30, b.y + 12);
  await page.mouse.click(b.x + 30, b.y + 12);
  await page.keyboard.press("End");
  await page.keyboard.type("DIRECTKEY");
  await page.waitForFunction(() =>
    window.session.doc
      .getBlocksByFlavour("affine:paragraph")[0]
      .model.text.toString()
      .includes("DIRECTKEY"),
  );
  assert.deepEqual(errors, []);
  console.log("PASS direct Canvas first character enters the document model");
  await page.evaluate(async () => {
    document
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setViewport(0.1, [725, -330]);
    await window.session.flush();
    window.session.destroy();
    sessionStorage.clear();
    window.session = await window.openEditor(
      { id: "b", title: "Board B", kind: "whiteboard", updated_at: 1 },
      () => {},
    );
    document.querySelector("#editor").append(window.session.editor);
  });
  await page.waitForFunction(
    () =>
      document.querySelector("affine-edgeless-root")?.gfx.viewport.zoom === 0.5,
  );
  await page.evaluate(async () => {
    document
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setViewport(0.2, [-240, 550]);
    window.session.destroy();
    sessionStorage.clear();
    window.session = await window.openEditor(
      { id: "a", title: "Board A", kind: "whiteboard", updated_at: 1 },
      () => {},
    );
    document.querySelector("#editor").append(window.session.editor);
  });
  const opening = () =>
    page.waitForFunction(() => {
      const v = document.querySelector("affine-edgeless-root")?.gfx.viewport;
      return (
        v?.zoom === 0.5 &&
        Math.abs(v.centerX - 725) < 0.01 &&
        Math.abs(v.centerY + 330) < 0.01
      );
    });
  await opening();
  await page.evaluate(async () => {
    const v = document.querySelector("affine-edgeless-root").gfx.viewport;
    v.setZoom(0.1);
    await window.session.setMode("page");
    await window.session.setMode("edgeless");
  });
  await opening();
  await page.waitForFunction(() =>
    document
      .querySelector("affine-edgeless-root")
      ?.textContent.includes("DIRECTKEY"),
  );
  assert.ok(
    await page.evaluate(() =>
      document
        .querySelector("affine-edgeless-root")
        .textContent.includes("DIRECTKEY"),
    ),
  );
  console.log(
    "PASS 50% opening zoom and notebook-specific location across cleared sessions and mode switching",
  );
} finally {
  await browser.close();
}
