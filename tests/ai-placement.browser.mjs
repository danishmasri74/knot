import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.isTauri = true;
  window.aiCalls = [];
  localStorage.setItem("knot.ai-workspace-search", "false");
  localStorage.setItem("knot.ai-enabled", "true");
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (cmd) => {
      window.aiCalls.push(cmd);
      if (cmd === "ai_respond") return new Promise(() => {});
      if (cmd === "workspace_catalog")
        return { active: "work", entries: [{ id: "work", path: "C:/test" }] };
      if (cmd === "collection_catalog")
        return { collections: [], favorites: [] };
      if (cmd === "getting_started_status")
        return { pending: false, welcome_id: "", version: 1 };
      if (cmd === "filter_objects") return [];
      if (cmd === "library_page") return { rows: [], total: 0 };
      if (cmd === "ai_connected") return true;
      if (cmd === "ai_models") return ["gpt-5.4-mini"];
      if (cmd.startsWith("plugin:")) return 1;
      return null;
    },
  };
});
await page.goto("http://127.0.0.1:1420");
await page.locator(".sidebar-ask").click();
await page.locator(".ask-knot textarea").fill("Draft survives page and panel");
await page.evaluate(
  () => (window.originalAI = document.querySelector(".ask-knot")),
);
await page.getByRole("button", { name: "Move to panel", exact: true }).click();
await page.getByRole("button", { name: "Open as page", exact: true }).click();
assert(
  await page.evaluate(
    () => window.originalAI === document.querySelector(".ask-knot"),
  ),
);
if (await page.locator(".pane-ask .ask-knot").count())
  await page.getByRole("button", { name: "Open as page", exact: true }).click();
await page.getByRole("button", { name: "Close Ask Knot", exact: true }).click();
await page.locator(".sidebar-ask").click();
assert.equal(
  await page.locator(".ask-knot textarea").inputValue(),
  "Draft survives page and panel",
);
assert.equal(await page.locator(".ask-knot").count(), 1);
await page.screenshot({ path: "test-results/ai-page.png" });
await page.reload();
await page.locator(".ask-knot textarea").waitFor();
assert.equal(
  await page.locator(".ask-knot textarea").inputValue(),
  "Draft survives page and panel",
);
await page
  .locator(".sidebar")
  .getByRole("button", { name: "Library", exact: true })
  .click();
assert.equal(await page.locator(".ask-workspace-host").isVisible(), false);
await page.getByRole("button", { name: "Go back", exact: true }).click();
await page.locator(".ask-knot textarea").waitFor();
await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
await page.getByRole("button", { name: "Move to panel", exact: true }).click();
await page.getByRole("button", { name: "Open as page", exact: true }).click();
if (await page.locator(".pane-ask .ask-knot").count())
  await page.getByRole("button", { name: "Open as page", exact: true }).click();
await page.getByRole("button", { name: "Close Ask Knot", exact: true }).click();
await page.locator(".sidebar-ask").click();
assert.equal(
  await page.getByRole("button", { name: "Stop", exact: true }).count(),
  1,
);
assert.equal(
  await page.evaluate(
    () => window.aiCalls.filter((c) => c === "ai_respond").length,
  ),
  1,
);
assert.equal(
  await page.evaluate(
    () => window.aiCalls.filter((c) => c === "ai_cancel").length,
  ),
  0,
);
await page.getByRole("button", { name: "Stop", exact: true }).click();
for (const theme of ["light", "dark"]) {
  await page.evaluate(
    (theme) => (document.documentElement.dataset.theme = theme),
    theme,
  );
  await page.screenshot({ path: `test-results/ai-page-${theme}.png` });
}
await page.getByRole("button", { name: "Move to panel", exact: true }).click();
assert.equal(await page.getByRole("tab", { name: /Ask Knot/ }).count(), 1);
assert.equal(await page.locator(".pane-ask .ask-knot").count(), 1);
await page.getByRole("button", { name: "Open as page", exact: true }).click();
assert.equal(await page.getByRole("tab", { name: /Ask Knot/ }).count(), 0);
assert.equal(await page.locator(".ask-knot").count(), 1);
await page.getByRole("button", { name: "Move to panel", exact: true }).click();
await page.setViewportSize({ width: 800, height: 700 });
assert.equal(await page.getByRole("tab", { name: /Ask Knot/ }).count(), 1);
await page.screenshot({ path: "test-results/ai-tab-dark.png" });
await page
  .getByRole("button", { name: "Close Ask Knot tab", exact: true })
  .click();
assert.equal(await page.getByRole("tab", { name: /Ask Knot/ }).count(), 0);
assert.equal(await page.locator(".ask-knot").isVisible(), false);
await page.locator(".sidebar-ask").click();
assert.equal(await page.locator(".ask-knot").count(), 1);
console.log(
  "AI placement: singleton, draft, restart, history, live request, explicit Stop, light/dark, shared tab, close/reopen, narrow projection passed",
);
assert.deepEqual(errors, []);
await browser.close();
