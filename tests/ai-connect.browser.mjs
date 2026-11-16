// Phase 3 of canvas awareness: connect_cards adds suggested arrows between
// existing cards (typed color, visible label), skips an arrow that already
// exists, refuses stale handles and a set that adds nothing, and Undo
// removes the new arrows. The preview lists each suggestion with its reason
// and a checkbox; unticking one updates the count.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport: { width: 1000, height: 850 },
  });
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(`${e.message} ${e.stack?.split("\n").slice(1, 4).join(" ")}`),
  );
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  const result = await page.evaluate(async () => {
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } =
      await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const Y = await import("/node_modules/.vite/deps/yjs.js");
    const { captureAiContext, applyAiProposal } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const { canvasHandles } = await import("/src/services/canvas-map-format.ts");
    const { ATOMIZE_RELATIONS } = await import("/src/services/ai-atomize.ts");
    const c = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("Testing") });
    const surfaceId = d.addBlock("affine:surface", {}, root);
    const note = (xywh, text) => {
      const id = d.addBlock("affine:note", { xywh }, root);
      d.addBlock("affine:paragraph", { text: new Text(text) }, id);
      return id;
    };
    const execute = note("[0,0,300,120]", "Execute tests");
    const env = note("[500,0,300,120]", "Test environment");
    const report = note("[1000,0,300,120]", "Report results");
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "edgeless";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff";
    document.body.append(host);
    host.append(editor);
    await editor.updateComplete;
    await new Promise((r) => setTimeout(r, 300));
    const surface = d.getBlock(surfaceId).model;
    surface.addElement({
      type: "connector",
      source: { id: execute },
      target: { id: report },
      text: new Y.Text("leads to"),
    });
    await new Promise((r) => setTimeout(r, 200));
    d.resetHistory();
    const context = captureAiContext(editor, "test", null);
    const handles = canvasHandles(context.canvasMap);
    const h = (id) => [...handles].find(([, t]) => t.id === id)[0];
    const attempt = (arrows) => {
      try {
        applyAiProposal(d, "test", context, { replacements: [], blocks: [], arrows }, "connect");
        return "";
      } catch (error) {
        return String(error);
      }
    };
    const stale = attempt([{ from: "K99", to: h(env), label: "requires", reason: "" }]);
    const nothing = attempt([{ from: h(execute), to: h(report), label: "leads to", reason: "" }]);
    const undo = applyAiProposal(
      d,
      "test",
      context,
      {
        replacements: [],
        blocks: [],
        arrows: [
          { from: h(execute), to: h(env), label: "requires", reason: "Tests run in an environment." },
          { from: h(execute), to: h(report), label: "leads to", reason: "Already drawn." },
        ],
      },
      "connect",
    );
    const arrows = surface.elementModels.filter((e) => e.type === "connector");
    const added = arrows.find((e) => e.target.id === env);
    const after = {
      count: arrows.length,
      from: added?.source.id === execute,
      label: String(added?.text ?? ""),
      color: added?.stroke,
      labelBox: Array.isArray(added?.labelXYWH),
    };
    undo();
    return {
      stale,
      nothing,
      after,
      undone: surface.elementModels.filter((e) => e.type === "connector").length,
      requires: ATOMIZE_RELATIONS.requires,
    };
  });
  assert.match(result.stale, /aren't on the canvas any more/);
  assert.match(result.nothing, /already on the canvas/);
  assert.deepEqual(result.after, {
    count: 2,
    from: true,
    label: "requires",
    color: result.requires,
    labelBox: true,
  });
  assert.equal(result.undone, 1, "Undo removes only the new arrow");

  // The preview: a saved connect proposal with two suggestions.
  await page.route("**/connect-preview-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root" style="height:800px;display:flex"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/connect-preview-test");
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    await import("/src/styles/app.css");
    localStorage.clear();
    localStorage.setItem(
      "knot.ai.chats.v1:preview:fixture",
      JSON.stringify({
        id: "fixture",
        documentId: "doc",
        title: "Connections",
        updated: 1,
        turns: [
          { role: "user", content: "What connections are missing?" },
          {
            role: "assistant",
            content: "Suggested connections",
            mode: "connect",
            proposal: {
              blocks: [],
              replacements: [],
              arrows: [
                { from: "K1", to: "K2", label: "requires", reason: "Tests run in an environment." },
                { from: "K3", to: "K1", label: "contrasts with", reason: "Static versus dynamic." },
              ],
            },
          },
        ],
      }),
    );
    window.chatStore = new Map();
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd === "ai_chats_list") return [...window.chatStore.values()];
        if (cmd === "ai_chat_save") return void window.chatStore.set(args.id, args.data);
        return cmd === "ai_connected" ? true : cmd === "ai_models" ? ["gpt-5.4-mini"] : undefined;
      },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { AskKnot } = await import("/src/app/AskKnot.tsx");
    createRoot(document.getElementById("root")).render(
      React.createElement(AskKnot, {
        workspace: "preview",
        documentId: "doc",
        initial: null,
        suggestion: null,
        onBusy: () => {},
        getSession: () => null,
        onClose: () => {},
        onSource: async () => {},
      }),
    );
  });
  const header = page.locator(".ask-proposal > span").first();
  await header.waitFor();
  assert.equal(await header.textContent(), "Add 2 of 2 connections");
  assert.equal(await page.getByText("Tests run in an environment.").count(), 1);
  const boxes = page.locator(".ask-connect-list input[type=checkbox]");
  assert.equal(await boxes.count(), 2);
  // A saved chat can't apply, so its choices are read-only.
  assert.ok(await boxes.nth(1).isDisabled());
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await page.locator(".ask-proposal").screenshot({
      path: `test-results/connect-preview-${theme}.png`,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Connect: suggested arrow added with color and label, existing one skipped, stale refused, Undo; preview checkboxes update the count",
  );
} finally {
  await browser.close();
}
