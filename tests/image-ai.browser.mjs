import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage();
  await page.route("**/image-ai-test", (r) =>
    r.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("http://127.0.0.1:1420/image-ai-test");
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (t) => t;
    window.__vite_plugin_react_preamble_installed__ = true;
    window.calls = [];
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd === "filter_objects")
          return [{ id: "other", title: "Design notes", kind: "notebook" }];
        if (cmd === "put_blob") {
          if (!args.mime.startsWith("image/") || !args.bytes.length)
            throw Error("Missing upload");
          window.uploads = (window.uploads || 0) + 1;
          return "reading-corner.svg";
        }
        if (cmd === "ai_connected") return true;
        if (cmd === "ai_models") return ["gpt-5.4-mini"];
        if (cmd === "get_blob")
          return Array.from(
            new Uint8Array(
              await (await fetch("/getting-started/" + args.key)).arrayBuffer(),
            ),
          );
        if (cmd === "ai_respond") {
          if (args.model !== "gpt-5.4-mini")
            throw Error("Automatic did not resolve to the available model");
          window.calls.push({
            image: args.image ?? null,
            measurements: JSON.parse(args.context).attachedImage,
            pdf: args.pdfInput?.split(",")[0],
          });
          return;
        }
        throw Error(cmd);
      },
    };
    await import("/src/styles/app.css");
    await import("/src/styles/dropdowns.css");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { AskKnot } = await import("/src/app/AskKnot.tsx");
    const doc = { id: "test" };
    const session = {
      doc,
      editor: new EventTarget(),
      imageSources: () =>
        ["reading-corner.svg", "views.png"].map((key) => ({ key, name: key })),
    };
    const initial = {
      instance: doc,
      selectedImageKey: "reading-corner.svg",
      pdf: true,
      pdfSource: { key: "reading-corner-brief.pdf" },
      ranges: [{ text: "hello", attributes: {} }],
      structure: [],
      surrounding: [],
      text: "hello",
      label: "Selection",
      document: doc.id,
    };
    const root = createRoot(document.getElementById("root"));
    window.renderContext = (change = {}) =>
      root.render(
        React.createElement(AskKnot, {
          workspace: "test",
          documentId: doc.id,
          initial: { ...initial, ...change },
          onBusy: () => {},
          getSession: () => session,
        }),
      );
    window.renderContext();
  });
  await mkdir("test-results/composer", { recursive: true });
  assert.equal(await page.getByLabel("AI action", { exact: true }).count(), 0);
  assert.equal(
    await page.getByLabel("Image context", { exact: true }).count(),
    0,
  );
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.setViewportSize({ width: 575, height: 930 });
    await page
      .getByRole("button", { name: "Add attachment", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "Add attachment",
      exact: true,
    });
    await picker
      .getByPlaceholder("Search notes or paste a URL...")
      .fill("Design");
    await picker
      .getByRole("button", { name: "Design notes", exact: true })
      .waitFor();
    await page.waitForFunction(() => {
      const box = document
        .querySelector('[role="dialog"][aria-label="Add attachment"]')
        .getBoundingClientRect();
      return (
        box.x >= 0 &&
        box.y >= 0 &&
        box.right <= innerWidth &&
        box.bottom <= innerHeight
      );
    });
    const box = await picker.boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 575 &&
        box.y + box.height <= 930,
    );
    await page.screenshot({
      path: `test-results/composer/${theme}-picker.png`,
    });
    await page.keyboard.press("Escape");
    assert.equal(await picker.count(), 0);
    await page.screenshot({
      path: `test-results/composer/${theme}-composer.png`,
    });
  }
  await page.getByLabel("AI model", { exact: true }).selectOption("auto");
  for (const [i, key] of ["reading-corner.svg", "views.png", ""].entries()) {
    if (i === 0)
      await page
        .getByRole("button", {
          name: "Preview reading-corner.svg",
          exact: true,
        })
        .waitFor();
    else if (key) {
      await page
        .getByRole("button", { name: "Add attachment", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Add attachment", exact: true })
        .getByRole("button", { name: key, exact: true })
        .click();
    } else
      await page
        .getByRole("button", { name: "Remove image", exact: true })
        .click();
    await page.getByLabel("Ask Knot message").fill("Describe the picture.");
    await page.getByLabel("Send to Knot").click();
    await page.waitForFunction((n) => window.calls.length === n, i + 1);
    const { image, pdf, measurements } = await page.evaluate(() =>
      window.calls.at(-1),
    );
    assert.equal(pdf, key ? "data:application/pdf;base64" : undefined);
    if (key) {
      assert.match(image, /^data:image\/png;base64,/);
      assert.ok(measurements.dominantSampledColors.length);
      if (key === "reading-corner.svg") {
        assert.equal(measurements.width, 800);
        assert.equal(measurements.height, 460);
        assert.equal(measurements.estimatedTransparentPercent, 0);
        assert.ok(
          measurements.dominantSampledColors.some(
            (color) => color.hex === "#f3eee3",
          ),
        );
      }
    } else assert.equal(image, null);
    assert.equal(
      await page.evaluate(() =>
        /data:(?:image\/(?:png|jpeg)|application\/pdf);base64/.test(
          JSON.stringify(localStorage),
        ),
      ),
      false,
    );
  }
  const upload = {
    name: "uploaded.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
    ),
  };
  await page.locator('input[type="file"]').setInputFiles(upload);
  await page
    .getByRole("button", { name: "Preview uploaded.svg", exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.uploads), 1);
  await page
    .getByRole("button", { name: "Preview uploaded.svg", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close preview", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "Close preview", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await page
    .getByRole("button", { name: "Add attachment", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Add attachment", exact: true })
    .getByRole("button", { name: "Design notes", exact: true })
    .click();
  await page
    .locator(".ask-context")
    .getByRole("button", { name: "Design notes", exact: false })
    .waitFor();
  await page.evaluate(() =>
    window.renderContext({
      selectionKey: '[["card"],[],[]]',
      selectionLabel:
        "Selected card with a long title that overflows the attachment chip",
      selectedImageKey: undefined,
      pdf: false,
    }),
  );
  await page
    .getByRole("button", { name: "Exclude note context", exact: true })
    .waitFor();
  assert.match(await page.locator(".ask-context").innerText(), /Selected card/);
  const selectedChip = page.getByRole("button", {
    name: "Exclude note context",
    exact: true,
  });
  const chip = await selectedChip.boundingBox();
  const removeIcon = await selectedChip
    .locator('[data-icon="close"]')
    .boundingBox();
  assert.ok(removeIcon.x + removeIcon.width <= chip.x + chip.width);
  assert.ok(
    await selectedChip
      .locator(".ask-chip-label")
      .evaluate((label) => label.scrollWidth > label.clientWidth),
  );

  await page
    .getByRole("button", { name: "Exclude note context", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Exclude note context", exact: true })
      .count(),
    0,
  );
  await page.evaluate(() =>
    window.renderContext({
      selectionKey: "[[],[],[]]",
      selectedImageKey: undefined,
      pdf: false,
    }),
  );
  await page.evaluate(() =>
    window.renderContext({
      selectionKey: '[["pdf"],[],[]]',
      selectionLabel: "Selected.pdf",
      selectedImageKey: undefined,
      pdf: true,
    }),
  );
  await page
    .getByRole("button", { name: "Exclude note context", exact: true })
    .waitFor();
  assert.match(await page.locator(".ask-context").innerText(), /Selected.pdf/);
  assert.equal(await page.locator('.ask-context [data-icon="pdf"]').count(), 1);
  await page.evaluate(() =>
    window.renderContext({
      selectionKey: "[[],[],[]]",
      selectedImageKey: undefined,
      pdf: false,
    }),
  );
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Exclude note context"]'),
  );
  await page.evaluate(() =>
    window.renderContext({
      selectionKey: '[["bookmark"],[],[]]',
      selectionKind: "website",
      selectionLabel: "example.org",
      selectedImageKey: undefined,
      pdf: false,
    }),
  );
  await page.locator('.ask-context [data-icon="link"]').waitFor();
  assert.match(await page.locator(".ask-context").innerText(), /example.org/);
  await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { WebSourceList } = await import("/src/app/WebSourceList.tsx");
    const container = document.createElement("div");
    container.id = "web-regression";
    document.body.append(container);
    function Test() {
      const [sources, setSources] = React.useState([
        {
          id: "web",
          url: "https://example.org",
          state: "partial",
          capture: { title: "Example website" },
        },
      ]);
      return React.createElement(WebSourceList, {
        sources,
        busy: false,
        onRemove: () => setSources([]),
      });
    }
    createRoot(container).render(React.createElement(Test));
  });
  await page
    .getByRole("button", {
      name: "Remove website: Example website",
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator("#web-regression details").count(), 0);
  assert.equal(
    await page
      .locator("#web-regression")
      .getByText("partial", { exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", {
      name: "Remove website: Example website",
      exact: true,
    })
    .click();
  assert.equal(
    await page.locator("#web-regression .web-source-item").count(),
    0,
  );
  await page
    .getByRole("button", { name: "Add attachment", exact: true })
    .click();
  const unifiedPicker = page.getByRole("dialog", {
    name: "Add attachment",
    exact: true,
  });
  assert.equal(await unifiedPicker.locator("input").count(), 1);
  await unifiedPicker.getByRole("textbox").fill("https://example.org/guide");
  const attachWebsite = unifiedPicker.getByRole("button", {
    name: "Attach example.org/guide",
    exact: true,
  });
  await attachWebsite.waitFor();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await attachWebsite.evaluate((button) => document.activeElement === button),
    true,
  );
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", {
      name: "Remove website: example.org/guide",
      exact: true,
    })
    .waitFor();
  const transparentSample = await page.evaluate(async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="50" height="100" fill="#ff0000"/></svg>';
    window.__TAURI_INTERNALS__.invoke = async () =>
      Array.from(new TextEncoder().encode(svg));
    const { prepareAiImage } = await import("/src/services/ai-image.ts");
    return (await prepareAiImage("transparent")).measurements;
  });
  assert.equal(transparentSample.estimatedTransparentPercent, 50);
  assert.deepEqual(transparentSample.dominantSampledColors, [
    { hex: "#ff0000", percentOfVisibleArea: 100 },
  ]);
  console.log(
    "PASS selected SVG and PNG sent as pixels, deselected image omitted",
  );
} finally {
  await browser.close();
}
