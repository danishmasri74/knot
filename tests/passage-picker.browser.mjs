import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:1420");
  await page.evaluate(async () => {
    const React = await import("/node_modules/.vite/deps/react.js");
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const Y = await import("/node_modules/.vite/deps/yjs.js");
    const { repository } = await import("/src/services/workspace.ts");
    const { PassagePicker } = await import("/src/app/PassagePicker.tsx");
    const source = { id: "closed", title: "Decisions" };
    const envelope = new Y.Doc(),
      body = new Y.Doc();
    envelope.getMap("meta").set("pages", [{ id: source.id }]);
    const root = new Y.Map();
    root.set("sys:flavour", "affine:page");
    root.set("sys:children", Y.Array.from(["decision", "other"]));
    body.getMap("blocks").set("page", root);
    for (const [id, text] of [
      ["decision", "Pilot postponed for training."],
      ["other", "Pilot catering menu."],
    ]) {
      const block = new Y.Map();
      block.set("sys:flavour", "affine:paragraph");
      block.set("prop:text", new Y.Text(text));
      body.getMap("blocks").set(id, block);
    }
    repository.load = async () => ({
      collection: [...Y.encodeStateAsUpdate(envelope)],
      document: [...Y.encodeStateAsUpdate(body)],
    });
    const host = document.body.appendChild(document.createElement("div"));
    createRoot(host).render(
      React.default.createElement(PassagePicker, {
        choices: [source],
        onPick: (p) => (window.selectedPassage = p),
      }),
    );
  });
  await page.getByLabel("Search passages").fill("pilot");
  await page.getByRole("button", { name: /Decisions.*postponed/ }).click();
  const passage = await page.evaluate(() => window.selectedPassage);
  assert.equal(passage.block.id, "decision");
  assert.equal(passage.source.id, "closed");
  assert.ok(!JSON.stringify(passage).includes("catering"));
  console.log(
    "PASS closed notebook passage selection excludes the other matching paragraph",
  );
} finally {
  await browser.close();
}
