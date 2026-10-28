import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  unlink,
  rmdir,
  access,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve("test-results/quarantine-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page, db;
let accept = true;
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9253",
    },
  });
  for (let n = 0; n < 100; n++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9253");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("dialog", (d) => (accept ? d.accept() : d.dismiss()));
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
}
const assets = path.join(root, "Workspace/assets");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function indexed(key, bytes, ids) {
  const hash = digest(bytes);
  await mkdir(path.join(assets, hash.slice(0, 2)), { recursive: true });
  await writeFile(path.join(assets, hash.slice(0, 2), hash), bytes);
  db.prepare("INSERT INTO attachments VALUES (?,?,?,'text/plain',?)").run(
    key,
    hash,
    key,
    bytes.length,
  );
  for (const id of ids)
    db.prepare("INSERT INTO object_attachments VALUES (?,?)").run(id, key);
  return hash;
}
const rows = () =>
  Object.fromEntries(
    ["objects", "documents", "attachments", "object_attachments"].map(
      (table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ],
    ),
  );
try {
  await launch();
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Shared source");
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await ready();
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Quarantine must preserve this shared content.");
  await save();
  const source = await page.evaluate(
    () => document.querySelector("affine-editor-container").doc.id,
  );
  await click("◇ New whiteboard");
  const board = await page.evaluate(
    () => document.querySelector("affine-editor-container").doc.id,
  );
  await click("＋ Reference");
  await page
    .getByLabel("Reference document")
    .selectOption({ label: "Shared source" });
  await click("Place shared note");
  await save();
  db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  db.prepare(
    "INSERT INTO objects (id,title,kind,updated_at,deleted_at) VALUES ('trash-fixture','Trashed attachment owner','note',1,1)",
  ).run();
  const hash = await indexed(
    "shared-asset",
    Buffer.from("shared and trashed attachment"),
    [source, board, "trash-fixture"],
  );
  await mkdir(path.join(assets, "aa"), { recursive: true });
  await writeFile(path.join(assets, "aa/interrupted.tmp"), "recover me");
  await writeFile(path.join(assets, "stale.tmp"), "before");
  await writeFile(path.join(assets, "newly-indexed.tmp"), "new index");
  await writeFile(
    path.join(assets, "duplicate.tmp"),
    "shared and trashed attachment",
  );
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "external"), "do not touch");
  await symlink(outside, path.join(assets, "linked"), "junction");
  await click("Orphan quarantine");
  const panel = page.getByRole("region", { name: "Orphan quarantine" });
  assert.equal(await panel.getByRole("checkbox").count(), 3);
  await panel.getByLabel("Select aa/interrupted.tmp", { exact: true }).check();
  await panel.getByLabel("Select stale.tmp", { exact: true }).check();
  await panel.getByLabel("Select newly-indexed.tmp", { exact: true }).check();
  await page.screenshot({ path: path.join(root, "preview.png") });
  accept = false;
  await click("Quarantine selected files");
  accept = true;
  assert.equal(
    await readFile(path.join(assets, "aa/interrupted.tmp"), "utf8"),
    "recover me",
  );
  await writeFile(path.join(assets, "stale.tmp"), "after");
  await indexed("new-index", Buffer.from("new index"), [source]);
  // Real save failure blocks cleanup; retry preserves content and rechecks files.
  db.exec(
    "CREATE TRIGGER reject_cleanup BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL,'cleanup save failure'); END;",
  );
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Board save retry");
  await click("Quarantine selected files");
  await page
    .getByRole("alert")
    .filter({ hasText: "cleanup save failure" })
    .waitFor();
  await access(path.join(assets, "aa/interrupted.tmp"));
  db.exec("DROP TRIGGER reject_cleanup");
  await save();
  const before = rows();
  await click("Quarantine selected files");
  await page.getByText(/Quarantined 1 files. 2 failed./).waitFor();
  await assert.rejects(access(path.join(assets, "aa/interrupted.tmp")));
  assert.equal(await readFile(path.join(assets, "stale.tmp"), "utf8"), "after");
  assert.equal(
    await readFile(path.join(assets, "newly-indexed.tmp"), "utf8"),
    "new index",
  );
  assert.equal(
    await readFile(path.join(assets, hash.slice(0, 2), hash), "utf8"),
    "shared and trashed attachment",
  );
  assert.deepEqual(rows(), before);
  await page.screenshot({ path: path.join(root, "quarantined.png") });
  // A redirected original parent cannot cause a restore outside the workspace.
  await rmdir(path.join(assets, "aa"));
  await symlink(outside, path.join(assets, "aa"), "junction");
  await click("Restore file aa/interrupted.tmp");
  await page.getByRole("alert").filter({ hasText: "redirected" }).waitFor();
  await assert.rejects(access(path.join(outside, "interrupted.tmp")));
  await unlink(path.join(assets, "aa"));
  await mkdir(path.join(assets, "aa"));
  db.close();
  db = null;
  await stop();
  await launch();
  await click("Orphan quarantine");
  await click("Restore file aa/interrupted.tmp");
  assert.equal(
    await readFile(path.join(assets, "aa/interrupted.tmp"), "utf8"),
    "recover me",
  );
  await writeFile(path.join(assets, "aa/interrupted.tmp"), "existing original");
  await click("Restore file aa/interrupted.tmp");
  await page.getByRole("alert").waitFor();
  assert.equal(
    await readFile(path.join(assets, "aa/interrupted.tmp"), "utf8"),
    "existing original",
  );
  assert.equal(
    await page
      .getByRole("button", {
        name: "Restore file aa/interrupted.tmp",
        exact: true,
      })
      .count(),
    1,
  );
  const copies = await readdir(path.join(root, "Workspace/quarantine"));
  assert.equal(copies.length, 1);
  assert.equal(
    await readFile(
      path.join(root, "Workspace/quarantine", copies[0], "payload"),
      "utf8",
    ),
    "recover me",
  );
  db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  assert.deepEqual(rows(), before);
  await click("Close quarantine");
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll("affine-embed-edgeless-synced-doc-block"),
    ].some((n) =>
      n.textContent.includes("Quarantine must preserve this shared content."),
    ),
  );
  assert.equal(
    await readFile(path.join(outside, "external"), "utf8"),
    "do not touch",
  );
  db.close();
  db = null;
  await click("Orphan quarantine");
  await click("Manage backups");
  await click("Create backup");
  await click("Restore archive");
  assert.equal(
    await page.getByRole("region", { name: "Orphan quarantine" }).count(),
    0,
  );
  await click("Orphan quarantine");
  await page
    .getByText("No complete recovery copies.", { exact: true })
    .waitFor();
  assert.equal(
    await readFile(
      path.join(root, "Workspace/quarantine", copies[0], "payload"),
      "utf8",
    ),
    "recover me",
  );
  console.log(
    "PASS quarantine preview, cancellation, save failure/retry, stale/newly indexed protection, partial outcomes, shared/Trash preservation, junction rejection, restart, restore and no overwrite",
    root,
  );
} finally {
  db?.close();
  await stop();
}
