import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("test-results/ai-connector-shape", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/ai-connector-shape-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div class="settings-modal" style="position:static;display:block;width:760px;max-height:none;margin:24px"><div id="root"></div></div>',
    }),
  );
  async function mount() {
    await page.evaluate(async () => {
      const rt = (await import("/@react-refresh")).default;
      rt.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (t) => t;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import("/node_modules/@toeverything/theme/dist/style.css?import");
      await import("/src/styles/app.css");
      await import("/src/styles/dropdowns.css");
      const React = (await import("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (
        await import("/node_modules/.vite/deps/react-dom_client.js")
      ).default;
      const { AiSettings } = await import("/src/app/AiSettings.tsx");
      createRoot(document.getElementById("root")).render(
        React.createElement(AiSettings, {
          enabled: true,
          beforeReload: async () => {},
        }),
      );
      const { DocCollection, Schema, Text } =
        await import("/node_modules/.vite/deps/@blocksuite_store.js");
      const { AffineSchemas } =
        await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
      const { captureCardContext, applyAiProposal } =
        await import("/src/features/editor/blocksuite/ai.ts");
      const collection = new DocCollection({
        schema: new Schema().register(AffineSchemas),
      });
      collection.meta.initialize();
      const doc = collection.createDoc();
      doc.load();
      const root = doc.addBlock("affine:page", {
        title: new Text("Connector shapes"),
      });
      const surfaceId = doc.addBlock("affine:surface", {}, root);
      const card = doc.addBlock("affine:note", {}, root);
      doc.addBlock(
        "affine:paragraph",
        { text: new Text("Existing card") },
        card,
      );
      window.generate = () => {
        const context = captureCardContext(
          doc,
          "connector-test",
          doc.getBlock(card).model,
        );
        applyAiProposal(
          doc,
          "connector-test",
          context,
          {
            replacements: [],
            blocks: [
              { type: "paragraph", text: "Start" },
              { type: "paragraph", text: "Finish" },
            ],
            connections: [{ from: 0, to: 1, label: "Next" }],
          },
          "canvas",
        );
        return doc
          .getBlock(surfaceId)
          .model.elementModels.filter((e) => e.type === "connector")
          .map((e) => e.mode);
      };
    });
  }
  await page.goto("http://127.0.0.1:1420/ai-connector-shape-test");
  await mount();
  const choices = page.getByRole("radiogroup", {
    name: "Default connector shape",
    exact: true,
  });
  const radio = (name) => choices.getByRole("radio", { name, exact: true });
  await choices.waitFor();
  assert.equal(
    await radio("Elbowed").isChecked(),
    true,
    "existing behavior remains the default",
  );
  assert.deepEqual(
    await choices.locator(".ai-connector-choice-label").allTextContents(),
    ["Curve", "Elbowed", "Straight"],
  );
  const modes = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const [shape, mode] of [
      ["curve", 2],
      ["elbowed", 1],
      ["straight", 0],
    ]) {
      await choices
        .getByText(shape[0].toUpperCase() + shape.slice(1), { exact: true })
        .click();
      assert.equal(
        await choices.locator(".ai-connector-preview").count(),
        3,
        "all shapes have a visible preview",
      );
      modes.push(mode);
      assert.deepEqual(
        await page.evaluate(() => window.generate()),
        modes,
        "new connectors use the selection and existing connectors keep their shape",
      );
    }
    await choices.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/ai-connector-shape/${theme}.png`,
    });
    await radio("Straight").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await radio("Curve").isChecked(),
      true,
      "native keyboard selection works",
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(await radio("Straight").isChecked(), true);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.evaluate(() => {
      const modal = document.querySelector(".settings-modal");
      modal.style.width = "calc(100vw - 32px)";
      modal.style.margin = "8px";
    });
    assert.equal(
      await choices.evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
      "previews fit narrow settings",
    );
    await page.screenshot({
      path: `test-results/ai-connector-shape/${theme}-narrow.png`,
    });
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.evaluate(() => {
      const modal = document.querySelector(".settings-modal");
      modal.style.width = "760px";
      modal.style.margin = "24px";
    });
  }
  await page.reload();
  await mount();
  await choices.waitFor();
  assert.equal(
    await radio("Straight").isChecked(),
    true,
    "shape persists after reopening settings",
  );
  assert.deepEqual(
    await page.evaluate(() => window.generate()),
    [0],
    "generation reads the persisted shape after reload",
  );
  assert.equal(
    await page.evaluate(async () => {
      localStorage.setItem("knot.ai-connector-shape", "unknown");
      const { getAiConnectorShape } =
        await import("/src/services/ai-preferences.ts");
      return getAiConnectorShape();
    }),
    "elbowed",
    "invalid stored shapes recover to the default",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS AI connector settings: all three shapes, saved preference, generation, existing connectors, reload, invalid fallback, light/dark and keyboard controls.",
  );
} finally {
  await browser.close();
}
