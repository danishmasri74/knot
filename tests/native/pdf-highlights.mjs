import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  rename as renameFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/pdf-highlights-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9260",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9260");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Native application did not start");
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
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
  await page.getByRole("button", { name, exact: true }).click();
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
async function save() {
  await page.getByTitle("Save now / retry").click();
  await ready();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
}
async function rename(title) {
  await page.getByLabel("Document title", { exact: true }).fill(title);
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
}
async function body(id) {
  return page.evaluate((id) => {
    const editor = document.querySelector("affine-editor-container");
    const doc = id ? editor.doc.collection.getDoc(id) : editor.doc;
    return {
      id: doc.id,
      json: JSON.stringify(doc.spaceDoc.getMap("blocks").toJSON()),
    };
  }, id);
}
const { PDFDocument, StandardFonts } = await import("pdf-lib");
const fixture = await PDFDocument.create();
const font = await fixture.embedFont(StandardFonts.Helvetica);
fixture
  .addPage([600, 500])
  .drawText("First PDF page", { x: 40, y: 420, size: 20, font });
const second = fixture.addPage([600, 500]);
second.drawText("A retained highlight on page two.", {
  x: 40,
  y: 420,
  size: 20,
  font,
});
second.drawText("The original PDF remains unchanged.", {
  x: 40,
  y: 380,
  size: 20,
  font,
});
fixture.addPage([600, 500]);
const fixturePath = path.join(root, "highlights.pdf");
await writeFile(fixturePath, await fixture.save());
async function readerReady(text) {
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll(".pdf-reader .textLayer span")].some((el) =>
        el.textContent.includes(text),
      ),
    text,
  );
}
async function chooseText(text) {
  await readerReady(text);
  const span = page
    .locator(".pdf-reader .textLayer span")
    .filter({ hasText: text })
    .first();
  await span.scrollIntoViewIfNeeded();
  const box = await span.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Create highlight card", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll(".pdf-reader button")].find(
        (b) => b.textContent === "Create highlight card",
      ).disabled,
  );
}
async function openSource() {
  await page
    .locator('affine-editor-container a[href^="https://knot.invalid/pdf"]')
    .first()
    .click();
  await ready();
  await readerReady("A retained highlight");
  await page.getByText("Page 2 of 3", { exact: true }).waitFor();
  assert.ok((await page.locator(".pdf-highlight").count()) > 0);
}
try {
  await launch();
  await rename("PDF study");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await ready();
  await save();
  const original = await body();
  const db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  const assets = () => ({
    attachments: db.prepare("SELECT * FROM attachments ORDER BY id").all(),
    associations: db
      .prepare(
        "SELECT * FROM object_attachments ORDER BY object_id,attachment_id",
      )
      .all(),
  });
  const beforeAssets = assets();
  const asset = beforeAssets.attachments[0];
  const assetPath = path.join(
    root,
    "Workspace/assets",
    asset.sha256.slice(0, 2),
    asset.sha256,
  );
  const bytes = await readFile(assetPath);
  // The new reader must work with WebView networking offline.
  await page.context().setOffline(true);
  await click("PDF highlights");
  await readerReady("First PDF page");
  await click("Next PDF page");
  await chooseText("A retained highlight");
  await page.screenshot({ path: path.join(root, "selected.png") });
  db.exec(
    "CREATE TRIGGER reject_pdf BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL, 'PDF save blocked'); END",
  );
  await click("Create highlight card");
  await page.getByRole("alert").filter({ hasText: "Card not saved" }).waitFor();
  await page
    .getByRole("alert")
    .filter({ hasText: "PDF save blocked" })
    .waitFor();
  db.exec("DROP TRIGGER reject_pdf");
  await click("Create highlight card");
  await page.getByText("Highlight card saved.", { exact: true }).waitFor();
  await click("Close PDF reader");
  let highlighted = await body();
  const blocks = JSON.parse(highlighted.json);
  assert.equal(
    Object.keys(blocks).filter((id) => id.startsWith("pdf-")).length,
    1,
  );
  for (const [id, block] of Object.entries(JSON.parse(original.json))) {
    if (block["sys:flavour"] === "affine:page") {
      assert.deepEqual(
        blocks[id]["sys:children"].slice(0, block["sys:children"].length),
        block["sys:children"],
      );
      assert.deepEqual(
        { ...blocks[id], "sys:children": block["sys:children"] },
        block,
      );
    } else assert.deepEqual(blocks[id], block);
  }
  const href = await page
    .locator('affine-editor-container a[href^="https://knot.invalid/pdf"]')
    .first()
    .getAttribute("href");
  const location = JSON.parse(decodeURIComponent(new URL(href).hash.slice(1)));
  assert.equal(location.page, 2);
  assert.equal(location.documentId, original.id);
  assert.equal(location.key, beforeAssets.associations[0].attachment_id);
  // Single undo removes only the new native note and its children.
  await page.getByTitle("Undo (Ctrl+Z)").click();
  await save();
  assert.deepEqual(await body(), original);
  await page.getByTitle("Redo (Ctrl+Y)").click();
  await save();
  assert.deepEqual(await body(), highlighted);
  await openSource();
  await page.screenshot({ path: path.join(root, "reopened.png") });
  await click("Next PDF page");
  await page
    .getByText("This page has no selectable text. OCR is not supported.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Create highlight card", exact: true })
      .isEnabled(),
    false,
  );
  await click("Close PDF reader");
  await click("◇ Canvas");
  await page.screenshot({ path: path.join(root, "canvas-card.png") });
  await click("▤ Page");
  await save();
  highlighted = await body();
  assert.deepEqual(assets(), beforeAssets);
  assert.deepEqual(await readFile(assetPath), bytes);
  db.close();
  await stop();
  await launch();
  assert.deepEqual(await body(), highlighted);
  await openSource();
  await click("Close PDF reader");
  // Invalid source bytes produce an explicit reader error and leave the card intact.
  await writeFile(assetPath, Buffer.from("not a PDF"));
  await page
    .locator('affine-editor-container a[href^="https://knot.invalid/pdf"]')
    .first()
    .click();
  await ready();
  await page
    .getByRole("alert")
    .filter({ hasText: "Unable to open PDF" })
    .waitFor();
  await click("Close PDF reader");
  assert.deepEqual(await body(), highlighted);
  await writeFile(assetPath, bytes);
  await renameFile(assetPath, assetPath + ".missing");
  await page
    .locator('affine-editor-container a[href^="https://knot.invalid/pdf"]')
    .first()
    .click();
  await ready();
  await page
    .getByRole("alert")
    .filter({ hasText: "missing or unreadable" })
    .waitFor();
  await click("Close PDF reader");
  await renameFile(assetPath + ".missing", assetPath);
  await click("Manage backups");
  await click("Create backup");
  await click("Verify archive");
  await openSource();
  await click("Restore archive");
  assert.equal(
    await page.getByRole("region", { name: "PDF reader", exact: true }).count(),
    0,
  );
  assert.deepEqual(await body(), highlighted);
  await openSource();
  await click("Close PDF reader");
  assert.deepEqual(await readFile(assetPath), bytes);
  const restoredId = (
    await readFile(path.join(root, "active-workspace.txt"), "utf8")
  ).trim();
  const restoredRoot = path.join(root, restoredId);
  assert.deepEqual(
    await readFile(
      path.join(restoredRoot, "assets", asset.sha256.slice(0, 2), asset.sha256),
    ),
    bytes,
  );
  const restoredDb = new DatabaseSync(path.join(restoredRoot, "knot.db"));
  assert.deepEqual(
    restoredDb.prepare("SELECT * FROM attachments ORDER BY id").all(),
    beforeAssets.attachments,
  );
  assert.deepEqual(
    restoredDb
      .prepare(
        "SELECT * FROM object_attachments ORDER BY object_id,attachment_id",
      )
      .all(),
    beforeAssets.associations,
  );
  restoredDb.close();
  const largePath = path.join(root, "large.pdf");
  await writeFile(
    largePath,
    Buffer.concat([bytes, Buffer.alloc(10 * 1024 * 1024, 32)]),
  );
  await page.locator('input[type="file"]').setInputFiles(largePath);
  await ready();
  await save();
  await click("PDF highlights");
  await page
    .getByLabel("PDF attachment", { exact: true })
    .selectOption({ label: "large.pdf" });
  await page.getByRole("alert").filter({ hasText: "10 MiB" }).waitFor();
  await click("Close PDF reader");
  const brokenPath = path.join(root, "broken.pdf");
  await writeFile(brokenPath, "Not a PDF");
  await page.locator('input[type="file"]').setInputFiles(brokenPath);
  await ready();
  await save();
  await click("PDF highlights");
  await page
    .getByLabel("PDF attachment", { exact: true })
    .selectOption({ label: "broken.pdf" });
  await page
    .getByRole("alert")
    .filter({ hasText: "Unable to open PDF" })
    .waitFor();
  await click("Close PDF reader");
  console.log(
    "PASS PDF highlights selection, retry, undo/redo, source location, offline, restart and archive restore",
    root,
  );
} finally {
  await stop();
}
