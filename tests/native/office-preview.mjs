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
const root = path.resolve("test-results/office-preview-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9262",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9262");
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
import { zipSync, strToU8 } from "fflate";
const xml = (text) =>
  `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text}</w:body></w:document>`;
const fixture = zipSync({
  "[Content_Types].xml": strToU8(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  "_rels/.rels": strToU8(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  "word/document.xml": strToU8(
    xml(
      '<w:p><w:r><w:t>Hello local Word — café</w:t><w:tab/><w:t>tab</w:t><w:br/><w:t>next line</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>&lt;img src="https://example.invalid"&gt;</w:t></w:r></w:p>',
    ),
  ),
  "word/media/unused.bin": new Uint8Array(100),
});
async function attach(name, bytes) {
  const file = path.join(root, name);
  await writeFile(file, bytes);
  await page.locator('input[type="file"]').setInputFiles(file);
  await ready();
  await save();
}
async function preview() {
  await click("Office preview");
  await page
    .locator(".office-text")
    .getByText("Table cell", { exact: true })
    .waitFor();
}
async function selectError(name, message) {
  await page
    .getByLabel("Office attachment", { exact: true })
    .selectOption({ label: name });
  await page
    .locator('.office-preview [role="alert"]')
    .filter({ hasText: message })
    .waitFor();
}
try {
  await launch();
  await rename("Office reference");
  await attach("reference.docx", fixture);
  const original = await body();
  const db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  const snapshot = () =>
    ["objects", "documents", "attachments", "object_attachments"].map((table) =>
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  const before = snapshot();
  const asset = db.prepare("SELECT * FROM attachments LIMIT 1").get();
  const assetPath = path.join(
    root,
    "Workspace/assets",
    asset.sha256.slice(0, 2),
    asset.sha256,
  );
  await page.context().setOffline(true);
  await preview();
  assert.match(
    await page.locator(".office-text").innerText(),
    /Hello local Word — café\s+tab\s+next line/,
  );
  assert.equal(await page.locator(".office-text img").count(), 0);
  await page.screenshot({ path: path.join(root, "preview.png") });
  await click("Close Office preview");
  assert.deepEqual(await body(), original);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(await readFile(assetPath), Buffer.from(fixture));
  await page.context().setOffline(false);
  db.exec(
    "CREATE TRIGGER reject_office BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL, 'Office save blocked'); END",
  );
  await page.locator("affine-paragraph [contenteditable=true]").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Save before preview");
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("failed"),
  );
  await click("Office preview");
  assert.equal(await page.locator(".office-preview").count(), 0);
  await page
    .getByRole("alert")
    .filter({ hasText: "Office save blocked" })
    .waitFor();
  db.exec("DROP TRIGGER reject_office");
  await save();
  await preview();
  await click("Close Office preview");
  const saved = await body();
  const sourceTitle = db
    .prepare("SELECT title FROM objects WHERE id = ?")
    .get(saved.id).title;
  await preview();
  await page.getByRole("button", { name: "New note" }).click();
  await ready();
  assert.equal(await page.locator(".office-preview").count(), 0);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await ready();
  await stop();
  await launch();
  await page.locator(".document-row").filter({ hasText: sourceTitle }).click();
  await ready();
  await preview();
  assert.deepEqual(await body(), saved);
  await click("Close Office preview");
  await renameFile(assetPath, assetPath + ".missing");
  await click("Office preview");
  await page
    .locator('.office-preview [role="alert"]')
    .filter({ hasText: "missing or unreadable" })
    .waitFor();
  await renameFile(assetPath + ".missing", assetPath);
  await click("Retry Office preview");
  await page
    .locator(".office-text")
    .getByText("Table cell", { exact: true })
    .waitFor();
  await click("Close Office preview");
  await click("Manage backups");
  await click("Create backup");
  await click("Verify archive");
  await preview();
  await click("Restore archive");
  assert.equal(await page.locator(".office-preview").count(), 0);
  await page.locator(".document-row").filter({ hasText: sourceTitle }).click();
  await ready();
  assert.deepEqual(await body(), saved);
  await preview();
  await click("Close Office preview");
  const restoredId = (
    await readFile(path.join(root, "active-workspace.txt"), "utf8")
  ).trim();
  const restoredRoot = path.join(root, restoredId);
  assert.deepEqual(
    await readFile(
      path.join(restoredRoot, "assets", asset.sha256.slice(0, 2), asset.sha256),
    ),
    Buffer.from(fixture),
  );
  const restoredDb = new DatabaseSync(path.join(restoredRoot, "knot.db"));
  for (const table of ["attachments", "object_attachments"])
    assert.deepEqual(
      restoredDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  restoredDb.close();
  db.close();
  await attach("legacy.doc", Buffer.from("unsupported"));
  await attach("broken.docx", Buffer.from("invalid zip"));
  await attach(
    "invalid-xml.docx",
    zipSync({ "word/document.xml": strToU8("<bad>") }),
  );
  await attach("large.docx", Buffer.alloc(5 * 1024 * 1024 + 1));
  await attach(
    "expanded.docx",
    zipSync({ "word/document.xml": new Uint8Array(1024 * 1024 + 1) }),
  );
  await attach(
    "entities.docx",
    zipSync({
      "word/document.xml": strToU8(
        '<!DOCTYPE x [<!ENTITY x "test">]>' + xml(""),
      ),
    }),
  );
  await attach(
    "blank.docx",
    zipSync({ "word/document.xml": strToU8(xml("")) }),
  );
  await attach(
    "long-text.docx",
    zipSync({
      "word/document.xml": strToU8(
        xml("<w:p><w:r><w:t>" + "a".repeat(100001) + "</w:t></w:r></w:p>"),
      ),
    }),
  );
  await attach(
    "many-paragraphs.docx",
    zipSync({ "word/document.xml": strToU8(xml("<w:p/>".repeat(5001))) }),
  );
  await preview();
  await selectError("long-text.docx", "100,000");
  await selectError("many-paragraphs.docx", "5,000");
  await selectError("legacy.doc", "Unsupported format");
  await selectError("broken.docx", "Unable to preview");
  await selectError("invalid-xml.docx", "Invalid or unsupported");
  await selectError("large.docx", "5 MiB");
  await selectError("expanded.docx", "1 MiB");
  await selectError("entities.docx", "entities are unsupported");
  await page
    .getByLabel("Office attachment", { exact: true })
    .selectOption({ label: "blank.docx" });
  await page
    .getByText("No supported body text in this document.", { exact: true })
    .waitFor();
  await page
    .getByLabel("Office attachment", { exact: true })
    .selectOption({ label: "reference.docx" });
  await page
    .locator(".office-text")
    .getByText("Table cell", { exact: true })
    .waitFor();
  console.log(
    "PASS Office preview text, offline, preservation, save retry, transitions, restart, backup and error bounds",
    root,
  );
} finally {
  await stop();
}
