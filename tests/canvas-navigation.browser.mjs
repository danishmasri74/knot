import { chromium } from "playwright";
import assert from "node:assert/strict";
import { verifyPanAlignment } from "./canvas-pan-alignment.mjs";
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

  await page.evaluate(async () => {
    const { appendAiContent } =
      await import("/src/features/editor/blocksuite/ai-content.ts");
    const d = window.session.doc;
    await window.session.setMode("page");
    const first = d.getBlocksByFlavour("affine:note")[0].model;
    for (let i = 0; i < 41; i++) {
      const id = i === 0 ? first.id : d.addBlock("affine:note", {}, d.root);
      d.updateBlock(d.getBlock(id).model, {
        xywh: JSON.stringify([
          (i % 7) * 650,
          Math.floor(i / 7) * 550,
          600,
          500,
        ]),
        index: "b" + String(i).padStart(2, "0"),
      });
      for (let j = 0; j < 10; j++)
        d.addBlock(
          "affine:paragraph",
          {
            type: j === 0 ? "h2" : "text",
            text: new d.Text(
              `Card ${i} section ${j}: Testing principles, procedures, and evidence for a dependable application.`,
            ),
          },
          id,
        );
      if (i % 5 === 0)
        appendAiContent(d, id, {
          type: "table",
          text: "Testware",
          columns: ["Type", "Meaning"],
          rows: [
            ["Plan", "Scope and resources"],
            ["Case", "Inputs and expected outcomes"],
            ["Log", "Evidence and results"],
          ],
        });
    }
    await window.session.setMode("edgeless");
    document
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setViewport(0.15, [2250, 1700]);
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("affine-edgeless-note")].every(
        (n) => n._knotRich,
      ),
    null,
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () => document.querySelectorAll("[data-knot-note-preview]").length === 41,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(2000);
  const result = await page.evaluate(async () => {
    let renders = 0,
      captures = 0,
      styleReads = 0;
    const notes = [...document.querySelectorAll("affine-edgeless-note")];
    const originals = notes.map((note) => note.renderGfxBlock);
    notes.forEach(
      (note, i) =>
        (note.renderGfxBlock = function (...args) {
          renders++;
          return originals[i].apply(this, args);
        }),
    );
    const requested = () => captures++;
    document
      .querySelector("affine-edgeless-root")
      .addEventListener("knot-note-preview", requested);
    const originalStyle = window.getComputedStyle;
    window.getComputedStyle = (...args) => {
      styleReads++;
      return originalStyle(...args);
    };
    const root = document.querySelector("affine-edgeless-root");
    const times = [];
    let previous = performance.now();
    for (let i = 0; i < 120; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      times.push(now - previous);
      previous = now;
      root.gfx.viewport.setViewport(0.15 + Math.sin(i / 16) * 0.035, [
        2250 + Math.sin(i / 9) * 150,
        1700 + Math.cos(i / 13) * 100,
      ]);
    }
    await new Promise(requestAnimationFrame);
    window.getComputedStyle = originalStyle;
    notes.forEach((note, i) => (note.renderGfxBlock = originals[i]));
    times.sort((a, b) => a - b);
    return {
      cards: notes.length,
      renders,
      captures,
      styleReads,
      medianMs: times[Math.floor(times.length * 0.5)],
      p95Ms: times[Math.floor(times.length * 0.95)],
      maxMs: times.at(-1),
    };
  });
  console.log(JSON.stringify(result));
  if (process.env.KNOT_NAV_ASSERT === "1") {
    assert.ok(
      result.renders < 120,
      "Steady overview navigation must not redraw every note on every viewport update",
    );
    assert.equal(
      result.captures,
      0,
      "Navigation must not invalidate unchanged previews",
    );
    assert.ok(
      result.styleReads < 100,
      "Snapshot serialization must not run during navigation",
    );
  }
  if (process.env.KNOT_NAV_ASSERT === "1") {
    const before = await page.evaluate(() =>
      [...document.querySelectorAll("affine-edgeless-note")].map((note) => ({
        id: note.model.id,
        url: note
          .querySelector("[data-knot-note-preview]")
          ?.getAttribute("src"),
      })),
    );
    const motionReads = await page.evaluate(async () => {
      performance.clearMarks("knot:canvas-preview-build");
      const note = document.querySelector("affine-edgeless-note");
      note.model.children[0].text.insert("UPDATED DURING NAVIGATION ", 0);
      const original = window.getComputedStyle;
      let reads = 0;
      window.getComputedStyle = (...args) => {
        reads++;
        return original(...args);
      };
      const root = document.querySelector("affine-edgeless-root");
      for (let i = 0; i < 45; i++) {
        root.gfx.viewport.setCenter(2250 + Math.sin(i / 9) * 150, 1700);
        await new Promise(requestAnimationFrame);
      }
      window.getComputedStyle = original;
      return reads;
    });
    assert.ok(
      motionReads < 100,
      "Dirty previews must wait for navigation to stop",
    );
    await page.waitForFunction(
      ({ id, url }) =>
        document
          .querySelector(`[data-block-id="${id}"] [data-knot-note-preview]`)
          ?.getAttribute("src") !== url,
      before[0],
    );
    const after = await page.evaluate(() =>
      [...document.querySelectorAll("affine-edgeless-note")].map((note) => ({
        id: note.model.id,
        url: note
          .querySelector("[data-knot-note-preview]")
          ?.getAttribute("src"),
      })),
    );
    assert.deepEqual(
      after.slice(1),
      before.slice(1),
      "Editing a card must not regenerate unrelated previews",
    );
    const builtCards = await page.evaluate(() => [
      ...new Set(
        performance
          .getEntriesByName("knot:canvas-preview-build")
          .map((entry) => entry.detail),
      ),
    ]);
    assert.deepEqual(
      builtCards,
      [before[0].id],
      "Only the edited card may be serialized after movement",
    );
    console.log(
      "PASS no card redraw loop, no capture during gestures, and targeted refresh after movement",
    );
  }
  // Live-detail navigation should never build invisible overview snapshots,
  // including the idle gaps between real Space-drag gestures.
  await page.evaluate(async () => {
    const root = document.querySelector("affine-edgeless-root");
    root.gfx.viewport.setViewport(0.6, [400, 350]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    performance.clearMarks("knot:canvas-preview-build");
    const note = document.querySelector("affine-edgeless-note");
    note.model.children[0].text.insert("LIVE DETAIL EDIT ", 0);
    window.detailPanStart = root.gfx.viewport.center.x;
  });
  await page.mouse.click(150, 180);
  await page.keyboard.down("Space");
  await page.mouse.move(150, 180);
  await page.mouse.down();
  await page.mouse.move(240, 245, { steps: 30 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(1000);
  const detail = await page.evaluate(() => ({
    builds: performance.getEntriesByName("knot:canvas-preview-build").length,
    moved:
      document.querySelector("affine-edgeless-root").gfx.viewport.center.x !==
      window.detailPanStart,
  }));
  assert.ok(detail.moved, "Real Space-drag must move the viewport");
  assert.equal(
    detail.builds,
    0,
    "Live-detail panning must not serialize hidden overview previews after a gesture",
  );
  await page.evaluate(() =>
    document
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setViewport(0.15, [2250, 1700]),
  );
  await page.waitForFunction(
    () => performance.getEntriesByName("knot:canvas-preview-build").length > 0,
  );
  console.log(
    "PASS real drag and deferred preview capture until overview is needed",
  );
  const resized = await page.evaluate(() => {
    const d = window.session.doc;
    const id = d.addBlock(
      "affine:note",
      { xywh: "[2100,1600,500,200]", index: "z1" },
      d.root,
    );
    d.addBlock("affine:paragraph", { text: new d.Text("Short text") }, id);
    return id;
  });
  await page.waitForFunction(
    (id) =>
      document.querySelector(
        `[data-block-id="${id}"] [data-knot-note-preview]`,
      ),
    resized,
  );
  const sizeBefore = await page.evaluate((id) => {
    const note = document.querySelector(`[data-block-id="${id}"]`);
    const before = {
      url: note.querySelector("[data-knot-note-preview]").getAttribute("src"),
      height: note.querySelector(".affine-note-block-container").offsetHeight,
    };
    const bound = JSON.parse(note.model.xywh);
    bound[2] = 600;
    window.session.doc.updateBlock(note.model, { xywh: JSON.stringify(bound) });
    return before;
  }, resized);
  await page.waitForFunction(
    ({ id, url }) =>
      document
        .querySelector(`[data-block-id="${id}"] [data-knot-note-preview]`)
        ?.getAttribute("src") !== url,
    { id: resized, url: sizeBefore.url },
  );
  assert.equal(
    await page.evaluate(
      (id) =>
        document.querySelector(
          `[data-block-id="${id}"] .affine-note-block-container`,
        ).offsetHeight,
      resized,
    ),
    sizeBefore.height,
  );
  console.log("PASS width-only resizing refreshes the preview");
  await verifyPanAlignment(page);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
