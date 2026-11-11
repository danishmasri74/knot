import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.route("**/chat-scroll-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root" style="display:flex;height:760px;width:440px"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/chat-scroll-test");
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (t) => t;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    const turns = Array.from({ length: 24 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content:
        `Message ${i}\n\n` +
        "A paragraph with **formatted text**.\n\n".repeat(12),
    }));
    localStorage.clear();
    localStorage.setItem(
      "knot.ai.chats.v1:scroll:fixture",
      JSON.stringify({
        id: "fixture",
        documentId: "doc",
        updated: Date.now(),
        title: "Scroll test",
        turns,
      }),
    );
    window.writes = 0;
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) {
      window.writes++;
      return save.apply(this, args);
    };
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd === "ai_connected") return true;
        if (cmd === "ai_models") return ["gpt-5.4-mini"];
        if (cmd === "ai_respond") {
          window.stream = args.onEvent;
          await new Promise((resolve) => {
            window.finish = resolve;
          });
        }
      },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { AskKnot } = await import("/src/app/AskKnot.tsx");
    const doc = { id: "doc" };
    const session = { doc, editor: new EventTarget(), imageSources: () => [] };
    createRoot(document.getElementById("root")).render(
      React.createElement(AskKnot, {
        workspace: "scroll",
        documentId: doc.id,
        initial: {
          instance: doc,
          label: "Selection",
          document: doc.id,
          text: "",
          ranges: [],
          structure: [],
          surrounding: [],
        },
        suggestion: null,
        onBusy: () => {},
        getSession: () => session,
      }),
    );
  });
  await page.waitForSelector(".ask-turn");
  const bottomGap = () =>
    page
      .locator(".ask-messages")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await page.waitForTimeout(300);
  assert.ok(
    (await bottomGap()) < 48,
    "saved conversation opens at latest message",
  );
  await page.getByLabel("Ask Knot message").fill("Continue");
  await page.getByLabel("Send to Knot").click();
  await page.waitForFunction(() => !!window.stream);
  const timer = page.getByRole("timer", { name: "Response time elapsed" });
  await timer.waitFor();
  await page.waitForFunction(() => {
    const timer = document.querySelector(".ask-author [role='timer']");
    return timer && timer.textContent !== "0:00";
  });
  await page.evaluate(() => {
    window.writes = 0;
    for (let i = 0; i < 500; i++)
      window.stream.onmessage({ delta: `chunk${i} ` });
  });
  await page.waitForTimeout(200);
  assert.equal(
    await timer.count(),
    1,
    "elapsed time stays visible while streaming",
  );
  assert.ok((await bottomGap()) < 48, "stream follows latest message");
  assert.ok(
    (await page.evaluate(() => window.writes)) <= 2,
    "token burst is saved in a batch",
  );
  await page.locator(".ask-messages").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  await page.evaluate(() =>
    window.stream.onmessage({ delta: "while reading history" }),
  );
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator(".ask-messages").evaluate((el) => el.scrollTop),
    0,
    "stream preserves manual scroll position",
  );
  await page.evaluate(() => {
    window.stream.onmessage({ delta: " final token" });
    window.finish();
  });
  await page.waitForSelector(".ask-send");
  const finalTime = await timer.textContent();
  assert.match(finalTime, /^\d+:[0-5]\d$/);
  assert.notEqual(finalTime, "0:00");
  await page.waitForTimeout(1100);
  assert.equal(await timer.textContent(), finalTime, "finished time stays fixed");
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("knot.ai.chats.v1:scroll:fixture"),
        ).turns.at(-1).elapsedSeconds,
    ),
    Number(finalTime.split(":")[0]) * 60 + Number(finalTime.split(":")[1]),
    "finished time is saved with the reply",
  );
  assert.match(
    await page.locator(".ask-turn").last().innerText(),
    /final token/,
  );
  assert.match(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("knot.ai.chats.v1:scroll:fixture"),
        ).turns.at(-1).content,
    ),
    /final token$/,
  );
  console.log(
    "Chat scroll: saved history, follow latest, manual scroll, batching and final save passed.",
  );
} finally {
  await browser.close();
}
