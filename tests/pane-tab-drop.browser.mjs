// Run with pnpm dev. Uses isolated in-memory pane metadata only.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/tab-drop-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main style="display:flex;height:100vh"><div class="workspace-content"><div class="editor-area">Canvas</div><div id="root" style="display:contents"></div></div></main>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/tab-drop-test");
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { WorkspacePanes } = await import("/src/app/WorkspacePanes.tsx");
    const { emptyLayout, layoutReducer } =
      await import("/src/app/workspace-layout.ts");
    await import("/src/styles/app.css");
    const seed = () =>
      ["pdf", "ask", "browser", "cardDeck"].reduce(
        (state, kind) =>
          layoutReducer(state, {
            type: "open",
            tab: { id: kind, kind, workspaceId: "fixture" },
            width: 600,
          }),
        emptyLayout(),
      );
    function Harness() {
      const [layout, dispatch] = React.useReducer(
        layoutReducer,
        undefined,
        seed,
      );
      const [width, setWidth] = React.useState(innerWidth);
      React.useEffect(() => {
        const resize = () => setWidth(innerWidth);
        addEventListener("resize", resize);
        return () => removeEventListener("resize", resize);
      }, []);
      window.configure = (split = false) => {
        dispatch({ type: "workspace" });
        for (const tab of Object.values(seed().tabs))
          dispatch({ type: "open", tab, width: 600 });
        if (split) dispatch({ type: "split", id: "cardDeck", side: "left" });
      };
      window.layout = layout;
      return React.createElement(WorkspacePanes, {
        layout,
        dispatch,
        available: width,
        blocked: false,
        label: (tab) => tab.id,
        render: (tab) => React.createElement("p", null, tab.id),
        onReturn: () => {},
      });
    }
    createRoot(document.querySelector("#root")).render(
      React.createElement(Harness),
    );
  });
  const tab = (id) => page.getByRole("tab", { name: id, exact: true });
  await tab("pdf").waitFor();
  const frame = () => page.evaluate(() => new Promise(requestAnimationFrame));
  const reset = async (split = false) => {
    await page.evaluate((value) => window.configure(value), split);
    await frame();
  };
  const start = async (id) => {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await tab(id).dispatchEvent("dragstart", { dataTransfer });
    return dataTransfer;
  };
  const hover = async (target, x, dataTransfer) => {
    const box = await target.boundingBox();
    const event = { clientX: x, clientY: box.y + 10, dataTransfer };
    await target.dispatchEvent("dragover", event);
    const marker = page.locator(".pane-tab-drop-indicator");
    assert.equal(await marker.count(), 1);
    assert.ok((await marker.boundingBox()).height === 28);
    return event;
  };
  for (const [source, targetId, half, expected] of [
    ["cardDeck", "pdf", "before", ["cardDeck", "pdf", "ask", "browser"]],
    ["pdf", "ask", "after", ["ask", "pdf", "browser", "cardDeck"]],
  ]) {
    await reset();
    const transfer = await start(source);
    const target = tab(targetId).locator("..");
    const box = await target.boundingBox();
    const x = half === "before" ? box.x + 5 : box.x + box.width - 5;
    const event = await hover(target, x, transfer);
    const marker = await page.locator(".pane-tab-drop-indicator").boundingBox();
    assert.ok(
      Math.abs(marker.x - (half === "before" ? box.x : box.x + box.width)) < 1,
    );
    await target.dispatchEvent("drop", event);
    assert.deepEqual(
      await page.evaluate(() => window.layout.groups[0].tabIds),
      expected,
    );
    assert.equal(await page.locator(".pane-tab-drop-indicator").count(), 0);
    await transfer.dispose();
  }
  await reset();
  const endTransfer = await start("pdf");
  const strip = page.locator(".pane-tabs");
  const stripBox = await strip.boundingBox();
  const endEvent = await hover(
    strip,
    stripBox.x + stripBox.width - 8,
    endTransfer,
  );
  await mkdir("test-results", { recursive: true });
  await page.evaluate(
    () => (document.documentElement.style.colorScheme = "dark"),
  );
  await page.screenshot({ path: "test-results/tab-drop-insertion.png" });
  await strip.dispatchEvent("drop", endEvent);
  assert.deepEqual(await page.evaluate(() => window.layout.groups[0].tabIds), [
    "ask",
    "browser",
    "cardDeck",
    "pdf",
  ]);
  await endTransfer.dispose();
  for (const width of [1400, 900]) {
    await page.setViewportSize({ width, height: 700 });
    await reset(true);
    const transfer = await start("ask");
    const target = tab("cardDeck").locator("..");
    const box = await target.boundingBox();
    const event = await hover(target, box.x + box.width - 5, transfer);
    await target.dispatchEvent("drop", event);
    assert.deepEqual(
      await page.evaluate(() => window.layout.groups[0].tabIds),
      ["cardDeck", "ask"],
      "cross-column insertion also respects underlying groups when visually collapsed",
    );
    await transfer.dispose();
  }
  await reset();
  const cancelled = await start("pdf");
  const scroller = page.locator(".pane-tabs");
  await scroller.evaluate((element) => {
    element.style.maxWidth = "100px";
    element.scrollLeft = 40;
  });
  const box = await scroller.boundingBox();
  await hover(scroller, box.x + box.width / 2, cancelled);
  assert.ok((await scroller.evaluate((element) => element.scrollLeft)) > 0);
  await scroller.dispatchEvent("dragleave", { dataTransfer: cancelled });
  assert.equal(await page.locator(".pane-tab-drop-indicator").count(), 0);
  await hover(scroller, box.x + box.width / 2, cancelled);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".pane-tab-drop-indicator").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.layout.groups[0].tabIds), [
    "pdf",
    "ask",
    "browser",
    "cardDeck",
  ]);
  await cancelled.dispose();
  assert.deepEqual(errors, []);
  console.log(
    "PASS tab insertion marker, before/after/end ordering, cross-column and collapsed drops, scrolled strip, leave/cancel cleanup",
  );
} finally {
  await browser.close();
}
