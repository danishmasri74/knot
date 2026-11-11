// Run with pnpm dev. Uses isolated browser storage and no user documents.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
async function mount(context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/notebook-layout-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/notebook-layout-test");
  return page;
}
async function hydrate(page) {
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
    const { useNotebookLayout } = await import("/src/app/useNotebookLayout.ts");
    const { tabIdentity } = await import("/src/app/workspace-layout.ts");
    const { WorkspacePanes, ColumnVisibilityToggle } =
      await import("/src/app/WorkspacePanes.tsx");
    await import("/src/styles/app.css");
    window.tab = (kind, noteId) => {
      const tab = {
        kind,
        noteId,
        workspaceId: "workspace",
        documentId: "testing",
      };
      return { ...tab, id: tabIdentity(tab) };
    };
    function Harness() {
      const [scope, setScope] = React.useState([null, undefined]);
      const [layout, dispatch] = useNotebookLayout(...scope);
      // Editor toolbar callbacks are registered before the notebook is active.
      // Keep that initial callback, as openEditor/observePdfToolbars do in App.
      const toolbarDispatch = React.useRef(dispatch);
      window.toolbarDispatch = toolbarDispatch.current;
      React.useEffect(() => setScope(["workspace", "testing"]), []);
      window.scope = scope;
      window.switchNotebook = (notebook, workspace = "workspace") =>
        setScope([workspace, notebook]);
      window.dispatch = dispatch;
      window.layout = layout;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(ColumnVisibilityToggle, { layout, dispatch }),
        React.createElement(WorkspacePanes, {
          layout,
          dispatch,
          available: 1600,
          blocked: false,
          label: (tab) => tab.noteId ?? tab.kind,
          render: (tab) => React.createElement("p", null, tab.kind),
          onReturn: () => {},
        }),
      );
    }
    createRoot(document.querySelector("#root")).render(
      React.createElement(React.StrictMode, null, React.createElement(Harness)),
    );
  });
  await page.waitForFunction(
    () => window.scope?.[0] === "workspace" && window.scope?.[1] === "testing",
  );
}
const snapshot = (page) =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.layout)));
const switchTo = async (page, notebook, workspace) => {
  await page.evaluate(
    ([n, w]) => window.switchNotebook(n, w),
    [notebook, workspace],
  );
  // React has committed by the next frame.
  await page.evaluate(() => new Promise(requestAnimationFrame));
};
try {
  const context = await browser.newContext();
  const page = await mount(context);
  await hydrate(page);
  assert.equal((await snapshot(page)).groups.length, 0);
  await page.evaluate(() =>
    window.toolbarDispatch({ type: "open", tab: window.tab("pdf") }),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(
    (await snapshot(page)).groups.length,
    1,
    "retained PDF toolbar callback opens the active notebook's pane",
  );
  await page.evaluate(() =>
    window.dispatch({ type: "close", id: window.tab("pdf").id }),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => {
    for (const t of [
      window.tab("note", "First note"),
      window.tab("pdf"),
      window.tab("ask"),
    ])
      window.dispatch({ type: "open", tab: t });
    window.dispatch({ type: "split", id: window.tab("pdf").id, side: "left" });
    window.dispatch({ type: "resize", group: "pane-2", width: 620 });
    window.dispatch({
      type: "activate",
      id: window.tab("note", "First note").id,
    });
  });
  await page.waitForFunction(() => window.layout.groups.length === 2);
  const testing = await snapshot(page);
  assert.equal(await page.locator(".pane-header").count(), 2);
  assert.equal(testing.groups[0].preferredWidth, 620);
  const strip = page.locator(".pane-tabs").last();
  await strip.evaluate((element) => {
    element.style.maxWidth = "100px";
    element.scrollLeft = 0;
  });
  await strip.hover();
  await page.mouse.wheel(0, 70);
  await page.waitForFunction(
    () => [...document.querySelectorAll(".pane-tabs")].at(-1).scrollLeft > 0,
  );
  await page.mouse.wheel(0, -70);
  await page.waitForFunction(
    () => [...document.querySelectorAll(".pane-tabs")].at(-1).scrollLeft === 0,
  );
  const wheel = (deltaY, deltaMode = 0, extra = {}) =>
    strip.evaluate(
      (element, values) => {
        element.scrollLeft = 0;
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ...values,
        });
        element.dispatchEvent(event);
        return { left: element.scrollLeft, prevented: event.defaultPrevented };
      },
      { deltaY, deltaMode, ...extra },
    );
  assert.deepEqual(await wheel(1, 1), { left: 16, prevented: true });
  assert.deepEqual(await wheel(70, 0, { ctrlKey: true }), {
    left: 0,
    prevented: false,
  });
  assert.deepEqual(await wheel(70, 0, { deltaX: 25 }), {
    left: 0,
    prevented: false,
  });
  await strip.evaluate((element) => (element.style.maxWidth = ""));
  const noOverflow = page.locator(".pane-tabs").first();
  assert.equal(
    await noOverflow.evaluate((element) => {
      const event = new WheelEvent("wheel", {
        deltaY: 70,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    false,
  );
  await page
    .locator(".pane-content")
    .first()
    .evaluate((element) => {
      window.retainedPanel = element;
    });
  await page.getByRole("button", { name: "Hide columns", exact: true }).click();
  assert.deepEqual(await snapshot(page), { ...testing, hidden: true });
  assert.equal(await page.locator(".workspace-panes").isVisible(), false);
  assert.equal(
    await page.locator(".workspace-panes").evaluate((element) => element.inert),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.retainedPanel.isConnected),
    true,
  );
  await page.getByRole("button", { name: "Show columns", exact: true }).click();
  assert.deepEqual(await snapshot(page), testing);
  assert.equal(
    await page.evaluate(
      () => window.retainedPanel === document.querySelector(".pane-content"),
    ),
    true,
  );
  await page.getByRole("button", { name: "Hide columns", exact: true }).click();
  await switchTo(page, "oop");
  assert.equal((await snapshot(page)).hidden, false);
  await switchTo(page, "testing");
  assert.equal((await snapshot(page)).hidden, true);
  await page.reload();
  await hydrate(page);
  assert.equal((await snapshot(page)).hidden, true);
  assert.equal(await page.locator(".workspace-panes").isVisible(), false);
  await page.getByRole("button", { name: "Show columns", exact: true }).click();
  assert.deepEqual(await snapshot(page), testing);
  await switchTo(page, "oop");
  assert.equal((await snapshot(page)).groups.length, 0);
  assert.equal(await page.getByRole("tab").count(), 0);
  await switchTo(page, "testing");
  assert.deepEqual(await snapshot(page), testing);
  await switchTo(page, "testing", "other-workspace");
  assert.equal((await snapshot(page)).groups.length, 0);
  await switchTo(page, "testing");
  assert.deepEqual(await snapshot(page), testing);
  await page.reload();
  await hydrate(page);
  assert.deepEqual(await snapshot(page), testing);
  assert.equal(await page.getByRole("tab", { selected: true }).count(), 2);

  const stored = await context.storageState();
  await context.close();
  const freshContext = await browser.newContext({ storageState: stored });
  const fresh = await mount(freshContext);
  await hydrate(fresh);
  assert.deepEqual(await snapshot(fresh), testing);
  await switchTo(fresh, "oop");
  assert.equal((await snapshot(fresh)).groups.length, 0);
  await switchTo(fresh, "testing");
  await fresh.evaluate(() => {
    for (const id of Object.keys(window.layout.tabs))
      window.dispatch({ type: "close", id });
  });
  await fresh.waitForFunction(() => window.layout.groups.length === 0);
  await fresh.reload();
  await hydrate(fresh);
  assert.equal((await snapshot(fresh)).groups.length, 0);
  // Invalid stored JSON must recover without breaking the app.
  await fresh.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.includes('["workspace","testing"]'),
    );
    localStorage.setItem(key, "{invalid");
  });
  await fresh.reload();
  await hydrate(fresh);
  assert.equal((await snapshot(fresh)).groups.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS per-notebook/workspace isolation, two-column order/widths/active tabs, refresh, fresh session, closed layout, malformed storage, StrictMode",
  );
  await freshContext.close();
} finally {
  await browser.close();
}
