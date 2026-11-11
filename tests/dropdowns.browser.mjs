import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("test-results/dropdowns", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/dropdown-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="root" style="padding:24px;display:flex;gap:24px;align-items:start"></div></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/dropdown-test");
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/node_modules/@toeverything/theme/dist/style.css?import");
    await import("/src/styles/app.css");
    await import("/src/styles/dropdowns.css");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { ShellMenu } = await import("/src/app/ShellMenu.tsx");
    const { ChoicePopover } = await import("/src/app/ChoicePopover.tsx");
    const { openCardMenu } =
      await import("/src/features/editor/blocksuite/card-menu.ts");
    window.openCardMenu = openCardMenu;
    const h = React.createElement;
    function Harness() {
      const [value, setValue] = React.useState("Last updated");
      return h(
        React.Fragment,
        null,
        h(ChoicePopover, {
          label: "Sort",
          value,
          options: ["Last updated", "Date created"],
          onChange: setValue,
        }),
        h(
          ShellMenu,
          { label: "Actions", className: "document-menu" },
          h(
            "div",
            { className: "document-action-group" },
            h("button", null, "Attach"),
            h("button", null, "Export"),
          ),
        ),
        h(
          "div",
          { className: "settings-row" },
          h(
            "select",
            { "aria-label": "Format", defaultValue: "markdown" },
            h("option", { value: "markdown" }, "Markdown"),
            h("option", { value: "pdf" }, "PDF"),
            h("option", { disabled: true }, "Unavailable"),
          ),
        ),
      );
    }
    createRoot(document.querySelector("#root")).render(h(Harness));
  });
  const skin = (locator, pseudo) =>
    locator.evaluate((element, pseudo) => {
      const s = getComputedStyle(element, pseudo);
      return [
        s.backgroundColor,
        s.color,
        s.borderRadius,
        s.borderTopColor,
        s.padding,
        s.boxShadow,
        s.fontSize,
      ];
    }, pseudo);
  const choice = page.getByRole("button", { name: "Sort", exact: true });
  const select = page.getByLabel("Format");
  assert.equal(
    await page.evaluate(() => CSS.supports("appearance", "base-select")),
    true,
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await choice.click();
    const popover = page.getByRole("dialog", { name: "Sort", exact: true });
    const reference = await skin(popover);
    assert.equal(
      await popover
        .locator('[aria-pressed="true"] [data-icon="check"]')
        .count(),
      1,
    );
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await popover.waitFor({ state: "detached" });
    assert.equal(
      await choice.evaluate((e) => e === document.activeElement),
      true,
    );

    const trigger = page.getByLabel("Actions", { exact: true });
    await trigger.click();
    assert.deepEqual(
      await skin(page.locator(".shell-menu-content")),
      reference,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await trigger.evaluate((e) => e === document.activeElement),
      true,
    );
    await trigger.click();
    await page.locator("#root").evaluate((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation(), {
        once: true,
      });
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    assert.equal(await page.locator(".shell-menu[open]").count(), 0);

    await page.evaluate(() =>
      window.openCardMenu(30, 160, [
        { label: "Open", run() {} },
        { label: "Remove", run() {} },
      ]),
    );
    assert.deepEqual(await skin(page.locator(".card-deck-menu")), reference);
    await page.keyboard.press("Escape");
    await select.click();
    assert.equal(await select.evaluate((e) => e.matches(":open")), true);
    assert.deepEqual(await skin(select, "::picker(select)"), reference);
    assert.equal(
      await select
        .locator("option:checked")
        .evaluate((e) => getComputedStyle(e, "::checkmark").order),
      "1",
    );
    await page.screenshot({
      path: `test-results/dropdowns/${theme}-select.png`,
    });
    await page.keyboard.press("Escape");
    assert.equal(await select.evaluate((e) => e.matches(":open")), false);
    await select.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await select.inputValue(), "pdf");
    await select.selectOption("markdown");

    await page.setViewportSize({ width: 420, height: 400 });
    await choice.click();
    const box = await popover.boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 420 &&
        box.y + box.height <= 400,
    );
    await page.screenshot({
      path: `test-results/dropdowns/${theme}-choices.png`,
    });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 900, height: 650 });
  }
  await page.evaluate(async () => {
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (command, args) => {
        if (command === "browser_status")
          return {
            session: "fixture",
            url: "https://example.com",
            title: "Fixture",
            back: false,
            forward: false,
            loading: false,
            error: null,
            externalUrl: null,
          };
        if (command === "browser_bounds") window.browserVisible = args.visible;
        return 1;
      },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { BrowserPanel } = await import("/src/app/BrowserPanel.tsx");
    const host = document.createElement("div");
    host.style.cssText =
      "display:flex;position:fixed;left:400px;top:250px;width:450px;height:350px";
    document.body.append(host);
    createRoot(host).render(
      React.createElement(BrowserPanel, {
        request: null,
        onNavigate() {},
        expanded: false,
        onExpand() {},
        onClose() {},
      }),
    );
  });
  await page.waitForFunction(() => window.browserVisible === true);
  await select.click();
  await page.waitForFunction(() => window.browserVisible === false);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.browserVisible === true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS shared light/dark dropdown skins, native picker, selected checks, keyboard changes/dismissal, focus restoration, narrow viewport bounds and embedded-browser overlay gating",
  );
} finally {
  await browser.close();
}
