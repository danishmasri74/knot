import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir("test-results/pdf-toolbar", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/pdf-ai-test", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root" class="pane-content" style="width:568px;height:800px;left:0;top:0;box-sizing:border-box"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/pdf-ai-test");
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (t) => t;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/styles/app.css");
    await import("/src/styles/dropdowns.css");
    const bytes = Array.from(
      new Uint8Array(
        await (
          await fetch("/getting-started/reading-corner-brief.pdf")
        ).arrayBuffer(),
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
    createRoot(document.getElementById("root")).render(
      React.createElement(PdfReader, {
        sources: [{ key: "test", name: "Sample.pdf", documentId: "test" }],
        onAsk: (label, text, source) =>
          (window.result = { label, text, source }),
      }),
    );
  });
  await page.locator(".pdf-page canvas").first().waitFor();
  const text = page.locator(".pdf-page .textLayer span").first();
  await text.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const selection = page.locator(".pdf-selection-panel");
  await selection.waitFor();
  await page.getByRole("button", { name: "Preview highlight card" }).click();
  await page.locator(".pdf-card-preview").waitFor();
  await page.mouse.click(600, 40);
  await selection.waitFor({ state: "hidden" });
  assert.equal(await page.locator(".pdf-highlight.active").count(), 0);

  for (const width of [320, 568, 1000]) {
    await page
      .locator("#root")
      .evaluate((el, width) => (el.style.width = `${width}px`), width);
    const toolbar = await page.locator(".pdf-reader-header").boundingBox();
    assert.ok(
      toolbar.height <= (width >= 1000 ? 36 : 66),
      `Compact toolbar at ${width}px: ${toolbar.height}`,
    );
    for (const control of [
      page.getByLabel("PDF attachment"),
      page.getByLabel("PDF context for Ask Knot"),
      page.getByRole("button", { name: "Ask Knot", exact: true }),
      page.getByRole("group", { name: "PDF zoom", exact: true }),
    ]) {
      const box = await control.boundingBox();
      assert.ok(
        box.x >= 0 && box.x + box.width <= width,
        `Control fits ${width}px`,
      );
    }
    assert.equal(
      await page
        .locator(".pdf-reader")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await page.screenshot({ path: `test-results/pdf-toolbar/${width}.png` });
  }
  await page.locator("#root").evaluate((el) => (el.style.width = "568px"));
  for (const [scope, label] of [
    ["document", "Sample.pdf · PDF"],
    ["page", "Sample.pdf · Page 2"],
  ]) {
    if (scope === "page") {
      assert.equal(await page.locator(".pdf-page").count(), 2);
      await page.locator(".pdf-scroll").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.getByLabel("Page 2 of 2", { exact: true }).waitFor();
    }
    await page.getByRole("button", { name: "PDF context for Ask Knot" }).click();
    await page
      .getByRole("button", {
        name: scope === "page" ? "This page" : "Whole PDF",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
    await page.waitForFunction((l) => window.result?.label === l, label);
    assert.match(
      await page.evaluate(() => window.result.text),
      scope === "page" ? /Page 2[\s\S]*Subtotal/ : /PDF with 2 pages/,
    );
  }
  const original = await readFile(
    "public/getting-started/reading-corner-brief.pdf",
  );
  const contextFor = async (source) =>
    page.evaluate(async (source) => {
      const { preparePdfInput } = await import("/src/services/pdf-input.ts");
      return preparePdfInput(source);
    }, source);
  const full = await contextFor({ key: "test" });
  assert.deepEqual(Buffer.from(full.split(",")[1], "base64"), original);
  const selected = await page.evaluate(() => window.result.source);
  assert.equal(selected.page, 2);
  assert.match(await contextFor(selected), /^data:image\/jpeg;base64,/);
  const second = page.locator('.pdf-page[data-page="2"]');
  const before = await second.evaluate((el) => el.clientWidth);
  await page.getByRole("button", { name: "Zoom in PDF" }).click();
  await page.waitForFunction(
    (w) => document.querySelector('[data-page="2"]').clientWidth > w,
    before,
  );
  const line = second
    .locator(".textLayer span")
    .filter({ hasText: "Example budget" })
    .first();
  await line.scrollIntoViewIfNeeded();
  await line.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator(".pdf-selection-panel").waitFor();
  // An image-only PDF page must reach the visual request without a text layer.
  const scanned = await PDFDocument.create();
  const picture = await scanned.embedPng(
    await readFile("tests/fixtures/knot.png"),
  );
  scanned
    .addPage([250, 250])
    .drawImage(picture, { x: 0, y: 0, width: 250, height: 250 });
  await page.evaluate(
    (bytes) => {
      window.__TAURI_INTERNALS__.invoke = async () => bytes;
    },
    Array.from(await scanned.save()),
  );
  const raster = await contextFor({ key: "scan", page: 1 });
  assert.ok(
    await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 40;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 40, 40);
      return ctx
        .getImageData(0, 0, 40, 40)
        .data.some((v, i) => i % 4 !== 3 && v < 100);
    }, raster),
  );
  console.log(
    "PASS continuous scroll, zoom, page-two text selection and PDF AI scope",
  );
} finally {
  await browser.close();
}
