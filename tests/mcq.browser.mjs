import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1300, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.route("**/mcq-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><div id="editor" style="width:1100px;height:800px"></div>',
    }),
  );
  await page.goto(
    (process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420") + "/mcq-test",
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
    const notebooks = ["a", "b"].map((id) => ({
      id,
      title: id,
      kind: "whiteboard",
      updated_at: 1,
    }));
    const saved = new Map();
    let deck = "{}";
    const progress = new Map();
    const drafts = new Map();
    const referenceCount = (raw) =>
      Object.values(JSON.parse(raw)).reduce(
        (count, card) =>
          count +
          card.nodes.filter(
            (node) => node.props["sys:flavour"]?.value === "knot:mcq-reference",
          ).length,
        0,
      );
    window.attempts = new Set();
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === "filter_objects")
          return args.offset === 0 ? notebooks : [];
        if (command === "load_document") return saved.get(args.id) ?? null;
        if (command === "load_card_deck") return deck;
        if (command === "load_mcq_progress")
          return [...(progress.get(args.notebook)?.values() ?? [])];
        if (command === "list_blobs") return [];
        if (command === "load_mcq_draft") return drafts.get(args.id) ?? null;
        if (command === "save_mcq_draft") {
          if (window.failDraft) throw Error("Injected draft failure");
          if (args.content === null) drafts.delete(args.id);
          else drafts.set(args.id, args.content);
          return;
        }
        if (command === "save_documents") {
          if (
            window.failPublication &&
            args.documents.length &&
            referenceCount(args.deck ?? "{}") > referenceCount(deck)
          ) {
            window.failPublication = false;
            throw Error("Injected publication failure");
          }
          if (args.deck !== undefined) deck = args.deck;
          if (args.publishedDraft) drafts.delete(args.publishedDraft);
          for (const { id, snapshot } of args.documents)
            saved.set(id, snapshot);
          for (const entry of args.quiz ?? []) {
            if (entry.attemptId && window.failAnswer) {
              window.failAnswer = false;
              throw Error("Injected write failure");
            }
            const key =
              JSON.parse(deck)[entry.cardId].nodes[0].props["prop:definition"]
                .value.correctOptionId;
            if (entry.attemptId) window.attempts.add(entry.attemptId);
            if (!progress.has(entry.notebookId))
              progress.set(entry.notebookId, new Map());
            progress.get(entry.notebookId).set(entry.cardId, {
              ...entry,
              correct: entry.attemptId ? entry.optionId === key : null,
            });
          }
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
    window.openNotebook = async (index) => {
      await window.session?.flush();
      window.session?.destroy();
      window.session = await openEditor(notebooks[index], () => {});
      document.querySelector("#editor").replaceChildren(window.session.editor);
      await window.session.editor.updateComplete;
      await window.session.setMode("page");
    };
    await window.openNotebook(0);
    const host = document.createElement("div");
    document.body.append(host);
    const composer = createRoot(host);
    window.draftClose = { current: undefined };
    window.openComposer = () =>
      composer.render(
        React.createElement(McqComposer, {
          id: "draft",
          windowCloseDraft: window.draftClose,
          onClose: () => composer.render(null),
          onSave: async (draft) => {
            const { id } = await window.session.publishQuestion(
              draft,
              "draft",
              { destination: { kind: "standalone" } },
            );
            window.quizId = id;
          },
        }),
      );
    window.addEventListener("knot-insert-mcq", ({ detail: target }) => {
      const owner = window.session;
      const id = `inline:v1:${target.notebookId}:${target.noteId}`;
      composer.render(
        React.createElement(McqComposer, {
          id,
          anchor: target.rect,
          deck: owner.cardDeck,
          notebookId: target.notebookId,
          onClose: (focus) => {
            composer.render(null);
            focus?.();
          },
          onSave: async (draft) => {
            const { focus } = await owner.publishQuestion(draft, id, {
              destination: { kind: "inline", target },
            });
            return focus;
          },
          onInsert: async (cardId, operationId) => {
            const { focus } = await owner.insertQuestion(
              cardId,
              target,
              operationId,
            );
            return focus;
          },
        }),
      );
    });
    window.openComposer();
  });
  const composer = page.getByRole("dialog");
  await composer.getByLabel("Question", { exact: true }).fill("Which is even?");
  await composer.getByRole("button", { name: "Close" }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.evaluate(() => window.openComposer());
  await composer
    .getByLabel("Question", { exact: true })
    .waitFor()
    .catch(async (error) => {
      throw Error(
        [
          error.message,
          ...errors,
          await page.locator("dialog").allTextContents(),
        ].join("\n"),
      );
    });
  assert.equal(
    await composer.getByLabel("Question", { exact: true }).inputValue(),
    "Which is even?",
  );
  await composer.getByLabel("Option A", { exact: true }).fill("Three");
  await composer.getByLabel("Option B", { exact: true }).fill("Four");
  await composer
    .getByRole("radio", { name: "Mark option B as correct" })
    .check();
  await composer.getByText("Explanation", { exact: false }).first().click();
  await composer.getByLabel(/Explanation/).fill("Four is divisible by two.");
  await composer.getByRole("button", { name: "Preview" }).click();
  await composer.getByRole("radio", { name: /Four/ }).check();
  await composer.getByRole("button", { name: "Check answer" }).click();
  await composer.getByText("Correct", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.attempts.size), 0);
  await composer.getByRole("button", { name: "Create card" }).click();
  await composer.waitFor({ state: "hidden" });
  const card = page.getByRole("region", {
    name: "Multiple choice",
    exact: true,
  });
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  const questionEntry = toc.getByRole("button", {
    name: "Which is even?",
    exact: true,
  });
  await questionEntry.waitFor();
  assert.equal(await card.getByText("Quick check", { exact: true }).count(), 0);
  await card.getByRole("radio", { name: /Three/ }).check();
  await page.evaluate(() => {
    window.failAnswer = true;
  });
  await card.getByRole("button", { name: "Check answer" }).click();
  await card
    .getByRole("alert")
    .filter({ hasText: "Injected write failure" })
    .waitFor();
  await card.getByRole("button", { name: "Retry save" }).click();
  await card.getByText("Incorrect", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.attempts.size), 1);

  await page.evaluate(async () => {
    await window.openNotebook(1);
    await window.session.setMode("edgeless");
    window.session.placeCard(window.quizId);
    await window.session.flush();
  });
  await questionEntry.waitFor();
  await card.getByRole("radio", { name: /Four/ }).check();
  await card.getByRole("button", { name: "Check answer" }).click();
  await card.getByText("Correct", { exact: true }).waitFor();
  await page.evaluate(() => window.openNotebook(0));
  await card.getByText("Incorrect", { exact: true }).waitFor();
  await card.getByRole("button", { name: "Try again" }).click();
  await card.getByRole("button", { name: "Check answer" }).waitFor();
  assert.equal(await card.getByText("Four is divisible by two.").count(), 0);
  const paragraph = page
    .locator("affine-paragraph [contenteditable=true]")
    .first();
  await paragraph.click();
  await page.keyboard.type("Before after");
  await page.keyboard.press("Home");
  for (let i = 0; i < "Before".length; i++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.type("/mcq");
  await page
    .locator('.slash-menu-item.multiple-choice[hover="true"]')
    .waitFor();
  await page.keyboard.press("Enter");
  await composer.getByRole("tab", { name: "Create new" }).waitFor();
  await composer.getByRole("textbox", { name: "Question" }).waitFor();
  await page.screenshot({ path: ".tmp/mcq-composer-light.png" });
  await composer.getByRole("button", { name: "Insert question" }).click();
  await composer.getByText("Write a question.").waitFor();
  await composer
    .getByRole("textbox", { name: /^Question/ })
    .fill("Inline question");
  await composer.getByRole("textbox", { name: "Option A" }).fill("Yes");
  await composer.getByRole("textbox", { name: "Option B" }).fill("No");
  await composer
    .getByRole("radio", { name: "Mark option A as correct" })
    .check();
  await page.evaluate(() => {
    window.failPublication = true;
  });
  await composer.getByRole("button", { name: "Insert question" }).click();
  await composer
    .getByRole("alert")
    .filter({ hasText: "Injected publication failure" })
    .waitFor();
  await composer.getByRole("button", { name: "Retry save" }).click();
  await composer.waitFor({ state: "hidden" });
  const structure = () =>
    page.evaluate(() =>
      window.session.doc
        .getBlocksByFlavour("affine:note")
        .map(({ model }) =>
          model.children.map(
            (child) => child.text?.toString() ?? child.flavour,
          ),
        ),
    );
  assert.deepEqual(await structure(), [
    ["Before", "knot:mcq-reference", " after"],
    ["knot:mcq"],
  ]);
  await toc.getByRole("button", { name: "Inline question" }).waitFor();
  await page.evaluate(() => window.session.doc.undo());
  assert.deepEqual(await structure(), [["Before after"], ["knot:mcq"]]);
  await page.evaluate(() => window.session.doc.redo());
  assert.deepEqual(await structure(), [
    ["Before", "knot:mcq-reference", " after"],
    ["knot:mcq"],
  ]);
  await page.setViewportSize({ width: 320, height: 560 });
  const emulation = await page.context().newCDPSession(page);
  await emulation.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 560,
    deviceScaleFactor: 1.25,
    mobile: false,
  });
  await page.evaluate(() => {
    document.querySelector("#editor").style.width = "100%";
    document.documentElement.dataset.theme = "dark";
  });
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type("/mcq");
  await page
    .locator('.slash-menu-item.multiple-choice[hover="true"]')
    .waitFor();
  await page.keyboard.press("Enter");
  await composer
    .getByRole("textbox", { name: "Question" })
    .fill("A draft with four answers");
  await composer.getByRole("button", { name: "Add answer" }).click();
  await composer.getByRole("button", { name: "Add answer" }).click();
  await composer
    .getByRole("textbox", { name: "Option C" })
    .fill(
      "A long answer that wraps within a narrow window without moving the correct-answer control.",
    );
  await composer
    .getByRole("radio", { name: "Mark option D as correct" })
    .check();
  assert.equal(
    await composer.getByRole("button", { name: "Add answer" }).count(),
    0,
  );
  await composer.locator("summary").filter({ hasText: "Explanation" }).click();
  await composer
    .getByLabel("Explanation (optional)")
    .fill("An optional explanation in the narrow layout.");
  await page.screenshot({ path: ".tmp/mcq-four-answers-dark.png" });
  await composer.getByRole("button", { name: "Remove option D" }).click();
  assert.equal(await composer.getByRole("radio", { checked: true }).count(), 0);
  await composer.getByRole("tab", { name: "Insert existing" }).click();
  await composer.getByRole("searchbox").fill("Inline question");
  const bounds = await composer.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  await page.screenshot({ path: ".tmp/mcq-picker-dark.png" });
  await composer.getByRole("searchbox").press("ArrowDown");
  await page.evaluate(() => {
    window.failPublication = true;
  });
  await page.keyboard.press("Enter");
  await composer
    .getByRole("alert")
    .filter({ hasText: "Injected publication failure" })
    .waitFor();
  await composer.getByRole("button", { name: "Retry save" }).click();
  await composer.waitFor({ state: "hidden" });
  const references = page.locator("knot-mcq-reference");
  await references.nth(1).waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        Object.values(window.session.cardDeck.data).filter(
          (card) => card.nodes[0]?.props["sys:flavour"]?.value === "knot:mcq",
        ).length,
    ),
    2,
  );
  await references.first().getByRole("radio", { name: /Yes/ }).check();
  await references
    .first()
    .getByRole("button", { name: "Check answer" })
    .click();
  await references.last().getByText("Correct", { exact: true }).waitFor();
  const sharing = await page.evaluate(async () => {
    const session = window.session;
    const deck = session.cardDeck;
    const note = session.doc.getBlocksByFlavour("affine:note")[0].model;
    const shared = session.doc.spaceDoc.getMap("knot:card-links").get(note.id);
    const id = note.children.find(
      (child) => child.flavour === "knot:mcq-reference",
    ).cardId;
    const { cardMcq } =
      await import("/src/features/editor/blocksuite/card-deck.ts");
    const { publishMcq } = await import("/src/features/quiz/mcq.ts");
    const before = cardMcq(deck.data[id]);
    deck.writeMcq(
      publishMcq({ ...before, explanation: "An updated explanation." }, before),
      id,
    );
    await session.flush();
    const markdown = new TextDecoder().decode(
      new Uint8Array((await session.exportFiles("markdown"))[0].bytes),
    );
    const { savedSearchContent } =
      await import("/src/features/editor/blocksuite/search.ts");
    const snapshot = await window.__TAURI_INTERNALS__.invoke("load_document", {
      id: session.doc.id,
    });
    return {
      shared,
      id,
      markdown,
      search: savedSearchContent(session.doc.id, snapshot, deck.data),
    };
  });
  assert.match(sharing.markdown, /Inline question/);
  assert.match(sharing.markdown, /A\. Yes/);
  assert.doesNotMatch(sharing.markdown, /An updated explanation|Correct/);
  assert.ok(
    sharing.search.notes.some((note) => note.text.includes("Inline question")),
  );
  await references.first().getByText("An updated explanation.").waitFor();
  await emulation.send("Emulation.clearDeviceMetricsOverride");
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.evaluate(async ({ shared }) => {
    await window.openNotebook(1);
    await window.session.setMode("edgeless");
    const placement = window.session.placeCard(shared);
    await window.session.flush();
    await window.session.focusCanvasCard(placement);
    window.mixedPlacement = placement;
  }, sharing);
  const canvasToolbar = page
    .locator('edgeless-element-toolbar-widget [aria-label="Multiple choice"]')
    .first();
  for (const zoom of [0.75, 1.25]) {
    await page.evaluate(async (zoom) => {
      const viewport = document.querySelector("affine-edgeless-root").gfx
        .viewport;
      viewport.setViewport(zoom, [viewport.center.x, viewport.center.y]);
      await window.session.focusCanvasCard(window.mixedPlacement);
    }, zoom);
    await canvasToolbar.click();
    await composer.getByRole("textbox", { name: "Question" }).waitFor();
    assert.equal((await composer.boundingBox()).width, 520);
    await page.screenshot({ path: `.tmp/mcq-canvas-${zoom}.png` });
    await page.keyboard.press("Escape");
    await composer.waitFor({ state: "hidden" });
  }
  await references.nth(1).waitFor();
  assert.equal(
    await references.getByText("Correct", { exact: true }).count(),
    0,
  );
  await references.first().getByRole("radio", { name: /No/ }).check();
  await references
    .first()
    .getByRole("button", { name: "Check answer" })
    .click();
  await references.last().getByText("Incorrect", { exact: true }).waitFor();
  await page.evaluate(() => window.openNotebook(0));
  await references.last().getByText("Correct", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const deck = window.session.cardDeck;
    const card = Object.values(deck.data).find(
      (card) =>
        card.nodes[0]?.props["prop:definition"]?.value.question ===
        "Inline question",
    );
    deck.delete(card.id);
  });
  await references
    .last()
    .getByText(/question unavailable/)
    .waitFor();
  await references
    .last()
    .getByRole("button", { name: "Restore question" })
    .click();
  await references.first().getByText("Correct", { exact: true }).waitFor();
  await references
    .last()
    .getByRole("button", { name: "Remove question from note" })
    .click();
  assert.equal(await references.count(), 1);
  await page.evaluate(() => window.session.doc.undo());
  await references.last().getByText("Correct", { exact: true }).waitFor();
  assert.equal(await references.count(), 2);
  await page.evaluate(async () => {
    const owner = window.session;
    const note = owner.doc.getBlocksByFlavour("affine:note")[0].model;
    const host = document.createElement("div");
    host.style.height = "650px";
    document.body.append(host);
    document.querySelector("#editor").hidden = true;
    window.notePane = await owner.createNotePageView(note.id, host);
  });
  const paneText = page
    .locator("[data-note-pane] affine-paragraph [contenteditable=true]")
    .first();
  await paneText.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("/mcq");
  assert.equal(await page.locator("affine-slash-menu").count(), 0);
  for (let index = 0; index < 4; index++)
    await page.keyboard.press("Backspace");
  await page.keyboard.type("/mcq");
  await page
    .locator('.slash-menu-item.multiple-choice[hover="true"]')
    .waitFor();
  await page.keyboard.press("Enter");
  assert.equal(
    await composer.getByRole("textbox", { name: "Question" }).inputValue(),
    "A draft with four answers",
  );
  await composer.getByRole("tab", { name: "Insert existing" }).click();
  await composer.getByRole("searchbox").fill("Which is even");
  await page.evaluate(() => window.notePane.dispose());
  await composer.getByRole("searchbox").press("Enter");
  await composer
    .getByRole("alert")
    .filter({ hasText: "original editor is unavailable" })
    .waitFor();
  await page.keyboard.press("Escape");
  await composer.waitFor({ state: "hidden" });
  await page.evaluate(async () => {
    await window.__TAURI_INTERNALS__.invoke("save_mcq_draft", {
      id: "draft",
      content: "{",
    });
    window.openComposer();
  });
  await composer.getByRole("button", { name: "Retry loading draft" }).waitFor();
  await composer.getByRole("button", { name: "Start a fresh draft" }).click();
  await page.evaluate(() => {
    window.failDraft = true;
  });
  await composer
    .getByRole("textbox", { name: "Question" })
    .fill("Keep this unsaved draft");
  await composer.getByRole("button", { name: "Close" }).click();
  await composer
    .getByRole("alert")
    .filter({ hasText: "Injected draft failure" })
    .waitFor();
  await page.evaluate(() => {
    window.failDraft = false;
  });
  await composer.getByRole("button", { name: "Retry draft" }).click();
  await composer.getByText("Draft saved", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await composer.waitFor({ state: "hidden" });
  await page.evaluate(() => window.openComposer());
  assert.equal(
    await composer.getByRole("textbox", { name: "Question" }).inputValue(),
    "Keep this unsaved draft",
  );
  await page.keyboard.press("Escape");
  await composer.waitFor({ state: "hidden" });
  await page.evaluate(() => window.openComposer());
  await composer
    .getByRole("textbox", { name: "Question" })
    .fill("Flush on Windows close");
  const lastDraft = await page.evaluate(async () => {
    await window.draftClose.current();
    const raw = await window.__TAURI_INTERNALS__.invoke("load_mcq_draft", {
      id: "draft",
    });
    return JSON.parse(raw).question.question;
  });
  assert.equal(lastDraft, "Flush on Windows close");
  await page.keyboard.press("Escape");
  await composer.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS standalone and inline MCQ composition, retry, undo/redo, sharing, notebook progress, export, and search",
  );
} finally {
  await browser.close();
}
