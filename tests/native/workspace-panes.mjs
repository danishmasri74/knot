import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import path from "node:path";
import assert from "node:assert/strict";
import { createNotebook } from "./create-notebook.mjs";

const root = path.resolve("test-results/workspace-panes-" + Date.now());
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

  await invoke("browser_test_window", {
    action: "size",
    width: 1920,
    height: 1080,
  });
  await shell.setViewportSize({ width: 1920, height: 1080 });
  await button("Canvas").click();
  await ready();
  await shell.evaluate(() => {
    const main = document.querySelector(
      ".editor-area > affine-editor-container",
    );
    const doc = main.doc;
    const note = doc.getBlocksByFlavour("affine:note")[0].model;
    note.children[0].text.insert("Chapter two", 0);
    window.paneNoteId = note.id;
    main
      .querySelector("affine-edgeless-root")
      .gfx.selection.set({ elements: [note.id], editing: false });
  });
  await shell.getByLabel("Open in side panel", { exact: true }).waitFor();
  assert.equal(
    await shell.getByLabel("Open in side panel", { exact: true }).count(),
    1,
  );
  await shell.getByLabel("Open in side panel", { exact: true }).click();
  await shell.locator(".note-page-host affine-paragraph").first().waitFor();
  await shell.screenshot({ path: path.join(root, "canvas-page-pane.png") });
  assert.equal(
    await shell.evaluate(
      () =>
        document.querySelector(".note-page-host affine-editor-container")
          .doc ===
        document.querySelector(".editor-area > affine-editor-container").doc,
    ),
    true,
  );
  const input = shell
    .locator('.note-page-host affine-paragraph [contenteditable="true"]')
    .first();
  await input.click();
  await shell.keyboard.press("End");
  await shell.keyboard.type(" edited beside canvas");
  assert.match(
    await shell.evaluate(() =>
      document
        .querySelector(".editor-area > affine-editor-container")
        .doc.getBlock(window.paneNoteId)
        .model.children[0].text.toString(),
    ),
    /edited beside canvas/,
  );
  await shell.keyboard.press("Control+z");
  assert.equal(
    await shell.evaluate(() =>
      document
        .querySelector(".editor-area > affine-editor-container")
        .doc.getBlock(window.paneNoteId)
        .model.children[0].text.toString(),
    ),
    "Chapter two",
  );
  await shell.keyboard.press("Control+Shift+z");
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("Browser").first().click();
  await geometry("Browser tab restored");
  const menu = shell.locator(".pane-menu summary");
  const canvasView = () =>
    shell.evaluate(() => {
      const v = document.querySelector(".editor-area affine-edgeless-root").gfx
        .viewport;
      return { x: v.center.x, y: v.center.y, zoom: v.zoom };
    });
  const beforeSplit = await canvasView();
  await menu.click();
  await button("Show beside current tab").click();
  await geometry("Browser separated to left");
  assert.deepEqual(
    await canvasView(),
    beforeSplit,
    "Splitting preserves the canvas center and zoom",
  );
  assert.equal(await shell.locator(".pane-group").count(), 2);
  await shell.screenshot({ path: path.join(root, "split-browser-note.png") });
  const beforeHosts = await shell.evaluate(() => {
    window.paneHost = document.querySelector(
      ".note-page-host affine-editor-container",
    );
    return window.paneHost.doc.getBlock(window.paneNoteId).model.xywh;
  });
  await shell.locator(".pane-menu summary").first().click();
  await shell.getByRole("button", { name: /Move pane (left|right)/ }).click();
  await geometry("Swapped native browser");
  assert.equal(
    await shell.evaluate(
      () =>
        window.paneHost ===
        document.querySelector(".note-page-host affine-editor-container"),
    ),
    true,
  );
  assert.equal(
    await shell.evaluate(
      () => window.paneHost.doc.getBlock(window.paneNoteId).model.xywh,
    ),
    beforeHosts,
  );
  assert.equal((await invoke("browser_status")).session, session);
  await shell.locator(".pane-menu summary").first().click();
  await shell
    .getByRole("button", { name: /Merge with (left|right) pane/ })
    .click();
  assert.equal(await shell.locator(".pane-group").count(), 1);
  // Native child must stay hidden for the whole tab drag, including before drop.
  const tab = shell.getByRole("tab", { name: "Browser", exact: true });
  const box = await tab.boundingBox();
  await shell.mouse.move(box.x + 10, box.y + 10);
  await shell.mouse.down();
  await shell.mouse.move(box.x + 50, box.y + 40, { steps: 10 });
  await eventually(
    async () => !(await probe()).browser.visible,
    "Native browser hidden during tab drag",
  );
  await shell.keyboard.press("Escape");
  await shell.mouse.up();
  // Reopen the same note through the toolbar; the tab is deduplicated.
  await shell.getByRole("tab", { name: /Chapter two/ }).click();
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 850, height: 640 },
    { width: 760, height: 540 },
  ]) {
    await shell.setViewportSize(size);
    await wait(200);
    assert.equal(
      await shell.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await shell.screenshot({
      path: path.join(root, `panes-${size.width}.png`),
    });
  }
  await button("Back to canvas or page").click();
  await shell.locator(".editor-area").waitFor({ state: "visible" });
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("Browser").first().click();
  await geometry("Narrow Browser restored");
  await shell.setViewportSize({ width: 1920, height: 1080 });
  await shell.getByRole("tab", { name: /Chapter two/ }).click();
  await shell.emulateMedia({ colorScheme: "dark" });
  await wait(100);
  await shell.screenshot({ path: path.join(root, "panes-dark.png") });
  await shell.emulateMedia({ colorScheme: "light" });
  await shell
    .getByRole("button", { name: "Close Browser tab", exact: true })
    .click();
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const fixture = await PDFDocument.create();
  const font = await fixture.embedFont(StandardFonts.Helvetica);
  for (const text of ["Read beside the note", "Second PDF page retained"])
    fixture
      .addPage([600, 800])
      .drawText(text, { x: 40, y: 700, size: 20, font });
  const pdfPath = path.join(root, "pane-reading.pdf");
  await writeFile(pdfPath, await fixture.save());
  await shell.locator('input[type="file"]').setInputFiles(pdfPath);
  await ready();
  await shell.getByLabel("Document actions", { exact: true }).click();
  await button("PDF reader").click();
  await shell
    .locator(".pdf-reader .textLayer span")
    .filter({ hasText: "Read beside the note" })
    .waitFor();
  await shell.evaluate(() => {
    window.readerHost = document.querySelector(".pdf-reader");
  });
  await shell
    .locator('.pdf-page[data-page="2"]')
    .evaluate((e) => e.scrollIntoView());
  const readerScroll = await shell
    .locator(".pdf-scroll")
    .evaluate((e) => e.scrollTop);
  await shell.getByLabel("Pane actions", { exact: true }).click();
  await button("Show beside current tab").click();
  await shell
    .locator(".pdf-reader .textLayer span")
    .filter({ hasText: "Second PDF page retained" })
    .waitFor();
  assert.equal(
    await shell.evaluate(
      () => window.readerHost === document.querySelector(".pdf-reader"),
    ),
    true,
  );
  assert.ok(
    Math.abs(
      (await shell.locator(".pdf-scroll").evaluate((e) => e.scrollTop)) -
        readerScroll,
    ) < 3,
  );
  await shell.screenshot({ path: path.join(root, "canvas-pdf-note.png") });
  await input.click();
  await shell.keyboard.press("End");
  await shell.keyboard.type(" while reading PDF");
  await shell
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
  await ready();
  await shell.locator(".pane-menu summary").first().click();
  await shell
    .getByRole("button", { name: /Merge with (left|right) pane/ })
    .click();
  await shell.getByRole("tab", { name: "PDF reader", exact: true }).click();
  assert.ok(
    Math.abs(
      (await shell.locator(".pdf-scroll").evaluate((e) => e.scrollTop)) -
        readerScroll,
    ) < 3,
  );
  await shell
    .getByRole("button", { name: "Close PDF reader tab", exact: true })
    .click();
  // Ordinary Escape never closes the note.
  await input.click();
  await shell.keyboard.press("Escape");
  assert.equal(await shell.locator(".note-page-host").count(), 1);
  await shell.getByRole("button", { name: /Close Chapter two.* tab/ }).click();
  assert.equal(await shell.locator(".note-page-host").count(), 0);
  assert.ok(
    await shell.evaluate(() =>
      document
        .querySelector(".editor-area > affine-editor-container")
        .doc.getBlock(window.paneNoteId),
    ),
  );
  assert.equal((await invoke("browser_status")).session, session);
  console.log(
    "PASS real PDF beside note with retained reader scroll, native shared editing, single undo, stable hosts, split/swap/merge, native browser geometry and drag visibility, responsive widths, close without deletion",
  );
  console.log("EVIDENCE", root);
} finally {
  if (shell) await invoke("plugin:window|close").catch(() => {});
  await browser?.close();
  await remoteBrowser?.close().catch(() => {});
  server.close();
  secureServer.close();
}
