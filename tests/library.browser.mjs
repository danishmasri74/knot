import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto("http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  await page.evaluate(() => {
    window.libraryRequests = 0;
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd === "set_favorite") {
          await new Promise((resolve) => {
            window.finishFavorite = resolve;
          });
          return;
        }
        if (cmd === "library_page") {
          window.libraryRequests++;
          if (window.libraryRequests === 1)
            await new Promise((resolve) => {
              window.finishLibrary = resolve;
            });
          return {
            total: 205,
            rows: Array.from(
              { length: Math.min(100, 205 - args.offset) },
              (_, i) => ({
                id: `n${args.offset + i}`,
                title: `Research notebook ${args.offset + i + 1}`,
                kind: "note",
                updated_at: Date.now() - i * 86400000,
                created_at: null,
              }),
            ),
          };
        }
        throw Error(`Unexpected command ${cmd}`);
      },
    };
  });
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.locator(".sidebar").getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.getByRole("status", { name: "Loading notebooks" }).waitFor();
  await page.waitForFunction(() => !!window.finishLibrary);
  assert.equal(await page.locator(".library-skeleton-row").count(), 6);
  await page.screenshot({ path: "test-results/library-skeleton.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".library-skeleton")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.evaluate(() => window.finishLibrary());
  await page.getByText("Research notebook 1", { exact: true }).waitFor();
  assert.equal(await page.locator(".library-skeleton").count(), 0);
  assert.equal(
    await page.getByLabel("Save now / retry", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByLabel("Document actions", { exact: true }).count(),
    0,
  );
  assert.equal(await page.locator(".library-row").count(), 100);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  assert.equal(await page.locator(".library-grid .library-row").count(), 100);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("knot.library.layout")),
    "grid",
  );
  const cards = page.locator(".library-grid .library-row");
  // Older notebooks share a date group and should sit side by side.
  const a = await cards.nth(20).boundingBox();
  const b = await cards.nth(21).boundingBox();
  assert.ok(a.x !== b.x || a.y !== b.y);
  assert.ok(a.height >= 190);
  await page.screenshot({ path: "test-results/library-grid.png" });
  await page.getByRole("button", { name: "List view", exact: true }).click();
  assert.equal(await page.locator(".library-grid").count(), 0);
  const requests = await page.evaluate(() => window.libraryRequests);
  const star = page.locator(".library-favorite").first();
  const sidebar = await page.locator(".sidebar").elementHandle();
  const disabledControls = await page
    .locator(".sidebar button:disabled")
    .count();
  await star.click({ force: true });
  await page.waitForFunction(() => !!window.finishFavorite);
  assert.equal(
    await page.locator(".app-shell").getAttribute("aria-busy"),
    "false",
  );
  assert.equal(
    await page.locator(".sidebar button:disabled").count(),
    disabledControls,
  );
  assert.equal(await sidebar.evaluate((el) => el.isConnected), true);
  await page.evaluate(() => {
    window.finishFavorite();
    window.finishFavorite = null;
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector(".library-favorite")
        ?.getAttribute("aria-pressed") === "true",
  );
  assert.equal(
    await star.locator("svg").evaluate((icon) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--control-accent)";
      icon.parentElement.append(probe);
      const matches =
        getComputedStyle(icon).color === getComputedStyle(probe).color;
      probe.remove();
      return matches;
    }),
    true,
  );
  await page.screenshot({ path: "test-results/library-star-alignment.png" });
  const starBox = await star.boundingBox();
  const moreBox = await page
    .locator(".library-row .collection-membership-trigger")
    .first()
    .boundingBox();
  assert.ok(
    Math.abs(starBox.y + starBox.height / 2 - moreBox.y - moreBox.height / 2) <
      1,
  );
  await star.click({ force: true });
  await page.waitForFunction(() => !!window.finishFavorite);
  assert.equal(
    await page.locator(".app-shell").getAttribute("aria-busy"),
    "false",
  );
  await page.evaluate(() => {
    window.finishFavorite();
    window.finishFavorite = null;
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector(".library-favorite")
        ?.getAttribute("aria-pressed") === "false",
  );
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.libraryRequests), requests);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Research notebook 101", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Sort notebooks" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Date created" })
    .click();
  await page.getByRole("heading", { name: "Creation date unknown" }).waitFor();
  await page.screenshot({ path: "test-results/library-notebooks.png" });
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await page
    .locator(".library-tabs")
    .getByRole("button", { name: "Collections", exact: true })
    .click();
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Grid view", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: "test-results/library-collections.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/library-collections-dark.png" });
  await page.setViewportSize({ width: 900, height: 700 });
  assert.equal(
    await page
      .locator(".library-page")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: /^Uncollected/ }).click();
  await page
    .getByRole("heading", { name: "Uncollected", exact: true })
    .waitFor();
  const mouseSession = await page.context().newCDPSession(page);
  const sideButton = async (button) => {
    await mouseSession.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button,
      buttons: button === "back" ? 8 : 16,
      x: 700,
      y: 400,
      clickCount: 1,
    });
    await mouseSession.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button,
      buttons: 0,
      x: 700,
      y: 400,
      clickCount: 1,
    });
  };
  await sideButton("back");
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await sideButton("forward");
  await page
    .getByRole("heading", { name: "Uncollected", exact: true })
    .waitFor();
  await sideButton("back");
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Sort notebooks" }).innerText(),
    "Date created",
  );
  console.log(
    "Library browser checks passed: contextual header, bounded rows, pagination, dates, collections, history, preferences.",
  );
} finally {
  await browser.close();
}
