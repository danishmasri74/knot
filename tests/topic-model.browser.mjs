import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  page.on("console", (m) => console.log(m.type(), m.text().slice(0, 500)));
  await page.goto("http://127.0.0.1:1420", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector(".app-shell");
  await page.waitForTimeout(3000);
  const result = await page.evaluate(async () => {
    const worker = new Worker("/src/services/topic.worker.ts", {
      type: "module",
    });
    let next = 0;
    const call = (query, passage = false) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        worker.onmessage = (e) =>
          e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
        worker.onerror = (e) => reject(Error(e.message));
        worker.postMessage(
          passage
            ? {
                id,
                type: "passages",
                passages: [
                  {
                    document: "x",
                    id: "b",
                    title: "",
                    text: query,
                    revision: "r",
                    vector: [],
                  },
                ],
              }
            : { id, type: "query", query },
        );
      });
    const start = performance.now();
    const a = await call("How can I remember material for longer?");
    const first = performance.now() - start;
    const b = (
      await call(
        "Reviewing at increasing intervals improves durable recall.",
        true,
      )
    )[0].vector;
    const c = (
      await call("The engine uses a copper heat sink and two fans.", true)
    )[0].vector;
    const dot = (x, y) => x.reduce((n, v, i) => n + v * y[i], 0);
    worker.terminate();
    return {
      first,
      dimensions: a.length,
      paraphrase: dot(a, b),
      unrelated: dot(a, c),
    };
  });
  console.log(JSON.stringify(result));
  assert.equal(result.dimensions, 384);
  assert(result.paraphrase > result.unrelated + 0.03);
} finally {
  await browser.close();
}
