// Public smoke test for the rendered website fallback (needs network).
// Runs the real native fetch + hidden WebView2 render through the actual
// coordinator in an isolated debug app; no AI calls are made.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve("test-results/web-render-" + Date.now());
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9298",
  },
});
let browser;
try {
  for (let i = 0; i < 400 && !browser; i++)
    browser = await chromium
      .connectOverCDP("http://127.0.0.1:9298")
      .catch(() => new Promise((r) => setTimeout(r, 200)));
  assert.ok(browser, "Native app did not start");
  const page = browser.contexts()[0].pages()[0];
  // The shell only needs to be loaded; no workspace content is used.
  await page.waitForFunction(
    () => document.readyState === "complete" && window.__TAURI_INTERNALS__,
    null,
    { timeout: 90000 },
  );
  // The dev server compiles the extraction worker on first use, which can
  // exceed its 3-second deadline; warm it up first.
  await page.evaluate(async () => {
    const { extractInWorker } = await import("/src/services/web-sources.ts");
    for (let i = 0; i < 10; i++)
      try {
        await extractInWorker("<p>warm up text</p>", "text/html", new AbortController().signal);
        return;
      } catch {
        /* still compiling */
      }
  });
  const capture = (urls) =>
    page.evaluate(async (urls) => {
      const { WebSourceCoordinator } =
        await import("/src/services/web-sources.ts");
      const coordinator = new WebSourceCoordinator();
      const last = {};
      const started = performance.now();
      await coordinator.capture(
        "web-render-test",
        urls.map((url, i) => ({ id: "s" + i, url, state: "queued" })),
        (a) => (last[a.id] = a),
      );
      return {
        ms: Math.round(performance.now() - started),
        results: Object.values(last).map((a) => ({
          url: a.url,
          state: a.state,
          reason: a.reason,
          method: a.capture?.method,
          title: a.capture?.title,
          text: a.capture?.sections.map((s) => s.text).join("\n") ?? "",
        })),
      };
    }, urls);

  const { ms, results } = await capture([
    "https://hn.algolia.com/",
    "https://docsify.js.org/#/quickstart",
    "https://example.com/",
  ]);
  console.log(`batch took ${ms} ms`);
  for (const r of results)
    console.log(r.url, r.state, r.method, r.reason ?? "", JSON.stringify(r.text.slice(0, 120)));
  const [react, hash, plain] = results;
  assert.ok(["ready", "partial"].includes(react.state), react.reason);
  assert.match(react.method, /^rendered-/);
  assert.ok(react.text.length > 500, "rendered app has its content");
  assert.ok(["ready", "partial"].includes(hash.state), hash.reason);
  assert.match(hash.method, /^rendered-/);
  assert.match(hash.text, /docsify-cli|Quick start/i);
  assert.ok(["ready", "partial"].includes(plain.state), plain.reason);
  assert.doesNotMatch(plain.method, /^rendered-/, "plain pages skip rendering");

  // Only the shell remains: hidden capture pages are closed.
  const targets = await (await fetch("http://127.0.0.1:9298/json")).json();
  assert.equal(
    targets.filter((t) => t.type === "page" && /algolia|docsify/.test(t.url)).length,
    0,
  );
  // Stop mid-render: the capture is cancelled, not left running.
  const stopped = await page.evaluate(async () => {
    const { WebSourceCoordinator } = await import("/src/services/web-sources.ts");
    const coordinator = new WebSourceCoordinator();
    const last = {};
    const run = coordinator
      .capture("web-render-test", [{ id: "x", url: "https://docsify.js.org/#/configuration", state: "queued" }], (a) => (last.x = a))
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    coordinator.cancel();
    await run;
    return last.x.state;
  });
  assert.equal(stopped, "cancelled");
  await new Promise((r) => setTimeout(r, 4000));
  const left = (await readdir(os.tmpdir())).filter((n) => n.startsWith("knot-capture-"));
  console.log("capture profiles left in temp:", left.length);
  console.log("PASS rendered fallback: JS app, hash route, plain page skipped, stop, views closed");
} finally {
  await browser?.close().catch(() => {});
  child.kill();
}
