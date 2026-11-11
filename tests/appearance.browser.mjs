// Run with pnpm dev serving localhost:1420. Uses an in-memory editor only.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://127.0.0.1:1420");
await p.waitForSelector(".app-shell");
await p.evaluate(() => localStorage.setItem("knot.appearance", "dark"));
await p.reload();
await p.waitForSelector(".app-shell");
await p.evaluate(async () => {
  const { DocCollection, Schema, Text } =
    await import("/node_modules/.vite/deps/@blocksuite_store.js");
  const { AffineSchemas } =
    await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
  const { AffineEditorContainer } =
    await import("/node_modules/.vite/deps/@blocksuite_presets.js");
  const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
  c.meta.initialize();
  const d = c.createDoc();
  d.load();
  const root = d.addBlock("affine:page", {
    title: new Text("Theme verification"),
  });
  d.addBlock("affine:surface", {}, root);
  const n = d.addBlock("affine:note", { xywh: "[0,0,500,150]" }, root);
  d.addBlock("affine:paragraph", { text: new Text("Readable note text") }, n);
  const e = new AffineEditorContainer();
  e.doc = d;
  e.mode = "edgeless";
  const host = document.querySelector(".editor-area");
  host.replaceChildren(e);
  document.querySelector(".welcome")?.remove();
});
await p.waitForSelector(".note-background");
await p.waitForTimeout(1000);

async function colors() {
  return p.evaluate(() => ({
    themes: [...document.querySelectorAll("[data-theme]")].map(
      (e) => e.dataset.theme,
    ),
    note: getComputedStyle(document.querySelector(".note-background"))
      .backgroundColor,
    text: getComputedStyle(document.querySelector("affine-paragraph")).color,
    grid: getComputedStyle(document.querySelector(".edgeless-background"))
      .getPropertyValue("--affine-edgeless-grid-color")
      .trim(),
  }));
}
const dark = await colors();
assert.ok(dark.themes.length > 1 && dark.themes.every((t) => t === "dark"));
assert.equal(dark.note, "rgb(48, 48, 48)");
assert.equal(dark.text, "rgb(210, 210, 210)");
assert.equal(dark.grid, "#414141");
assert.equal(
  await p.locator(".edgeless-toolbar-wrapper").getAttribute("data-app-theme"),
  "dark",
);
const snapshot = () =>
  p.evaluate(() =>
    JSON.stringify(
      document
        .querySelector("affine-editor-container")
        .doc.spaceDoc.getMap("blocks")
        .toJSON(),
    ),
  );
const before = await snapshot();
await p.screenshot({ path: "test-results/theme-native/dark-fixed.png" });
await p.evaluate(async () =>
  (await import("/src/services/appearance.ts")).setAppearance("light"),
);
await p.waitForFunction(() =>
  [...document.querySelectorAll("[data-theme]")].every(
    (e) => e.dataset.theme === "light",
  ),
);
assert.equal((await colors()).note, "rgb(255, 255, 255)");
await p.evaluate(() => {
  document.querySelector("affine-editor-container").mode = "page";
});
await p.waitForSelector("affine-page-root");
await p.evaluate(async () =>
  (await import("/src/services/appearance.ts")).setAppearance("dark"),
);
await p.waitForFunction(() =>
  [...document.querySelectorAll("[data-theme]")].every(
    (e) => e.dataset.theme === "dark",
  ),
);
assert.equal(
  await p
    .locator("affine-paragraph")
    .evaluate((e) => getComputedStyle(e).color),
  "rgb(210, 210, 210)",
);
assert.equal(
  await snapshot(),
  before,
  "Theme changes must not alter document content",
);
console.log(
  "PASS saved dark startup, canvas colors, live switching, page text, and unchanged document",
);
await b.close();
