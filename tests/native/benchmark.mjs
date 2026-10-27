// Run against the isolated native test app, never a normal user workspace.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const { root, port } = JSON.parse(
  readFileSync("test-results/current-native.json"),
);
const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const p = b.contexts()[0].pages()[0];
try {
  await p.getByRole("button", { name: "New whiteboard" }).click();
  await p.waitForSelector("affine-edgeless-root");
  const result = await p.evaluate(async () => {
    const d = document.querySelector("affine-editor-container").doc;
    const s = d.getBlocksByFlavour("affine:surface")[0].model;
    const start = performance.now();
    d.transact(() => {
      for (let i = 0; i < 500; i++)
        s.addElement({
          type: "shape",
          shapeType: "rect",
          xywh: JSON.stringify([
            (i % 25) * 24,
            Math.floor(i / 25) * 24,
            20,
            20,
          ]),
          fillColor: "#b8d4be",
          strokeColor: "#456854",
        });
    });
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    return {
      elements: s.getElementsByType("shape").length,
      insertAndTwoFramesMs: performance.now() - start,
    };
  });
  assert.equal(result.elements, 500);
  await p.getByTitle("Save now / retry").click();
  await p.waitForFunction(() =>
    document.querySelector(".save-status").textContent.includes("Saved"),
  );
  await p.screenshot({ path: path.join(root, "canvas-500.png") });
  const start = Date.now();
  await p.getByRole("button", { name: "Welcome to Knot" }).click();
  await p.waitForSelector("affine-paragraph");
  result.documentSwitchMs = Date.now() - start;
  console.log(JSON.stringify(result));
  writeFileSync(
    path.join(root, "benchmark.json"),
    JSON.stringify(result, null, 2),
  );
} finally {
  await b.close();
}
