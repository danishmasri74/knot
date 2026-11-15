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
      body: '<html><body><main style="height:100vh"><div class="workspace-content" id="layout"><div class="editor-area" id="editor"></div><div id="panel" style="display:contents"></div></div></main></body></html>',
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
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { WorkspacePanes } = await import("/src/app/WorkspacePanes.tsx");
    const { NotePagePane } = await import("/src/app/NotePagePane.tsx");
    const { emptyLayout, layoutReducer } =
      await import("/src/app/workspace-layout.ts");
    const { observeNotePaneToolbar } =
      await import("/src/features/editor/blocksuite/note-pane-toolbar.ts");
    window.stopToolbar = observeNotePaneToolbar(
      window.session.editor,
      () => {},
    );
    function Harness() {
      const [layout, dispatch] = React.useReducer(layoutReducer, emptyLayout());
      const [width, setWidth] = React.useState(innerWidth);
      React.useEffect(() => {
        const fn = () => setWidth(innerWidth);
        addEventListener("resize", fn);
        return () => removeEventListener("resize", fn);
      }, []);
      window.dispatch = dispatch;
      return React.createElement(WorkspacePanes, {
        layout,
        dispatch,
        available: width,
        blocked: false,
        onReturn: () => {},
        label: (tab) =>
          tab.kind === "note"
            ? "Chapter two"
            : tab.id.startsWith("pdf-")
              ? `Reader ${tab.id.slice(4)}`
              : "PDF reader",
        render: (tab) =>
          tab.kind === "note"
            ? React.createElement(NotePagePane, {
                session: window.session,
                noteId: note.id,
                aiEnabled: false,
                onAsk: () => {},
              })
            : React.createElement(
                "div",
                { className: "fixture-reader" },
                "PDF reader state retained",
              ),
      });
    }
    window.root = createRoot(document.querySelector("#panel"));
    window.root.render(React.createElement(Harness));
  });
  await page.waitForFunction(() => !!window.dispatch);
  await page.evaluate(() =>
    window.dispatch({
      type: "open",
      tab: {
        id: "note",
        kind: "note",
        workspaceId: "w",
        documentId: "a",
        noteId: window.noteId,
      },
    }),
  );
  await page.locator("[data-note-pane] affine-paragraph").waitFor();
  await page.waitForFunction(() => {
    const panes = document.querySelector(".workspace-panes");
    return panes.dataset.collapsed === "false";
  });
  const host = await page.locator("[data-note-pane]").elementHandle();
  await host.evaluate((element) => {
    element.dataset.visibilitySentinel = "retained";
  });
  // "Hide columns" leaves only the canvas column; this harness has no canvas
  // tab, so every column hides while the hosts stay mounted.
  const toggleColumns = (hidden) =>
    page.evaluate(
      (hidden) => window.dispatch({ type: "visibility", hidden }),
      hidden,
    );
  await toggleColumns(true);
  await page.locator(".workspace-panes").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator(".workspace-panes")
      .evaluate((element) =>
        element.parentElement.style.getPropertyValue("--support-width"),
      ),
    "0px",
  );
  assert.equal(
    await page
      .locator(".editor-area")
      .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
    await page
      .locator(".workspace-content")
      .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
  );
  assert.equal(await host.evaluate((element) => element.isConnected), true);
  await toggleColumns(false);
  await page.locator(".workspace-panes").waitFor({ state: "visible" });
  assert.equal(
    await page
      .locator("[data-note-pane]")
      .getAttribute("data-visibility-sentinel"),
    "retained",
  );
  const input = page
    .locator('[data-note-pane] affine-paragraph [contenteditable="true"]')
    .first();
  await input.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" from pane");
  await page.evaluate(() =>
    window.dispatch({
      type: "open",
      tab: { id: "pdf", kind: "pdf", workspaceId: "w", documentId: "a" },
    }),
  );
  // Columns have no ⋯ menu: a tab's own menu separates it.
  assert.equal(await page.locator(".pane-menu, .pane-group-drag").count(), 0);
  await page
    .getByRole("tab", { name: "PDF reader", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in new column ←", exact: true })
    .click();
  assert.equal(await page.locator(".pane-group").count(), 2);
  // One Focus switch, at the right end of the rightmost header, acting on
  // the column marked current.
  assert.equal(await page.locator(".pane-focus").count(), 1);
  assert.equal(
    await page.locator(".pane-group").last().locator(".pane-focus").count(),
    1,
  );
  assert.equal(
    await page.locator('.pane-header[data-current="true"]').count(),
    1,
  );
  const current = await page
    .locator('.pane-header[data-current="true"] [role="tab"]')
    .first()
    .textContent();
  await page.locator(".pane-focus").click();
  assert.equal(await page.locator(".pane-rail").count(), 1);
  assert.equal(await page.locator(".pane-group").count(), 1);
  assert.equal(
    await page.locator(".pane-focus").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page.locator('.pane-group [role="tab"]').first().textContent(),
    current,
  );
  // A rail switches focus to its column; it doesn't bring both back.
  await page.locator(".pane-rail-tabs button").first().click();
  assert.equal(await page.locator(".pane-rail").count(), 1);
  assert.notEqual(
    await page.locator('.pane-group [role="tab"]').first().textContent(),
    current,
  );
  await page.locator(".pane-focus").click();
  assert.equal(await page.locator(".pane-rail").count(), 0);
  assert.equal(await page.locator(".pane-group").count(), 2);
  // Shift+F10 opens a tab's menu from the keyboard; Esc returns to the tab
  // without closing it.
  await page.getByRole("tab", { name: "Chapter two", exact: true }).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menu").waitFor();
  await page.screenshot({ path: "test-results/workspace-panes-tab-menu.png" });
  assert.deepEqual(
    await page.getByRole("menuitem").allTextContents(),
    ["Focus this column", "Move to other column", "Swap columns", "Close tab", "Close other tabs"],
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".pane-tab-menu").count(), 0);
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    "Chapter two",
  );
  assert.equal(await page.locator(".pane-group").count(), 2);
  assert.equal(await host.evaluate((e) => e.isConnected), true);
  await page.screenshot({ path: "test-results/workspace-panes-split.png" });
  await page.evaluate(() => window.dispatch({ type: "swap" }));
  assert.equal(
    await host.evaluate(
      (e) => e === document.querySelector("[data-note-pane]"),
    ),
    true,
  );
  const membership = await page.evaluate(
    () => document.querySelectorAll(".pane-group").length,
  );
  assert.equal(membership, 2);
  // Two 360px columns no longer fit: they share one column.
  await page.setViewportSize({ width: 700, height: 640 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".pane-group").count(), 1);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".pane-group").count(), 2);
  await page.evaluate(() =>
    window.dispatch({ type: "merge", group: "pane-2" }),
  );
  await page.getByRole("tab", { name: "Chapter two", exact: true }).click();
  await input.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" retained");
  assert.match(
    await page.evaluate(() =>
      window.session.doc
        .getBlock(window.noteId)
        .model.children[0].text.toString(),
    ),
    /from pane retained/,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-note-pane]").count(), 1);
  // Unavailable note views must not recreate a deleted model; undo safely rebinds it.
  await page.evaluate(() => {
    window.session.doc.captureSync();
    window.session.doc.deleteBlock(
      window.session.doc.getBlock(window.noteId).model,
    );
  });
  await page.getByText(/This note is unavailable/).waitFor();
  await page.evaluate(() => window.session.doc.undo());
  await input.waitFor();
  await page.evaluate(async () => {
    await window.session.flush();
  });
  // A crowded column says how many tabs are out of view, and lists them.
  assert.equal(await page.locator(".pane-overflow-chip").count(), 0);
  await page.setViewportSize({ width: 520, height: 640 });
  await page.evaluate(() => {
    for (let n = 1; n <= 6; n++)
      window.dispatch({
        type: "open",
        tab: { id: `pdf-${n}`, kind: "pdf", workspaceId: "w", documentId: `doc-${n}` },
      });
  });
  const chip = page.locator(".pane-overflow-chip");
  await chip.waitFor();
  const hiddenCount = Number((await chip.textContent()).replace(/\D/g, ""));
  assert.ok(hiddenCount > 0, "some tabs are out of view");
  await chip.click();
  await page.getByText("Out of view").waitFor();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/workspace-panes-overflow-list.png" });
  await page.emulateMedia({ colorScheme: "light" });
  assert.equal(
    await page.locator('.pane-overflow-row button[aria-pressed="true"]').count(),
    1,
  );
  const awayRows = page.locator(".pane-overflow-heading ~ .pane-overflow-row");
  assert.equal(await awayRows.count(), hiddenCount);
  const picked = await awayRows.first().locator("button").first().textContent();
  await awayRows.first().locator("button").first().click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator('.pane-tab[data-active="true"] [role="tab"]').textContent(),
    picked,
    "picking a row makes that tab active",
  );
  const activeBox = await page
    .locator('.pane-tab[data-active="true"]')
    .boundingBox();
  const stripBox = await page.locator(".pane-tabs").boundingBox();
  assert.ok(
    activeBox.x >= stripBox.x - 2 &&
      activeBox.x + activeBox.width <= stripBox.x + stripBox.width + 2,
    "the picked tab is scrolled into view",
  );
  await page.screenshot({ path: "test-results/workspace-panes-overflow.png" });
  await page.evaluate(() => {
    for (let n = 1; n <= 6; n++) window.dispatch({ type: "close", id: `pdf-${n}` });
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await chip.waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Close Chapter two tab", exact: true })
    .click();
  assert.equal(await page.locator("[data-note-pane]").count(), 0);
  await page.evaluate(() => {
    window.root.unmount();
    window.stopToolbar();
    window.session.destroy();
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS stable pane hosts, shared edits, tab menu, Focus switch and rails, split/swap/merge, responsive restoration, delete/undo, hidden-tab count, close/disposal",
  );
} finally {
  await browser.close();
}
