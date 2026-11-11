import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    reducedMotion: "reduce",
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

  await page.evaluate(() => {
    const field = document.createElement("textarea");
    field.setAttribute("aria-label", "Outside editor");
    field.style.cssText =
      "position:absolute;left:1050px;top:20px;width:200px;height:100px";
    document.body.append(field);
  });
  const zoom = () =>
    page.evaluate(
      () => document.querySelector("affine-edgeless-root").gfx.viewport.zoom,
    );
  const field = page.getByRole("textbox", {
    name: "Outside editor",
    exact: true,
  });
  await field.fill("Keep this draft focused");
  await page.mouse.move(700, 400);
  const initial = await zoom();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForTimeout(100);
  assert(
    (await zoom()) > initial,
    "Canvas zoom must work while the external textarea retains focus",
  );
  assert(
    await field.evaluate((node) => node === document.activeElement),
    "Wheel must not steal typing focus",
  );
  const closer = await zoom();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Control");
  await page.waitForTimeout(100);
  assert((await zoom()) < closer, "Zoom out must work without a click");
  const center = await page.evaluate(
    () => document.querySelector("affine-edgeless-root").gfx.viewport.centerY,
  );
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(100);
  assert.notEqual(
    await page.evaluate(
      () => document.querySelector("affine-edgeless-root").gfx.viewport.centerY,
    ),
    center,
    "Pan should follow pointer too",
  );
  const unchanged = await zoom();
  await page.mouse.move(1150, 50);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  assert.equal(await zoom(), unchanged, "Outside wheel cannot zoom canvas");
  await page.evaluate(() => (document.querySelector("#editor").inert = true));
  await page.mouse.move(700, 400);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  assert.equal(await zoom(), unchanged, "Locked canvas cannot receive wheel");
  assert.deepEqual(errors, []);
  console.log(
    "Canvas wheel focus: zoom in/out, pan, unchanged typing focus, external controls and inert guards passed",
  );
} finally {
  await browser.close();
}
