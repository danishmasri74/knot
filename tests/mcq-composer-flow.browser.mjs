import assert from "node:assert/strict";
import { chromium } from "playwright";

// Keyboard-first question writing and "Add another" chaining after /mcq.
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1300, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.route("**/mcq-flow-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><div id="editor" style="width:1100px;height:800px"></div>',
    }),
  );
  await page.goto(
    (process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420") +
      "/mcq-flow-test",
  );
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/src/styles/mcq.css");
    await import("/src/styles/dropdowns.css");
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    const notebook = { id: "a", title: "a", kind: "whiteboard", updated_at: 1 };
    let deck = "{}";
    const drafts = new Map();
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === "filter_objects")
          return args.offset === 0 ? [notebook] : [];
        if (command === "load_document") return null;
        if (command === "load_card_deck") return deck;
        if (command === "load_mcq_progress") return [];
        if (command === "list_blobs") return [];
        if (command === "load_mcq_draft") return drafts.get(args.id) ?? null;
        if (command === "save_mcq_draft") {
          if (args.content === null) drafts.delete(args.id);
          else drafts.set(args.id, args.content);
          return;
        }
        if (command === "save_documents") {
          if (args.deck !== undefined) deck = args.deck;
          if (args.publishedDraft) drafts.delete(args.publishedDraft);
          return;
        }
        throw Error("Unexpected command: " + command);
      },
    };
    const { openEditor } =
      await import("/src/features/editor/blocksuite/adapter.ts");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { McqComposer } = await import("/src/app/McqComposer.tsx");
    window.session = await openEditor(notebook, () => {});
    document.querySelector("#editor").replaceChildren(window.session.editor);
    await window.session.editor.updateComplete;
    await window.session.setMode("page");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    // Mirrors App: "Add another" moves the target after the inserted question.
    const render = (target) =>
      root.render(
        React.createElement(McqComposer, {
          id: `inline:v1:${target.notebookId}:${target.noteId}`,
          anchor: target.rect,
          deck: window.session.cardDeck,
          notebookId: target.notebookId,
          onClose: (focus) => {
            root.render(null);
            focus?.();
          },
          onSave: async (draft, expected, copy, another) => {
            const { focus, next } = await window.session.publishQuestion(
              draft,
              `inline:v1:${target.notebookId}:${target.noteId}`,
              { destination: { kind: "inline", target } },
            );
            if (another && next) render(next);
            return focus;
          },
          onInsert: async () => {},
        }),
      );
    window.addEventListener("knot-insert-mcq", ({ detail }) => render(detail));
  });

  const paragraph = page
    .locator("affine-paragraph [contenteditable=true]")
    .first();
  await paragraph.click();
  await page.keyboard.type("Intro");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/mcq");
  await page
    .locator('.slash-menu-item.multiple-choice[hover="true"]')
    .waitFor();
  await page.keyboard.press("Enter");
  const composer = page.getByRole("dialog");
  const active = () =>
    page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  await composer.getByRole("textbox", { name: "Question" }).waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Question",
  );

  // Enter walks question → A → B → new C; Backspace on empty C removes it.
  await page.keyboard.type("Which is a primary colour?");
  await page.keyboard.press("Enter");
  assert.equal(await active(), "Option A");
  await page.keyboard.type("Red");
  await page.keyboard.press("Enter");
  assert.equal(await active(), "Option B");
  await page.keyboard.type("Green");
  await page.keyboard.press("Enter");
  assert.equal(await active(), "Option C");
  await page.keyboard.press("Backspace");
  assert.equal(await active(), "Option B");
  assert.equal(
    await composer.getByRole("textbox", { name: "Option C" }).count(),
    0,
  );
  // Alt+1 marks A correct; the letter badge carries the selection.
  await page.keyboard.press("Alt+Digit1");
  assert.equal(
    await composer
      .getByRole("radio", { name: "Mark option A as correct" })
      .isChecked(),
    true,
  );
  await page.waitForTimeout(300); // Let badge transitions settle.
  await page.screenshot({ path: "test-results/mcq-flow-light.png" });

  // Ctrl+Shift+Enter inserts and starts the next question in place.
  await page.keyboard.press("Control+Shift+Enter");
  await composer.getByText("1 added").waitFor();
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-label") === "Question" &&
      document.activeElement.value === "",
  );
  assert.equal(
    await composer.getByRole("radio", { checked: true }).count(),
    0,
  );

  // Pasting a list fills consecutive answers; [x] marks the correct one.
  await page.keyboard.type("Which animal barks?");
  await page.keyboard.press("Enter");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "- Cat\n- [x] Dog\n- Fish");
    document.activeElement.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  for (const [letter, value] of [
    ["A", "Cat"],
    ["B", "Dog"],
    ["C", "Fish"],
  ])
    assert.equal(
      await composer
        .getByRole("textbox", { name: `Option ${letter}` })
        .inputValue(),
      value,
    );
  assert.equal(
    await composer
      .getByRole("radio", { name: "Mark option B as correct" })
      .isChecked(),
    true,
  );
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await composer.getByRole("textbox", { name: "Option C" }).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/mcq-flow-dark.png" });
  await page.evaluate(() => delete document.documentElement.dataset.theme);
  await composer.getByRole("button", { name: "Insert question" }).click();
  await composer.waitFor({ state: "detached" });

  // Both questions sit next to each other, in order, after the slash line.
  const result = await page.evaluate(() => {
    const deck = window.session.cardDeck.data;
    const note = window.session.doc.getBlocksByFlavour("affine:note")[0].model;
    return note.children.map((child) =>
      child.flavour === "knot:mcq-reference"
        ? deck[child.cardId].nodes[0].props["prop:definition"].value.question
        : (child.text?.toString() ?? child.flavour),
    );
  });
  assert.deepEqual(result, [
    "Intro",
    "",
    "Which is a primary colour?",
    "Which animal barks?",
    "",
  ]);
  assert.deepEqual(errors, []);
  console.log(
    "PASS keyboard question flow, Alt+number key, list paste and inline Add another chaining",
  );
} finally {
  await browser.close();
}
