// Real Windows child-webview feasibility test. Uses disposable data, never live notes.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve("test-results/browser-gate-" + Date.now());
await mkdir(root, { recursive: true });
const server = createServer((req, res) => {
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: "/second" });
    res.end();
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<title>Remote fixture</title><h1>${req.url}</h1><a href="/second">Second</a>
    <button onclick="history.pushState({},'', '#same-document')">Same document</button>
    <input aria-label="Remote input"><div style="height:2000px">Reading</div>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const env = {
  ...process.env,
  KNOT_TEST_DATA_DIR: root,
  KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9294",
  KNOT_TEST_REMOTE_ARGS: "--remote-debugging-port=9295",
};
delete env.WEBVIEW2_USER_DATA_FOLDER;
delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env,
});
child.stderr.on("data", (data) => process.stderr.write(data));
child.stdout.on("data", (data) => process.stdout.write(data));
child.on("exit", (code) => console.log("Isolated app exited", code));
let browser, remoteBrowser, shell;
const report = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9294", {
        timeout: 700,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Isolated native app launched");
  shell = browser.contexts()[0].pages()[0];
  await shell.waitForSelector("affine-paragraph", { timeout: 60000 });
  const invoke = (cmd, args) =>
    shell.evaluate(
      ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
      { cmd, args },
    );
  const bounds = { x: 650, y: 150, width: 450, height: 400 };
  await shell.evaluate(() =>
    localStorage.setItem("browser-isolation-secret", "private-shell"),
  );
  await invoke("browser_create", { url: url + "/first", bounds });
  remoteBrowser = await chromium.connectOverCDP("http://127.0.0.1:9295");
  let remote;
  for (let i = 0; i < 100; i++) {
    const contexts = remoteBrowser.contexts();
    remote = contexts
      .flatMap((c) => c.pages())
      .find((p) => p !== shell && p.url().startsWith(url));
    if (remote) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(remote, "A real native child loaded the fixture");
  await remote.waitForSelector("h1");
  assert.equal(await remote.title(), "Remote fixture");
  report.push(
    "PASS native child creation in the existing main window and live remote document",
  );
  const boundary = await remote.evaluate(async () => {
    const results = {};
    for (const cmd of [
      "list_objects",
      "create_object",
      "ai_connected",
      "web_sources_fetch",
      "web_sources_cancel",
      "get_blob",
      "browser_dispose",
      "plugin:window|close",
      "plugin:event|listen",
    ]) {
      try {
        await window.__TAURI_INTERNALS__.invoke(cmd, {
          kind: "note",
          id: "test",
          name: "private-event",
          target: { kind: "Any" },
          handler: 999,
        });
        results[cmd] = "ALLOWED";
      } catch (e) {
        results[cmd] = String(e);
      }
    }
    for (const target of [
      "http://tauri.localhost/",
      "http://tauri.localhost/assets/missing",
      "tauri://localhost/",
    ]) {
      try {
        const response = await fetch(target);
        results[target] =
          `${response.status}:${(await response.text()).slice(0, 80)}`;
      } catch (e) {
        results[target] = String(e);
      }
    }
    return results;
  });
  for (const [key, value] of Object.entries(boundary)) {
    assert.notEqual(value, "ALLOWED", `${key} denied`);
    assert.ok(!value.includes("<html"), `${key} does not expose shell assets`);
  }
  report.push(
    "PASS representative read/write/AI/browser/core commands denied and app assets inaccessible",
    JSON.stringify(boundary),
  );
  await remote.getByRole("link", { name: "Second" }).click();
  await remote.waitForURL(url + "/second");
  await remote.getByRole("button", { name: "Same document" }).click();
  await remote.goBack();
  assert.equal(remote.url(), url + "/second");
  await remote.goBack();
  assert.equal(remote.url(), url + "/first");
  report.push("PASS native history includes same-document navigation");
  await remote.evaluate(() => {
    localStorage.setItem("remote-session", "retained");
    document.cookie = "session=remote; SameSite=Lax";
    scrollTo(0, 500);
  });
  await invoke("browser_bounds", { bounds, visible: false });
  await invoke("browser_bounds", {
    bounds,
    visible: true,
  });
  assert.equal(
    await remote.evaluate(() => localStorage.getItem("remote-session")),
    "retained",
  );
  assert.ok(Math.abs((await remote.evaluate(() => scrollY)) - 500) < 1);
  await invoke("browser_bounds", {
    bounds: { x: 500, y: 100, width: 600, height: 450 },
    visible: true,
  });
  report.push("PASS hide/show and resize retain remote scroll and storage");
  await remote.evaluate(() => (location.href = "http://tauri.localhost/"));
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(remote.url().startsWith(url), "Privileged navigation blocked");
  await invoke("browser_dispose");
  await remoteBrowser.close();
  remoteBrowser = null;
  await new Promise((r) => setTimeout(r, 500));
  await invoke("browser_create", { url: url + "/first", bounds });
  for (let i = 0; i < 100; i++) {
    try {
      remoteBrowser ??= await chromium.connectOverCDP("http://127.0.0.1:9295");
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    remote = remoteBrowser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p !== shell && p.url().startsWith(url));
    if (remote && !remote.isClosed()) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await remote.waitForSelector("h1");
  assert.equal(
    await remote.evaluate(() => localStorage.getItem("remote-session")),
    null,
  );
  assert.equal(await remote.evaluate(() => document.cookie), "");
  report.push("PASS recreated session does not retain cookies or localStorage");
  console.log(report.join("\n"));
  if (process.env.KNOT_GATE_INSPECT) {
    console.log("READY FOR NATIVE INSPECTION");
    await new Promise((r) => setTimeout(r, 45000));
  }
} finally {
  await writeFile(path.join(root, "report.txt"), report.join("\n"));
  if (shell && !shell.isClosed())
    await shell
      .evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close"))
      .catch(() => {});
  await browser?.close();
  await remoteBrowser?.close().catch(() => {});
  server.close();
  console.log("TEST WORKSPACE " + root);
  child.unref();
}
