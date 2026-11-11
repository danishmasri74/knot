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

  const id = await page.evaluate(async () => {
    const { appendAiContent } =
      await import("/src/features/editor/blocksuite/ai-content.ts");
    const d = window.session.doc;
    const note = d.getBlocksByFlavour("affine:note")[0].model;
    d.updateBlock(note, { xywh: "[0,0,700,650]" });
    appendAiContent(d, note.id, {
      type: "table",
      text: "Testware quick reference",
      columns: ["Testware", "Meaning"],
      rows: [
        ["Test plan", "Objectives, scope, approach, resources, and schedule."],
        ["Test condition", "An aspect or feature that can be evaluated."],
        ["Test case", "Inputs, expected outcomes, and relevant conditions."],
        ["Test procedure", "Instructions describing how tests are executed."],
        ["Test log", "Record of testing activities and results."],
      ],
    });
    document
      .querySelector("affine-edgeless-root")
      .gfx.viewport.setViewport(0.3, [350, 325]);
    return note.id;
  });
  const note = page.locator(`[data-block-id="${id}"]`);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-block-id="${id}"] [data-knot-note-preview]`)
        ?.querySelector("canvas")?.width,
    id,
  );
  // Allow the nested database view to finish rendering and the snapshot cache to settle.
  await page.waitForFunction(async (id) => {
    const image = document.querySelector(
      `[data-block-id="${id}"] [data-knot-note-preview]`,
    );
    return (
      image &&
      (await (await fetch(image.getAttribute("src"))).text()).includes(
        "Objectives, scope",
      )
    );
  }, id);
  // Overview requests the snapshot; live detail no longer precomputes hidden
  // thumbnails. Return to the comparison scale before taking the live image.
  await page.evaluate(() =>
    document.querySelector("affine-edgeless-root").gfx.viewport.setZoom(0.5),
  );
  await page.mouse.move(1200, 800);
  await page.waitForTimeout(500);
  const full = await note.screenshot({
    path: "test-results/canvas-table-live.png",
  });
  const before = await note.evaluate((el) => el.model.xywh);
  const cachedXML = await note
    .locator("[data-knot-note-preview]")
    .evaluate(async (el) => (await fetch(el.getAttribute("src"))).text());
  // Compare the cached layer against the live table at exactly the same scale.
  await note.evaluate((el) => {
    el._knotLive = false;
    el.requestUpdate();
  });
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-block-id="${id}"] [data-knot-note-preview]`)
        ?.style.opacity === "1",
    id,
  );
  const preview = await note.screenshot({
    path: "test-results/canvas-table-thumbnail.png",
  });
  const alignment = await note.evaluate((el) => {
    const live = el
      .querySelector(".affine-note-block-container")
      .getBoundingClientRect();
    const image = el
      .querySelector("[data-knot-note-preview]")
      .getBoundingClientRect();
    return Math.max(
      Math.abs(live.left - image.left),
      Math.abs(live.top - image.top),
      Math.abs(live.width - image.width),
    );
  });
  assert.ok(
    alignment < 0.5,
    "Snapshot must share the live content origin and width",
  );
  const difference = await page.evaluate(
    async ({ full, preview }) => {
      const decode = async (bytes) => {
        const bmp = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        return {
          width: c.width,
          height: c.height,
          data: ctx.getImageData(0, 0, c.width, c.height).data,
        };
      };
      const a = await decode(full),
        b = await decode(preview);
      if (a.width !== b.width || a.height !== b.height)
        throw Error("Snapshot changed card geometry");
      let different = 0;
      let totalDifference = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        for (const channel of [0, 1, 2])
          totalDifference += Math.abs(
            a.data[i + channel] - b.data[i + channel],
          );
        if (
          Math.max(
            ...[0, 1, 2].map((n) => Math.abs(a.data[i + n] - b.data[i + n])),
          ) > 40
        )
          different++;
      }
      return {
        changed: different / (a.width * a.height),
        mean: totalDifference / (255 * 3 * a.width * a.height),
      };
    },
    { full: [...full], preview: [...preview] },
  );
  console.log({ tablePixelDifference: difference });
  assert.ok(
    difference.changed < 0.08 && difference.mean < 0.025,
    "Thumbnail must preserve the table layout and text positions",
  );
  const zoom = async (value) => {
    await page.evaluate(
      (value) =>
        document
          .querySelector("affine-edgeless-root")
          .gfx.viewport.setZoom(value),
      value,
    );
    await page.waitForTimeout(80);
  };
  await zoom(0.3);
  for (const value of [0.32, 0.35, 0.39]) {
    await zoom(value);
    assert.equal(await note.evaluate((el) => el._knotDetailed), false);
  }
  await zoom(0.4);
  assert.equal(await note.evaluate((el) => el._knotDetailed), true);
  for (const value of [0.39, 0.35, 0.31]) {
    await zoom(value);
    assert.equal(await note.evaluate((el) => el._knotDetailed), true);
  }
  await zoom(0.3);
  assert.equal(await note.evaluate((el) => el._knotDetailed), false);
  assert.equal(await note.evaluate((el) => el.model.xywh), before);
  const currentXML = await note
    .locator("[data-knot-note-preview]")
    .evaluate(async (el) => (await fetch(el.getAttribute("src"))).text());
  assert.equal(
    currentXML,
    cachedXML,
    "Zooming must preserve the cached table appearance",
  );
  await page.evaluate(() => {
    const row =
      window.session.doc.getBlocksByFlavour("affine:database")[0].model
        .children[0];
    row.text.insert("UPDATED ", 0);
  });
  await page.waitForFunction(async (id) => {
    const image = document.querySelector(
      `[data-block-id="${id}"] [data-knot-note-preview]`,
    );
    return (
      image &&
      (await (await fetch(image.getAttribute("src"))).text()).includes(
        "UPDATED",
      )
    );
  }, id);
  for (const theme of ["dark", "light"]) {
    const previous = await note
      .locator("[data-knot-note-preview]")
      .getAttribute("src");
    await page.evaluate(
      async (theme) =>
        (await import("/src/services/appearance.ts")).setAppearance(theme),
      theme,
    );
    await page.waitForFunction(
      ({ id, previous }) => {
        const image = document.querySelector(
          `[data-block-id="${id}"] [data-knot-note-preview]`,
        );
        return (
          image?.querySelector("canvas")?.width &&
          image.getAttribute("src") !== previous
        );
      },
      { id, previous },
    );
    await page.screenshot({ path: `test-results/canvas-table-${theme}.png` });
  }
  assert.deepEqual(errors, []);
  await note.evaluate((el) => {
    const media = document.createElement("video");
    media.id = "unsupported-preview-media";
    el.querySelector(".affine-note-block-container").append(media);
  });
  await page.waitForFunction((id) => {
    const note = document.querySelector(`[data-block-id="${id}"]`);
    return (
      !note.querySelector("[data-knot-note-preview]") &&
      note.querySelector("[data-knot-note-live]").style.opacity === "1"
    );
  }, id);
  await note.evaluate((el) =>
    el.querySelector("#unsupported-preview-media").remove(),
  );
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-block-id="${id}"] [data-knot-note-preview]`)
        ?.querySelector("canvas")?.width,
    id,
  );
  console.log(
    "PASS table thumbnail layout, hysteresis, cache reuse, edits, theme refresh and stable bounds",
  );
} finally {
  await browser.close();
}
