import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto("http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  await page.evaluate(() => {
    const row = {
      id: "test-doc",
      title: "Skeleton test",
      kind: "note",
      updated_at: 0,
    };
    window.libraryRequests = 0;
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === "library_page") {
          window.libraryRequests++;
          return { total: 1, rows: [row] };
        }
        if (cmd === "filter_objects") return [row];
        if (cmd === "load_card_deck") return "{}";
        if (cmd === "load_document")
          return await new Promise((resolve, reject) => {
            window.resolveLoad = () => resolve(null);
            window.rejectLoad = () => reject(Error("Load failed"));
          });
        if (cmd === "save_documents") return;
        throw Error(cmd);
      },
    };
  });
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByText("Skeleton test", { exact: true }).click();
  await page.getByRole("status", { name: "Loading notebook" }).waitFor();
  assert.equal(await page.locator(".document-header-skeleton").count(), 0);
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  assert.equal(
    await page.locator(".app-shell").getAttribute("aria-busy"),
    "false",
  );
  // A header navigation request during loading must run after the pending load,
  // including when that load fails. Previously run() silently discarded it.
  await page
    .locator(".library-breadcrumb")
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".document-page-skeleton")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.screenshot({ path: "test-results/document-skeleton.png" });
  await page.evaluate(() => window.rejectLoad());
  await page
    .getByRole("status", { name: "Loading notebook" })
    .waitFor({ state: "detached" });
  await page.waitForFunction(() => window.libraryRequests >= 2);
  await page.getByText("Skeleton test", { exact: true }).click();
  await page.getByRole("status", { name: "Loading notebook" }).waitFor();
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    // Hold view readiness after the editor container has finished mounting.
    const area = document.querySelector(".editor-area");
    const observer = new MutationObserver(() => {
      const root = area.querySelector("affine-page-root");
      if (!root || window.pendingViewProbe) return;
      const probe = document.createElement("button");
      probe.textContent = "Still loading";
      probe.setAttribute("data-knot-loading", "");
      root.append(probe);
      window.pendingViewProbe = probe;
      observer.disconnect();
    });
    observer.observe(area, { childList: true, subtree: true });
    window.resolveLoad();
  });
  await page.waitForFunction(() => window.pendingViewProbe?.isConnected);
  await page.waitForTimeout(300);
  assert.equal(
    await page.getByRole("status", { name: "Loading notebook" }).count(),
    1,
  );
  assert.equal(
    await page.locator(".editor-area").evaluate((el) => el.inert),
    true,
  );
  // Even bypassing the visual cover must not unlock the document itself.
  const bypass = await page.addStyleTag({
    content:
      ".document-loading { display: none !important; } .editor-area { visibility: visible !important; }",
  });
  assert.equal(
    await page.evaluate(() => {
      window.pendingViewProbe.focus();
      return document.activeElement === window.pendingViewProbe;
    }),
    false,
  );
  await bypass.evaluate((el) => el.remove());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.locator(".editor-area").evaluate((el) => el.inert),
    true,
  );
  assert.equal(
    await page.getByRole("status", { name: "Loading notebook" }).count(),
    1,
  );
  await page.evaluate(() => window.pendingViewProbe.remove());
  await page
    .getByRole("status", { name: "Loading notebook" })
    .waitFor({ state: "detached" });
  assert.equal(await page.locator(".document-header-skeleton").count(), 0);
  assert.equal(
    await page.getByLabel("Document title", { exact: true }).inputValue(),
    "Skeleton test",
  );
  await page.waitForFunction(
    () => !document.querySelector(".editor-area").inert,
  );
  console.log(
    "PASS content-only loader, queued navigation, readiness gating, bypass protection, Settings round trip, and successful reveal",
  );
} finally {
  await browser.close();
}
