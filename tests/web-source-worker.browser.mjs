import { chromium } from "playwright";
import { readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const workerFile = (await readdir("dist/assets")).find((name) =>
  /^web-source-extract\.worker-.*\.js$/.test(name),
);
assert.ok(workerFile, "Production worker was not emitted");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const remote = [];
  page.on("request", (request) => {
    if (request.url().includes("hostile.example")) remote.push(request.url());
  });
  await page.goto("http://127.0.0.1:1421");
  const result = await page.evaluate(async (workerFile) => {
    const worker = new Worker(`/assets/${workerFile}`);
    const output = await new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({
        contentType: "text/html",
        body: '<html><head><title>Production guide</title><link rel="stylesheet" href="https://hostile.example/style"></head><body><main><h1>世界 مرحبا</h1><p>Short evidence.</p><pre>const x = 1</pre><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><script>fetch("https://hostile.example/script")</script><img src="https://hostile.example/image"><iframe src="https://hostile.example/frame"></iframe></main></body></html>',
      });
      setTimeout(() => reject(Error("Worker timed out")), 3000);
    });
    worker.terminate();
    return output;
  }, workerFile);
  assert.equal(result.error, undefined);
  assert.ok(result.result.sections.some((section) => section.kind === "code"));
  assert.ok(result.result.sections.some((section) => section.kind === "table"));
  assert.ok(
    result.result.sections.some((section) => section.text.includes("مرحبا")),
  );
  assert.deepEqual(remote, []);
  console.log(
    "PASS production Vite worker: article structure, code/table/Unicode, no scripts or subresource requests",
  );
} finally {
  await browser.close();
}
