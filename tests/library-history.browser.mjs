import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto("http://127.0.0.1:1420");
  await page.locator(".app-shell").waitFor();
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === "library_page") return { rows: [], total: 0 };
        if (cmd === "load_card_deck")
          return JSON.stringify({
            test: {
              id: "test",
              nodes: [
                {
                  props: {
                    "sys:flavour": { type: "json", value: "affine:paragraph" },
                    "prop:type": { type: "json", value: "h2" },
                    "prop:text": {
                      type: "text",
                      delta: [{ insert: "Navigation test note" }],
                    },
                  },
                  children: [],
                },
              ],
            },
          });
        if (cmd === "filter_objects" || cmd === "list_blobs") return [];
        if (cmd === "save_documents") return;
        throw Error(`Unexpected ${cmd}`);
      },
    };
  });
  const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismiss.count()) await dismiss.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Library", exact: true })
    .click();
  const tabs = page.getByRole("navigation", { name: "Library views" });
  const back = page.getByRole("button", { name: "Go back", exact: true });
  const forward = page.getByRole("button", { name: "Go forward", exact: true });
  const current = async (name) => {
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll(".library-tabs button")].some(
          (el) =>
            el.textContent.trim() === name &&
            el.getAttribute("aria-current") === "page",
        ),
      name,
    );
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".app-shell")
          ?.classList.contains("is-navigating"),
    );
  };
  await current("Notebooks");
  await tabs.getByRole("button", { name: "Collections", exact: true }).click();
  await current("Collections");
  await tabs.getByRole("button", { name: "Card Deck", exact: true }).click();
  await current("Card Deck");
  assert.equal(await back.isEnabled(), true);
  await back.click();
  await current("Collections");
  assert.equal(
    await forward.isEnabled(),
    true,
    "Forward must enable after Back changes tabs",
  );
  await back.click();
  await current("Notebooks");
  assert.equal(await back.isEnabled(), false);
  await forward.click();
  await current("Collections");
  await forward.click();
  await current("Card Deck");
  assert.equal(await forward.isEnabled(), false);
  await back.click();
  await current("Collections");
  await tabs.getByRole("button", { name: "Notebooks", exact: true }).click();
  await current("Notebooks");
  assert.equal(
    await forward.isEnabled(),
    false,
    "New tab visits discard the forward branch",
  );
  // Repeat with a live editor session, so navigation also awaits the save flow.
  await tabs.getByRole("button", { name: "Card Deck", exact: true }).click();
  await current("Card Deck");
  await page
    .getByRole("button", { name: "Edit Navigation test note", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Card note page", exact: true })
    .locator("affine-paragraph [contenteditable=true]")
    .waitFor();
  await back.click();
  await current("Card Deck");
  await tabs.getByRole("button", { name: "Collections", exact: true }).click();
  await current("Collections");
  await tabs.getByRole("button", { name: "Notebooks", exact: true }).click();
  await current("Notebooks");
  await back.click();
  await current("Collections");
  assert.equal(await forward.isEnabled(), true);
  await back.click();
  await current("Card Deck");
  await forward.click();
  await current("Collections");
  await forward.click();
  await current("Notebooks");
  assert.equal(await forward.isEnabled(), false);
  console.log(
    "Library tabs: actual shell Back/Forward controls, endpoints and branch changes passed",
  );
} finally {
  await browser.close();
}
