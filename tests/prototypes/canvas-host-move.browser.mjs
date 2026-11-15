// Prototype for the tabbed layout plan (docs/TABBED-LAYOUT-PLAN.md, step 3).
// Question: can the canvas editor move between columns, resize, and hide
// without remounting BlockSuite or losing its viewport?
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
const record = (step, data) => {
  results.push({ step, ...data });
  console.log(step, JSON.stringify(data));
};
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/host-move-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="margin:0"><div id="panes" style="position:relative;width:1400px;height:850px"><section id="host" style="position:absolute;top:0;left:0;width:700px;height:850px"></section></div><div id="elsewhere" style="position:absolute;left:0;top:0;width:700px;height:850px"></div></body></html>',
    }),
  );
  await page.goto(
    `${process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420"}/host-move-test`,
  );
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    const catalog = [{ id: "a", title: "Board A", kind: "whiteboard", updated_at: 1 }];
    window.saved = {};
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd === "filter_objects") return args.offset === 0 ? catalog : [];
        if (cmd === "load_document") return window.saved[args.id] ?? null;
        if (cmd === "load_card_deck") return "{}";
        if (cmd === "save_documents") {
          for (const w of args.documents) window.saved[w.id] = w.snapshot;
          return;
        }
        if (cmd === "list_blobs") return [];
        throw Error("Unexpected " + cmd);
      },
    };
    const { openEditor } = await import("/src/features/editor/blocksuite/adapter.ts");
    window.session = await openEditor(catalog[0], () => {});
    document.querySelector("#host").append(window.session.editor);
  });
  await page.waitForSelector("affine-edgeless-note .affine-note-block-container");
  await page.evaluate(async () => {
    const root = document.querySelector("affine-edgeless-root");
    const d = root.doc;
    const id = d.addBlock(
      "affine:note",
      { xywh: "[0,0,300,120]", index: "t9" },
      d.root,
    );
    d.addBlock("affine:paragraph", { text: new d.Text("Host move target") }, id);
    window.target = d.getBlock(id).model;
    root.gfx.viewport.setViewport(1, [150, 60]);
    root.__probe = "original";
    window.session.editor.__probe = "original";
    window.disconnects = 0;
    const original = root.disconnectedCallback.bind(root);
    root.disconnectedCallback = () => {
      window.disconnects++;
      original();
    };
    await new Promise((r) => setTimeout(r, 600));
  });

  // Where BlockSuite thinks the card is vs where it is on screen.
  const measure = () =>
    page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 150));
      const root = document.querySelector("affine-edgeless-root");
      const vp = root?.gfx.viewport;
      const el = document.querySelector(`[data-block-id="${window.target.id}"]`);
      const r = el?.getBoundingClientRect();
      const host = document.querySelector("#host").getBoundingClientRect();
      const [vx, vy] = vp ? vp.toViewCoord(0, 0) : [NaN, NaN];
      return {
        sameRoot: root?.__probe === "original",
        sameEditor: window.session.editor.__probe === "original",
        disconnects: window.disconnects,
        zoom: vp && +vp.zoom.toFixed(3),
        center: vp && [+vp.centerX.toFixed(1), +vp.centerY.toFixed(1)],
        vpSize: vp && [Math.round(vp.width), Math.round(vp.height)],
        cardOnScreen: r && [Math.round(r.left), Math.round(r.top)],
        cardExpected: [Math.round(host.left + vx), Math.round(host.top + vy)],
      };
    });
  const clickSelects = async () => {
    const point = await page.evaluate(() => {
      const el = document.querySelector(`[data-block-id="${window.target.id}"]`);
      const r = el.getBoundingClientRect();
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await page.mouse.click(10, 840);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(200);
    return page.evaluate(() =>
      document
        .querySelector("affine-edgeless-root")
        .gfx.selection.selectedIds.includes(window.target.id),
    );
  };
  const setHost = (style) =>
    page.evaluate((s) => Object.assign(document.querySelector("#host").style, s), style);

  record("start", { ...(await measure()), click: await clickSelects() });

  await setHost({ left: "700px" });
  record("move to right column (left 0 -> 700)", { ...(await measure()), click: await clickSelects() });

  await setHost({ width: "400px" });
  record("narrow (700 -> 400)", { ...(await measure()), click: await clickSelects() });

  await setHost({ left: "0px", width: "1400px" });
  record("expand to full width", { ...(await measure()), click: await clickSelects() });

  await page.evaluate(() => (document.querySelector("#host").hidden = true));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const vp = document.querySelector("affine-edgeless-root").gfx.viewport;
    window.whileHidden = { zoom: vp.zoom, size: [vp.width, vp.height] };
  });
  await page.evaluate(() => (document.querySelector("#host").hidden = false));
  record("hidden then shown (closed tab / rail)", {
    whileHidden: await page.evaluate(() => window.whileHidden),
    ...(await measure()),
    click: await clickSelects(),
  });

  record("errors before re-parent", { count: errors.length });

  // Fix A: hide with visibility (keeps layout size) instead of display:none.
  await page.evaluate(() => document.querySelector("affine-edgeless-root").gfx.viewport.setViewport(1, [150, 60]));
  await page.evaluate(() => {
    const h = document.querySelector("#host");
    h.style.visibility = "hidden";
    h.inert = true;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const h = document.querySelector("#host");
    h.style.visibility = "";
    h.inert = false;
  });
  record("fix A: visibility hidden + inert", await measure());

  // Fix B: keep display:none, but save the viewport before and restore after.
  await page.evaluate(() => {
    const vp = document.querySelector("affine-edgeless-root").gfx.viewport;
    vp.setViewport(1, [150, 60]);
    window.savedViewport = { zoom: vp.zoom, center: [vp.centerX, vp.centerY] };
    document.querySelector("#host").hidden = true;
  });
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    document.querySelector("#host").hidden = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const vp = document.querySelector("affine-edgeless-root").gfx.viewport;
    vp.setViewport(window.savedViewport.zoom, window.savedViewport.center);
  });
  record("fix B: display none + save/restore viewport", { ...(await measure()), click: await clickSelects() });
  record("errors before re-parent (after fixes)", { count: errors.length });

  // Typing into the card still works after all the moves.
  await page.evaluate(() => (document.querySelector("#host").style.width = "700px"));
  await page.waitForTimeout(200);
  const typed = await page.evaluate(async () => {
    const p = window.target.children[0];
    p.text.insert("!", p.text.length);
    await new Promise((r) => setTimeout(r, 100));
    return p.text.toString();
  });
  record("model edit after moves", { text: typed });

  // Contrast: re-parenting the host (what we must avoid).
  await page.evaluate(() =>
    document.querySelector("#elsewhere").append(document.querySelector("#host")),
  );
  await page.waitForTimeout(400);
  record("re-parent host to another element", await measure());

  record("page errors", { errors });
} finally {
  await browser.close();
}
