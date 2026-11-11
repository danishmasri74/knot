import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createNotebook } from "./create-notebook.mjs";
import { DatabaseSync } from "node:sqlite";

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
let certificateRequests = 0;
const secureServer = createSecureServer(
  {
    key: await readFile("tests/fixtures/browser-test-key.pem"),
    cert: await readFile("tests/fixtures/browser-test-cert.pem"),
  },
  (_req, res) => {
    certificateRequests++;
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
const report = [];
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
  const before = await snapshot();
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
  await remote.getByRole("link", { name: "Second", exact: true }).click();
  await remote.waitForURL(origin + "/second");
  await eventually(
    () => button("Browser back").isEnabled(),
    "Native Back enabled",
  );
  await button("Browser back").click();
  await remote.waitForURL(origin + "/first");
  await eventually(
    () => button("Browser forward").isEnabled(),
    "Native Forward enabled",
  );
  await button("Browser forward").click();
  await remote.waitForURL(origin + "/second");
  await remote.getByRole("button", { name: "Same document" }).click();
  await eventually(
    async () => (await invoke("browser_status")).url.endsWith("#same-document"),
    "Native same-document URL observable",
  );
  await button("Browser back").click();
  await remote.waitForURL(origin + "/second");
  const input = shell.getByRole("textbox", { name: "Web address" });
  await input.fill("javascript:alert(1)");
  await input.press("Enter");
  await shell.getByRole("alert").filter({ hasText: "HTTP or HTTPS" }).waitFor();
  assert.equal(remote.url(), origin + "/second");
  await input.fill(origin + "/redirect");
  await input.press("Enter");
  await remote.waitForURL(origin + "/second");
  await eventually(
    async () => (await input.inputValue()) === origin + "/second",
    "Address reflects redirect",
  );
  assert.equal(await snapshot(), before, "Browsing preserves document blocks");
  assert.equal(
    await shell.evaluate(
      () =>
        window.browserTestEditor ===
        document.querySelector("affine-editor-container"),
    ),
    true,
    "Editor stays mounted",
  );
  report.push(
    "PASS Page bookmark activation, native history/same-document/redirects, invalid URL retention, mounted editor and document continuity",
  );
  await remote.evaluate(() => scrollTo(0, 650));
  await shell.getByLabel("Document actions", { exact: true }).click();
  await eventually(
    async () =>
      !(await probe()).browser.visible && (await probe()).browser.muted,
    "Menu hides and mutes native view",
  );
  await button("PDF reader").click();
  await shell
    .getByText("Attach a PDF to this document first.", { exact: true })
    .waitFor();
  assert.equal((await probe()).browser.visible, false);
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("Browser").click();
  await geometry("Resumed browser");
  assert.equal((await invoke("browser_status")).session, session);
  assert.ok(
    Math.abs((await remote.evaluate(() => scrollY)) - 650) < 1,
    "Scroll retained within one CSS pixel at the current Windows scale",
  );
  await button("Expand browser").click();
  await geometry("Expanded");
  assert.equal(await shell.locator(".editor-area").isVisible(), false);
  await button("Restore browser split").click();
  await geometry("Restored");
  assert.equal(await snapshot(), before);
  report.push(
    "PASS tool-slot hide/mute, PDF switching, resume scroll/history, expansion and restoration",
  );
  await invoke("browser_test_window", {
    action: "size",
    width: 760,
    height: 540,
  });
  await geometry("760 x 540");
  const narrow = await shell.locator(".workspace-panes").boundingBox();
  const main = await shell.locator("main").boundingBox();
  assert.ok(
    Math.abs(narrow.width - main.width) < 2,
    "Explicit single pane at minimum window size",
  );
  for (const name of [
    "Browser back",
    "Browser forward",
    "Reload page",
    "Open in default browser",
    "Close Browser tab",
  ]) {
    const box = await button(name).boundingBox();
    assert.ok(
      box && box.x >= 0 && box.x + box.width <= 760,
      `${name} fits minimum window`,
    );
  }
  await invoke("browser_test_window", {
    action: "size",
    width: 1280,
    height: 850,
  });
  await invoke("browser_test_window", { action: "move" });
  await geometry("Moved and restored size");
  await invoke("browser_test_window", { action: "minimize" });
  await wait(300);
  await invoke("browser_test_window", { action: "restore" });
  await geometry("Unminimized");
  report.push(
    "PASS actual native-window minimum size, move, resize, minimize and restore",
  );
  await button("Close Browser tab").click();
  await button("Canvas").click();
  await ready();
  const canvasViewport = () =>
    shell.evaluate(() => {
      const viewport = document.querySelector("affine-edgeless-root").service
        .viewport;
      return {
        x: viewport.center.x,
        y: viewport.center.y,
        zoom: viewport.zoom,
      };
    });
  await shell.evaluate(() =>
    document
      .querySelector("affine-edgeless-root")
      .service.viewport.setViewport(0.8, [240, 180]),
  );
  const canvasBefore = await canvasViewport();
  // Canvas owns pointer selection; activate the card's explicit Open action
  // after it mounts rather than forcing a pointer into a transformed note.
  await shell
    .locator(".affine-bookmark-content-url")
    .evaluate((element) => element.click());
  await geometry("Canvas split");
  const canvasSplit = await canvasViewport();
  for (const key of ["x", "y", "zoom"])
    assert.ok(
      Math.abs(canvasSplit[key] - canvasBefore[key]) < 0.001,
      `Canvas ${key} retained while opening browser`,
    );
  await button("Close Browser tab").click();
  const canvasClosed = await canvasViewport();
  for (const key of ["x", "y", "zoom"])
    assert.ok(
      Math.abs(canvasClosed[key] - canvasBefore[key]) < 0.001,
      `Canvas ${key} retained while closing browser`,
    );
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("Browser").click();
  await geometry("Canvas browser resumed");
  assert.equal((await invoke("browser_status")).session, session);
  report.push("PASS Canvas bookmark uses the same native browser session");
  await shell.locator(".notebook-contents button").nth(1).click();
  await ready();
  await geometry("Note navigation retains browser");
  assert.equal((await invoke("browser_status")).session, session);
  report.push("PASS note navigation retains the open browser and its session");
  const routedPage = remote.url();
  await shell.evaluate(() =>
    window.open("https://knot.invalid/unsupported-internal-route", "_blank"),
  );
  await shell
    .locator(".error-banner")
    .filter({ hasText: "internal link" })
    .waitFor();
  assert.equal(
    remote.url(),
    routedPage,
    "Reserved internal URLs never reach the remote browser",
  );
  await button("Dismiss").click();
  await shell.evaluate(() => {
    const documentId = document.querySelector("affine-editor-container").doc.id;
    const href =
      "https://knot.invalid/pdf#" +
      encodeURIComponent(
        JSON.stringify({
          key: "missing-native-test-pdf",
          name: "Fixture.pdf",
          documentId,
          page: 1,
          rects: [],
        }),
      );
    window.open(href, "_blank");
  });
  await button("Close PDF reader tab").waitFor();
  await eventually(
    async () => !(await probe()).browser.visible,
    "PDF source action uses the existing PDF slot",
  );
  assert.equal(remote.url(), routedPage);
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("Browser").click();
  await geometry("Browser after internal PDF route");
  report.push(
    "PASS reserved/malformed internal URLs stay internal and PDF source URLs use the PDF reader",
  );
  await button("Settings").click();
  await shell
    .getByRole("combobox", { name: "Open web links in" })
    .selectOption("external");
  await button("Close Settings panel").click();
  await shell
    .locator(".affine-bookmark-content-url")
    .evaluate((element) => element.click());
  await eventually(async () => {
    try {
      return (
        (
          await readFile(path.join(root, "external-opens.txt"), "utf8")
        ).trim() ===
        origin + "/first"
      );
    } catch {
      return false;
    }
  }, "Preference routes one explicit Open action through native external opener");
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("Browser").click();
  await button("Open in default browser").click();
  await eventually(
    async () =>
      (await readFile(path.join(root, "external-opens.txt"), "utf8"))
        .trim()
        .split("\n").length === 2,
    "Explicit external opener dispatches once",
  );
  await button("Settings").click();
  await shell
    .getByRole("combobox", { name: "Open web links in" })
    .selectOption("knot");
  await button("Close Settings panel").click();
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("Browser").click();
  report.push(
    "PASS preference and explicit external action dispatch exactly once (debug sink isolates the system browser)",
  );
  await invoke("browser_navigate", { url: origin + "/slow" });
  await button("Stop loading page").waitFor();
  await button("Stop loading page").click();
  await eventually(
    async () => !(await invoke("browser_status")).loading,
    "Stop cancels native loading",
  );
  assert.equal((await invoke("browser_status")).error, null);
  await invoke("browser_navigate", { url: origin + "/disconnect" });
  await eventually(
    async () => !!(await invoke("browser_status")).error,
    "Network errors are observable",
  );
  await invoke("browser_navigate", {
    url: `https://127.0.0.1:${secureServer.address().port}/`,
  });
  await eventually(
    async () => !!(await invoke("browser_status")).error,
    "Untrusted certificate is rejected",
  );
  assert.equal(
    certificateRequests,
    0,
    "No HTTP document fetched through the untrusted certificate",
  );
  await invoke("browser_navigate", { url: origin + "/first" });
  await remote.waitForURL(origin + "/first");
  report.push(
    "PASS Stop, network failure, and self-signed certificate rejection without a bypass",
  );
  await remote.evaluate(() => {
    document.querySelector("input[type=file]").click();
  });
  await eventually(
    async () =>
      (await invoke("browser_status")).error?.includes("File uploads"),
    "File input blocked with fallback",
  );
  assert.equal(
    await remote.evaluate(() => {
      try {
        document.querySelector("input[type=file]").showPicker();
        return false;
      } catch (e) {
        return e.name === "NotAllowedError";
      }
    }),
    true,
  );
  await invoke("browser_navigate", { url: origin + "/download" });
  await eventually(
    async () => (await invoke("browser_status")).error?.includes("Downloads"),
    "Download denied with fallback",
  );
  assert.equal(
    (await invoke("browser_status")).externalUrl,
    origin + "/download",
    "External fallback targets the rejected download, not the old page",
  );
  await shell
    .locator(".browser-error")
    .filter({ hasText: "Downloads are unavailable" })
    .waitFor();
  await button("Open in default browser").click();
  await eventually(
    async () =>
      (await readFile(path.join(root, "external-opens.txt"), "utf8"))
        .trim()
        .split("\n")
        .at(-1) ===
      origin + "/download",
    "Download fallback dispatches the rejected file URL",
  );
  await invoke("browser_navigate", { url: origin + "/first" });
  await remote.waitForURL(origin + "/first");
  await remote.getByRole("link", { name: "New window link" }).click();
  await remote.waitForURL(origin + "/popup");
  await wait(5500); // Let the preceding genuine click's activation expire.
  const popupSession = await remote.context().newCDPSession(remote);
  await popupSession.send("Runtime.evaluate", {
    expression: "window.open('/unsolicited')",
    userGesture: false,
  });
  await wait(300);
  assert.equal(remote.url(), origin + "/popup");
  assert.equal(remoteBrowser.contexts().flatMap((c) => c.pages()).length, 1);
  report.push(
    "PASS user new-window links stay in panel, unsolicited popup suppression, file picker and downloads fallback",
  );
  if (process.env.KNOT_BROWSER_PUBLIC_SMOKE) {
    for (const [category, url] of [
      ["article", "https://en.wikipedia.org/wiki/Hypertext"],
      ["documentation", "https://developer.mozilla.org/en-US/docs/Web/HTTP"],
      ["video", "https://www.youtube.com/watch?v=jNQXAC9IVRw"],
      ["login page (no authentication)", "https://github.com/login"],
      ["expired certificate", "https://expired.badssl.com/"],
    ]) {
      await invoke("browser_navigate", { url });
      await wait(1000);
      for (let i = 0; i < 75; i++) {
        if (!(await invoke("browser_status")).loading) break;
        await wait(200);
      }
      const result = await invoke("browser_status");
      report.push(`PUBLIC SMOKE ${category}: ${JSON.stringify(result)}`);
      console.log(report.at(-1));
      if (result.loading) await invoke("browser_action", { action: "stop" });
    }
    await invoke("browser_navigate", { url: origin + "/popup" });
    await remote.waitForURL(origin + "/popup");
  }
  if (process.env.KNOT_BROWSER_INSPECT) {
    console.log("READY FOR NATIVE BROWSER INSPECTION");
    await wait(55000);
  }
  await button("Save now / retry").click();
  await shell.reload();
  await shell.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
  assert.equal(
    await shell.locator(".browser-panel").count(),
    0,
    "Reloading the shell does not auto-open a page",
  );
  await eventually(
    async () =>
      !(await probe()).browser.visible && (await probe()).browser.muted,
    "Reloaded shell cannot be obstructed by a native sibling",
  );
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("Browser").click();
  await geometry("Browser after shell reload");
  assert.equal((await invoke("browser_status")).session, session);
  report.push(
    "PASS trusted shell reload hides/mutes native content until explicitly reopened",
  );
  await createNotebook(shell);
  await geometry("Notebook navigation retains browser");
  assert.equal((await invoke("browser_status")).session, session);
  report.push("PASS notebook navigation preserves the browser session");
  await assert.rejects(
    invoke("switch_workspace", { id: "invalid-workspace-test" }),
  );
  assert.equal(
    (await invoke("browser_status")).session,
    session,
    "Failed workspace switch preserves browser",
  );
  const catalog = await invoke("workspace_catalog");
  await invoke("switch_workspace", { id: catalog.active });
  assert.equal(
    await invoke("browser_status"),
    null,
    "Successful workspace transition disposes browser",
  );
  await assert.rejects(
    access(path.join(os.tmpdir(), `knot-browser-${session}`)),
    "Temporary profile removed after shutdown",
  );
  report.push(
    "PASS failed workspace transition retains session; successful transition closes child and removes profile",
  );
  const cleanupSession = await invoke("browser_create", {
    url: origin + "/first",
    bounds: { x: 700, y: 250, width: 400, height: 350 },
  });
  const cleanupProfile = path.join(
    os.tmpdir(),
    `knot-browser-${cleanupSession}`,
  );
  // SQLite's Windows handle denies deletion until close: exercise a real cache
  // cleanup failure without granting remote content any filesystem access.
  const cacheLock = new DatabaseSync(
    path.join(cleanupProfile, "locked-native-test.sqlite"),
  );
  try {
    cacheLock.exec("CREATE TABLE fixture(value TEXT)");
    const backup = await invoke("create_backup");
    const oldWorkspace = (await invoke("workspace_catalog")).active;
    await invoke("restore_managed_backup", { id: backup });
    assert.notEqual(
      (await invoke("workspace_catalog")).active,
      oldWorkspace,
      "Completed transition stays successful despite cache cleanup failure",
    );
    assert.equal(
      await invoke("browser_status"),
      null,
      "Closed page metadata never leaks into the next workspace",
    );
  } finally {
    cacheLock.close();
  }
  await invoke("browser_dispose");
  await assert.rejects(access(cleanupProfile));
  report.push(
    "PASS locked-cache warning cannot turn a committed workspace change into a failed transition; cleanup retries after handle release",
  );
  console.log(report.join("\n"));
} finally {
  await writeFile(path.join(root, "report.txt"), report.join("\n"));
  if (shell && !shell.isClosed())
    await invoke("plugin:window|close").catch(() => {});
  await browser?.close();
  await remoteBrowser?.close().catch(() => {});
  server.close();
  secureServer.close();
  child.unref();
  console.log("TEST WORKSPACE " + root);
}
