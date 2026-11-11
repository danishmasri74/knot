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
  await page.goto("http://127.0.0.1:1420/card-deck-test");
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
    const note = window.session.doc.getBlocksByFlavour("affine:note")[0].model;
    window.noteId = note.id;
    for (const [flavour, props, text] of [
      ["affine:paragraph", { type: "h2" }, "A supported heading"],
      ["affine:list", { type: "bulleted" }, "A supported list item"],
      ["affine:code", {}, "const shared = true;"],
    ]) {
      const id = window.session.doc.addBlock(flavour, props, note.id);
      window.session.doc.getBlock(id).model.text.insert(text, 0);
    }
    const sibling = window.session.doc.addBlock(
      "affine:note",
      { xywh: "[800,0,448,240]" },
      window.session.doc.root.id,
    );
    const siblingText = window.session.doc.addBlock(
      "affine:paragraph",
      {},
      sibling,
    );
    window.session.doc
      .getBlock(siblingText)
      .model.text.insert("Hidden sibling", 0);

    await window.session.setMode("page");
    const doc = window.session.doc;
    doc.transact(() => {
      for (let i = 0; i < 150; i++)
        doc.addBlock(
          "affine:paragraph",
          { text: new doc.Text("Representative paragraph " + i) },
          note.id,
        );
    });
    const surface = doc.getBlocksByFlavour("affine:surface")[0].model;
    const elements = doc.spaceDoc
      .getMap("blocks")
      .get(surface.id)
      .get("prop:elements")
      .get("value");
    const first = surface.addElement({
      type: "shape",
      shapeType: "rect",
      xywh: "[0,0,20,20]",
      fillColor: "#b8d4be",
      strokeColor: "#456854",
    });
    const template = elements.get(first);
    doc.transact(() => {
      for (let i = 1; i < 1000; i++) {
        const id = crypto.randomUUID(),
          shape = template.clone();
        shape.set("id", id);
        shape.set("index", "c" + i.toString(36).padStart(3, "0"));
        shape.set("xywh", JSON.stringify([10000 + i * 32, 0, 20, 20]));
        elements.set(id, shape);
      }
    });
    await window.session.flush();
    await window.session.setMode("edgeless");
    window.panProbe = async () => {
      const times = [];
      let previous = performance.now();
      const viewport = window.session.editor.querySelector(
        "affine-edgeless-root",
      ).gfx.viewport;
      for (let i = 0; i < 60; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        times.push(now - previous);
        previous = now;
        viewport.setViewport(1, [i, 0]);
      }
      times.sort((a, b) => a - b);
      return { median: times[30], p95: times[57] };
    };
  });
  const baseline = await page.evaluate(() => window.panProbe());
  const opened = await page.evaluate(async () => {
    const start = performance.now();
    window.view = await window.session.createNotePageView(
      window.noteId,
      document.querySelector("#panel"),
    );
    return performance.now() - start;
  });
  const withPane = await page.evaluate(() => window.panProbe());
  const input = page
    .locator('[data-note-pane] affine-paragraph [contenteditable="true"]')
    .first();
  await input.click();
  await page.keyboard.press("End");
  const start = performance.now();
  await page.keyboard.type(" performance probe");
  await page
    .getByText(/Reusable knowledge performance probe/)
    .last()
    .waitFor();
  const typing = performance.now() - start;
  await page.evaluate(() => {
    document.querySelector("#panel").style.visibility = "hidden";
    document.querySelector("#panel").inert = true;
  });
  const hiddenPane = await page.evaluate(() => window.panProbe());
  await page.evaluate(() => window.view.dispose());
  const cycles = await page.evaluate(async () => {
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      const view = await window.session.createNotePageView(
        window.noteId,
        document.querySelector("#panel"),
      );
      view.dispose();
    }
    return performance.now() - start;
  });
  assert.equal(await page.locator("affine-editor-container").count(), 1);
  await page.evaluate(async () => {
    await window.session.flush();
    window.session.destroy();
  });
  assert.deepEqual(errors, []);
  const result = {
    fixture: "1000 shapes, 150 additional paragraphs",
    baseline,
    withPane,
    hiddenPane,
    openMs: opened,
    typingSequenceMs: typing,
    tenOpenCloseMs: cycles,
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    "test-results/pane-performance.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
