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
    window.view = await window.session.createNotePageView(
      note.id,
      document.querySelector("#panel"),
    );
  });
  await page.locator("[data-note-pane] affine-paragraph").first().waitFor();
  assert.equal(
    await page.evaluate(() => window.view.editor.doc === window.session.doc),
    true,
  );
  assert.equal(await page.locator("[data-note-pane] affine-note").count(), 1);
  assert.equal(await page.locator("[data-note-pane] affine-list").count(), 1);
  assert.equal(await page.locator("[data-note-pane] affine-code").count(), 1);
  assert.equal(
    await page
      .locator("[data-note-pane]")
      .getByText("Hidden sibling", { exact: true })
      .count(),
    0,
  );
  const input = page
    .locator('[data-note-pane] affine-paragraph [contenteditable="true"]')
    .first();
  await page.evaluate(() => window.session.doc.captureSync());
  await input.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" from pane");
  await page.waitForTimeout(250);
  assert.match(
    await page.evaluate(() =>
      window.session.doc
        .getBlock(window.noteId)
        .model.children[0].text.toString(),
    ),
    /from pane/,
  );
  assert.equal(
    await page.evaluate(() => window.session.editor.mode),
    "page",
  );
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() =>
      window.session.doc
        .getBlock(window.noteId)
        .model.children[0].text.toString(),
    ),
    "Reusable knowledge",
  );
  await page.keyboard.press("Control+Shift+z");
  await page.evaluate(async () => {
    await window.session.flush();
  });
  const scanCounts = await page.evaluate(async () => {
    const { observeToolbarMounts } = await import('/src/features/editor/blocksuite/toolbar-observer.ts');
    let discoveries = 0;
    const stop = observeToolbarMounts('[data-test-toolbar]', () => discoveries++);
    const { observeEditorPreferences } = await import('/src/services/editor-preferences.ts');
    const host = document.createElement('div');
    host.innerHTML = '<div contenteditable="true">Typing</div>'.repeat(300);
    document.body.append(host);
    const stopPreferences = observeEditorPreferences(host);
    await new Promise(requestAnimationFrame);
    let fullScans = 0;
    const query = host.querySelectorAll.bind(host);
    host.querySelectorAll = (...args) => { fullScans++; return query(...args); };
    for (let i = 0; i < 20; i++) {
      host.firstElementChild.textContent += 'x';
      await new Promise(requestAnimationFrame);
    }
    const added = document.createElement('div');
    added.contentEditable = 'true';
    host.append(added);
    await new Promise(requestAnimationFrame);
    if (added.getAttribute('spellcheck') !== 'true') throw Error('New editable missed preferences');
    const bar = document.createElement('div');
    bar.dataset.testToolbar = '';
    host.append(bar);
    await new Promise(requestAnimationFrame);
    stop(); stopPreferences(); host.remove();
    return { fullScans, discoveries };
  });
  assert.deepEqual(scanCounts, { fullScans: 0, discoveries: 1 });
  console.log('Page + note observer regression:', scanCounts);
  await page.screenshot({ path: "test-results/page-note-performance.png" });
  assert.deepEqual(errors, []);
  await page.evaluate(async () => {
    window.view.dispose();
    const note = window.session.doc.getBlock(window.noteId).model;
    window.session.doc.updateBlock(note, { lockedBySelf: true });
    let rejected = false;
    try {
      await window.session.createNotePageView(
        note.id,
        document.querySelector("#panel"),
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Locked note opened an editable pane");
    window.session.doc.updateBlock(note, { lockedBySelf: false });
  });
  await page.evaluate(() => {
    window.view.dispose();
    window.session.destroy();
  });
  console.log(
    "Page + note input, undo/redo, observer isolation and locked-note gate passed",
  );
} finally {
  await browser.close();
}
