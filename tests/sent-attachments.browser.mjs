import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run with `pnpm dev`. Saves light/dark screenshots to SHOTS when it is set.
const shots = process.env.SHOTS;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const scheme of ["dark", "light"]) {
    const page = await browser.newPage({ colorScheme: scheme });
    await page.route("**/sent-attachments-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<div id="root" style="display:flex;height:900px;width:460px"></div>',
      }),
    );
    await page.goto("http://127.0.0.1:1420/sent-attachments-test");
    await page.evaluate(async () => {
      const rt = (await import("/@react-refresh")).default;
      rt.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (t) => t;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import("/src/styles/app.css");
      // Knot sets its own theme; follow the scheme under test.
      document.documentElement.style.colorScheme = matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches
        ? "dark"
        : "light";
      const { DocCollection, Schema, Text } =
        await import("/node_modules/.vite/deps/@blocksuite_store.js");
      const { AffineSchemas } =
        await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
      const collection = new DocCollection({
        schema: new Schema().register(AffineSchemas),
      });
      collection.meta.initialize();
      const doc = collection.createDoc();
      doc.load();
      const root = doc.addBlock("affine:page", { title: new Text("Review") });
      doc.addBlock("affine:surface", {}, root);
      window.session = {
        doc,
        editor: new EventTarget(),
        imageSources: () => [],
      };
      const video = {
        videoId: "abc",
        documentId: doc.id,
        blockId: "yt",
        start: 0,
        title: "Switching to Obsidian after 1,000 hours in Apple Notes",
      };
      const sent = [
        { kind: "video", label: video.title, video },
        {
          kind: "pdf",
          label: "Zettelkasten guide.pdf",
          detail: "p. 4",
          document: doc.id,
          pdf: { key: "pdf1", page: 4 },
        },
        {
          kind: "note",
          label: "Spaced repetition",
          document: "deck:card1",
          block: "c1",
          text: "Review just before you forget",
        },
        {
          kind: "excerpt",
          label: "“ideas got lost between apps…”",
          from: "Weekly review",
          document: "n2",
          block: "b2",
          text: "ideas got lost between apps",
        },
        { kind: "web", label: "obsidian.md", url: "https://obsidian.md/" },
      ];
      const chat = {
        id: "fixture",
        documentId: doc.id,
        title: "Attachments",
        updated: Date.now(),
        turns: [
          {
            role: "user",
            content: "Summarize",
            request: {
              mode: "auto",
              sourceMode: "current",
              context: "{}",
              attachments: sent.slice(0, 4),
            },
          },
          { role: "assistant", content: "A summary." },
          {
            role: "user",
            content: "Older question",
            request: {
              mode: "ask",
              sourceMode: "current",
              context: JSON.stringify({
                scope: "Page",
                title: "Apple Notes review",
                document: doc.id,
                addedNotes: [{ document: "n3", title: "Spaced repetition" }],
                citationSources: [
                  { document: doc.id, id: "p1", text: "First" },
                  { document: "n3", id: "q1", text: "Second" },
                ],
              }),
            },
          },
          { role: "assistant", content: "An older answer." },
          {
            role: "user",
            content: "Compare everything",
            request: {
              mode: "auto",
              sourceMode: "current",
              context: "{}",
              attachments: [
                ...sent,
                { kind: "note", label: "Inbox", document: "n4", block: "i1" },
                { kind: "note", label: "Ideas", document: "n5", block: "i2" },
              ],
            },
          },
          { role: "assistant", content: "Compared." },
          {
            role: "user",
            content: "No attachments",
            request: {
              mode: "auto",
              sourceMode: "none",
              context: "{}",
              attachments: [],
            },
          },
        ],
      };
      localStorage.clear();
      localStorage.setItem(
        `knot.ai.chats.v1:sent:${chat.id}`,
        JSON.stringify(chat),
      );
      window.chatStore = new Map();
      window.opened = [];
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        invoke: async (cmd, args) => {
          if (cmd === "ai_chats_list") return [...window.chatStore.values()];
          if (cmd === "ai_chat_save")
            return void window.chatStore.set(args.id, args.data);
          if (cmd.includes("external") || cmd.includes("open"))
            window.opened.push(["external", JSON.stringify(args)]);
          return cmd === "ai_connected"
            ? true
            : cmd === "ai_models"
              ? ["gpt-5.4-mini"]
              : undefined;
        },
      };
      const React = (await import("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (
        await import("/node_modules/.vite/deps/react-dom_client.js")
      ).default;
      const { AskKnot } = await import("/src/app/AskKnot.tsx");
      createRoot(document.getElementById("root")).render(
        React.createElement(AskKnot, {
          workspace: "sent",
          documentId: doc.id,
          initial: null,
          suggestion: null,
          onBusy: () => {},
          getSession: () => window.session,
          onClose: () => {},
          onSource: async (document, block, text, pdf, video) => {
            window.opened.push([
              document,
              block,
              text,
              pdf?.key ?? null,
              video?.start ?? null,
            ]);
          },
        }),
      );
    });
    const lists = page.getByRole("list", { name: "Sent with this message" });
    await lists.first().waitFor();
    assert.equal(await lists.count(), 3, "messages without chips show none");
    const first = lists.nth(0);
    assert.equal(await first.getByRole("listitem").count(), 4);
    // Older chat: page and added note recovered from the saved context.
    assert.deepEqual(
      await lists.nth(1).locator(".ask-chip-label").allInnerTexts(),
      ["Apple Notes review", "Spaced repetition"],
    );
    // Seven attachments: three chips, then "+4 more" expands in place.
    const many = lists.nth(2);
    assert.equal(await many.locator(".ask-chip").count(), 4);
    await many.getByRole("button", { name: "Show 4 more attachments" }).click();
    assert.equal(await many.locator(".ask-chip").count(), 7);

    if (scheme === "dark") {
      await first.getByRole("button", { name: /^Open YouTube video/ }).click();
      await first.getByRole("button", { name: /^Open PDF/ }).click();
      await first.getByRole("button", { name: /^Open Note/ }).click();
      await first.getByRole("button", { name: /^Open Excerpt/ }).click();
      await many.getByRole("button", { name: /^Open Website/ }).click();
      const opened = await page.evaluate(() => window.opened);
      assert.deepEqual(opened.slice(0, 4), [
        [await page.evaluate(() => window.session.doc.id), "yt", "", null, 0],
        [
          await page.evaluate(() => window.session.doc.id),
          "",
          "",
          "pdf1",
          null,
        ],
        ["deck:card1", "c1", "Review just before you forget", null, null],
        ["n2", "b2", "ideas got lost between apps", null, null],
      ]);
      assert.ok(
        opened.slice(4).some((entry) => /obsidian\.md/.test(entry.join(" "))),
        "website chip opens in the browser",
      );
    }
    // Chips stay inside the panel and sit above their bubble.
    const box = await first.boundingBox();
    const bubble = await page
      .locator(".ask-user .ask-message-text")
      .first()
      .boundingBox();
    assert.ok(box && bubble && box.y + box.height <= bubble.y + 1);
    assert.ok(box.x >= 0 && box.x + box.width <= 461);
    if (shots)
      await page
        .locator("#root")
        .screenshot({ path: `${shots}/sent-attachments-${scheme}.png` });
    await page.close();
  }
  console.log(
    "Sent attachments: chips, older chats, +N more, opening sources and both themes passed.",
  );
} finally {
  await browser.close();
}
