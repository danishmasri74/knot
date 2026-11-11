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
      body: '<!doctype html><html><body><div id="editor" class="editor-area" style="width:1000px;height:100vh"></div><div id="panel" class="note-page-host" style="position:absolute;left:1000px;top:0;width:380px;height:100vh"></div></body></html>',
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
    await import("/src/styles/dropdowns.css");
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

    window.view = await window.session.createNotePageView(
      note.id,
      document.querySelector("#panel"),
    );
  });
  assert.equal(await page.locator("[data-note-pane] .floating-toc").count(), 0);
  await page.evaluate(async () => {
    await window.session.setMode("page");
  });
  const toc = page.locator("#editor .floating-toc");
  await toc.waitFor();
  assert.equal(await toc.getByRole("button").count(), 1);
  await page.waitForTimeout(200);
  assert.ok((await toc.boundingBox()).width <= 41);
  await page.evaluate(() => {
    const { doc } = window.session;
    window.headingIds = [];
    for (let section = 0; section < 12; section++) {
      const id = doc.addBlock(
        "affine:paragraph",
        { type: `h${(section % 3) + 1}` },
        window.noteId,
      );
      doc.getBlock(id).model.text.insert(`Section ${section + 1}`, 0);
      window.headingIds.push(id);
      for (let i = 0; i < 4; i++) {
        const p = doc.addBlock("affine:paragraph", {}, window.noteId);
        doc
          .getBlock(p)
          .model.text.insert(
            "Body text to make each section independently scrollable.",
            0,
          );
      }
    }
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#editor .floating-toc button").length === 13,
  );
  const before = await page
    .locator("#editor affine-paragraph")
    .first()
    .boundingBox();
  await toc.hover();
  await page.waitForTimeout(220);
  assert.equal(await toc.getAttribute("data-expanded"), "true");
  assert.ok((await toc.boundingBox()).width >= 270);
  assert.deepEqual(
    await page.locator("#editor affine-paragraph").first().boundingBox(),
    before,
  );
  const indents = await toc
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons
        .slice(1, 4)
        .map((b) => parseFloat(getComputedStyle(b).paddingLeft)),
    );
  assert.ok(indents[0] < indents[1] && indents[1] < indents[2]);
  await toc.getByRole("button", { name: "Section 8", exact: true }).click();
  await page.waitForTimeout(850);
  assert.equal(
    await toc.locator('[aria-current="location"]').getAttribute("aria-label"),
    "Section 8",
  );
  const position = await page.evaluate(() => {
    const editor = window.session.editor;
    return editor.querySelector(".affine-page-viewport").scrollTop;
  });
  assert.ok(position > 500);
  await page.mouse.move(600, 400);
  await page.waitForTimeout(220);
  assert.equal(await toc.getAttribute("data-expanded"), null);
  await page.waitForTimeout(200);
  assert.ok((await toc.boundingBox()).width <= 41);
  await toc.getByRole("button").first().focus();
  await page.keyboard.press("End");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.getAttribute("aria-label"),
    ),
    "Section 12",
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(850);
  assert.equal(
    await toc.locator('[aria-current="location"]').getAttribute("aria-label"),
    "Section 12",
  );
  await page.keyboard.press("Escape");
  assert.equal(await toc.getAttribute("data-expanded"), null);
  await page.evaluate(() => {
    const doc = window.session.doc;
    const heading = doc.getBlock(window.headingIds[0]).model;
    heading.text.insert("Updated ", 0);
    doc.updateBlock(doc.getBlock(window.headingIds[1]).model, { type: "text" });
  });
  await toc
    .getByRole("button", { name: "Updated Section 1", exact: true })
    .waitFor();
  assert.equal(await toc.getByRole("button").count(), 12);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }, theme);
    await toc.hover();
    await page.waitForTimeout(220);
    await page.screenshot({ path: `test-results/floating-toc-${theme}.png` });
    const colors = await toc.evaluate((nav) => ({
      bg: getComputedStyle(nav).backgroundColor,
      color: getComputedStyle(nav).color,
    }));
    assert.notEqual(colors.bg, "rgba(0, 0, 0, 0)");
    assert.notEqual(colors.bg, colors.color);
    await page.mouse.move(600, 400);
  }
  await page.evaluate(async () => {
    await window.session.setMode("page");
  });
  const mainToc = page.locator(
    "#editor > affine-editor-container > .floating-toc",
  );
  await mainToc.waitFor();
  assert.equal(await mainToc.getByRole("button").count(), 12);
  await page.evaluate(async () => {
    await window.session.setMode("edgeless");
  });
  await page.waitForFunction(() =>
    document.querySelector(
      '#editor .floating-toc[data-mode="edgeless"] button[data-heading-id]',
    ),
  );
  assert.equal(
    await mainToc
      .getByRole("button", { name: "Toggle canvas outline" })
      .count(),
    0,
  );
  await page.mouse.move(600, 400);
  assert.equal(await mainToc.getAttribute("data-expanded"), null);
  await mainToc.hover();
  assert.equal(await mainToc.getAttribute("data-expanded"), "true");
  const cards = mainToc.locator("button[data-heading-id]");
  assert.ok((await cards.count()) >= 2);
  const beforeZoom = await page.evaluate(
    () =>
      window.session.editor.querySelector("affine-edgeless-root").gfx.viewport
        .zoom,
  );
  await cards.last().click();
  assert.equal(await cards.last().getAttribute("aria-current"), "location");
  assert.equal(
    await page.evaluate(
      () =>
        window.session.editor.querySelector("affine-edgeless-root").gfx.viewport
          .zoom,
    ),
    beforeZoom,
  );
  await cards.first().click();
  assert.equal(await cards.first().getAttribute("aria-current"), "location");
  await page.mouse.move(600, 400);
  assert.equal(await mainToc.getAttribute("data-expanded"), null);
  await cards.first().focus();
  assert.equal(await mainToc.getAttribute("data-expanded"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await mainToc.getAttribute("data-expanded"), null);
  assert.equal(
    await mainToc.evaluate((nav) => document.activeElement === nav),
    true,
  );
  await page.setViewportSize({ width: 1180, height: 520 });
  await page.evaluate(async () => {
    document.querySelector("#editor").style.width = "180px";
    window.scrollTo(0, 0);
    await window.session.setMode("page");
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(150, 80);
  await page.waitForTimeout(220);
  const box = await toc.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 180, JSON.stringify(box));
  assert.ok(box.y >= 0 && box.y + box.height <= 520);
  await page.evaluate(() => {
    const doc = window.session.doc;
    for (const { model } of doc.getBlocksByFlavour("affine:paragraph")) {
      if (/^h[1-6]$/.test(model.type)) doc.updateBlock(model, { type: "text" });
    }
  });
  await page.waitForFunction(
    () => document.querySelector("#editor .floating-toc").hidden,
  );
  assert.equal(await page.locator("[data-note-pane] .floating-toc").count(), 0);
  await page.evaluate(() => {
    window.view.dispose();
    window.session.destroy();
  });
  assert.deepEqual(errors, []);
  console.log(
    "Floating TOC: hierarchy, live updates, hover, keyboard, scrolling, themes, view isolation and bounds passed",
  );
} finally {
  await browser.close();
}
