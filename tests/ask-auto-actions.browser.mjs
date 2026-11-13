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
        if (cmd === "topic_catalog") return { activation: "test", sources: [] };
        if (cmd === "topic_pending") return [];
        if (cmd === "get_blob") return window.png;
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
    // The device search is stubbed: it records the model's query and returns
    // one excerpt numbered from [S1], as the real search does.
    const { TopicIndexer } = await import("/src/services/workspace-topic.ts");
    window.searched = [];
    // A tiny PNG for the image look.
    const pixel = document.createElement("canvas");
    pixel.width = pixel.height = 4;
    pixel.getContext("2d").fillRect(0, 0, 4, 4);
    window.png = Array.from(
      new Uint8Array(
        await (
          await new Promise((resolve) => pixel.toBlob(resolve, "image/png"))
        ).arrayBuffer(),
      ),
    );
    TopicIndexer.prototype.search = async (query) => {
      window.searched.push(query);
      return {
        version: 1,
        sourceMode: "workspace",
        activation: "test",
        coverage: { indexed: 2, total: 2, failed: 0, semantic: true },
        citationSources: [
          {
            document: "study",
            id: "p1",
            revision: "r1",
            title: "Study habits",
            text: "Review cards at growing intervals.",
            citation: "[S1]",
          },
        ],
      };
    };
    const { AskKnot } = await import("/src/app/AskKnot.tsx");
    const doc = { id: "doc", meta: { title: "Launch plan" } };
    const session = {
      doc,
      editor: new EventTarget(),
      imageSources: () => window.images ?? [],
      topicOverlay: () => [],
      topicVersion: () => 1,
    };
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
      .getByRole("button", { name: "Search my workspace" })
      .getAttribute("aria-pressed"),
    "true",
  );
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

  // With editing off nothing can be proposed; Knot may only search.
  let call = await send("Make this shorter");
  assert.equal(call.mode, "auto");
  assert.deepEqual(call.tools, ["search_workspace"]);
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
  assert.deepEqual(call.tools, [
    "search_workspace",
    "rewrite_selection",
    "insert_blocks",
  ]);
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
        // The rewrite tool sends only replacements.
        delta: JSON.stringify({ replacements: ["Beta ships in March."] }).slice(
          20,
        ),
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
  // Answer only: it can still search, but not propose.
  assert.equal(call.mode, "auto");
  assert.deepEqual(call.tools, ["search_workspace"]);
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

  // Knot searches the workspace: the device runs the model's query and the
  // excerpts go back in a second request, numbered after the note's sources.
  call = await send("What do my notes say about spaced repetition?");
  const first = await page.evaluate(() => window.calls.length);
  assert.equal(call.mode, "auto");
  assert.equal(call.tools[0], "search_workspace");
  assert.equal(call.searches, undefined);
  await page.evaluate(() =>
    window.emit([
      { delta: "", call: "search_workspace", call_id: "call_1" },
      { delta: '{"query":"spaced repetition"}', call: "search_workspace" },
    ]),
  );
  await page.waitForFunction((n) => window.calls.length > n, first);
  assert.deepEqual(await page.evaluate(() => window.searched), [
    "spaced repetition",
  ]);
  const second = await page.evaluate(() => {
    const [a, b] = window.calls.slice(-2);
    const { onEvent, ...call } = b;
    void onEvent;
    return { ...call, firstId: a.id };
  });
  assert.notEqual(second.id, second.firstId, "each round has its own request");
  assert.equal(second.mode, "auto");
  assert.equal(second.searches.length, 1);
  assert.equal(second.searches[0].callId, "call_1");
  assert.equal(second.searches[0].query, "spaced repetition");
  const evidence = JSON.parse(second.searches[0].evidence);
  const noteCitations = JSON.parse(second.context).citationSources.length;
  assert.equal(
    evidence.citationSources[0].citation,
    `[S${noteCitations + 1}]`,
    "excerpts continue the note's citation numbers",
  );
  assert.ok(
    second.tools.includes("search_workspace"),
    "one more search allowed",
  );
  await page.evaluate(
    (citation) =>
      window.emit([
        { delta: `Review cards at growing intervals ${citation}.` },
      ]),
    evidence.citationSources[0].citation,
  );
  await page.getByText("Searched workspace for “spaced repetition”").waitFor();
  await page
    .locator(".ask-message-text", {
      hasText: "Review cards at growing intervals",
    })
    .last()
    .waitFor();
  await page.locator(".ask-sources summary").last().click();
  await page.getByText("Study habits").waitFor();
  await page.screenshot({ path: "test-results/ask-auto-actions/search.png" });

  // With search off for the chat, the tool is not offered.
  await abilities.click();
  await page.getByRole("button", { name: "Search my workspace" }).click();
  await page.keyboard.press("Escape");
  call = await send("What else do my notes say?");
  assert.ok(!(call.tools ?? []).includes("search_workspace"));
  await page.evaluate(() => window.emit([{ delta: "Only this note." }]));
  await page.getByText("Only this note.").waitFor();

  // Web search: off until Settings turns it on; then OpenAI's hosted tool is
  // offered, and the links it cites become numbered sources.
  assert.ok(
    !call.tools?.includes("web_search"),
    "web search is off by default",
  );
  await page.evaluate(async () => {
    const { setWebSearchEnabled } =
      await import("/src/services/ai-preferences.ts");
    setWebSearchEnabled(true);
  });
  call = await send("What changed in the latest release?");
  assert.ok(call.tools.includes("web_search"));
  const url = "https://example.com/news?utm_source=openai";
  await page.evaluate(() => {
    const call = window.calls.at(-1);
    call.onEvent.onmessage({ delta: "", status: "web" });
  });
  await page.getByText("Searching the web").waitFor();
  await page.evaluate(
    (url) =>
      window.emit([
        { delta: `Version 2 shipped ([example.com](${url})).` },
        {
          delta: "",
          citations: [
            {
              url,
              title: "Release news",
              start: 18,
              end: 18 + `([example.com](${url}))`.length,
            },
          ],
        },
        {
          delta: "",
          cost: {
            usd: 0.0102,
            input: 1000,
            cached: 0,
            output: 100,
            reasoning: 0,
            tier: "default",
            pricing: "test",
            web_searches: 1,
          },
        },
      ]),
    url,
  );
  const webAnswer = page
    .locator(".ask-message-text", { hasText: "Version 2 shipped" })
    .last();
  await webAnswer.waitFor();
  assert.ok(!(await webAnswer.innerText()).includes("example.com]("));
  await page.getByText("Searched the web").waitFor();
  await page.locator(".ask-sources summary").last().click();
  await page.getByText("Release news").waitFor();
  await page.getByText("example.com/news").waitFor();
  await page.getByRole("button", { name: "Open link" }).waitFor();
  assert.match(
    await page.locator(".ask-response-cost").last().getAttribute("aria-label"),
    /1 web search at \$0\.01/,
  );
  await page.screenshot({ path: "test-results/ask-auto-actions/web.png" });

  // Images: offered when the note has images; the app sends them back.
  await page.evaluate(() => {
    window.images = [{ key: "img1", name: "Launch diagram" }];
  });
  call = await send("What does the diagram show?");
  assert.ok(call.tools.includes("view_images"));
  const beforeLook = await page.evaluate(() => window.calls.length);
  await page.evaluate(() =>
    window.emit([
      { delta: "", call: "view_images", call_id: "call_img" },
      { delta: "{}", call: "view_images" },
    ]),
  );
  await page.waitForFunction((n) => window.calls.length > n, beforeLook);
  const look = await page.evaluate(() => {
    const { onEvent, ...call } = window.calls.at(-1);
    void onEvent;
    return call;
  });
  assert.equal(look.viewed.length, 1);
  assert.equal(look.viewed[0].callId, "call_img");
  assert.deepEqual(look.viewed[0].names, ["Launch diagram"]);
  assert.match(look.viewed[0].images[0], /^data:image\/png;base64,/);
  assert.ok(!look.tools.includes("view_images"), "one look per message");
  await page.evaluate(() =>
    window.emit([{ delta: "The diagram shows the launch flow." }]),
  );
  await page.getByText("Looked at 1 image").waitFor();
  assert.deepEqual(errors, []);
  console.log("ask auto actions: ok");
} finally {
  await browser.close();
}
