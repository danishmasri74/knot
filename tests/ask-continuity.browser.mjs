// Run with pnpm dev. No user data or provider calls.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/ask-continuity-test", (r) =>
    r.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("http://127.0.0.1:1420/ask-continuity-test");
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
    const { WorkspacePanes } =
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
      const [notebook, setNotebook] = React.useState("a");
      const continuation = React.useRef(null);
      const [layout, dispatch, askKey] = useNotebookLayout(
        "workspace",
        notebook,
        continuation,
      );
      window.layout = layout;
      window.switchNotebook = (id, source = false) => {
        if (source)
          continuation.current = { workspace: "workspace", notebook: id };
        setNotebook(id);
      };
      window.openAsk = () => {
        const tab = {
          kind: "ask",
          workspaceId: "workspace",
          documentId: notebook,
        };
        dispatch({ type: "open", tab: { ...tab, id: tabIdentity(tab) } });
      };
      return React.createElement(WorkspacePanes, {
        layout,
        dispatch,
        available: 1600,
        blocked: false,
        label: (t) => t.kind,
        contentKey: (t) => (t.kind === "ask" ? `ask:${askKey}` : t.id),
        render: (t) =>
          React.createElement("input", {
            "aria-label": t.kind,
            defaultValue: "fresh",
          }),
        onReturn: () => {},
      });
    }
    createRoot(document.querySelector("#root")).render(
      React.createElement(React.StrictMode, null, React.createElement(Harness)),
    );
  });
  await page.waitForFunction(() => !!window.openAsk);
  await page.evaluate(() => window.openAsk());
  await page
    .getByRole("textbox", { name: "ask", exact: true })
    .fill("DRAFT AND LIVE CONVERSATION");
  await page.evaluate(
    () => (window.originalAsk = document.querySelector(".pane-ask input")),
  );
  // Destination without an Ask pane: one is inserted before render, preserving the live child.
  await page.evaluate(() => window.switchNotebook("empty", true));
  await page.waitForFunction(
    () =>
      window.layout.tabs[Object.keys(window.layout.tabs)[0]]?.documentId ===
      "empty",
  );
  assert(
    await page.evaluate(
      () => window.originalAsk === document.querySelector(".pane-ask input"),
    ),
  );
  assert.equal(
    await page.getByRole("textbox", { name: "ask", exact: true }).inputValue(),
    "DRAFT AND LIVE CONVERSATION",
  );
  // Destination with its own hidden Ask and browser layout: restore other tabs/widths, carry live Ask.
  await page.evaluate(async () => {
    const { notebookLayoutKey } = await import("/src/app/useNotebookLayout.ts");
    const { layoutReducer, emptyLayout, tabIdentity } =
      await import("/src/app/workspace-layout.ts");
    let layout = emptyLayout();
    for (const kind of ["ask", "browser"]) {
      const tab = {
        kind,
        workspaceId: "workspace",
        documentId: kind === "ask" ? "existing" : undefined,
      };
      layout = layoutReducer(layout, {
        type: "open",
        tab: { ...tab, id: tabIdentity(tab) },
        width: 613,
      });
    }
    layout.hidden = true;
    localStorage.setItem(
      notebookLayoutKey("workspace", "existing"),
      JSON.stringify(layout),
    );
    window.switchNotebook("existing", true);
  });
  await page.waitForFunction(() =>
    Object.values(window.layout.tabs).some((t) => t.documentId === "existing"),
  );
  assert(
    await page.evaluate(
      () => window.originalAsk === document.querySelector(".pane-ask input"),
    ),
  );
  assert.equal(
    await page.getByRole("textbox", { name: "ask", exact: true }).inputValue(),
    "DRAFT AND LIVE CONVERSATION",
  );
  assert.equal(await page.evaluate(() => window.layout.hidden), false);
  assert.equal(
    await page.evaluate(() => window.layout.groups[0].preferredWidth),
    613,
  );
  assert.equal(
    await page.evaluate(
      () =>
        Object.values(window.layout.tabs).filter((t) => t.kind === "ask")
          .length,
    ),
    1,
  );
  // Manual navigation retains the usual notebook restoration and resets the mounted session.
  await page.evaluate(() => window.switchNotebook("a"));
  await page.waitForFunction(() =>
    Object.values(window.layout.tabs).some((t) => t.documentId === "a"),
  );
  assert.equal(
    await page.getByRole("textbox", { name: "ask", exact: true }).inputValue(),
    "fresh",
  );
  assert.equal(
    await page.evaluate(
      () => window.originalAsk === document.querySelector(".pane-ask input"),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Ask continuity: empty/existing/hidden destination, live DOM/draft, saved widths, normal navigation passed.",
  );
} finally {
  await browser.close();
}
