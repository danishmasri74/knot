import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve("test-results/integrity-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser;
try {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9252",
    },
  });
  for (let n = 0; n < 100; n++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9252");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  const click = async (name) => {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".primary")?.disabled === false,
    );
  };
  await click("✓ Check workspace");
  await page
    .getByText("SQLite integrity and stored relationships passed.")
    .waitFor();
  const db = new DatabaseSync(path.join(root, "Workspace/knot.db"));
  const id = db.prepare("SELECT id FROM objects LIMIT 1").get().id;
  db.prepare(
    "INSERT INTO objects (id,title,kind,updated_at,deleted_at) VALUES ('trashed','Recovered source','note',1,1)",
  ).run();
  const bytes = Buffer.from("attachment fixture");
  const hash = createHash("sha256").update(bytes).digest("hex");
  db.prepare(
    "INSERT INTO attachments VALUES ('fixture',?,'fixture.png','image/png',?)",
  ).run(hash, bytes.length);
  for (const doc of [id, "trashed"])
    db.prepare("INSERT INTO object_attachments VALUES (?, 'fixture')").run(doc);
  const assetPath = path.join(root, "Workspace/assets", hash.slice(0, 2), hash);
  await mkdir(path.dirname(assetPath), { recursive: true });
  const orphan = path.join(root, "Workspace/assets/interrupted.tmp");
  await writeFile(orphan, "retained");
  const before = db.prepare("SELECT * FROM documents ORDER BY object_id").all();
  await click("Check again");
  await page
    .getByText(
      "1 asset records checked; 1 missing, 0 corrupt, 1 unindexed files.",
    )
    .waitFor();
  await page.getByText("Missing: fixture.png · 2 associated documents").click();
  await page.getByText(/Recovered source \(in Trash\)/).waitFor();
  await page.getByText("Unindexed files (1)", { exact: true }).click();
  await page.getByText("interrupted.tmp", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "missing.png") });
  await writeFile(assetPath, "damaged");
  await click("Check again");
  await page
    .getByText(
      "1 asset records checked; 0 missing, 1 corrupt, 1 unindexed files.",
    )
    .waitFor();
  assert.deepEqual(
    db.prepare("SELECT * FROM documents ORDER BY object_id").all(),
    before,
  );
  assert.equal(await readFile(orphan, "utf8"), "retained");
  await writeFile(assetPath, bytes);
  await click("Check again");
  await page
    .getByText("No missing or corrupt indexed attachments found.")
    .waitFor();
  await click("Recovery backups");
  await page.getByRole("region", { name: "Backup management" }).waitFor();
  await click("Close backups");
  await click("Close report");
  assert.equal(
    await page.getByRole("region", { name: "Workspace integrity" }).count(),
    0,
  );
  // A failed audit must not leave a stale passing report visible.
  await click("✓ Check workspace");
  await unlink(orphan);
  db.exec("DROP TABLE object_attachments");
  await click("Check again");
  await page
    .getByRole("alert")
    .filter({ hasText: "object_attachments" })
    .waitFor();
  assert.equal(
    await page.getByRole("region", { name: "Workspace integrity" }).count(),
    0,
  );
  db.close();
  console.log(
    "PASS native integrity: healthy, missing, corrupt, Trash associations, retained files/content, refresh, recovery route and failed audit",
    root,
  );
} finally {
  await browser?.close();
  if (child?.pid)
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
}
