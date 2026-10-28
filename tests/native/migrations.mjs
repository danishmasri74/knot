import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/migrations-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
async function launch(recovery = false) {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9255",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9255");
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
  if (!recovery)
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
  // Windows can release SQLite shared-memory handles after taskkill returns.
  await new Promise((resolve) => setTimeout(resolve, 500));
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
async function select(title) {
  await page.locator(".document-row").filter({ hasText: title }).click();
  await ready();
}
async function place(title, shared = true) {
  await click("＋ Reference");
  await page.getByLabel("Reference document").selectOption({ label: title });
  await click(shared ? "Place shared note" : "Insert link");
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
async function preview(text) {
  await page.waitForFunction(
    (text) =>
      [
        ...document.querySelectorAll("affine-embed-edgeless-synced-doc-block"),
      ].some((node) => node.textContent.includes(text)),
    text,
  );
}
const database = path.join(root, "Workspace/knot.db");
function rows(db) {
  return {
    objects: db
      .prepare(
        "SELECT id,title,kind,updated_at,deleted_at FROM objects ORDER BY id",
      )
      .all(),
    documents: db.prepare("SELECT * FROM documents ORDER BY object_id").all(),
    attachments: db.prepare("SELECT * FROM attachments ORDER BY id").all(),
    associations: db
      .prepare(
        "SELECT * FROM object_attachments ORDER BY object_id,attachment_id",
      )
      .all(),
  };
}
try {
  await launch();
  await rename("Migration source");
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Shared content survives schema migration.");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/knot.png"));
  await ready();
  await save();
  const source = await body();
  await click("◇ New whiteboard");
  await rename("Migration board");
  await place("Migration source");
  await save();
  const board = await body();
  await page.getByRole("button", { name: "New note" }).click();
  await ready();
  await rename("Migration Trash");
  await page.getByTitle("Delete document").click();
  await ready();
  await select("Migration board");
  await stop();
  // Reconstruct schema 1 while retaining the exact native-generated snapshot pairs.
  let db = new DatabaseSync(database);
  const before = rows(db);
  const manifest = await readFile(path.join(root, "Workspace/workspace.json"));
  db.exec(
    "DROP INDEX objects_folder; DROP TABLE object_tags; DROP TABLE tags; DROP TABLE folders; ALTER TABLE objects DROP COLUMN folder_id; DELETE FROM schema_migrations WHERE version=2; PRAGMA user_version=1;",
  );
  db.exec(
    "CREATE TRIGGER reject_migration BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT,'native migration failure'); END;",
  );
  db.close();
  await launch(true);
  await page
    .getByRole("alert")
    .filter({ hasText: "schema changes rolled back" })
    .waitFor();
  await page.screenshot({ path: path.join(root, "migration-failure.png") });
  db = new DatabaseSync(database);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
  assert.deepEqual(rows(db), before);
  db.exec("DROP TRIGGER reject_migration");
  db.close();
  await stop();
  await launch();
  await select("Migration board");
  await preview("Shared content survives schema migration.");
  assert.deepEqual(await body(), board);
  await select("Migration source");
  assert.deepEqual(await body(), source);
  db = new DatabaseSync(database);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
  assert.deepEqual(rows(db), before);
  assert.deepEqual(
    await readFile(path.join(root, "Workspace/workspace.json")),
    manifest,
  );
  const asset = before.attachments[0];
  assert.deepEqual(
    await readFile(
      path.join(
        root,
        "Workspace/assets",
        asset.sha256.slice(0, 2),
        asset.sha256,
      ),
    ),
    await readFile("tests/fixtures/knot.png"),
  );
  db.close();
  await click("✓ Check workspace");
  await page.getByText("Database schema: 2.", { exact: true }).waitFor();
  await page
    .getByText("Pre-migration recovery archives (2)", { exact: true })
    .click();
  await page.screenshot({ path: path.join(root, "migration-recovery.png") });
  await stop();
  await launch();
  await click("✓ Check workspace");
  await page
    .getByText("Pre-migration recovery archives (2)", { exact: true })
    .waitFor();
  console.log(
    "PASS native migration rollback/retry, retained recovery archives, exact snapshots/IDs/Trash/attachments/shared references, integrity UI and restart",
    root,
  );
} finally {
  await stop();
}
