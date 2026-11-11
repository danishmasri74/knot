// Run with pnpm dev serving localhost:1420; all data stays in this fixture.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  await page.route("**/collection-popover-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="root" style="position:fixed;left:100px;top:24px"></div></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/collection-popover-test");
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/src/styles/dropdowns.css");
    window.__TAURI_INTERNALS__ = {
      // Hold the real asynchronous boundary so loading and ready states each
      // paint. An immediately resolved mock hid the visible placement jump.
      invoke: () =>
        new Promise((resolve) => {
          window.resolveMembership = () => resolve({ collections: ["1"] });
        }),
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { CollectionMembership } = await import("/src/app/Collections.tsx");
    createRoot(document.querySelector("#root")).render(
      React.createElement(CollectionMembership, {
        object: "fixture",
        title: "Fixture notebook",
        catalog: {
          collections: ["Projects", "UniKL", "Getting Started"].map(
            (name, i) => ({
              id: String(i),
              name,
              notebooks: [],
            }),
          ),
          favorites: [],
        },
        busy: false,
        run: (task) => task(),
        onChanged: async () => {},
        onRename: async () => {},
        onTrash() {},
      }),
    );
  });
  const trigger = page.getByRole("button", {
    name: "Notebook options for Fixture notebook",
    exact: true,
  });
  const panel = page.getByRole("dialog");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.style.colorScheme = theme),
      theme,
    );
    for (const narrow of [false, true]) {
      await page.setViewportSize(
        narrow ? { width: 420, height: 400 } : { width: 900, height: 650 },
      );
      // The compact menu fits below; the taller submenu must flip above or clamp.
      await page
        .locator("#root")
        .evaluate(
          (e, narrow) => (e.style.top = narrow ? "180px" : "280px"),
          narrow,
        );
      await trigger.click();
      await panel.evaluate((element) => {
        window.collectionFrames = [];
        // Read immediately after the submenu commit, before ResizeObserver can
        // correct a stale menu position on a later rendering step.
        const sample = () => {
          const box = element.getBoundingClientRect();
          window.collectionFrames.push({
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            scrollTop: element.scrollTop,
          });
        };
        sample();
        window.collectionObserver = new MutationObserver(() => {
          sample();
          window.collectionObserver.disconnect();
        });
        window.collectionObserver.observe(element, {
          childList: true,
          subtree: true,
        });
      });
      await panel
        .getByRole("button", { name: "Collections", exact: false })
        .click();
      await page.getByRole("checkbox", { name: "UniKL" }).waitFor();
      assert.equal(
        await page.getByRole("checkbox", { name: "UniKL" }).isDisabled(),
        true,
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const loadingBox = await panel.boundingBox();
      await page.evaluate(() => window.resolveMembership());
      await page.waitForFunction(
        () => !document.querySelector(".collection-choices input").disabled,
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const readyBox = await panel.boundingBox();
      assert.deepEqual(
        readyBox,
        loadingBox,
        "Loading memberships must not change the submenu size or position",
      );
      await page.waitForFunction(() => window.collectionFrames.length >= 2);
      const frames = await page.evaluate(() => window.collectionFrames);
      const viewport = page.viewportSize();
      for (const box of frames) {
        assert.ok(box.x >= 8 && box.y >= 8, JSON.stringify(box));
        assert.ok(box.x + box.width <= viewport.width - 8, JSON.stringify(box));
        assert.ok(
          box.y + box.height <= viewport.height - 8,
          JSON.stringify(box),
        );
        assert.equal(
          box.scrollTop,
          0,
          "Changing submenu must not scroll the popup",
        );
      }
      assert.equal(
        await page.getByRole("checkbox", { name: "UniKL" }).isChecked(),
        true,
      );
      assert.equal(
        await panel.evaluate((e) => getComputedStyle(e).borderRadius),
        "6px",
      );
      await page
        .getByRole("button", { name: "← Notebook options" })
        .press("Enter");
      await panel
        .getByRole("button", { name: "Collections", exact: false })
        .press("Enter");
      await page.keyboard.press("Escape");
      assert.equal(await panel.count(), 0);
      assert.equal(
        await trigger.evaluate((e) => e === document.activeElement),
        true,
      );
      await page.evaluate(() => window.collectionObserver.disconnect());
    }
  }
  console.log(
    "PASS Collections submenu pre-paint bounds, scroll stability, selection, keyboard/back/Escape and focus restoration in light/dark and narrow viewports",
  );
} finally {
  await browser.close();
}
