// A column's + menu: Note drills into the notebook's notes (the menu stays
// open, a filter appears for long lists, the current note is marked) and
// opens the chosen one; reopening starts from the main list. Settings →
// Editor: the blank-card cleanup toggle reveals its frequency slider.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  await page.evaluate(async () => {
    const ReactModule = await import("/node_modules/.vite/deps/react.js");
    const React = ReactModule.default ?? ReactModule;
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ShellMenu } = await import("/src/app/ShellMenu.tsx");
    const { ShellIcon } = await import("/src/app/ShellIcon.tsx");
    const { ColumnTabMenu } = await import("/src/app/ColumnTabMenu.tsx");
    const { EditorSettings } = await import("/src/app/EditorSettings.tsx");
    try {
      localStorage.removeItem("knot.editor-preferences");
    } catch {}
    window.__opened = [];
    const notes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, title: `Note about topic ${i}` }));
    const host = document.createElement("div");
    host.id = "column-test";
    host.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:#1e1e1e;padding:20px 20px 20px 520px;overflow:auto";
    document.body.append(host);
    const h = React.createElement;
    ReactDOM.createRoot(host).render(
      h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "pane-header", style: { position: "relative", display: "flex", justifyContent: "flex-end" } },
          h(
            ShellMenu,
            { label: "New tab", icon: h(ShellIcon, { name: "plus" }), className: "pane-new-tab" },
            h(ColumnTabMenu, {
              items: [
                { name: "Canvas", icon: "board", run: () => window.__opened.push("canvas") },
                { name: "Browser", icon: "globe", run: () => window.__opened.push("browser") },
              ],
              notes: () => notes,
              suggested: () => "n3",
              openNote: (id) => window.__opened.push(id),
              disabled: false,
            }),
          ),
        ),
        h("div", { style: { marginTop: 520, width: 640 } }, h(EditorSettings)),
      ),
    );
  });
  const menuOpen = () => page.$eval("#column-test .pane-new-tab", (d) => d.open);
  const rows = () =>
    page.$$eval("#column-test .pane-new-tab .shell-menu-content button", (b) => b.map((x) => x.textContent.trim()));

  await page.click("#column-test .pane-new-tab summary");
  assert.deepEqual(await rows(), ["Canvas", "Note", "Browser"], "Note stays second");
  await page.click(".column-item-note");
  assert.equal(await menuOpen(), true, "Note keeps the menu open");
  const list = await rows();
  assert.equal(list[0], "Open a note");
  assert.equal(list.length, 11, "back row and every note");
  assert.ok(list.includes("Note about topic 3Current"), "the current note is marked");
  await page.screenshot({
    path: process.env.KNOT_SCREENSHOT ?? "test-results/column-note-menu.png",
    clip: { x: 400, y: 0, width: 600, height: 520 },
  }).catch(() => {});
  // Long lists get a filter; Enter opens the first match.
  await page.fill(".column-note-filter", "topic 7");
  assert.deepEqual((await rows()).slice(1), ["Note about topic 7"]);
  await page.press(".column-note-filter", "Enter");
  assert.deepEqual(await page.evaluate(() => window.__opened), ["n7"]);
  assert.equal(await menuOpen(), false, "choosing a note closes the menu");
  // Reopening starts from the main list.
  await page.click("#column-test .pane-new-tab summary");
  assert.deepEqual(await rows(), ["Canvas", "Note", "Browser"]);
  // Back returns to the main list; clicking a note opens it.
  await page.click(".column-item-note");
  await page.click(".column-back");
  assert.equal(await menuOpen(), true);
  assert.deepEqual(await rows(), ["Canvas", "Note", "Browser"]);
  await page.click(".column-item-note");
  await page.click(".column-note >> text=Note about topic 2");
  assert.deepEqual(await page.evaluate(() => window.__opened), ["n7", "n2"]);

  // Settings: the slider appears only with the toggle on.
  const toggle = page.locator('[aria-labelledby="blank-card-cleanup-label"]');
  assert.equal(await toggle.getAttribute("aria-checked"), "false", "off by default");
  assert.equal(await page.locator("#blank-card-cleanup-days").count(), 0);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  assert.equal(await page.textContent('output[for="blank-card-cleanup-days"]'), "1 week");
  await page.locator("#blank-card-cleanup-days").fill("0");
  assert.equal(await page.textContent('output[for="blank-card-cleanup-days"]'), "1 day");
  await page.locator("#blank-card-cleanup-days").fill("4");
  assert.equal(await page.textContent('output[for="blank-card-cleanup-days"]'), "1 month");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("knot.editor-preferences")));
  assert.equal(saved.blankCardCleanup, true);
  assert.equal(saved.blankCardCleanupDays, 30);
  await toggle.click();
  assert.equal(await page.locator("#blank-card-cleanup-days").count(), 0, "off hides the slider");
  await page.evaluate(() => localStorage.removeItem("knot.editor-preferences"));

  assert.deepEqual(errors, []);
  console.log("Column + menu: Note drill-in with filter, current mark, back and reset; cleanup toggle and slider");
} finally {
  await browser.close();
}
