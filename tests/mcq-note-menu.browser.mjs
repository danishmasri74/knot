import assert from "node:assert/strict";
import { chromium } from "playwright";

// Canvas note-tool menu offers a standalone multiple-choice question.
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1300, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.route("**/mcq-note-menu-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><div id="editor" style="width:1100px;height:800px"></div>',
    }),
  );
  await page.goto(
    (process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420") +
      "/mcq-note-menu-test",
  );
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/src/styles/dropdowns.css");
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    const notebook = { id: "a", title: "a", kind: "whiteboard", updated_at: 1 };
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === "filter_objects")
          return args.offset === 0 ? [notebook] : [];
        if (command === "load_document") return null;
        if (command === "load_card_deck") return "{}";
        if (command === "load_mcq_progress") return [];
        if (command === "list_blobs") return [];
        if (command === "load_mcq_draft") return null;
        if (command === "save_documents") return;
        throw Error("Unexpected command: " + command);
      },
    };
    const { openEditor } =
      await import("/src/features/editor/blocksuite/adapter.ts");
    window.session = await openEditor(notebook, () => {});
    document.querySelector("#editor").replaceChildren(window.session.editor);
    await window.session.editor.updateComplete;
    await window.session.setMode("edgeless");
    window.requests = [];
    window.addEventListener("knot-new-mcq", ({ detail }) =>
      window.requests.push(detail.doc === window.session.doc),
    );
  });
  await page.locator("edgeless-note-senior-button").first().click();
  const menu = page.locator("edgeless-note-menu");
  const button = menu.locator('[aria-label="Multiple choice"]');
  await button.waitFor();
  // Placed in the add-to-canvas group, directly after File.
  const order = await menu.evaluate((element) =>
    [
      ...element.shadowRoot.querySelector(".button-group-container").children,
    ].map(
      (child) =>
        child.getAttribute("aria-label") ?? child.tooltip ?? child.tagName,
    ),
  );
  assert.deepEqual(order.slice(-2), ["File", "Multiple choice"]);
  await page.screenshot({ path: "test-results/mcq-note-menu.png" });
  await button.click();
  assert.deepEqual(await page.evaluate(() => window.requests), [true]);
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector("affine-edgeless-root").gfx.tool
          .currentToolName$.value,
    ),
    "default",
  );
  await menu.waitFor({ state: "detached" });
  // Closing must not leave the note button needing a second click.
  await page.locator("edgeless-note-senior-button").first().click();
  await button.waitFor();
  assert.deepEqual(errors, []);
  console.log("MCQ note-menu browser test passed.");
} finally {
  await browser.close();
}
