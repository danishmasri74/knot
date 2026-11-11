import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/exports-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9250",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9250");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Native application did not start");
  page = browser.contexts()[0].pages()[0];
  page.on("console", (m) => {
    if (m.type() === "error") console.log("WEB ERROR", m.text());
  });
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
}
async function ready() {
  await page.waitForFunction(
    () => document.querySelector(".primary")?.disabled === false,
  );
}
async function click(name) {
  await clickShellButton(page, name);
  await ready();
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child?.pid)
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  child = null;
}

async function capture(format, name) {
  console.log("CAPTURE", format, name);
  if (!(await page.getByLabel("Export format").isVisible()))
    await click("Export");
  await page.getByLabel("Export format").selectOption(format);
  await click("Save export");
  const result = await page.evaluate(() => window.exportCapture);
  assert.ok(result, await page.locator('[role="alert"]').allTextContents());
  assert.equal(result.format, format);
  for (const file of result.files) {
    const target = path.join(root, name, file.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.bytes));
  }
  await page.evaluate(() => {
    window.exportCapture = null;
  });
  return result.files;
}
try {
  await launch();
  // Capture only the final Save As handoff; rendering and persistence use the real backend.
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).endsWith("/export_document")) {
        if (window.exportBehavior === "cancel")
          return new Response("null", {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "ok",
            },
          });
        if (window.exportBehavior === "fail")
          return new Response(
            JSON.stringify("Export destination unavailable"),
            {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": "error",
              },
            },
          );
        window.exportCapture = JSON.parse(init.body);
        return new Response(JSON.stringify("Captured export for native test"), {
          headers: {
            "Content-Type": "application/json",
            "Tauri-Response": "ok",
          },
        });
      }
      return fetch(input, init);
    };
  });
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Export body with Unicode café.");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await page.getByRole("button", { name: "Save now / retry", exact: true }).click();
  await ready();
  await click("Export");
  const md = await capture("markdown", "plain");
  assert.equal(md.length, 1);
  assert.match(
    Buffer.from(md[0].bytes).toString(),
    /Export body with Unicode café/,
  );
  assert.match(Buffer.from(md[0].bytes).toString(), /\*\*/);
  const before = await page.evaluate(() =>
    JSON.stringify(
      document
        .querySelector("affine-editor-container")
        .doc.spaceDoc.getMap("blocks")
        .toJSON(),
    ),
  );
  const png = await capture("png", "page");
  assert.equal(Buffer.from(png[0].bytes).subarray(1, 4).toString(), "PNG");
  const white = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, png[0].bytes);
  assert.deepEqual(white, [255, 255, 255, 255]);
  const pdf = await capture("pdf", "page");
  assert.equal(Buffer.from(pdf[0].bytes).subarray(0, 5).toString(), "%PDF-");
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(
        document
          .querySelector("affine-editor-container")
          .doc.spaceDoc.getMap("blocks")
          .toJSON(),
      ),
    ),
    before,
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from(png[0].bytes),
  });
  await ready();
  const assets = await capture("markdown", "with-assets");
  assert.equal(assets.length, 2);
  assert.deepEqual(Buffer.from(assets[1].bytes), Buffer.from(png[0].bytes));
  assert.ok(Buffer.from(assets[0].bytes).toString().includes(assets[1].name));
  await click("Canvas");
  await page.evaluate(() => {
    const root = document.querySelector("affine-edgeless-root");
    root.service.addElement("shape", {
      xywh: "[500,100,180,120]",
      shapeType: "rect",
      fillColor: "#ff0000",
      strokeColor: "#000000",
    });
  });
  const canvasPng = await capture("png", "canvas");
  assert.ok(
    await page.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 200 && pixels[i + 1] < 60 && pixels[i + 2] < 60) red++;
      return red > 1000;
    }, canvasPng[0].bytes),
    "Canvas shapes must be visible in exported image",
  );
  assert.ok(
    await page.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(60, 85, 500, 55).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100)
          dark++;
      return dark > 100;
    }, canvasPng[0].bytes),
    "Canvas note text must remain visible above its attached image",
  );
  const canvasPdf = await capture("pdf", "canvas");
  const { PDFDocument } = await import("pdf-lib");
  assert.equal(
    (await PDFDocument.load(new Uint8Array(canvasPdf[0].bytes))).getPageCount(),
    1,
  );
  await page.screenshot({ path: path.join(root, "export-panel.png") });
  await click("Page");
  const db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  db.exec(
    "CREATE TRIGGER reject_export_save BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL,'export save failure'); END;",
  );
  await page.locator("affine-paragraph [contenteditable=true]").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Pending export.");
  await page.getByLabel("Export format").selectOption("markdown");
  await click("Save export");
  await page
    .getByRole("alert")
    .filter({ hasText: "export save failure" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.exportCapture), null);
  db.exec("DROP TRIGGER reject_export_save;");
  db.close();
  const retry = await capture("markdown", "retry");
  assert.match(Buffer.from(retry[0].bytes).toString(), /Pending export/);
  await page.locator(".primary").click();
  await ready();
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Export reference source");
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Only in referenced source note.");
  await page.getByRole("button", { name: "Save now / retry", exact: true }).click();
  await ready();
  const referenceId = await page.evaluate(
    () => document.querySelector("affine-editor-container").doc.id,
  );
  await page
    .locator(".document-row")
    .filter({ hasText: "Welcome to Knot" })
    .click();
  await ready();
  await page.evaluate((id) => {
    const doc = document.querySelector("affine-editor-container").doc;
    const note = doc.getBlocksByFlavour("affine:note")[0].model;
    doc.addBlock("affine:embed-linked-doc", { pageId: id }, note);
    doc.addBlock("affine:embed-synced-doc", { pageId: id }, note);
  }, referenceId);
  const refs = await capture("markdown", "references");
  const referenceMarkdown = Buffer.from(refs[0].bytes).toString();
  assert.ok(referenceMarkdown.includes(referenceId));
  assert.ok(referenceMarkdown.includes("Export reference source"));
  assert.doesNotMatch(referenceMarkdown, /Only in referenced source note/);
  await page.evaluate(() => {
    window.exportBehavior = "cancel";
  });
  await click("Save export");
  await page
    .getByRole("status")
    .filter({ hasText: "Export canceled." })
    .waitFor();
  await page.evaluate(() => {
    window.exportBehavior = "fail";
  });
  await click("Save export");
  await page
    .getByRole("alert")
    .filter({ hasText: "Export destination unavailable" })
    .waitFor();
  await page.evaluate(() => {
    window.exportBehavior = null;
  });
  await capture("markdown", "destination-retry");
  await click("Canvas");
  await page.evaluate(() =>
    document.querySelector("affine-edgeless-root").service.addElement("shape", {
      xywh: "[0,0,20000,20000]",
      shapeType: "rect",
    }),
  );
  await page.getByLabel("Export format").selectOption("png");
  await click("Save export");
  await page
    .getByRole("alert")
    .filter({ hasText: "too large to export" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.exportCapture), null);
  console.log(
    "PASS native Markdown/assets, Page and Canvas PNG/PDF, unchanged content, failed-save retry; Save As handoff captured",
    root,
  );
} finally {
  await stop();
}
