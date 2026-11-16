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
const askTab = () => page.getByRole("tab", { name: /Ask Knot/ });
const libraryTab = () => page.getByRole("tab", { name: "Library" });
await page.goto("http://127.0.0.1:1420", { timeout: 120000 });
// The Library is a tab in its own layout; it has no close button.
await libraryTab().waitFor();
assert.equal(
  await page.getByRole("button", { name: "Close Library tab" }).count(),
  0,
);
// Ask Knot opens as a tab beside the Library, never as a page.
await page.locator(".sidebar-ask").click();
await askTab().waitFor();
assert.equal(await page.locator(".pane-ask .ask-knot").count(), 1);
assert.equal(await libraryTab().count(), 1);
assert.equal(
  await page.getByRole("button", { name: /Open as page|Move to panel/ }).count(),
  0,
);
await page.locator(".ask-knot textarea").fill("Draft survives the tab");
await page.evaluate(
  () => (window.originalAI = document.querySelector(".ask-knot")),
);
// Closing and reopening keeps the one live chat and its draft.
await page
  .getByRole("button", { name: "Close Ask Knot tab", exact: true })
  .click();
assert.equal(await askTab().count(), 0);
await page.locator(".sidebar-ask").click();
await askTab().waitFor();
assert(
  await page.evaluate(
    () => window.originalAI === document.querySelector(".ask-knot"),
  ),
);
assert.equal(
  await page.locator(".ask-knot textarea").inputValue(),
  "Draft survives the tab",
);
// The Library remembers its own layout, sizes included.
const saved = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('knot.library-layout.v1.["work"]')),
);
assert.equal(saved.groups.length, 2);
await page.evaluate(() => {
  const key = 'knot.library-layout.v1.["work"]';
  const layout = JSON.parse(localStorage.getItem(key));
  layout.groups[1].preferredWidth = 520;
  localStorage.setItem(key, JSON.stringify(layout));
});
await page.reload();
await askTab().waitFor();
assert.equal(await libraryTab().count(), 1);
assert.equal(
  Math.round(
    await page.locator(".pane-ask").evaluate((e) => e.getBoundingClientRect().width),
  ),
  520,
);
assert.equal(
  await page.locator(".ask-knot textarea").inputValue(),
  "Draft survives the tab",
);
// A live request keeps running while the tab is closed.
await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
await page
  .getByRole("button", { name: "Close Ask Knot tab", exact: true })
  .click();
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
  await page.screenshot({ path: `test-results/library-ask-${theme}.png` });
}
// Too narrow for both columns: one stays, the other becomes a rail.
await page.setViewportSize({ width: 800, height: 700 });
await askTab().waitFor();
assert.equal(await askTab().count(), 1);
await page.screenshot({ path: "test-results/library-ask-narrow.png" });
console.log(
  "Library tab: unclosable Library, Ask tab beside it, draft, saved layout and width, live request, light/dark, narrow projection passed",
);
assert.deepEqual(errors, []);
await browser.close();
