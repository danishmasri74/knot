import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(process.argv[2]);
const fixture = JSON.parse(
  await readFile(path.join(root, "retrieval.json"), "utf8"),
).fixture;
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9296",
    KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9296",
  },
});
let browser;
try {
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9296");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert(browser);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector(".app-shell", { timeout: 90000 });
  const result = await page.evaluate(async (fixture) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    if (
      (await invoke("list_trash", { search: "", offset: 0 })).some(
        (s) => s.id === fixture.target,
      )
    )
      await invoke("restore_object", { id: fixture.target });
    const script = document.querySelector('script[type="module"]').src;
    const js = await (await fetch(script)).text();
    const filename = js.match(/\/assets\/topic\.worker-[\w-]+\.js/)[0];
    const worker = new Worker(filename, { type: "module" });
    const start = performance.now();
    const vector = await new Promise((resolve, reject) => {
      worker.onmessage = (e) =>
        e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
      worker.onerror = (e) => reject(Error(e.message));
      worker.postMessage({
        id: 1,
        type: "query",
        query: "How can I remember material for longer?",
      });
    });
    const firstUseMs = performance.now() - start;
    let catalog = await invoke("topic_catalog");
    for (let n = 0; n < 180; n++) {
      const pending = await invoke("topic_pending", {
        activation: catalog.activation,
      });
      if (!pending.length) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const report = await invoke("topic_search", {
      activation: catalog.activation,
      query: "How can I remember material for longer?",
      vector,
      omit: [],
    });
    worker.terminate();
    return { origin: location.origin, firstUseMs, report };
  }, fixture);
  await writeFile(
    path.join(root, "packaged.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      origin: result.origin,
      firstUseMs: result.firstUseMs,
      indexed: result.report.indexed,
      total: result.report.total,
      titles: result.report.passages.map((p) => [p.document, p.title]),
    }),
  );
  assert(!result.origin.includes("1420"));
  assert(
    result.report.passages.some((p) =>
      p.text.includes(
        "Reviewing at increasing intervals improves durable recall.",
      ),
    ),
  );
  await writeFile(
    path.join(root, "packaged.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      origin: result.origin,
      firstUseMs: result.firstUseMs,
      semanticFound: true,
      indexed: result.report.indexed,
      total: result.report.total,
    }),
  );
} finally {
  if (child.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${child.pid};if(-not $p.CloseMainWindow()){throw 'Close failed'};if(-not $p.WaitForExit(30000)){throw 'Close did not finish'}`,
      ],
      { windowsHide: true },
    );
  await browser?.close();
}
