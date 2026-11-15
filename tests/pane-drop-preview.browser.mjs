// Run with pnpm dev; only isolated in-memory layout metadata is used.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/pane-drop-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main style="display:flex;height:100vh"><div class="workspace-content"><div class="editor-area">Canvas</div><div id="root" style="display:contents"></div></div></main>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/pane-drop-test");
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
    const initial = (split) => {
      let layout = ["pdf", "ask"].reduce(
        (state, kind) =>
          layoutReducer(state, {
            type: "open",
            tab: {
              id: kind,
              kind,
              workspaceId: "fixture",
              documentId: "notebook",
            },
            width: 640,
          }),
        emptyLayout(),
      );
      if (split) {
        layout = layoutReducer(layout, {
          type: "split",
          id: "pdf",
          side: "left",
        });
        layout = layoutReducer(layout, {
          type: "resize",
          group: "pane-1",
          width: 370,
        });
      }
      return layout;
    };
    function Harness() {
      const [layout, dispatch] = React.useReducer(
        layoutReducer,
        initial(false),
      );
      const [width, setWidth] = React.useState(innerWidth);
      const [expanded, setExpanded] = React.useState(false);
      React.useEffect(() => {
        const resize = () => setWidth(innerWidth);
        addEventListener("resize", resize);
        return () => removeEventListener("resize", resize);
      }, []);
      window.configure = (split = false) => {
        dispatch({ type: "workspace" });
        const state = initial(split);
        // Rebuild via public reducer transitions to exercise real layout state.
        for (const tab of Object.values(state.tabs))
          dispatch({ type: "open", tab, width: 640 });
        if (split) {
          dispatch({ type: "split", id: "pdf", side: "left" });
          dispatch({ type: "resize", group: "pane-1", width: 370 });
        }
      };
      window.setExpanded = setExpanded;
      window.addColumnTab = () =>
        dispatch({
          type: "open",
          tab: {
            id: "extra",
            kind: "note",
            noteId: "note",
            workspaceId: "fixture",
            documentId: "notebook",
          },
        });
      window.layout = layout;
      return React.createElement(WorkspacePanes, {
        layout,
        dispatch,
        available: width,
        expanded,
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
  await page.getByRole("tab", { name: "pdf", exact: true }).waitFor();
  const frame = () => page.evaluate(() => new Promise(requestAnimationFrame));
  const start = async () => {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page
      .getByRole("tab", { name: "pdf", exact: true })
      .dispatchEvent("dragstart", { dataTransfer: transfer });
    return transfer;
  };
  for (const width of [1082, 1280, 1600]) {
    await page.setViewportSize({ width, height: 700 });
    for (const side of ["left", "right"]) {
      await page.evaluate(() => window.configure());
      await frame();
      const before = await page.evaluate(() => JSON.stringify(window.layout));
      const transfer = await start();
      const target = page.locator(`.pane-split-target.${side}`);
      await target.waitFor();
      const preview = await target.boundingBox();
      await target.dispatchEvent("dragenter", { dataTransfer: transfer });
      assert.equal(await target.getAttribute("data-drop-active"), "true");
      const other = page.locator(
        `.pane-split-target.${side === "left" ? "right" : "left"}`,
      );
      await other.dispatchEvent("dragenter", { dataTransfer: transfer });
      // A late leave from the old target must not clear the newly hovered one.
      await target.dispatchEvent("dragleave", { dataTransfer: transfer });
      assert.equal(await other.getAttribute("data-drop-active"), "true");
      assert.equal(await target.getAttribute("data-drop-active"), "false");
      assert.equal(
        await page
          .locator('.pane-split-target[data-drop-active="true"]')
          .count(),
        1,
      );
      await other.dispatchEvent("dragleave", { dataTransfer: transfer });
      assert.equal(
        await page
          .locator('.pane-split-target[data-drop-active="true"]')
          .count(),
        0,
      );
      await target.dispatchEvent("dragover", { dataTransfer: transfer });
      assert.equal(await target.getAttribute("data-drop-active"), "true");
      assert.equal(
        await target.evaluate(
          (element) => getComputedStyle(element).borderStyle,
        ),
        "solid",
      );
      if (width === 1280 && side === "left") {
        await mkdir("test-results", { recursive: true });
        for (const theme of ["light", "dark"]) {
          await page.evaluate(
            (scheme) => (document.documentElement.style.colorScheme = scheme),
            theme,
          );
          await page.screenshot({
            path: `test-results/pane-drop-preview-${theme}.png`,
          });
        }
        await page.evaluate(
          () => (document.documentElement.style.colorScheme = "light"),
        );
      }
      assert.equal(
        await page.evaluate(() => JSON.stringify(window.layout)),
        before,
        "preview leaves actual layout unchanged",
      );
      await target.dispatchEvent("dragover", { dataTransfer: transfer });
      await target.dispatchEvent("drop", { dataTransfer: transfer });
      await page.waitForFunction(() => window.layout.groups.length === 2);
      await frame();
      const actual = await page.locator(".pane-pdf").boundingBox();
      for (const key of ["x", "y", "width", "height"])
        assert.ok(
          Math.abs(preview[key] - actual[key]) < 1,
          `${width}px ${side} preview ${key} matches dropped column: ${preview[key]} vs ${actual[key]}`,
        );
      assert.equal(await page.locator(".pane-split-target").count(), 0);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await transfer.dispose();
    }
  }
  // Whole-column drags include multiple tabs and keep their actual widths.
  const startColumn = async (index) => {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page
      .getByRole("button", { name: "Move column", exact: true })
      .nth(index)
      .dispatchEvent("dragstart", { dataTransfer });
    return dataTransfer;
  };
  // Resize through the real divider, then preview into the resized destination.
  for (const source of [0, 1]) {
    await page.setViewportSize({ width: 1600, height: 700 });
    await page.evaluate(() => window.configure(true));
    await frame();
    const startWidth = (
      await page.locator(".pane-group").first().boundingBox()
    ).width;
    const divider = await page
      .getByRole("separator", {
        name: "Resize columns",
        exact: true,
      })
      .boundingBox();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + 150);
    await page.mouse.down();
    await page.mouse.move(divider.x + divider.width / 2 - 80, divider.y + 150, {
      steps: 8,
    });
    await page.mouse.up();
    await frame();
    const destination = await page
      .locator(".pane-group")
      .nth(1 - source)
      .boundingBox();
    const resized = await page.locator(".pane-group").first().boundingBox();
    assert.ok(
      Math.abs(resized.width - (startWidth - 80)) < 1,
      "pointer resize changes column width",
    );
    const dataTransfer = await startColumn(source);
    const target = page.locator(
      `.pane-split-target.${source === 0 ? "right" : "left"}`,
    );
    const preview = await target.boundingBox();
    assert.ok(
      Math.abs(preview.x - destination.x) < 1,
      "preview respects resized destination position",
    );
    assert.ok(
      Math.abs(preview.width - destination.width) < 1,
      "preview respects resized destination width",
    );
    await target.dispatchEvent("dragover", { dataTransfer });
    if (source === 1)
      await page.screenshot({ path: "test-results/pane-drop-resized.png" });
    await target.dispatchEvent("drop", { dataTransfer });
    await frame();
    const landed = await page
      .locator(".pane-group")
      .nth(1 - source)
      .boundingBox();
    assert.ok(
      Math.abs(landed.x - destination.x) < 1,
      "column move keeps resized divider position",
    );
    assert.ok(
      Math.abs(landed.width - destination.width) < 1,
      "column move keeps resized slot width",
    );
    await dataTransfer.dispose();
  }
  for (const width of [1082, 1280, 1600]) {
    await page.setViewportSize({ width, height: 700 });
    for (const source of [0, 1]) {
      await page.evaluate(() => {
        window.configure(true);
      });
      await frame();
      await page.evaluate(() => window.addColumnTab());
      await frame();
      const before = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.layout)),
      );
      const side = source === 0 ? "right" : "left";
      const dataTransfer = await startColumn(source);
      const target = page.locator(`.pane-split-target.${side}`);
      assert.equal(await page.locator(".pane-split-target").count(), 1);
      assert.match(await target.textContent(), /Move column/);
      const preview = await target.boundingBox();
      if (source === 0) {
        const header = page.locator(".pane-header").nth(1);
        await header.dispatchEvent("dragover", { dataTransfer });
        assert.equal(await target.getAttribute("data-drop-active"), "true");
        await header.dispatchEvent("drop", { dataTransfer });
      } else {
        await target.dispatchEvent("dragover", { dataTransfer });
        assert.equal(await target.getAttribute("data-drop-active"), "true");
        await target.dispatchEvent("drop", { dataTransfer });
      }
      await frame();
      const after = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.layout)),
      );
      const contents = ({ id, tabIds, activeTabId }) => ({
        id,
        tabIds,
        activeTabId,
      });
      assert.deepEqual(
        after.groups.map(contents),
        [...before.groups].reverse().map(contents),
        "all tabs and active tabs move with the column",
      );
      const landed = await page
        .locator(".pane-group")
        .nth(1 - source)
        .boundingBox();
      assert.ok(
        Math.abs(preview.x - landed.x) < 1,
        "whole-column preview x matches destination",
      );
      assert.ok(
        Math.abs(preview.width - landed.width) < 1,
        "whole-column preview width matches destination",
      );
      assert.equal(await page.locator(".pane-split-target").count(), 0);
      await dataTransfer.dispose();
    }
  }
  // Dropping on the source column is a no-op; cancel clears its preview.
  await page.evaluate(() => window.configure(true));
  await frame();
  const unchanged = await page.evaluate(() => JSON.stringify(window.layout));
  const ownTransfer = await startColumn(0);
  await page
    .locator(".pane-header")
    .first()
    .dispatchEvent("drop", { dataTransfer: ownTransfer });
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.layout)),
    unchanged,
  );
  assert.equal(await page.locator(".pane-split-target").count(), 0);
  await ownTransfer.dispose();
  const cancelled = await startColumn(0);
  await page
    .locator(".pane-split-target.right")
    .dispatchEvent("dragover", { dataTransfer: cancelled });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".pane-split-target").count(), 0);
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.layout)),
    unchanged,
  );
  await cancelled.dispose();
  // Existing unequal columns: only the opposite side is a valid move.
  await page.evaluate(() => window.configure(true));
  await frame();
  const transfer = await start();
  assert.equal(await page.locator(".pane-split-target.left").count(), 0);
  const right = page.locator(".pane-split-target.right");
  const swapPreview = await right.boundingBox();
  await right.dispatchEvent("drop", { dataTransfer: transfer });
  await frame();
  const swapped = await page.locator(".pane-pdf").boundingBox();
  assert.ok(Math.abs(swapPreview.x - swapped.x) < 1);
  assert.ok(Math.abs(swapPreview.width - swapped.width) < 1);
  await transfer.dispose();
  await page.evaluate(() => window.configure());
  await frame();
  await start();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".pane-split-target").count(), 0);
  // A 360px PDF column and a 320px Ask column need 681px.
  await page.setViewportSize({ width: 650, height: 700 });
  await frame();
  await start();
  assert.equal(
    await page.locator(".pane-split-target").count(),
    0,
    "no split preview when two columns cannot fit",
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.evaluate(() => window.setExpanded(true));
  await frame();
  await start();
  assert.equal(
    await page.locator(".pane-split-target").count(),
    0,
    "no two-column preview while a pane is expanded",
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "PASS pointer-resized destination widths/dividers, tab and column drop previews/highlights, exact bounds at 1082/1280/1600px, multi-tab moves, header/body drops, cancellation",
  );
} finally {
  await browser.close();
}
