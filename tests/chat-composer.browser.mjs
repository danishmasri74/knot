import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("test-results/chat-composer", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/chat-composer-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root" style="display:flex;height:660px;width:600px;margin:12px"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/chat-composer-test");
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
    const doc = { id: "doc" };
    const session = { doc, editor: new EventTarget(), imageSources: () => [] };
    createRoot(document.getElementById("root")).render(
      React.createElement(AskKnot, {
        workspace: "composer",
        documentId: doc.id,
        initial: {
          instance: doc,
          workspace: "composer",
          document: doc.id,
          label: "Canvas text",
          sourceIntent: "explicit",
          selectionKey: "selected-card",
          text: "Canvas selection",
          ranges: [],
          structure: [],
          surrounding: [],
          note: null,
        },
        suggestion: null,
        onBusy: () => {},
        getSession: () => session,
      }),
    );
  });
  const source = page.getByRole("button", {
    name: "Source scope",
    exact: true,
  });
  await source.waitFor();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [600, 320]) {
      await page.evaluate((width) => {
        document.getElementById("root").style.width = `${width}px`;
      }, width);
      await source.click();
      const menu = page.getByRole("dialog", {
        name: "Source scope",
        exact: true,
      });
      await menu.waitFor();
      await menu
        .getByRole("button", { name: "Current note", exact: true })
        .click();
      assert.equal(await source.innerText(), "Current note");
      assert.equal(
        await source
          .locator("span")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        "source label is fully readable",
      );
      assert.equal(
        await page
          .locator(".ask-context")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        "sources stay inside narrow composers",
      );
      await source.press("Enter");
      const selected = menu.getByRole("button", {
        name: "Current note",
        exact: true,
      });
      await selected.waitFor();
      await page.waitForTimeout(80);
      assert.equal(await selected.getAttribute("aria-pressed"), "true");
      assert.equal(await selected.locator('[data-icon="check"]').count(), 1);
      const anchor = await source.boundingBox();
      const box = await menu.boundingBox();
      assert.ok(
        box.y + box.height <= anchor.y,
        "source menu opens above the composer",
      );
      assert.ok(
        box.x >= 8 && box.x + box.width <= 892 && box.y >= 8,
        "menu remains within viewport",
      );
      assert.equal(
        await menu.evaluate((el) => getComputedStyle(el).borderRadius),
        "6px",
      );
      await page.screenshot({
        path: `test-results/chat-composer/${theme}-${width}-open.png`,
      });
      await selected.press("ArrowDown");
      const none = menu.getByRole("button", {
        name: "No note sources",
        exact: true,
      });
      await none.press("Enter");
      await page.waitForFunction(
        () =>
          document.querySelector(".ask-source-scope")?.textContent ===
          "No note sources",
      );
      assert.equal(
        await page.locator(".ask-context .ask-chip").count(),
        0,
        "source-less mode has no duplicate status badge",
      );
      assert.equal(
        await source.evaluate((el) => document.activeElement === el),
        true,
        "selection restores focus",
      );
      await source.press("Enter");
      await menu.waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await menu.count(), 0);
      assert.equal(
        await source.evaluate((el) => document.activeElement === el),
        true,
        "Escape restores focus",
      );
      await source.click();
      await menu
        .getByRole("button", { name: "Current note", exact: true })
        .click();
      await page.screenshot({
        path: `test-results/chat-composer/${theme}-${width}-closed.png`,
      });
      await source.click();
      await page.getByRole("textbox", { name: "Ask Knot message" }).click();
      assert.equal(await menu.count(), 0, "outside click closes source menu");
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Composer: full source labels, wrapping, top placement, shared dropdown styling, selected indicators, keyboard selection, Escape, focus return, and outside dismissal passed in light/dark at 600px/320px.",
  );
} finally {
  await browser.close();
}
