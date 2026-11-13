// Ask Knot picks the action itself: abilities decide which tools a message
// offers, a tool call becomes a preview, and either can be undone into an
// answer or turned back into an edit. The backend is mocked; no paid calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("test-results/ask-auto-actions", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/ask-auto-actions-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root" style="display:flex;height:720px;width:520px;margin:12px"></div>',
    }),
  );
  await page.goto(
    `${process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420"}/ask-auto-actions-test`,
  );
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (t) => t;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    await import("/src/styles/app.css");
    await import("/src/styles/dropdowns.css");
    localStorage.clear();
    window.calls = [];
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd === "ai_connected") return true;
        if (cmd === "ai_models") return ["gpt-5.4-mini"];
        if (cmd === "ai_respond") {
          window.calls.push(args);
          // The test streams events, then resolves the request.
          await new Promise((resolve) => (window.finish = resolve));
        }
      },
    };
    window.emit = (events) => {
      const call = window.calls.at(-1);
      for (const event of events) call.onEvent.onmessage(event);
      window.finish();
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { AskKnot } = await import("/src/app/AskKnot.tsx");
    const doc = { id: "doc", meta: { title: "Launch plan" } };
    const session = { doc, editor: new EventTarget(), imageSources: () => [] };
    createRoot(document.getElementById("root")).render(
      React.createElement(AskKnot, {
        workspace: "auto-actions",
        documentId: doc.id,
        initial: {
          instance: doc,
          workspace: "auto-actions",
          document: doc.id,
          label: "Selection",
          sourceIntent: "explicit",
          selectionKey: "selection",
          text: "We ship the beta in March after the review.",
          ranges: [
            {
              id: "b1",
              start: 0,
              length: 43,
              text: "We ship the beta in March after the review.",
              attributes: {},
            },
          ],
          structure: [
            {
              id: "b1",
              type: "paragraph",
              text: "We ship the beta in March after the review.",
            },
          ],
          surrounding: [],
          note: "note-1",
        },
        suggestion: null,
        onBusy: () => {},
        getSession: () => session,
      }),
    );
  });
  const box = page.getByRole("textbox", { name: "Ask Knot message" });
  await box.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="AI model"]:disabled'),
  );
  assert.equal(
    await page.getByRole("button", { name: "Writing actions" }).count(),
    0,
    "the mode menu is gone",
  );
  assert.equal(await box.getAttribute("placeholder"), "Ask, write, or edit…");
  const send = async (text) => {
    const before = await page.evaluate(() => window.calls.length);
    await box.fill(text);
    await box.press("Enter");
    await page.waitForFunction((n) => window.calls.length > n, before);
    return page.evaluate(() => {
      const { onEvent, ...call } = window.calls.at(-1);
      void onEvent;
      return call;
    });
  };

  // Abilities: both on by default; turning one off marks the chat as changed.
  const abilities = page.getByRole("button", {
    name: "Abilities",
    exact: true,
  });
  await abilities.click();
  const edit = page.getByRole("button", { name: "Edit the current note" });
  assert.equal(await edit.getAttribute("aria-pressed"), "true");
  assert.equal(
    await page
      .getByRole("button", { name: "Create cards on canvas" })
      .getAttribute("aria-pressed"),
    "true",
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({
      path: `test-results/ask-auto-actions/abilities-${theme}.png`,
    });
  }
  await edit.click();
  assert.equal(await edit.getAttribute("aria-pressed"), "false");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".ask-abilities-dot").count(), 1);

  // With editing off nothing can be proposed, so this is an ordinary answer.
  let call = await send("Make this shorter");
  assert.equal(call.mode, "ask");
  assert.equal(call.tools, undefined);
  await page.evaluate(() =>
    window.emit([{ delta: "Editing is turned off for this chat." }]),
  );
  await page.getByText("Editing is turned off for this chat.").waitFor();

  // Back to the Settings defaults: the selection and note can be edited.
  await abilities.click();
  await edit.click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".ask-abilities-dot").count(), 0);
  call = await send("Make this shorter");
  assert.equal(call.mode, "auto");
  assert.deepEqual(call.tools, ["rewrite_selection", "insert_blocks"]);
  assert.equal(call.messages.at(-1).content, "Make this shorter");
  assert.equal(JSON.parse(call.context).runs.length, 1);
  await page.evaluate(() => {
    const call = window.calls.at(-1);
    call.onEvent.onmessage({ delta: "Here is a shorter version." });
    call.onEvent.onmessage({ delta: "", call: "rewrite_selection" });
  });
  await page.getByText("Preparing preview").waitFor();
  await page.evaluate(() =>
    window.emit([
      {
        delta: JSON.stringify({ replacements: ["Beta ships in March."] }).slice(
          0,
          20,
        ),
        call: "rewrite_selection",
      },
      {
        delta: JSON.stringify({
          replacements: ["Beta ships in March."],
          blocks: [],
        }).slice(20),
        call: "rewrite_selection",
      },
    ]),
  );
  await page.getByText("Replace selection").waitFor();
  await page.getByText("Here is a shorter version.").waitFor();
  assert.equal(await page.getByText("Beta ships in March.").count(), 1);
  await page.screenshot({ path: "test-results/ask-auto-actions/preview.png" });

  // "Just answer instead" replaces the preview in this chat with an answer.
  const turnsBefore = await page.locator(".ask-turn").count();
  await page.getByRole("button", { name: "Just answer instead" }).click();
  await page.waitForFunction(() => window.calls.length === 3);
  call = await page.evaluate(() => {
    const { onEvent, ...call } = window.calls.at(-1);
    void onEvent;
    return call;
  });
  assert.equal(call.mode, "ask");
  assert.equal(call.tools, undefined);
  await page.evaluate(() =>
    window.emit([{ delta: "Shorter: the beta ships in March." }]),
  );
  await page.getByText("Shorter: the beta ships in March.").waitFor();
  assert.equal(await page.locator(".ask-turn").count(), turnsBefore);
  assert.equal(await page.getByText("Replace selection").count(), 0);

  // An answer can be put into the note as an explicit action.
  await page.getByRole("button", { name: "Insert into note" }).last().click();
  await page.waitForFunction(() => window.calls.length === 4);
  call = await page.evaluate(() => {
    const { onEvent, ...call } = window.calls.at(-1);
    void onEvent;
    return call;
  });
  assert.equal(call.mode, "insert");
  assert.match(call.messages.at(-1).content, /^Add the following answer/);
  assert.match(
    call.messages.at(-1).content,
    /Shorter: the beta ships in March\./,
  );
  await page.getByText("Insert this answer into the note").waitFor();
  await page.evaluate(() =>
    window.emit([
      {
        delta: JSON.stringify({
          replacements: [],
          blocks: [
            {
              type: "paragraph",
              text: "The beta ships in March.",
              columns: [],
              rows: [],
              children: [],
            },
          ],
        }),
      },
    ]),
  );
  await page.getByText("Append to note").waitFor();
  // Explicit actions are not offered to answer instead.
  assert.equal(
    await page.getByRole("button", { name: "Just answer instead" }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log("ask auto actions: ok");
} finally {
  await browser.close();
}
