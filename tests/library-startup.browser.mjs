import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const scenario of [
    "returning",
    "empty",
    "first-run",
    "resume",
    "missing",
    "import",
  ]) {
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
      localStorage.setItem("knot.ai.placement.v1:work", "panel");
      if (["resume", "missing", "import"].includes(scenario)) {
        localStorage.setItem("knot.startup-destination", "last-notebook");
        localStorage.setItem(
          "knot.last-notebook:work",
          JSON.stringify({
            id: scenario === "missing" ? "missing" : notebook.id,
            view: "edgeless",
          }),
        );
      }
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
          if (cmd === "pending_knotbook")
            return scenario === "import" ? "import-token" : null;
          if (cmd === "load_document") return null;
          if (cmd === "load_card_deck") return "{}";
          if (cmd === "list_blobs") return [];
          if (cmd === "save_documents") return;
          if (cmd === "unshared_references") return {};
          if (cmd.startsWith("plugin:")) return 1;
          throw Error(`Unexpected startup command: ${cmd}`);
        },
      };
    }, scenario);
    await page.goto("http://127.0.0.1:1420", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () =>
        window.startupCalls.includes("filter_objects") &&
        document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
          "false",
    );
    if (scenario === "resume") {
      await page.locator("affine-edgeless-root").waitFor();
      assert.equal(await page.locator(".library-page").count(), 0);
      assert.equal(
        await page.evaluate(() =>
          window.startupCalls.includes("load_document"),
        ),
        true,
      );
      await page.close();
      continue;
    }
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
    if (scenario === "import")
      await page.locator('dialog[aria-labelledby="import-title"]').waitFor();
    else assert.equal(await page.locator(".error-banner").count(), 0);
    if (scenario === "returning") {
      await page.locator(".sidebar-settings").click();
      const picker = page.getByLabel("On startup", { exact: true });
      assert.equal(await picker.inputValue(), "library");
      await picker.selectOption("last-notebook");
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("knot.startup-destination"),
        ),
        "last-notebook",
      );
      await picker.selectOption("library");
    }
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
    "Startup opens Library by default or when the last notebook is missing, resumes Canvas, and prioritizes file imports",
  );
} finally {
  await browser.close();
}
