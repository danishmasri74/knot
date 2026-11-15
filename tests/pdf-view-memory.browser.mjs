// A notebook's PDF reader comes back at the zoom and scroll position it was
// left at, after the reader is rebuilt (switching notebooks or restarting).
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/pdf-view-test", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root" class="pane-content" style="width:568px;height:700px;left:0;top:0;box-sizing:border-box"></div>',
    }),
  );
  await page.goto(
    `${process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420"}/pdf-view-test`,
  );
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (t) => t;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    localStorage.removeItem("knot.pdf-view.v1");
    const bytes = Array.from(
      new Uint8Array(
        await (await fetch("/getting-started/reading-corner-brief.pdf")).arrayBuffer(),
      ),
    );
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === "get_blob") return bytes;
        throw Error(cmd);
      },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { PdfReader } = await import("/src/app/PdfReader.tsx");
    const root = createRoot(document.getElementById("root"));
    window.mount = (generation, rememberAs) =>
      root.render(
        React.createElement(PdfReader, {
          key: generation,
          rememberAs,
          sources: [{ key: "test", name: "Sample.pdf", documentId: "test" }],
          busy: false,
          onReplace: async () => {},
          onDetach: async () => async () => {},
          onJump: () => {},
          onCreate: async () => {},
          onRemove: async () => {},
        }),
      );
    window.mount(1, "notebook-a");
  });
  await page.locator(".pdf-page canvas").first().waitFor();
  // Zoom in once and scroll part way down.
  await page.getByRole("button", { name: "Zoom in PDF", exact: true }).click();
  await page.waitForTimeout(400);
  const before = await page.locator(".pdf-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight * 0.4;
    el.dispatchEvent(new Event("scroll"));
    return el.scrollTop / el.scrollHeight;
  });
  const zoomBefore = await page.locator(".pdf-view-tools span").textContent();
  await page.waitForTimeout(600);

  // Rebuild the reader, as switching notebooks does.
  await page.evaluate(() => window.mount(2, "notebook-a"));
  await page.locator(".pdf-page canvas").first().waitFor();
  await page.waitForFunction(
    (target) => {
      const el = document.querySelector(".pdf-scroll");
      return el && Math.abs(el.scrollTop / el.scrollHeight - target) < 0.02;
    },
    before,
    { timeout: 10000 },
  );
  assert.equal(
    await page.locator(".pdf-view-tools span").textContent(),
    zoomBefore,
    "zoom is restored",
  );

  // Another notebook's reader starts fresh.
  await page.evaluate(() => window.mount(3, "notebook-b"));
  await page.locator(".pdf-page canvas").first().waitFor();
  assert.equal(await page.locator(".pdf-view-tools span").textContent(), "100%");
  assert.deepEqual(errors, []);
  console.log("PASS PDF reader restores zoom and scroll per notebook");
} finally {
  await browser.close();
}
