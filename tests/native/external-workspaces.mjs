import { placeLegacyReference } from "./legacy-reference-fixture.mjs";
import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  cp,
  writeFile,
  rename as movePath,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = path.resolve("test-results/external-workspaces-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
async function launch(recovery = false) {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: !interactive,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: path.join(root, "managed"),
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9249",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9249");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Native application did not start");
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(180000);
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
async function save() {
  await page.getByRole("button", { name: "Save now / retry", exact: true }).click();
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
  await placeLegacyReference(page, title, shared);
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
async function switchTo(name) {
  await click("Switch workspace");
  await click(`Open ${name}`);
}
const interactive = process.argv.includes("--dialogs");
const base = path.join(root, "managed");
const external = path.join(root, "External notes");
const destination = path.join(root, "Destination");
await mkdir(destination);
try {
  await launch();
  await rename("Original source");
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.type("Original workspace content.");
  await save();
  const original = await body();
  await createNotebook(page, true);
  await rename("Original board");
  await place("Original source");
  await save();
  await preview("Original workspace content.");
  await stop();
  await cp(path.join(base, "Workspace"), external, { recursive: true });
  if (!interactive)
    await writeFile(
      path.join(base, "external-workspaces.json"),
      JSON.stringify([{ id: "external-fixture", path: external }]),
    );
  await launch();
  await click("Trash & recovery");
  if (interactive) {
    await click("Switch workspace");
    console.log("DIALOG open folder:", external);
    await page
      .getByRole("button", { name: "+ Open workspace folder", exact: true })
      .click();
    await ready();
  } else await switchTo("External workspace · fixture");
  assert.equal(await page.getByLabel("Trash and recovery").count(), 0);
  assert.ok(
    await page
      .getByRole("button", { name: "Go back", exact: true })
      .isDisabled(),
  );
  await select("Original source");
  assert.equal((await body()).id, original.id);
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" External-only edit.");
  await save();
  const externalId = await readFile(
    path.join(base, "active-workspace.txt"),
    "utf8",
  );
  const externalName = `External workspace · ${externalId.slice(9, 17)}`;
  await switchTo("Personal workspace");
  await select("Original source");
  assert.equal((await body()).json, original.json);
  const db = new DatabaseSync(path.join(base, "Workspace/knot.db"));
  db.exec(
    "CREATE TRIGGER reject_external_save BEFORE UPDATE ON documents BEGIN SELECT RAISE(FAIL,'external save failure'); END;",
  );
  await page.locator("affine-paragraph [contenteditable=true]").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Pending edit.");
  await switchTo(externalName);
  await page
    .getByRole("alert")
    .filter({ hasText: "external save failure" })
    .waitFor();
  assert.match((await body()).json, /Pending edit/);
  db.exec("DROP TRIGGER reject_external_save;");
  db.close();
  await click(`Open ${externalName}`);
  await select("Original source");
  assert.match((await body()).json, /External-only edit/);
  assert.doesNotMatch((await body()).json, /Pending edit/);
  await select("Original board");
  await preview("External-only edit");
  await click("Manage backups");
  await click("Create backup");
  await click("Verify archive");
  await page.getByText(/Backup verified:/).waitFor();
  await click("Close Backups panel");
  await click("Switch workspace");
  await page.screenshot({ path: path.join(root, "external-picker.png") });
  await click("Close Workspaces panel");
  if (interactive) {
    await select("Original source");
    await page.locator("affine-paragraph [contenteditable=true]").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Saved before relocation.");
    await click("Switch workspace");
    await page.locator(".workspace-storage summary").click();
    console.log("DIALOG relocation destination:", destination);
    await page
      .getByRole("button", { name: "Relocate workspace", exact: true })
      .click();
    await ready();
    await select("Original source");
    assert.match((await body()).json, /Saved before relocation/);
    const relocatedId = await readFile(
      path.join(base, "active-workspace.txt"),
      "utf8",
    );
    assert.notEqual(relocatedId, externalId);
    const entries = JSON.parse(
      await readFile(path.join(base, "external-workspaces.json"), "utf8"),
    );
    const relocated = entries.find((e) => e.id === relocatedId);
    assert.ok(relocated.path.includes("Destination"));
    const fromDb = new DatabaseSync(path.join(external, "knot.db"));
    const toDb = new DatabaseSync(path.join(relocated.path, "knot.db"));
    assert.deepEqual(
      fromDb.prepare("SELECT * FROM documents ORDER BY object_id").all(),
      toDb.prepare("SELECT * FROM documents ORDER BY object_id").all(),
    );
    fromDb.close();
    toDb.close();
    await stop();
    await launch();
    assert.equal(
      await readFile(path.join(base, "active-workspace.txt"), "utf8"),
      relocatedId,
    );
    await switchTo(externalName);
  }
  await stop();
  await launch();
  await select("Original source");
  assert.match((await body()).json, /External-only edit/);
  await stop();
  const manifest = path.join(external, "workspace.json");
  const offline = path.join(external, "workspace.offline");
  await movePath(manifest, offline);
  await launch(true);
  await page.getByRole("alert").waitFor();
  await switchTo("Personal workspace");
  await select("Original source");
  assert.match((await body()).json, /Pending edit/);
  await switchTo(externalName);
  await page.getByRole("alert").waitFor();
  assert.match((await body()).json, /Pending edit/);
  await movePath(offline, manifest);
  await click(`Open ${externalName}`);
  await select("Original source");
  assert.match((await body()).json, /External-only edit/);
  console.log(
    "PASS external selection, canonical catalog, save failure/retry, shared references, backup, restart and offline recovery",
    interactive
      ? "with native open/relocation dialogs"
      : "with seeded external catalog",
    root,
  );
} finally {
  await stop();
}
