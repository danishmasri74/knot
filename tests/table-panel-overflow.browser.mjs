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
  await page.evaluate(async () => {
    const { appendAiContent } = await import('/src/features/editor/blocksuite/ai-content.ts');
    const note = window.session.doc.getBlocksByFlavour('affine:note')[0].model;
    appendAiContent(window.session.doc, note.id, {
      type: 'table', text: 'Testing types', columns: ['Testing Type', 'Purpose'],
      rows: [['Unit Testing', 'Tests individual functions or components'], ['Integration Testing', 'Tests interactions between components']],
    });
    await window.session.setMode('page');
    window.view = await window.session.createNotePageView(note.id, document.querySelector('#panel'));
  });
  await page.locator('[data-note-pane] component-overflow').waitFor();
  const results = await page.evaluate(async () => {
    const panel = document.querySelector('#panel');
    const overflow = panel.querySelector('component-overflow');
    const results = [];
    const { initializeAppearance, setAppearance } = await import('/src/services/appearance.ts');
    initializeAppearance();
    for (const theme of ['light', 'dark']) {
      setAppearance(theme);
      for (const width of [280, 320, 360, 380, 420, 480, 600, 380, 320]) {
        panel.style.width = width + 'px';
        await new Promise(resolve => setTimeout(resolve, 100));
        const counts = [], heights = [];
        for (let i = 0; i < 40; i++) {
          await new Promise(requestAnimationFrame);
          counts.push(overflow.renderCount);
          heights.push(overflow.getBoundingClientRect().height);
        }
        results.push({theme, width, counts: [...new Set(counts)], heights: [...new Set(heights)]});
      }
    }
    // Force real overflow too: hidden tabs must retain measurable width even
    // when the app's global .hidden utility is present.
    overflow.style.width = '50px';
    await new Promise(resolve => setTimeout(resolve, 100));
    const counts = [];
    for (let i = 0; i < 40; i++) {
      await new Promise(requestAnimationFrame);
      counts.push(overflow.renderCount);
    }
    if (counts.some(count => count !== 0)) throw Error('More toggle oscillates at forced narrow width');
    overflow.style.width = '300px';
    await new Promise(resolve => setTimeout(resolve, 100));
    if (overflow.renderCount !== 1) throw Error('Tab did not return when widened');
    return results;
  });
  console.log(JSON.stringify(results));
  for (const result of results) {
    assert.equal(result.counts.length, 1, `Unstable tab count at ${result.width}px`);
    assert.equal(result.heights.length, 1, `Unstable header height at ${result.width}px`);
  }
  await page.screenshot({path: 'test-results/table-panel-overflow.png'});
  assert.deepEqual(errors, []);
  console.log('Table header remains stable across narrow/wide panel resizing in both themes.');
} finally {
  await browser.close();
}
