// Note tabs that aren't on screen drop their editor after a short warm
// period, and come back with their edits and scroll position.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/note-tab-sleep-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><main style="height:100vh"><div class="workspace-content"><div class="editor-area" id="editor"></div><div id="panel" style="display:contents"></div></div></main></body></html>',
    }),
  );
  await page.goto(
    `${process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420"}/note-tab-sleep-test`,
  );
  await page.clock.install();
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
    document.querySelector("#editor").append(window.session.editor);
    const doc = window.session.doc;
    window.notes = [0, 1, 2].map((n) => {
      const id = doc.addBlock(
        "affine:note",
        { xywh: `[${n * 500},0,400,200]`, index: `t${n}` },
        doc.root,
      );
      for (let line = 0; line < 60; line++)
        doc.addBlock(
          "affine:paragraph",
          { text: new doc.Text(`Note ${n} line ${line}`) },
          id,
        );
      return id;
    });
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { WorkspacePanes } = await import("/src/app/WorkspacePanes.tsx");
    const { NotePagePane } = await import("/src/app/NotePagePane.tsx");
    const { emptyLayout, layoutReducer } = await import("/src/app/workspace-layout.ts");
    function Harness() {
      const [layout, dispatch] = React.useReducer(layoutReducer, emptyLayout());
      window.dispatch = dispatch;
      return React.createElement(WorkspacePanes, {
        layout,
        dispatch,
        available: 1400,
        blocked: false,
        onReturn: () => {},
        label: (tab) => tab.noteId,
        render: (tab, _close, state) =>
          React.createElement(NotePagePane, {
            session: window.session,
            noteId: tab.noteId,
            aiEnabled: false,
            onAsk: () => {},
            asleep: state === "asleep",
          }),
      });
    }
    createRoot(document.querySelector("#panel")).render(React.createElement(Harness));
  });
  await page.waitForFunction(() => !!window.dispatch);
  const tab = (n) => ({
    id: `note-${n}`,
    kind: "note",
    workspaceId: "w",
    documentId: "a",
  });
  const editors = () => page.locator("[data-note-pane]").count();
  for (const n of [0, 1, 2])
    await page.evaluate(
      ([t, id]) => window.dispatch({ type: "open", tab: { ...t, noteId: id } }),
      [tab(n), await page.evaluate((n) => window.notes[n], n)],
    );
  await page.waitForFunction(
    () => document.querySelectorAll("[data-note-pane]").length === 3,
  );
  assert.equal(await editors(), 3, "tabs just left stay warm");

  // Scroll the first note, leave it, and let it go to sleep.
  await page.evaluate(() => window.dispatch({ type: "activate", id: "note-0" }));
  const viewport = page.locator("#panel-note-0 .affine-page-viewport");
  await viewport.waitFor();
  await viewport.evaluate((v) => (v.scrollTop = 400));
  await page.clock.runFor(100);
  await page.evaluate(() => window.dispatch({ type: "activate", id: "note-2" }));
  await page.clock.runFor(31_000);
  await page.waitForFunction(
    () => document.querySelectorAll("[data-note-pane]").length === 1,
  );
  assert.equal(await editors(), 1, "only the visible note keeps an editor");

  // An edit made elsewhere while asleep is there when the tab wakes, and it
  // comes back at the same scroll position.
  await page.evaluate(() => {
    const p = window.session.doc.getBlock(window.notes[0]).model.children[0];
    p.text.insert(" edited while asleep", p.text.length);
  });
  await page.evaluate(() => window.dispatch({ type: "activate", id: "note-0" }));
  // The clock is fake: let the editor's animation frames run.
  await page.clock.runFor(1000);
  await page.locator("#panel-note-0 [data-note-pane]").waitFor();
  await page.clock.runFor(1000);
  await page
    .locator("#panel-note-0 .note-page-host")
    .getByText("Note 0 line 0 edited while asleep")
    .waitFor();
  assert.ok(
    (await page
      .locator("#panel-note-0 .affine-page-viewport")
      .evaluate((v) => v.scrollTop)) >= 390,
    "woken tab returns to its scroll position",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS note tabs: warm after leaving, asleep after 30 s with one editor left, wake with edits and scroll position",
  );
} finally {
  await browser.close();
}
