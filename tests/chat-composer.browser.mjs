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
  // The Abilities popover replaced the Source scope dropdown.
  const trigger = page.getByRole("button", { name: "Abilities", exact: true });
  await trigger.waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Source scope" }).count(),
    0,
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [600, 320]) {
      await page.evaluate((width) => {
        document.getElementById("root").style.width = `${width}px`;
      }, width);
      assert.equal(
        await page
          .locator(".ask-context")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        "sources stay inside narrow composers",
      );
      await trigger.click();
      const menu = page.getByRole("dialog", { name: "Abilities", exact: true });
      await menu.waitFor();
      const search = menu.getByRole("switch", {
        name: "Search my workspace",
        exact: true,
      });
      const edit = menu.getByRole("switch", {
        name: "Edit the current note",
        exact: true,
      });
      await page.waitForTimeout(80);
      assert.equal(
        await search.evaluate((el) => document.activeElement === el),
        true,
        "the first row takes focus",
      );
      for (const row of [search, edit]) {
        assert.equal(await row.getAttribute("aria-checked"), "true");
        assert.equal(
          await row
            .locator(".knot-switch")
            .evaluate((el) => getComputedStyle(el).backgroundColor),
          await page.evaluate(() => {
            const probe = document.createElement("span");
            probe.style.color = "var(--control-accent)";
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          }),
          "an on switch uses the Settings accent",
        );
      }
      const anchor = await trigger.boundingBox();
      const box = await menu.boundingBox();
      assert.ok(
        box.y + box.height <= anchor.y,
        "abilities open above the composer",
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
      // Web search is off in Settings, so its row is disabled and skipped.
      const web = menu.getByRole("switch", {
        name: "Search the web",
        exact: true,
      });
      assert.equal(await web.isDisabled(), true);
      assert.equal(await web.getAttribute("aria-checked"), "false");
      const images = menu.getByRole("switch", {
        name: "Look at images",
        exact: true,
      });
      // Keyboard: move to a row and toggle it; the chat is then marked.
      await search.press("ArrowDown");
      assert.equal(
        await images.evaluate((el) => document.activeElement === el),
        true,
      );
      await images.press("Enter");
      assert.equal(await images.getAttribute("aria-checked"), "false");
      await page.waitForTimeout(200); // the knob slides for 120ms
      assert.equal(
        await images
          .locator(".knot-switch span")
          .evaluate((el) => getComputedStyle(el).transform),
        "none",
        "an off switch has its knob on the left",
      );
      assert.equal(await page.locator(".ask-abilities-dot").count(), 1);
      await images.press("Enter");
      assert.equal(await page.locator(".ask-abilities-dot").count(), 0);
      await page.keyboard.press("Escape");
      assert.equal(await menu.count(), 0);
      assert.equal(
        await trigger.evaluate((el) => document.activeElement === el),
        true,
        "Escape restores focus",
      );
      await trigger.click();
      await menu.waitFor();
      await page.locator(".ask-header h2").click();
      assert.equal(await menu.count(), 0, "outside click closes the menu");
      await page.screenshot({
        path: `test-results/chat-composer/${theme}-${width}-closed.png`,
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Composer: abilities popover placement, shared dropdown styling, selected indicators, keyboard toggling, chat marker, Escape, focus return, outside dismissal and narrow source chips passed in light/dark at 600px/320px.",
  );
} finally {
  await browser.close();
}
