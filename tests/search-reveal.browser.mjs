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
  assert.deepEqual(
    await page.evaluate(async () => {
      const { searchTextRanges } =
        await import("/src/features/editor/blocksuite/search-reveal.ts");
      const root = document.createElement("div");
      root.innerHTML =
        '<rich-text><v-line><span>İ prefix </span><span>target.</span><b>syntax</b><span>("needle")</span></v-line></rich-text>';
      return searchTextRanges(root, 'target.syntax("needle")').map((range) =>
        range.toString(),
      );
    }),
    ['target.syntax("needle")'],
  );
  await page.evaluate(async () => {
    const { doc } = window.session;
    for (let i = 0; i < 65; i++) {
      const id = doc.addBlock("affine:paragraph", {}, window.noteId);
      doc
        .getBlock(id)
        .model.text.insert(
          `Paragraph ${i}: content above the search match.`,
          0,
        );
    }
    window.matchId = doc.addBlock("affine:paragraph", {}, window.noteId);
    const text = doc.getBlock(window.matchId).model.text;
    text.insert(
      `${"Long line content that wraps naturally in the note. ".repeat(80)} Exact target.syntax("needle") here.`,
      0,
    );
    const start = text.toString().indexOf("target.syntax");
    text.format(start + 4, 9, { bold: true });
    window.query = 'TARGET.syntax("needle")';
    await window.session.focusNotebookNote(window.noteId);
  });
  const reveal = () =>
    page.evaluate(async () => {
      await window.session.revealSearchMatch(window.query, window.noteId);
    });
  assert.deepEqual(
    await page.evaluate(async () => {
      const { isSearchResultOnPage } =
        await import("/src/features/editor/blocksuite/search-reveal.ts");
      const editor = window.session.editor;
      const sibling = editor.doc
        .getBlocksByFlavour("affine:note")
        .find(({ model }) => model.id !== window.noteId).model.id;
      return [
        isSearchResultOnPage(editor, editor.doc.id, window.noteId),
        isSearchResultOnPage(editor, editor.doc.id),
        isSearchResultOnPage(editor, "another-notebook", window.noteId),
        isSearchResultOnPage(editor, editor.doc.id, sibling),
      ];
    }),
    [true, true, false, false],
  );
  const visibleMatch = async () => {
    await page.waitForFunction(() => {
      const marks = document.querySelectorAll(".search-match-overlay > span");
      const editor = window.session.editor.getBoundingClientRect();
      return (
        marks.length > 0 &&
        [...marks].every((mark) => {
          const rect = mark.getBoundingClientRect();
          return (
            rect.top >= editor.top &&
            rect.bottom <= editor.bottom &&
            rect.left >= editor.left &&
            rect.right <= editor.right
          );
        })
      );
    });
    assert.equal(
      await page.evaluate(() => {
        const range = window.session.editor.querySelector(
          ".search-match-overlay",
        );
        return range.parentElement === window.session.editor;
      }),
      true,
    );
  };
  const snapshot = await page.evaluate(() =>
    JSON.stringify(window.session.doc.spaceDoc.getMap("blocks").toJSON()),
  );
  await reveal();
  await visibleMatch();
  assert.ok(
    await page.evaluate(
      () =>
        window.session.editor.querySelector(".affine-page-viewport").scrollTop >
        1500,
    ),
  );
  await page.screenshot({ path: "test-results/search-reveal-page.png" });
  // A second reveal replaces the old overlay; scrolling keeps it on the text.
  await reveal();
  assert.equal(await page.locator(".search-match-overlay").count(), 1);
  await page.evaluate(() => {
    window.session.editor.querySelector(".affine-page-viewport").scrollTop +=
      50;
  });
  await page.waitForTimeout(60);
  await visibleMatch();
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(window.session.doc.spaceDoc.getMap("blocks").toJSON()),
    ),
    snapshot,
  );
  await page.waitForTimeout(3200);
  assert.ok(
    (await page
      .locator(".search-match-overlay")
      .evaluate((el) => Number(el.style.opacity))) < 1,
  );
  await page.waitForFunction(
    () => !document.querySelector(".search-match-overlay"),
  );
  await page.evaluate(async () => {
    await window.session.focusCanvasCard(window.noteId);
    const canvas = window.session.editor.querySelector("affine-edgeless-root");
    canvas.service.viewport.setViewport(0.4, [10000, -10000]);
    await window.session.focusCanvasCard(window.noteId);
    await window.session.revealSearchMatch(window.query, window.noteId);
  });
  await visibleMatch();
  assert.ok(
    await page.evaluate(
      () =>
        window.session.editor.querySelector("affine-edgeless-root").service
          .viewport.zoom >= 1,
    ),
  );
  assert.equal(
    await page.evaluate(async () => {
      const { isSearchResultOnPage } =
        await import("/src/features/editor/blocksuite/search-reveal.ts");
      return isSearchResultOnPage(
        window.session.editor,
        window.session.doc.id,
        window.noteId,
      );
    }),
    false,
  );
  await page.screenshot({ path: "test-results/search-reveal-canvas.png" });
  // The matching range should be centered, even near the end of one very long block.
  const center = await page
    .locator(".search-match-overlay > span")
    .first()
    .boundingBox();
  assert.ok(center.y > 150 && center.y < 650, JSON.stringify(center));
  await page.evaluate(async () => {
    await window.session.setMode("page");
  });
  await page.waitForFunction(
    () => !document.querySelector(".search-match-overlay"),
  );
  await reveal();
  await visibleMatch();
  await page.evaluate(async () => {
    await window.session.revealSearchMatch("a missing query", window.noteId);
  });
  assert.equal(await page.locator(".search-match-overlay").count(), 0);
  await page.evaluate(async () => {
    await window.session.revealSearchMatch(window.query, window.noteId);
    window.session.editor.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "insertText",
        data: "a",
      }),
    );
  });
  assert.equal(await page.locator(".search-match-overlay").count(), 0);
  await page.evaluate(async () => {
    const doc = window.session.doc;
    window.codeId = doc.addBlock("affine:code", {}, window.noteId);
    doc
      .getBlock(window.codeId)
      .model.text.insert(
        `${"const padding = 1; ".repeat(120)}target.syntax("needle")`,
        0,
      );
    await window.session.focusNotebookNote(window.noteId);
    await window.session.revealSearchMatch(window.query, window.noteId);
  });
  // Search the code block alone so the long prose match cannot satisfy the assertion.
  await page.evaluate(async () => {
    window.session.doc
      .getBlock(window.matchId)
      .model.text.delete(
        0,
        window.session.doc.getBlock(window.matchId).model.text.length,
      );
    await window.session.revealSearchMatch(window.query, window.noteId);
  });
  await visibleMatch();
  assert.ok(
    await page.evaluate(() =>
      [
        ...window.session.editor.std.view
          .getBlock(window.codeId)
          .querySelectorAll("*"),
      ].some((el) => el.scrollLeft > 0),
    ),
  );
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = "dark";
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: "test-results/search-reveal-code-dark.png" });
  await page.evaluate(async () => {
    const doc = window.session.doc;
    const web = doc.addBlock(
      "knot:web-source",
      { text: new doc.Text("retained.website.match") },
      window.noteId,
    );
    window.webId = web;
    doc.addBlock(
      "knot:cited-excerpt",
      { text: new doc.Text("readonly.excerpt.match"), reviewed: true },
      window.noteId,
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await window.session.revealSearchMatch(
      "retained.website.match",
      window.noteId,
    );
  });
  await visibleMatch();
  assert.equal(
    await page.evaluate(
      () =>
        window.session.editor.std.view
          .getBlock(window.webId)
          .querySelector("details").open,
    ),
    true,
  );
  await page.evaluate(async () => {
    await window.session.revealSearchMatch(
      "readonly.excerpt.match",
      window.noteId,
    );
  });
  await visibleMatch();
  await page.evaluate(() => {
    window.view.dispose();
    window.session.destroy();
  });
  assert.equal(await page.locator(".search-match-overlay").count(), 0);
  // Verify the global search forwards its exact literal query through both open actions.
  await page.evaluate(async () => {
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { createElement } = (
      await import("/node_modules/.vite/deps/react.js")
    ).default;
    const { GlobalSearch } = await import("/src/app/GlobalSearch.tsx");
    window.opened = [];
    window.reactRoot = createRoot(document.querySelector("#panel"));
    window.reactRoot.render(
      createElement(GlobalSearch, {
        preferredView: "edgeless",
        isResultOnCurrentPage: (result) => result.source.id === "a",
        search: async () => ({
          results: [
            {
              source: { id: "a", title: "Notebook" },
              noteId: "note",
              noteTitle: "Match",
              excerpt: "result",
            },
            {
              source: { id: "b", title: "Other notebook" },
              noteId: "other",
              noteTitle: "Other match",
              excerpt: "result",
            },
          ],
          skipped: [],
          limited: false,
        }),
        recent: async () => [],
        onClose: () => {},
        onOpen: async (...args) => {
          window.opened.push(args);
        },
      }),
    );
  });
  await page.getByRole("combobox").fill('target.syntax("needle")');
  await page.getByRole("option", { name: "Match — Notebook" }).waitFor();
  await page.getByRole("combobox").press("Enter");
  await page
    .getByRole("button", { name: "Show on canvas", exact: true })
    .click();
  await page.getByRole("combobox").press("ArrowDown");
  await page
    .getByRole("button", { name: "Open in page", exact: true })
    .waitFor();
  await page.getByRole("combobox").press("Enter");
  assert.deepEqual(
    await page.evaluate(() =>
      window.opened.map((args) => [args[1], args[2] ?? null, args[3]]),
    ),
    [
      ["note", "page", 'target.syntax("needle")'],
      ["note", "edgeless", 'target.syntax("needle")'],
      ["other", null, 'target.syntax("needle")'],
    ],
  );
  await page.evaluate(() => window.reactRoot.unmount());
  assert.deepEqual(errors, []);
  console.log(
    "Search reveal: exact ranges across formatting, tall cards, page scrolling, canvas centering, fading, cleanup and query forwarding passed",
  );
} finally {
  await browser.close();
}
