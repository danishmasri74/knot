import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 850 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/references-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><main style="height:100vh"><div class="workspace-content"><div class="editor-area" id="editor"></div><div id="root" style="display:contents"></div></div></main></body></html>',
    }),
  );
  await page.goto(
    `${process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1421"}/references-test`,
  );
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    await import("/src/styles/app.css");
    await import("/src/styles/dropdowns.css");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { LinksPanel } = await import("/src/app/LinksPanel.tsx");

    const catalog = [
      {
        id: "board",
        title: "Current notebook",
        kind: "whiteboard",
        updated_at: 1,
      },
      {
        id: "note",
        title: "Software Testing — a long reference note title",
        kind: "note",
        updated_at: 1,
      },
      {
        id: "other",
        title: "Another notebook",
        kind: "whiteboard",
        updated_at: 1,
      },
    ];
    window.saved = {};
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd === "filter_objects") return args.offset === 0 ? catalog : [];
        if (cmd === "load_document") return window.saved[args.id] ?? null;
        if (cmd === "save_documents") {
          for (const write of args.documents)
            window.saved[write.id] = write.snapshot;
          return;
        }
        if (cmd === "load_card_deck") return "{}";
        if (cmd === "list_blobs") return [];
        throw Error("Unexpected " + cmd);
      },
    };
    const { openEditor } =
      await import("/src/features/editor/blocksuite/adapter.ts");
    window.session = await openEditor(
      catalog[0],
      () => {},
      undefined,
      (id) => {
        window.opened = id;
      },
    );
    document.querySelector("#editor").append(window.session.editor);
    const h = React.createElement;
    function Harness() {
      const [view, setView] = React.useState("add");
      const [mode, setMode] = React.useState("edgeless");
      window.changeMode = async () => {
        await window.session.setMode("page");
        setMode("page");
      };
      return h(
        "div",
        { style: { width: "320px", padding: "16px" } },
        h(
          LinksPanel,
          {
            session: window.session,
            notebooks: catalog.slice(1),
            mode,
            enabled: true,
            view,
            onView: setView,
            onPlace: async (id, placement) => {
              await window.session.placeNotebookLink(id, placement);
            },
          },
          "Notebooks that link here",
        ),
      );
    }
    document.querySelector("#root").style.display = "block";
    createRoot(document.querySelector("#root")).render(h(Harness));
  });

  const search = page.getByRole("searchbox", { name: "Find a notebook" });
  const source = page.getByRole("button", {
    name: "Place link to Another notebook",
  });
  const editor = page.locator("#editor");
  await source.waitFor();
  await search.fill("Another");
  const target = await editor.boundingBox();
  await source.dragTo(editor, {
    targetPosition: { x: target.width / 2, y: target.height / 2 },
  });
  const tile = page.locator(".notebook-link-tile");
  await tile.waitFor();
  assert.equal(await tile.getByText("Another notebook").count(), 1);
  const bounds = await tile.boundingBox();
  assert.ok(Math.abs(bounds.x - (target.x + target.width / 2)) < 3);
  assert.ok(Math.abs(bounds.y - (target.y + target.height / 2)) < 3);
  await tile.getByRole("button", { name: "Open Another notebook" }).click();
  await page.waitForFunction(() => window.opened === "other");
  assert.equal(await search.inputValue(), "Another");
  await page.getByRole("tab", { name: "Backlinks" }).click();
  await page.getByText("Notebooks that link here").waitFor();
  await page.getByRole("tab", { name: "Add link" }).click();
  assert.equal(await search.inputValue(), "Another");

  await source.click();
  await page.locator(".notebook-link-preview").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".notebook-link-preview").count(), 0);
  await page.evaluate(() => window.changeMode());
  await page.getByText("Drag a notebook between blocks.").waitFor();
  await source.click();
  await page.locator(".notebook-link-preview.page").waitFor();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      window.session.doc.getBlocksByFlavour("affine:embed-linked-doc")
        .length === 2,
  );
  await page.evaluate(() => window.session.flush());
  const saved = await page.evaluate(async () => {
    const { savedReferences } =
      await import("/src/features/editor/blocksuite/backlinks.ts");
    return [...savedReferences("board", window.saved.board)];
  });
  assert.deepEqual(saved, ["other"]);
  const located = await page.evaluate(async () => {
    const { findBacklinks } =
      await import("/src/features/editor/blocksuite/backlinks.ts");
    const { session } = window;
    const report = await findBacklinks(
      "other",
      session.catalog,
      async (id) => window.saved[id] ?? null,
    );
    const id = report.locations.board;
    await session.revealNotebookLink(id);
    return {
      id,
      mode: session.editor.mode,
      selected: session.editor.querySelector("affine-edgeless-root").gfx.selection.selectedIds,
    };
  });
  assert.equal(located.mode, "edgeless");
  assert.ok(located.selected.includes(located.id));
  await page.evaluate(async () => {
    await window.session.setMode("edgeless");
    await window.session.reference("note", true);
  });
  await page.locator("affine-embed-edgeless-synced-doc-block").waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Notebook links: canvas drag, Page placement, Escape, tab switching, search, and persistence passed.",
  );
} finally {
  await browser.close();
}
