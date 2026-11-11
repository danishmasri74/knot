import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import path from "node:path";
import assert from "node:assert/strict";
import { createNotebook } from "./create-notebook.mjs";

const root = path.resolve("test-results/browser-v1-" + Date.now());
await mkdir(root, { recursive: true });
const server = createServer((req, res) => {
  if (req.url === "/disconnect") {
    req.socket.destroy();
    return;
  }
  if (req.url === "/slow") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.write("<title>Slow fixture</title><h1>Still loading</h1>");
    return;
  }
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: "/second" });
    res.end();
    return;
  }
  if (req.url === "/privileged") {
    res.writeHead(302, { Location: "http://tauri.localhost/" });
    res.end();
    return;
  }
  if (req.url === "/download") {
    res.writeHead(200, {
      "Content-Disposition": "attachment; filename=fixture.txt",
    });
    res.end("fixture");
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<title>Fixture ${req.url}</title><h1>${req.url}</h1><a href="/second">Second</a>
    <a href="/popup" target="_blank">New window link</a>
    <button onclick="window.open('/unsolicited')">Popup</button>
    <button onclick="history.pushState({},'', '#same-document')">Same document</button>
    <input aria-label="Remote input"><input type="file" aria-label="Upload file">
    <div style="height:2400px">Reading</div>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const secureServer = createSecureServer(
  {
    key: await readFile("tests/fixtures/browser-test-key.pem"),
    cert: await readFile("tests/fixtures/browser-test-cert.pem"),
  },
  (_req, res) => {
    res.end("A certificate error must prevent this document loading");
  },
);
await new Promise((r) => secureServer.listen(0, "127.0.0.1", r));
const env = {
  ...process.env,
  KNOT_TEST_DATA_DIR: root,
  KNOT_TEST_EXTERNAL_LOG: path.join(root, "external-opens.txt"),
  KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9294",
  KNOT_TEST_REMOTE_ARGS: "--remote-debugging-port=9295",
};
delete env.WEBVIEW2_USER_DATA_FOLDER;
delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stderr.on("data", (data) => process.stderr.write(data));
let browser, remoteBrowser, shell, remote;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(port) {
  for (let i = 0; i < 100; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 700,
      });
    } catch {
      await wait(200);
    }
  }
  throw new Error(`No isolated CDP endpoint ${port}`);
}
const invoke = (cmd, args) =>
  shell.evaluate(
    ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );
const probe = () => invoke("browser_test_window", { action: "inspect" });
async function eventually(test, message) {
  for (let i = 0; i < 100; i++) {
    if (await test()) return;
    await wait(100);
  }
  throw new Error(message);
}
async function geometry(label) {
  await eventually(async () => {
    const expected = await shell.locator(".browser-viewport").evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x * devicePixelRatio,
        y: r.y * devicePixelRatio,
        width: r.width * devicePixelRatio,
        height: r.height * devicePixelRatio,
      };
    });
    const actual = (await probe()).browser;
    return (
      actual?.visible &&
      Object.keys(expected).every((k) => Math.abs(actual[k] - expected[k]) < 2)
    );
  }, `${label}: native rectangle matches trusted placeholder`);
  assert.equal(
    await shell.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `${label}: no horizontal overflow`,
  );
}
async function ready() {
  await shell.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
      "false",
  );
}
const button = (name) => shell.getByRole("button", { name, exact: true });
const snapshot = () =>
  shell.evaluate(() =>
    JSON.stringify(
      document
        .querySelector("affine-editor-container")
        .doc.spaceDoc.getMap("blocks")
        .toJSON(),
    ),
  );
try {
  browser = await connect(9294);
  shell = browser.contexts()[0].pages()[0];
  shell.on("pageerror", (e) => console.log("SHELL ERROR", e.message));
  await shell.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
  await createNotebook(shell);
  await button("Page").click();
  await ready();
  await shell.evaluate((url) => {
    const editor = document.querySelector("affine-editor-container");
    window.browserTestEditor = editor;
    const doc = editor.doc;
    const note = doc.getBlocksByFlavour("affine:note")[0].model;
    doc.addBlock(
      "affine:bookmark",
      {
        url,
        title: "Browser fixture",
        description: "A controlled native test",
      },
      note.id,
    );
  }, origin + "/first");
  await shell.locator(".affine-bookmark-content-url").waitFor();
  await snapshot();
  await shell.locator(".affine-bookmark-content-url").click();
  await shell.getByLabel("Mini browser", { exact: true }).waitFor();
  remoteBrowser = await connect(9295);
  await eventually(async () => {
    remote = remoteBrowser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().startsWith(origin));
    return !!remote;
  }, "Remote document finishes its initial navigation");
  assert.ok(remote, "Native remote page exists");
  await remote.waitForSelector("h1");
  await geometry("Page split");
  await invoke("browser_test_window", { action: "restore" });
  await button("Focus webpage").focus();
  await button("Focus webpage").press("Enter");
  await eventually(
    () => remote.evaluate(() => document.hasFocus()),
    "Trusted keyboard control moves focus into the native page",
  );
  const session = (await invoke("browser_status")).session;
  await shell.evaluate(() =>
    document.documentElement.setAttribute("data-pane-gesture", ""),
  );
  await eventually(
    async () => !(await probe()).browser.visible,
    "Native child hidden throughout gesture",
  );
  await shell.locator(".browser-panel").evaluate((e) => {
    e.style.marginLeft = "60px";
  });
  await shell.evaluate(() =>
    document.documentElement.removeAttribute("data-pane-gesture"),
  );
  await geometry("Moved viewport");
  assert.equal((await invoke("browser_status")).session, session);
  console.log(
    "Native browser movement gate passed: hidden during gesture, updated physical bounds, same session",
  );
} finally {
  if (shell) await invoke("plugin:window|close").catch(() => {});
  await browser?.close();
  await remoteBrowser?.close().catch(() => {});
  server.close();
  secureServer.close();
}
