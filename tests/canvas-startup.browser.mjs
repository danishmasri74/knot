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
  await page.route("**/offscreen-lazy.png", (route) =>
    route.fulfill({ path: "tests/fixtures/knot.png" }),
  );
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

  await page.evaluate(async () => {
    await window.session.setMode("page");
    const doc = window.session.doc,
      first = doc.getBlocksByFlavour("affine:note")[0].model;
    doc.updateBlock(first, { xywh: "[0,0,448,200]" });
    for (let i = 1; i < 41; i++) {
      const id = doc.addBlock(
        "affine:note",
        {
          xywh: JSON.stringify([10000 + i * 500, 10000, 448, 200]),
          index: "b" + i.toString().padStart(2, "0"),
        },
        doc.root,
      );
      for (let j = 0; j < 8; j++)
        doc.addBlock(
          "affine:paragraph",
          {
            text: new doc.Text(`Note ${i} paragraph ${j}`),
            type: j === 0 ? "h2" : "text",
          },
          id,
        );
    }
    window.previewBounds = doc
      .getBlocksByFlavour("affine:note")
      .slice(1)
      .map((b) => b.model.xywh);
    await window.session.setMode("edgeless");
    document
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setViewport(1, [0, 0]);
    const { waitForEditorView } = await import("/src/app/view-readiness.ts");
    const lazyImage = new Image();
    lazyImage.loading = "lazy";
    lazyImage.style.cssText =
      "position:absolute;left:100000px;top:100000px;width:64px;height:64px";
    lazyImage.src = "/offscreen-lazy.png";
    document.querySelector("affine-edgeless-root").append(lazyImage);
    const started = performance.now();
    await waitForEditorView(window.session.editor, "edgeless");
    window.preparationMs = performance.now() - started;
    if (
      !lazyImage.complete ||
      !lazyImage.naturalWidth ||
      lazyImage.loading !== "lazy"
    )
      throw Error(
        "Full preparation must load offscreen lazy images and restore their loading policy",
      );
    lazyImage.remove();
  });
  console.log(
    "Canvas preparation ms:",
    await page.evaluate(() => window.preparationMs),
  );
  await page.evaluate(async () => {
    const { waitForEditorView } = await import("/src/app/view-readiness.ts");
    const marker = document.createElement("div");
    marker.setAttribute("data-knot-loading", "");
    document.querySelectorAll("affine-edgeless-note")[40].append(marker);
    let released = false;
    const ready = waitForEditorView(window.session.editor, "edgeless").then(
      () => {
        released = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (released) throw Error("Loading gate ignored pending offscreen media");
    marker.remove();
    await ready;
  });
  assert.deepEqual(
    await page.evaluate(() => ({
      deferred: [...document.querySelectorAll("affine-edgeless-note")].filter(
        (note) => !note._knotRich,
      ).length,
      previews: document.querySelectorAll("[data-knot-note-preview]").length,
      preparing: window.session.editor.hasAttribute(
        "data-knot-canvas-preparing",
      ),
    })),
    { deferred: 0, previews: 41, preparing: false },
  );
  await page.evaluate(() => {
    performance.clearMarks("knot:canvas-note-mount");
    performance.clearMarks("knot:canvas-preview-build");
  });
  await page.evaluate(() => {
    const note = window.session.doc.getBlocksByFlavour("affine:note")[1].model;
    const [x, y, w, h] = JSON.parse(note.xywh);
    window.previewId = note.id;
    document
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setViewport(0.25, [x + w / 2, y + h / 2]);
  });
  await page.waitForFunction(() => {
    const v = window.session.editor.std.view.getBlock(window.previewId);
    return (
      v?.style.display !== "none" &&
      v?.querySelector("[data-knot-note-preview]")
    );
  });
  await page.waitForTimeout(700);
  assert.deepEqual(
    await page.evaluate(() => ({
      mounts: performance.getEntriesByName("knot:canvas-note-mount").length,
      previews: performance.getEntriesByName("knot:canvas-preview-build")
        .length,
    })),
    { mounts: 0, previews: 0 },
    "Moving to a previously offscreen card must not initialize content or previews",
  );
  const id = await page.evaluate(() => window.previewId);
  const note = page.locator(`[data-block-id="${id}"]`);
  // Hover must not change detail or make the overview depend on pointer history.
  await note.hover({ force: true });
  assert.equal(await note.locator('[data-knot-lod="thumbnail"]').count(), 1);
  const cachedSource = await note
    .locator("[data-knot-note-preview]")
    .getAttribute("src");
  await page.evaluate(() => {
    const root = document.querySelector("affine-edgeless-root");
    root.gfx.viewport.setZoom(1);
  });
  await page.waitForFunction(() => {
    const v = window.session.editor.std.view.getBlock(window.previewId);
    return (
      v?._knotDetailed &&
      v.querySelector("[data-knot-note-preview]")?.style.opacity === "0"
    );
  });
  const lodBounds = await note.evaluate((el) => el.model.xywh);
  await page.evaluate(() =>
    document.querySelector("affine-edgeless-root").gfx.viewport.setZoom(0.1),
  );
  await page.waitForFunction(
    () =>
      document.querySelector(
        `[data-block-id="${window.previewId}"] [data-knot-note-preview]`,
      )?.style.opacity === "1",
  );
  assert.equal(await note.evaluate((el) => el.model.xywh), lodBounds);
  await note.hover({ force: true });
  assert.equal(await note.locator('[data-knot-lod="thumbnail"]').count(), 1);
  assert.equal(
    await note.locator("[data-knot-note-preview]").getAttribute("src"),
    cachedSource,
    "Zooming must reuse the same layout snapshot",
  );
  assert.equal(
    await note
      .locator("[data-knot-note-preview]")
      .evaluate((el) => getComputedStyle(el).position),
    "absolute",
    "Preview text must paint above the positioned card background",
  );
  await page.screenshot({ path: "test-results/canvas-lod-overview.png" });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(async (theme) => {
      const { setAppearance } = await import("/src/services/appearance.ts");
      setAppearance(theme);
    }, theme);
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.theme === theme,
      theme,
    );
    await page.screenshot({ path: `test-results/canvas-lod-${theme}.png` });
    await page.waitForFunction(() =>
      document.querySelector(
        `[data-block-id="${window.previewId}"] [data-knot-note-preview]`,
      ),
    );
    const channel = await note
      .locator(".affine-note-block-container")
      .evaluate((el) => Number(getComputedStyle(el).color.match(/\d+/)[0]));
    assert.ok(
      theme === "dark" ? channel > 180 : channel < 80,
      `${theme} previews must use readable theme text`,
    );
  }
  await page.evaluate(() =>
    document.querySelector("affine-edgeless-root").gfx.viewport.setZoom(0.25),
  );
  const box = await note.boundingBox();
  await page.mouse.dblclick(box.x + 30, box.y + 18);
  const caret = await page.evaluate(() => {
    const range = getSelection().getRangeAt(0),
      node = range.startContainer;
    const paragraph = (
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    ).closest("affine-paragraph");
    const prefix = range.cloneRange();
    prefix.selectNodeContents(
      paragraph.querySelector("[contenteditable=true]"),
    );
    prefix.setEnd(range.startContainer, range.startOffset);
    const index = prefix.toString().replaceAll("\u200b", "").length;
    const length = range.toString().replaceAll("\u200b", "").length;
    const text = paragraph.model.text.toString();
    return {
      id: paragraph.model.id,
      expected:
        text.slice(0, index) + "PREVIEWKEY" + text.slice(index + length),
    };
  });
  await page.keyboard.type("PREVIEWKEY");
  await page.waitForFunction(
    ({ id, expected }) =>
      window.session.doc.getBlock(id)?.model.text.toString() === expected,
    caret,
  );

  await page.waitForFunction(() =>
    window.session.doc
      .getBlock(window.previewId)
      .model.children.some((c) => c.text?.toString().includes("PREVIEWKEY")),
  );
  const activeView = await note.elementHandle(),
    ime = await page.context().newCDPSession(page);
  await ime.send("Input.imeSetComposition", {
    text: String.fromCodePoint(0x6f22),
    selectionStart: 1,
    selectionEnd: 1,
  });
  await page.evaluate(() =>
    document.querySelector("affine-edgeless-root").gfx.viewport.setZoom(0.1),
  );
  assert.equal(await activeView.evaluate((el) => el.isConnected), true);
  await ime.send("Input.insertText", { text: String.fromCodePoint(0x6f22) });
  await ime.detach();
  await page.waitForFunction(() =>
    window.session.doc
      .getBlock(window.previewId)
      .model.children.some((c) =>
        c.text?.toString().includes(String.fromCodePoint(0x6f22)),
      ),
  );
  await page.evaluate(() =>
    document.querySelector("affine-edgeless-root").gfx.viewport.setZoom(1),
  );
  await page.evaluate(async () => {
    const target = window.session.doc
      .getBlocksByFlavour("affine:note")
      .at(-1).id;
    await window.session.focusCanvasCard(target);
    if (
      !window.session.editor.std.view
        .getBlock(target)
        .querySelector(".affine-note-block-container")
    )
      throw Error("Target remained a preview");
  });
  const text = page
    .locator(
      "affine-edgeless-note:visible affine-paragraph [contenteditable=true]",
    )
    .first();
  await text.dblclick({ force: true });
  await page.keyboard.press("End");
  await page.keyboard.type("FIRSTCHAR");
  await page.waitForFunction(() =>
    document
      .querySelector("affine-edgeless-root")
      ?.textContent.includes("FIRSTCHAR"),
  );
  const before = await page
    .locator("affine-edgeless-root")
    .evaluate((r) => [r.gfx.viewport.centerX, r.gfx.viewport.centerY]);
  await page.mouse.move(300, 200);
  await page.mouse.wheel(90, 65);
  await page.waitForFunction(([x, y]) => {
    const v = document.querySelector("affine-edgeless-root").gfx.viewport;
    return v.centerX !== x || v.centerY !== y;
  }, before);
  await page.evaluate(async () => {
    const { LayerManager } =
      await import("/node_modules/@blocksuite/block-std/dist/gfx/layer.js");
    const doc = window.session.doc,
      surface = doc.getBlocksByFlavour("affine:surface")[0].model;
    const a = surface.addElement({
      type: "shape",
      shapeType: "rect",
      xywh: "[0,0,100,100]",
      index: "c000",
    });
    const b = surface.addElement({
      type: "shape",
      shapeType: "rect",
      xywh: "[0,0,100,100]",
      index: "c001",
    });
    const compare = () => {
      const legacy = new LayerManager(doc, null, { watch: false });
      surface.elementModels.forEach((e) => legacy.add(e));
      const bulk = new LayerManager(doc, null, { watch: false });
      bulk.watch({ surface });
      const snapshot = (m) =>
        m.layers.map((l) => [l.type, l.zIndex, l.elements.map((e) => e.id)]);
      if (JSON.stringify(snapshot(legacy)) !== JSON.stringify(snapshot(bulk)))
        throw Error("Layer ordering changed");
      legacy.dispose();
      bulk.dispose();
    };
    compare();
    surface.updateElement(a, {
      index: doc.getBlocksByFlavour("affine:note")[0].model.index,
    });
    compare();
    surface.updateElement(b, { index: surface.getElementById(a).index });
    compare();
    doc.captureSync();
    surface.updateElement(b, { index: "c002" });
    doc.captureSync();
    compare();
    doc.undo();
    compare();
    document.querySelector("affine-edgeless-root").service.createGroup([a, b]);
    compare();
    doc.undo();
    compare();
    const { waitForEditorView } = await import("/src/app/view-readiness.ts"),
      editor = window.session.editor;
    const controller = new AbortController();
    const cancelled = waitForEditorView(editor, "edgeless", {
      targetId: "missing",
      signal: controller.signal,
    }).then(
      () => false,
      (e) => e.name === "AbortError",
    );
    controller.abort();
    if (!(await cancelled)) throw Error("Readiness did not cancel");
    await waitForEditorView(editor, "edgeless", { content: true });
    if (
      [...editor.querySelectorAll("affine-edgeless-note")].some(
        (note) => !note._knotDetailed,
      )
    )
      throw Error("Export retained previews");
    const pending = waitForEditorView(editor, "edgeless", {
      targetId: "missing",
    }).then(
      () => false,
      (e) => e.name === "AbortError",
    );
    await window.session.setMode("page");
    if (!(await pending)) throw Error("Old view survived mode change");
    await window.session.setMode("edgeless");
  });
  const hitIds = await page.evaluate(() => {
    const root = document.querySelector("affine-edgeless-root"),
      doc = window.session.doc,
      surface = doc.getBlocksByFlavour("affine:surface")[0].model;
    const a = surface.addElement({
      type: "shape",
      shapeType: "rect",
      xywh: "[1000,1000,120,120]",
      index: "d0000",
      fillColor: "#ff0000",
      filled: true,
    });
    const b = surface.addElement({
      type: "shape",
      shapeType: "rect",
      xywh: "[1000,1000,120,120]",
      index: "d0001",
      fillColor: "#00ff00",
      filled: true,
    });
    root.gfx.viewport.setViewport(1, [1060, 1060]);
    doc.captureSync();
    return { a, b };
  });
  const hit = async (expected) => {
    await page.evaluate(async () => {
      document
        .querySelector("affine-edgeless-root")
        .gfx.selection.set({ elements: [], editing: false });
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    });
    const r = await page.locator("affine-edgeless-root").boundingBox();
    await page.mouse.click(r.x + 50, r.y + 50);
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    assert.deepEqual(
      await page.evaluate(() =>
        document
          .querySelector("affine-edgeless-root")
          .gfx.selection.selectedElements.map((e) => e.id),
      ),
      [expected],
    );
  };
  await hit(hitIds.b);
  await page.evaluate(({ a }) => {
    const d = window.session.doc;
    d.getBlocksByFlavour("affine:surface")[0].model.updateElement(a, {
      index: "d0002",
    });
    d.captureSync();
  }, hitIds);
  await hit(hitIds.a);
  await page.evaluate(() => window.session.doc.undo());
  await hit(hitIds.b);
  await page.evaluate(({ b }) => {
    const doc = window.session.doc;
    doc.captureSync();
    doc
      .getBlocksByFlavour("affine:surface")[0]
      .model.updateElement(b, { index: "d0000" });
    doc.captureSync();
  }, hitIds);
  await hit(hitIds.b);
  const group = await page.evaluate(({ a, b }) => {
    const doc = window.session.doc;
    doc.captureSync();
    const id = document
      .querySelector("affine-edgeless-root")
      .service.createGroup([a, b]);
    doc.captureSync();
    return id;
  }, hitIds);
  await hit(group);
  await page.evaluate(() => window.session.doc.undo());
  await hit(hitIds.b);
  assert.deepEqual(errors, []);
  console.log(
    "PASS previews, first character, IME across zoom, pan, target focus, export promotion, cancellation, groups/equal-index ordering, reorder and undo hit-testing",
  );
} finally {
  await browser.close();
}
