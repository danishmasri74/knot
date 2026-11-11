import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 850 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/proposal-preview-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root" style="height:800px;display:flex"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/proposal-preview-test");
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    await import("/src/styles/app.css");
    localStorage.clear();
    localStorage.setItem(
      "knot.ai.chats.v1:preview:fixture",
      JSON.stringify({
        id: "fixture",
        documentId: "doc",
        title: "Preview",
        updated: 1,
        turns: [
          {
            role: "assistant",
            content: "Suggested addition",
            mode: "canvas",
            status: "applied",
            proposal: {
              mindmap: Array.from({ length: 30 }, (_, i) => ({
                text: "Mind map topic " + i,
                parent: i === 0 ? -1 : 0,
              })),
              blocks: [],
              connections: [],
              replacements: [],
            },
          },
          {
            role: "assistant",
            content: "Suggested addition",
            mode: "insert",
            proposal: {
              blocks: [{ type: "paragraph", text: "Short preview." }],
              connections: [],
              replacements: [],
            },
          },
        ],
      }),
    );
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd) =>
        cmd === "ai_connected"
          ? true
          : cmd === "ai_models"
            ? ["gpt-5.4-mini"]
            : undefined,
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { AskKnot } = await import("/src/app/AskKnot.tsx");
    createRoot(document.getElementById("root")).render(
      React.createElement(AskKnot, {
        workspace: "preview",
        documentId: "doc",
        initial: null,
        suggestion: null,
        onBusy: () => {},
        getSession: () => null,
        onClose: () => {},
        onSource: async () => {},
      }),
    );
  });
  const expand = page.getByRole("button", {
    name: "Show full preview",
    exact: true,
  });
  await expand.waitFor();
  assert.equal(await expand.count(), 1, "short preview needs no control");
  const proposal = page.locator(".ask-proposal").first();
  assert.equal(await proposal.getByText("Applied", { exact: true }).count(), 1);
  assert(
    await proposal
      .locator(".ask-proposal-preview-window")
      .evaluate((n) => n.clientHeight <= 144),
  );
  assert.equal(
    await proposal
      .locator('.ask-proposal-preview-window > [aria-hidden="true"]')
      .count(),
    1,
  );
  await expand.focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .getByRole("button", { name: "Collapse preview" })
      .getAttribute("aria-expanded"),
    "true",
  );
  assert(
    await proposal
      .locator(".ask-proposal-preview-window")
      .evaluate((n) => n.clientHeight > 144),
  );
  await page.getByRole("button", { name: "Collapse preview" }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    for (const width of [420, 900]) {
      await page.evaluate(
        (w) => (document.getElementById("root").style.width = w + "px"),
        width,
      );
      await page.screenshot({
        path: `test-results/proposal-${theme}-${width}.png`,
      });
      assert.equal(
        await page.getByRole("button", { name: "Show full preview" }).count(),
        1,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Proposal previews: measured truncation, full expansion, keyboard toggle, collapse, persistent status, short content and light/dark panel/page widths passed.",
  );
} finally {
  await browser.close();
}
