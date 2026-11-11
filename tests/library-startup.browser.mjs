import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const scenario of ["returning", "empty", "first-run"]) {
    const page = await browser.newPage();
    await page.addInitScript((scenario) => {
      window.isTauri = true;
      window.startupCalls = [];
      const notebook = {
        id: "recent",
        title: "Recent notebook",
        kind: "note",
        updated_at: 1,
      };
      localStorage.setItem("knot.ai-workspace-search", "false");
      localStorage.setItem(
        "knot.sidebar.work",
        JSON.stringify({ recent: ["recent"] }),
      );
      let callback = 0;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => ++callback,
        unregisterCallback: () => {},
        invoke: async (cmd) => {
          window.startupCalls.push(cmd);
          if (cmd === "workspace_catalog")
            return {
              active: "work",
              entries: [{ id: "work", path: "C:/test" }],
            };
          if (cmd === "collection_catalog")
            return { collections: [], favorites: [] };
          if (cmd === "getting_started_status")
            return {
              pending: scenario === "first-run",
              welcome_id: "recent",
              version: 1,
            };
          if (cmd === "filter_objects")
            return scenario === "empty" ? [] : [notebook];
          if (cmd === "library_page")
            return {
              rows: scenario === "empty" ? [] : [notebook],
              total: scenario === "empty" ? 0 : 1,
            };
          if (cmd === "clear_expired_trash") return 0;
          if (cmd.startsWith("plugin:")) return 1;
          throw Error(`Unexpected startup command: ${cmd}`);
        },
      };
    }, scenario);
    await page.goto("http://127.0.0.1:1420");
    await page.waitForFunction(
      () =>
        window.startupCalls.includes("filter_objects") &&
        document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
          "false",
    );
    await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
    assert.equal(
      await page
        .locator('.library-tabs button[aria-current="page"]')
        .textContent(),
      "Notebooks",
    );
    assert.equal(await page.locator("affine-editor-container").count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Go back", exact: true })
        .isEnabled(),
      false,
    );
    assert.equal(
      await page.evaluate(() => window.startupCalls.includes("load_document")),
      false,
    );
    assert.equal(await page.locator(".error-banner").count(), 0);
    await page.reload();
    await page.waitForFunction(
      () =>
        window.startupCalls.includes("filter_objects") &&
        document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
          "false",
    );
    await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
    assert.equal(await page.locator("affine-editor-container").count(), 0);
    await page.close();
  }
  console.log(
    "Startup opens Library for returning, empty and first-run workspaces, including reload",
  );
} finally {
  await browser.close();
}
