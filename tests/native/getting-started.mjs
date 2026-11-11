import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/getting-started-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
const errors = [];
async function ready() {
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
      "false",
  );
}
async function invoke(command, args = {}) {
  return page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
}
async function launch(scale = 1) {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=9258 --force-device-scale-factor=${scale}`,
    },
  });
  for (let i = 0; i < 120; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9258");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Sample player loaded</h1>",
    }),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".app-shell", { timeout: 60000 });
  await ready();
  await page.waitForSelector("affine-editor-container", { timeout: 30000 });
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child?.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$tourApp=Get-Process -Id ${child.pid}; if(-not $tourApp.CloseMainWindow()){throw 'Could not close test app'}; if(-not $tourApp.WaitForExit(30000)){throw 'Test app still saving'}`,
      ],
      { windowsHide: true },
    );
  child = null;
}
async function save() {
  await page
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
  await ready();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
}
async function settings() {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await ready();
}
async function view(name) {
  await page.getByRole("button", { name, exact: true }).click();
  await ready();
}
async function note(title) {
  const button = page.getByRole("button", { name: title, exact: true }).first();
  if (!(await button.isVisible())) {
    const group = page.getByRole("region", {
      name: "Collection Getting Started",
      exact: true,
    });
    const expand = group.getByRole("button", {
      name: "Getting Started",
      exact: true,
    });
    if ((await expand.getAttribute("aria-expanded")) === "false")
      await expand.click();
  }
  await button.click();
  await ready();
}
try {
  await launch();
  console.log("first launch ready");
  const status = await invoke("getting_started_status");
  assert.ok(status.welcome_id);
  assert.equal(status.pending, false);
  const rows = await invoke("filter_objects", {
    search: "",
    offset: 0,
    collection: null,
  });
  assert.equal(rows.length, 2);
  const welcome = status.welcome_id,
    project = rows.find((r) => r.id !== welcome).id;
  const inventory = await page.evaluate(() => {
    const d = document.querySelector("affine-editor-container").doc,
      s = d.getBlocksByFlavour("affine:surface")[0].model;
    return {
      id: d.id,
      notes: d.getBlocksByFlavour("affine:note").length,
      frames: d.getBlocksByFlavour("affine:frame").length,
      math: d.getBlocksByFlavour("affine:latex").length,
      databases: d.getBlocksByFlavour("affine:database").map((b) => ({
        rows: b.model.children.length,
        mode: b.model.views[0].mode,
      })),
      elements: s.elementModels.map((e) => ({ id: e.id, type: e.type })),
      images: d.getBlocksByFlavour("affine:image").length,
    };
  });
  assert.equal(inventory.id, welcome);
  assert.equal(inventory.notes, 13);
  assert.equal(inventory.frames, 13);
  assert.equal(inventory.math, 2);
  assert.equal(inventory.images, 6);
  assert.deepEqual(
    inventory.databases.map((x) => x.mode),
    ["kanban", "table"],
  );
  assert.ok(inventory.elements.some((e) => e.type === "mindmap"));
  assert.ok(
    inventory.elements.filter((e) => e.type === "connector").length >= 5,
  );
  await page.screenshot({ path: path.join(root, "start-100.png") });
  await note("07 · Plan your tasks");
  await page.waitForSelector("affine-database");
  await page.screenshot({ path: path.join(root, "kanban.png") });
  // Exercise real persisted database cell edits, independent of fragile drag hit targets.
  await page.evaluate(() => {
    const d = document.querySelector("affine-editor-container").doc,
      b = d.getBlocksByFlavour("affine:database")[0].model,
      c = b.columns.find((c) => c.name === "Status");
    const row = b.children[0];
    row.text.delete(0, row.text.length);
    row.text.insert("Measure my own room", 0);
    d.updateBlock(b, {
      cells: {
        ...b.cells,
        [row.id]: {
          ...b.cells[row.id],
          [c.id]: { columnId: c.id, value: c.data.options[1].id },
        },
      },
    });
    const todo = d
      .getBlocksByFlavour("affine:list")
      .find((b) => b.model.type === "todo").model;
    d.updateBlock(todo, { checked: true });
  });
  await save();
  await note("08 · Use math and tables");
  await page.waitForSelector("affine-latex");
  await page.screenshot({ path: path.join(root, "math-table.png") });
  await note("11 · Organize your library");
  await page.waitForSelector("affine-image img");
  await page.screenshot({ path: path.join(root, "organize.png") });
  const media = await page.evaluate(() =>
    [...document.querySelectorAll("affine-image img")].map((i) => ({
      complete: i.complete,
      width: i.naturalWidth,
      src: i.src,
    })),
  );
  assert.ok(media.length >= 2);
  assert.ok(media.every((i) => i.complete && i.width > 0));
  await note("09 · Read and annotate PDFs");
  await page
    .getByText("Reading Corner Brief · page 1 · Open highlighted source", {
      exact: true,
    })
    .click();
  await ready();
  await page.waitForSelector(".pdf-reader canvas", { timeout: 30000 });
  await page.screenshot({ path: path.join(root, "pdf-source.png") });
  await note("13 · Watch a YouTube video");
  await page
    .frameLocator('iframe[src^="https://www.youtube.com/embed/"]')
    .getByText("Sample player loaded")
    .waitFor();
  await page.screenshot({ path: path.join(root, "youtube.png") });
  await view("Canvas");
  await page.evaluate(() => {
    const viewport = document.querySelector("affine-edgeless-root").service
      .viewport;
    viewport.setZoom(0.65);
    viewport.setCenter(3085, 4050);
  });
  await page.waitForSelector(".knot-canvas-pdf canvas", { timeout: 30000 });
  await page.screenshot({ path: path.join(root, "pdf-canvas.png") });
  assert.ok(
    await page
      .locator(".knot-canvas-pdf canvas")
      .evaluate((canvas) => canvas.width > 0 && canvas.height > 0),
  );
  await settings();
  await page
    .getByRole("button", { name: "Open Getting Started", exact: true })
    .click();
  await ready();
  assert.equal(
    (
      await invoke("filter_objects", {
        search: "",
        offset: 0,
        collection: null,
      })
    ).length,
    2,
  );
  await view("Canvas");
  await page.evaluate(() => {
    const v = document.querySelector("affine-edgeless-root").service.viewport;
    v.setZoom(0.65);
    v.setCenter(1835, 2350);
  });
  await page.screenshot({ path: path.join(root, "mindmap.png") });
  await page.evaluate(() =>
    document
      .querySelector("affine-edgeless-root")
      .service.viewport.setCenter(3085, 2400),
  );
  await page.screenshot({ path: path.join(root, "flowchart.png") });
  // A shared card must hydrate the actual source and save source edits too.
  await page.evaluate((projectId) => {
    const editor = document.querySelector("affine-editor-container");
    const source = editor.doc.collection.getDoc(projectId);
    const paragraph = source
      .getBlocksByFlavour("affine:paragraph")
      .find(({ model }) =>
        model.text.toString().startsWith("Make a comfortable"),
      );
    assertSource(paragraph);
    function assertSource(value) {
      if (!value) throw new Error("Shared source was not hydrated");
    }
    paragraph.model.text.insert("My own intention: ", 0);
  }, project);
  await save();
  await stop();
  await launch(1.5);
  await settings();
  await page
    .getByRole("button", { name: "Open Getting Started", exact: true })
    .click();
  await ready();
  await page.screenshot({ path: path.join(root, "start-150.png") });
  const persisted = await page.evaluate(() => {
    const d = document.querySelector("affine-editor-container").doc,
      b = d.getBlocksByFlavour("affine:database")[0].model,
      c = b.columns.find((c) => c.name === "Status"),
      r = b.children[0];
    return {
      text: r.text.toString(),
      status: b.cells[r.id][c.id].value,
      doing: c.data.options[1].id,
      checked: d
        .getBlocksByFlavour("affine:list")
        .find((b) => b.model.type === "todo").model.checked,
    };
  });
  assert.equal(persisted.text, "Measure my own room");
  assert.equal(persisted.status, persisted.doing);
  assert.equal(persisted.checked, true);
  assert.ok(
    await page.evaluate(
      (projectId) =>
        document
          .querySelector("affine-editor-container")
          .doc.collection.getDoc(projectId)
          .getBlocksByFlavour("affine:paragraph")
          .some(({ model }) =>
            model.text.toString().startsWith("My own intention:"),
          ),
      project,
    ),
  );
  const assets = await invoke("list_blobs", { object: welcome });
  assert.equal(assets.length, 8);
  for (const key of assets)
    assert.ok((await invoke("get_blob", { key })).length > 0);
  const health = await invoke("check_workspace");
  assert.deepEqual(health.missing, []);
  assert.deepEqual(health.corrupt, []);
  await settings();
  await page
    .getByRole("button", { name: "Create fresh copy", exact: true })
    .click();
  await ready();
  const fresh = await invoke("getting_started_status");
  assert.notEqual(fresh.welcome_id, welcome);
  assert.equal(
    (
      await invoke("filter_objects", {
        search: "",
        offset: 0,
        collection: null,
      })
    ).length,
    4,
  );
  await save();
  await invoke("delete_object", { id: fresh.welcome_id });
  assert.equal((await invoke("getting_started_status")).welcome_id, null);
  assert.equal((await invoke("getting_started_status")).pending, false);
  await invoke("restore_object", { id: fresh.welcome_id });
  assert.equal(
    (await invoke("getting_started_status")).welcome_id,
    fresh.welcome_id,
  );
  assert.ok(
    (await invoke("load_document", { id: project })).document.length > 0,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(root, "results.json"),
    JSON.stringify(
      { inventory, persisted, assets: assets.length, errors },
      null,
      2,
    ),
  );
  console.log(
    "PASS tour content, edits, persistence, PDF source, media, scaling, idempotency, fresh copy, trash/restore, integrity",
  );
  console.log(root);
} catch (error) {
  console.error(error);
  if (page) {
    console.error(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  }
  console.error("Page errors", errors);
  console.error(root);
  process.exitCode = 1;
} finally {
  await stop();
}
