import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  await page.route("**/card-suggestions-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><main style="position:relative;width:1440px;height:1000px"><div class="editor-area" style="width:1000px;height:900px"></div></main></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/card-suggestions-test");
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    (
      await import("/node_modules/.vite/deps/@blocksuite_presets_effects.js")
    ).effects();
    (
      await import("/node_modules/.vite/deps/@blocksuite_blocks_effects.js")
    ).effects();
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } =
      await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { CanvasSuggestions } =
      await import("/src/app/CanvasSuggestions.tsx");
    const { AskKnot } = await import("/src/app/AskKnot.tsx");
    const { captureCardContext } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const collection = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    collection.meta.initialize();
    const doc = collection.createDoc();
    doc.load();
    const root = doc.addBlock("affine:page", {}, null);
    doc.addBlock("affine:surface", {}, root);
    const ids = ["Alpha", "Beta"].map((topic, index) => {
      const id = doc.addBlock(
        "affine:note",
        { xywh: JSON.stringify([index * 400, 0, 340, 500]) },
        root,
      );
      for (let i = 0; i < 4; i++) {
        doc.addBlock(
          "affine:paragraph",
          { type: "h2", text: new Text(topic + " section " + i) },
          id,
        );
        doc.addBlock(
          "affine:paragraph",
          {
            text: new Text(
              (topic + " substantiated detail for section " + i + ". ").repeat(
                9,
              ),
            ),
          },
          id,
        );
      }
      return id;
    });
    const editor = new AffineEditorContainer();
    editor.doc = doc;
    editor.mode = "edgeless";
    const host = document.querySelector(".editor-area");
    host.replaceChildren(editor);
    await editor.updateComplete;
    const canvas = editor.querySelector("affine-edgeless-root");
    canvas.service.viewport.setViewport(0.6, [380, 250]);
    window.shorten = () => {
      for (const b of [...doc.getBlock(ids[1]).model.children])
        doc.deleteBlock(b);
    };
    window.calls = [];
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd === "ai_connected") return true;
        if (cmd === "ai_models") return ["gpt-5.4"];
        if (cmd === "ai_respond") {
          window.calls.push(args);
          await new Promise((resolve) => (window.finish = resolve));
        }
      },
    };
    const mount = document.createElement("div");
    Object.assign(mount.style, {
      position: "absolute",
      left: "1000px",
      top: "0",
      width: "400px",
      height: "900px",
    });
    host.parentElement.append(mount);
    const session = { doc, editor, imageSources: () => [] };
    function Harness() {
      const [visit, setVisit] = React.useState(0);
      window.revisit = () => setVisit((v) => v + 1);
      window.seedLegacyDismissal = () =>
        localStorage.setItem(
          JSON.stringify(["knot.card-suggestions.dismissed", "test", doc.id]),
          JSON.stringify([ids[0]]),
        );
      const [initial, setInitial] = React.useState(null);
      const [suggestion, setSuggestion] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(CanvasSuggestions, {
          key: visit,
          editor,
          workspace: "test",
          disabled: busy || !!suggestion,
          onStart: (id, action) => {
            const context = captureCardContext(
              doc,
              "test",
              doc.getBlock(id).model,
            );
            setInitial(context);
            setSuggestion({ context, action });
          },
        }),
        initial &&
          React.createElement(AskKnot, {
            workspace: "test",
            documentId: doc.id,
            initial,
            suggestion,
            onSuggestionHandled: () => setSuggestion(null),
            onBusy: setBusy,
            getSession: () => session,
          }),
      );
    }
    createRoot(mount).render(React.createElement(Harness));
  });
  const buttons = page.getByRole("button", {
    name: "Break this into ideas?",
  });
  await buttons.nth(1).waitFor();
  await buttons.first().click();
  await page.waitForFunction(() => window.calls.length === 1);
  const [call] = await page.evaluate(() => window.calls);
  assert.equal(call.mode, "canvas");
  assert.match(call.messages.at(-1).content, /atomic idea cards/);
  const text = JSON.parse(call.context)
    .citationSources.map((b) => b.text)
    .join(" ");
  assert.equal(text.includes("Alpha") !== text.includes("Beta"), true);
  // The request describes the canvas: both cards, the asked-about one cited.
  const canvasMap = JSON.parse(call.context).canvasMap;
  assert.match(canvasMap, /^K1 "/m, canvasMap);
  assert.match(canvasMap, /^K2 "/m, canvasMap);
  assert.match(canvasMap, /\[S1–S\d+\]/, canvasMap);
  assert.ok(await buttons.nth(1).isDisabled());
  const groups = page.getByRole("group", { name: "Card suggestions" });
  await groups.first().getByRole("button", { name: "Not now" }).click();
  const waitForCount = (n) =>
    page.waitForFunction(
      (count) => document.querySelectorAll(".card-suggestion").length === count,
      n,
    );
  const revisit = async (count) => {
    const group = await groups.first().elementHandle();
    await page.evaluate(() => window.revisit());
    await page.waitForFunction((old) => !old.isConnected, group);
    await waitForCount(count);
  };
  await waitForCount(1);
  await revisit(1);
  await page.clock.setFixedTime(new Date("2026-11-05T12:00:00Z"));
  await revisit(2);
  const options = groups.first().getByLabel("Suggestion options");
  await options.click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".card-suggestion details[open]").count(), 0);
  await options.click();
  await page.getByRole("button", { name: "Dismiss this suggestion" }).click();
  await waitForCount(1);
  await page.clock.setFixedTime(new Date("2026-11-06T12:00:00Z"));
  await revisit(1);
  await page.evaluate(() => window.seedLegacyDismissal());
  await revisit(1);
  await page.evaluate(() => {
    window.shorten();
    window.finish();
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".card-suggestion").length === 0,
  );
  console.log(
    "PASS card suggestions, scoped auto-send, snooze and revisit, permanent and legacy dismissal, live disqualification",
  );
} finally {
  await browser.close();
}
