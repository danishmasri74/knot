import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
  });
  await page.goto("http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  await page.evaluate(async () => {
    const React = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } =
      await import("/node_modules/.vite/deps/react-dom_client.js");
    const { AddNotePicker } = await import("/src/app/AddNotePicker.tsx");
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === "filter_objects")
          return [
            { id: "research", title: "Research", kind: "note", updated_at: 0 },
            { id: "plans", title: "Plans", kind: "note", updated_at: 0 },
          ];
        throw Error(cmd);
      },
    };
    const host = document.createElement("div");
    host.id = "picker-test";
    host.style.cssText =
      "position:fixed;inset:50px;background:var(--affine-background-primary-color);z-index:10;padding:20px";
    document.body.append(host);
    ReactDOM.createRoot(host).render(
      React.default.createElement(AddNotePicker, {
        busy: false,
        onChoose: async (row) => {
          window.chosen = row.id;
        },
        onCreate: async (name) => {
          window.created = name;
        },
      }),
    );
  });
  const trigger = page
    .locator("#picker-test")
    .getByRole("button", { name: "Add note", exact: true });
  await trigger.click();
  const search = page.getByLabel("Add a note to…", { exact: true });
  await search.fill("Research");
  await page.getByRole("button", { name: "Research", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Plans", exact: true }).count(),
    0,
  );
  await page.screenshot({ path: "test-results/add-note-picker.png" });
  await search.press("Enter");
  assert.equal(await page.evaluate(() => window.chosen), "research");
  await trigger.click();
  await search.fill("missing");
  await page.getByText("No matching notebooks.").waitFor();
  await page
    .getByRole("dialog", { name: "Add note" })
    .getByRole("button", { name: "New notebook…", exact: true })
    .click();
  await page.getByLabel("New notebook name").fill("Fresh notebook");
  await page.getByLabel("New notebook name").press("Enter");
  assert.equal(await page.evaluate(() => window.created), "Fresh notebook");
  await trigger.click();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("dialog", { name: "Add note", exact: true }).count(),
    0,
  );
  await trigger.click();
  await page.evaluate(() => {
    const outside = document.createElement("div");
    outside.id = "intercepting-canvas";
    outside.style.cssText =
      "position:fixed;bottom:20px;right:20px;width:80px;height:80px;z-index:9999";
    outside.addEventListener("pointerdown", (event) => event.stopPropagation());
    document.body.append(outside);
  });
  await page.locator("#intercepting-canvas").click();
  assert.equal(
    await page.getByRole("dialog", { name: "Add note", exact: true }).count(),
    0,
  );
  await trigger.click();
  await page.getByLabel("Add a note to…", { exact: true }).click();
  assert.equal(
    await page.getByRole("dialog", { name: "Add note", exact: true }).count(),
    1,
  );
  console.log(
    "PASS notebook picker filtering, selection, creation, and Escape dismissal",
  );
} finally {
  await browser.close();
}
