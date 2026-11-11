import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createNotebook } from "./create-notebook.mjs";

const scenario = process.argv[2] ?? "all";
assert.ok(
  ["workspace", "board", "shapes", "media", "rich", "all"].includes(scenario),
);
// Separate processes and workspaces keep earlier fixtures out of later measurements.
if (scenario === "all" || scenario === "board") {
  const scenarios =
    scenario === "all" ? ["workspace", "shapes", "media"] : ["shapes", "media"];
  for (const name of scenarios)
    execFileSync(process.execPath, [process.argv[1], name], {
      stdio: "inherit",
    });
  process.exit(0);
}
const root = path.resolve(
  process.env.KNOT_BENCH_ROOT ?? "test-results/editor-baseline-" + Date.now(),
);
await mkdir(root, { recursive: true });
assert.ok(
  root
    .toLowerCase()
    .startsWith(path.resolve("test-results").toLowerCase() + path.sep),
  "Benchmarks must use a disposable directory under test-results",
);
const profile = path.join(root, "webview");
let child, browser, page;

const rows = process.env.KNOT_DIRECT_ONLY
  ? await readFile(path.join(root, "samples.json"), "utf8")
      .then(JSON.parse)
      .catch(() => [])
  : [];
async function record(row) {
  rows.push(row);
  await writeFile(
    path.join(root, "samples.json"),
    JSON.stringify(rows, null, 2),
  );
  console.log(JSON.stringify(row));
}
const ready = () =>
  page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
        "false" &&
      document.querySelector(".editor-area")?.getAttribute("aria-busy") ===
        "false" &&
      !document.querySelector(".editor-area")?.inert,
    undefined,
    { timeout: 120000 },
  );
const clock = () => page.evaluate(() => performance.now());
async function click(button) {
  await button.click();
  await ready();
}
async function switchView(name) {
  const start = await clock();
  await click(page.getByRole("button", { name, exact: true }));
  await page.waitForSelector(
    name === "Page" ? "affine-page-root" : "affine-edgeless-root",
  );
  return (await clock()) - start;
}
async function save() {
  await click(
    page.getByRole("button", { name: "Save now / retry", exact: true }),
  );
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
}
async function typeProbe(openStart, exerciseAutosave = false) {
  const paragraph = page
    .locator('affine-paragraph [contenteditable="true"]')
    .first();
  await paragraph.click();
  const start = await clock();
  await page.keyboard.type("x");
  await page.waitForFunction(() =>
    document.querySelector("affine-paragraph")?.textContent.includes("x"),
  );
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const painted = await clock();
  const typeMs = painted - start;
  const clickToKeyMs = painted - openStart;
  const editingFrames = [];
  // Keep real edits arriving across the 600 ms autosave timer.
  if (exerciseAutosave) {
    const frames = page.evaluate(async () => {
      const gaps = [];
      const start = performance.now();
      let previous = await new Promise(requestAnimationFrame);
      while (performance.now() - start < 1300) {
        const now = await new Promise(requestAnimationFrame);
        gaps.push(now - previous);
        previous = now;
      }
      return gaps;
    });
    await page.keyboard.type("benchmark", { delay: 110 });
    editingFrames.push(...(await frames));
    for (let i = 0; i < 9; i++) await page.keyboard.press("Backspace");
  }
  await page.keyboard.press("Backspace");
  await save();
  return { typeMs, clickToKeyMs, editingFrames };
}
async function media() {
  const area = await page.locator(".editor-area").boundingBox();
  const client = await page.context().newCDPSession(page);
  const data = {
    items: [],
    files: ["knot.png", "sample.pdf"].map((f) =>
      path.resolve("tests/fixtures", f),
    ),
    dragOperationsMask: 1,
  };
  for (const type of ["dragEnter", "dragOver", "drop"])
    await client.send("Input.dispatchDragEvent", {
      type,
      x: area.x + area.width / 2,
      y: area.y + area.height / 2,
      data,
    });
  await client.detach();
  await page.waitForFunction(
    () =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:attachment").length,
  );
  await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc.updateBlock(doc.getBlocksByFlavour("affine:attachment")[0].model, {
      embed: true,
      xywh: "[-470,0,280,360]",
    });
    for (const image of doc.getBlocksByFlavour("affine:image"))
      doc.updateBlock(image.model, { xywh: "[-470,440,240,160]" });
  });
  await page.waitForSelector(".knot-canvas-pdf canvas");
  await save();
}
async function canvasInput(
  kind,
  button = page.getByRole("button", { name: "Canvas", exact: true }),
) {
  const start = await clock();
  await button.click();
  await ready();
  const root = page.locator("affine-edgeless-root");
  let typeTarget;
  let pdfPendingDuringPan = false;
  if (kind === "pan") {
    const before = await root.evaluate((r) => {
      const v = r.gfx.viewport,
        initial = [v.centerX, v.centerY];
      window.benchPdfPan = false;
      window.benchPanObserver = v.viewportUpdated.on(() => {
        if (
          (v.centerX !== initial[0] || v.centerY !== initial[1]) &&
          r.querySelector(".knot-canvas-pdf[aria-busy=true]")
        )
          window.benchPdfPan = true;
      });
      return initial;
    });
    const box = await root.boundingBox();
    // Use blank space away from the opening note and toolbar. Wheel input
    // in WebView2's CDP can target HTML instead of the Canvas.
    const x = box.x + box.width * 0.25,
      y = box.y + box.height * 0.2;
    await page.mouse.click(x, y);
    await page.keyboard.down("Space");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y + 65, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await page.waitForFunction(
      ([x, y]) => {
        const v = document.querySelector("affine-edgeless-root").service
          .viewport;
        return v.center.x !== x || v.center.y !== y;
      },
      before,
      { timeout: 10000 },
    );
    pdfPendingDuringPan = await page.evaluate(() => {
      window.benchPanObserver.dispose();
      return window.benchPdfPan;
    });
  } else {
    const text = page
      .locator('affine-edgeless-note affine-paragraph [contenteditable="true"]')
      .first();
    await page
      .locator("affine-edgeless-note")
      .first()
      .dblclick({ force: true, position: { x: 224, y: 46 } });
    await page.waitForFunction(
      () =>
        document.querySelector("affine-edgeless-root")?.gfx.selection.editing &&
        document
          .querySelector("affine-edgeless-root")
          ?.gfx.selection.has(
            document.querySelector("affine-edgeless-note").model.id,
          ),
      undefined,
      { timeout: 5000 },
    );
    // Selection may enter note editing before WebView2 establishes a caret.
    // Send a real click to place it, then verify the model receives the key.
    await text.click({ force: true, position: { x: 180, y: 12 } });
    typeTarget = await text.evaluate((el) => {
      const model = el.closest("affine-paragraph").model;
      return { id: model.id, text: model.text.toString() };
    });
    await page.keyboard.press("End");
    await page.keyboard.type("q");
    await page.waitForFunction(
      () =>
        [
          ...document.querySelectorAll("affine-edgeless-note affine-paragraph"),
        ].some((el) => el.textContent.includes("q")),
      undefined,
      { timeout: 10000 },
    );
  }
  if (kind === "type")
    await page.waitForFunction(
      ({ id, text }) =>
        [
          ...document.querySelectorAll("affine-edgeless-note affine-paragraph"),
        ].some(
          (p) =>
            p.model.id === id &&
            p.model.text?.length === text.length + 1 &&
            p.model.text.toString().includes("q"),
        ),
      typeTarget,
    );
  const inputMs = (await clock()) - start;
  const settleMs = await page
    .evaluate(async () => {
      const editor = document.querySelector("affine-editor-container");
      let changed = performance.now();
      const observer = new MutationObserver(
        () => (changed = performance.now()),
      );
      observer.observe(editor, { subtree: true, childList: true });
      const deadline = performance.now() + 45000;
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame);
        const area = editor.getBoundingClientRect();
        const pending = [
          ...editor.querySelectorAll(
            "[data-knot-loading], .knot-canvas-pdf[aria-busy=true]",
          ),
        ].some((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            r.right > area.left &&
            r.left < area.right &&
            r.bottom > area.top &&
            r.top < area.bottom
          );
        });
        if (performance.now() - changed > 180 && !pending) break;
      }
      observer.disconnect();
      return performance.now();
    })
    .catch(() => 0);
  if (kind === "type") {
    await page.keyboard.press("Backspace");
    await save();
  }
  await root.evaluate(async (r) => {
    r.service.viewport.setViewport(1, [0, 0]);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  const phases = await page.evaluate(
    (start) =>
      performance
        .getEntries()
        .filter((e) => e.name.startsWith("knot:canvas") && e.startTime >= start)
        .map((e) => ({
          name: e.name,
          startMs: e.startTime - start,
          duration: e.duration,
        })),
    start,
  );
  return {
    inputMs,
    settleMs: settleMs ? settleMs - start : null,
    phases,
    pdfPendingDuringPan,
  };
}
async function instrumentCanvasLayer() {
  await page.evaluate(() => {
    const root = document.querySelector("affine-edgeless-root");
    const proto = Object.getPrototypeOf(root.gfx.layer);
    if (proto.knotWatchProbe) return;
    proto.knotWatchProbe = true;
    const watch = proto.watch;
    proto.watch = function (...args) {
      const start = performance.now();
      try {
        return watch.apply(this, args);
      } finally {
        performance.measure("knot:canvas-layer-watch", {
          start,
          end: performance.now(),
        });
      }
    };
  });
}
async function board(withMedia, rich = false) {
  await instrumentCanvasLayer();
  await page.evaluate(() =>
    document
      .querySelector("affine-edgeless-root")
      .service.viewport.setViewport(1, [0, 0]),
  );
  if (withMedia && !process.env.KNOT_REUSE_FIXTURE) await media();
  for (const size of rich
    ? [77]
    : (process.env.KNOT_BENCH_SIZES ?? "100,1000,5000")
        .split(",")
        .map(Number)) {
    // Build saved fixtures in Page view. Live addElement computes stacking
    // order on each insert, which measures bulk authoring instead of switching.
    await switchView("Page");
    if (rich && !process.env.KNOT_REUSE_FIXTURE)
      await page.evaluate(() => {
        const doc = document.querySelector("affine-editor-container").doc;
        const note = doc.getBlocksByFlavour("affine:note")[0].model;
        doc.updateBlock(note, { xywh: "[0,0,448,260]" });
        doc
          .getBlocksByFlavour("affine:paragraph")[0]
          .model.text.insert("Recognizable formatted canvas note", 0);
        doc.transact(() => {
          for (let i = 1; i < 41; i++) {
            const id = doc.addBlock(
              "affine:note",
              {
                xywh: JSON.stringify([
                  (i % 5) * 520,
                  Math.floor(i / 5) * 420,
                  448,
                  300,
                ]),
                index: "b" + i.toString().padStart(2, "0"),
              },
              doc.root,
            );
            for (let j = 0; j < 12; j++)
              doc.addBlock(
                "affine:paragraph",
                {
                  text: new doc.Text(
                    `Rich note ${i}: paragraph ${j}, representative formatted content for reading and editing.`,
                  ),
                  type: j === 0 ? "h2" : "text",
                },
                id,
              );
          }
        });
      });
    await page.evaluate((size) => {
      const doc = document.querySelector("affine-editor-container").doc;
      const surface = doc.getBlocksByFlavour("affine:surface")[0].model;
      const blocks = doc.spaceDoc.getMap("blocks");
      const elements = blocks.get(surface.id).get("prop:elements").get("value");
      const shapes = surface.getElementsByType("shape");
      const first =
        shapes[0]?.id ??
        surface.addElement({
          type: "shape",
          shapeType: "rect",
          xywh: "[0,0,20,20]",
          fillColor: "#b8d4be",
          strokeColor: "#456854",
        });
      const template = elements.get(first);
      doc.transact(() => {
        for (let i = Math.max(shapes.length, 1); i < size; i++) {
          const id = crypto.randomUUID();
          const shape = template.clone();
          shape.set("id", id);
          shape.set("index", "c" + i.toString(36).padStart(3, "0"));
          const x = i < 20 ? (i % 5) * 36 : 10000 + (i % 100) * 32;
          const y =
            i < 20 ? Math.floor(i / 5) * 36 : 10000 + Math.floor(i / 100) * 32;
          shape.set("xywh", JSON.stringify([x, y, 20, 20]));
          elements.set(id, shape);
        }
      });
      if (surface.getElementsByType("shape").length !== size)
        throw Error("Shape fixture count mismatch");
    }, size);
    await save();
    await switchView("Canvas");
    await page.evaluate(() =>
      document
        .querySelector("affine-edgeless-root")
        .service.viewport.setViewport(1, [0, 0]),
    );
    for (let trial = 0; trial < 5; trial++) {
      const pageStart = await clock();
      const pageMs = await switchView("Page");
      const { typeMs, clickToKeyMs, editingFrames } = await typeProbe(
        pageStart,
        true,
      );
      const panInput = await canvasInput("pan");
      await switchView("Page");
      const typeInput = await canvasInput("type");
      const canvasMs = typeInput.inputMs;
      const pan = await page.evaluate(async () => {
        const v = document.querySelector("affine-edgeless-root").service
          .viewport;
        v.setViewport(1, [0, 0]);
        const gaps = [];
        let last = await new Promise(requestAnimationFrame);
        for (let i = 0; i < 30; i++) {
          v.setCenter(i * 2, 0);
          const t = await new Promise(requestAnimationFrame);
          gaps.push(t - last);
          last = t;
        }
        v.setCenter(0, 0);
        return gaps;
      });
      await record({
        kind: "board",
        withMedia,
        rich,
        size,
        trial,
        pageMs,
        typeMs,
        canvasMs,
        panInput,
        typeInput,
        clickToKeyMs,
        pan,
        editingFrames,
      });
    }
    await rename("Canvas benchmark");
    if (process.env.KNOT_SKIP_DIRECT) continue;
    await directOpen(size, withMedia, rich);
    await click(
      page
        .locator(".document-row")
        .filter({ hasText: "Canvas benchmark" })
        .first(),
    );
    await switchView("Canvas");
  }
}
async function directOpen(size, withMedia, rich) {
  // Exercise the supported whiteboard-kind direct-open path in this disposable
  // workspace. Preserve document/card identities instead of cloning Yjs IDs.
  const target = await page.evaluate(async () => {
    const rows = await window.__TAURI_INTERNALS__.invoke("filter_objects", {
      search: "Canvas benchmark",
      offset: 0,
      collection: null,
    });
    return rows.find((row) => row.title === "Canvas benchmark");
  });
  assert.ok(target, "Saved benchmark notebook missing");
  const db = new DatabaseSync(path.join(root, "Workspace", "knot.db"));
  db.prepare("UPDATE objects SET kind='whiteboard' WHERE id=?").run(target.id);
  db.close();
  await page.evaluate(
    (id) =>
      sessionStorage.setItem(
        "blocksuite:" + id + ":edgelessViewport",
        JSON.stringify({ zoom: 1, centerX: 0, centerY: 0 }),
      ),
    target.id,
  );
  await page.evaluate(() =>
    document
      .querySelector("affine-edgeless-root")
      ?.gfx.viewport.setViewport(1, [0, 0]),
  );
  const library = () =>
    page.getByRole("button", { name: "Library", exact: true }).click();
  const source = async () => {
    await library();
    await click(
      page
        .locator(".library-row-open")
        .filter({ hasText: "Welcome to Knot" })
        .first(),
    );
    await library();
  };
  await source();
  const directPan = await canvasInput(
    "pan",
    page.locator(".library-row-open").filter({ hasText: target.title }),
  );
  await record({
    kind: "direct-canvas-pan",
    size,
    withMedia,
    rich,
    panInput: directPan,
  });
  await source();
  let directType;
  try {
    directType = await canvasInput(
      "type",
      page.locator(".library-row-open").filter({ hasText: target.title }),
    );
  } catch (error) {
    if (!process.env.KNOT_BENCH_ALLOW_TYPE_FAILURE) throw error;
    await record({
      kind: "direct-canvas",
      size,
      withMedia,
      rich,
      panInput: directPan,
      typeInput: null,
      typeFailure: String(error),
    });
    return;
  }
  await record({
    kind: "direct-canvas",
    size,
    withMedia,
    rich,
    panInput: directPan,
    typeInput: directType,
  });
  const state = () =>
    page.evaluate(() => {
      const doc = document.querySelector("affine-editor-container").doc;
      return {
        id: doc.id,
        text: doc
          .getBlocksByFlavour("affine:paragraph")
          .map((b) => b.model.text?.toString()),
        shapes:
          doc.getBlocksByFlavour("affine:surface")[0].model.elementModels
            .length,
      };
    });
  const saved = await state();
  await stop();
  await launch();
  if ((await state()).id !== saved.id) {
    await library();
    await click(
      page
        .locator(".library-row-open")
        .filter({ hasText: target.title })
        .first(),
    );
  }
  assert.deepEqual(await state(), saved);
  await record({ kind: "save-reopen", size, withMedia, rich, verified: true });
}

async function rename(name) {
  const title = page.getByLabel("Document title", { exact: true });
  await title.fill(name);
  await title.press("Enter");
  await ready();
  await save();
}
async function launch() {
  child = spawn(
    path.resolve(
      process.env.KNOT_BENCH_EXE ?? "src-tauri/target/debug/knot.exe",
    ),
    [],
    {
      windowsHide: false,
      stdio: "ignore",
      env: {
        ...process.env,
        KNOT_TEST_DATA_DIR: root,
        WEBVIEW2_USER_DATA_FOLDER: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
          "--remote-debugging-port=0 --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding",
      },
    },
  );
  for (let i = 0; i < 150 && !browser; i++) {
    try {
      const port = (
        await readFile(
          path.join(profile, "EBWebView", "DevToolsActivePort"),
          "utf8",
        )
      ).split(/\s/)[0];
      browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, {
        timeout: 1000,
      });
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Isolated WebView2 did not start");
  page = browser.contexts()[0].pages()[0];
  await page.waitForSelector("affine-editor-container", { timeout: 120000 });
  await ready();
  await access(path.join(root, "Workspace", "knot.db"));
  page.setDefaultTimeout(120000);
}
async function stop() {
  await browser?.close();
  browser = undefined;
  if (child?.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if($p -and (!$p.CloseMainWindow() -or !$p.WaitForExit(120000))){throw 'Isolated app still open'}`,
      ],
      { windowsHide: true },
    );
}
try {
  await launch();

  if (process.env.KNOT_DIRECT_ONLY) {
    await switchView("Canvas");
    await instrumentCanvasLayer();
    await directOpen(
      Number(process.env.KNOT_BENCH_SIZES ?? 5000),
      scenario === "rich",
      scenario === "rich",
    );
  } else if (scenario !== "workspace") {
    const withMedia = scenario === "media" || scenario === "rich";
    if (process.env.KNOT_REUSE_FIXTURE) {
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await click(
        page
          .locator(".library-row-open")
          .filter({ hasText: "Canvas benchmark" })
          .first(),
      );
      await switchView("Canvas");
    } else await createNotebook(page, true);
    await page.waitForSelector("affine-edgeless-root");
    await ready();
    await board(withMedia, scenario === "rich");
  }
  if (scenario === "workspace") {
    await createNotebook(page);
    await rename("Baseline target");
    await page.evaluate(() => {
      const doc = document.querySelector("affine-editor-container").doc;
      const note = doc.getBlocksByFlavour("affine:note")[0].model;
      doc.transact(() => {
        for (let i = 0; i < 150; i++)
          doc.addBlock(
            "affine:paragraph",
            { text: new doc.Text("Baseline paragraph " + i) },
            note,
          );
      });
    });
    await save();
    await createNotebook(page);
    await rename("Baseline start");
    await page.evaluate(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const rows = await invoke("filter_objects", {
        search: "Baseline",
        offset: 0,
        collection: null,
      });
      for (const row of rows)
        await invoke("set_favorite", { id: row.id, favorite: true });
    });
    let count = 0;
    for (const size of [10, 100, 1000]) {
      await page.evaluate(async (n) => {
        for (let i = 0; i < n; i++)
          await window.__TAURI_INTERNALS__.invoke("create_object", {
            kind: "note",
          });
      }, size - count);
      count = size;
      const row = (name) =>
        page.locator(".document-row").filter({ hasText: name }).first();
      // Materialize newly created bodies once, outside the timed trials.
      await click(row("Baseline target"));
      const deckButton = page.getByRole("button", {
        name: "Card Deck",
        exact: true,
      });
      await page.getByLabel("Document actions", { exact: true }).click();
      await click(deckButton);
      await page.waitForSelector(".card-deck-panel");
      await page.getByLabel("Document actions", { exact: true }).click();
      await click(deckButton);
      await click(row("Baseline start"));
      await page.evaluate(() => {
        if (window.benchReads) return;
        window.benchReads = [];
        const fetchOriginal = window.fetch.bind(window);
        window.fetch = (url, options) => {
          if (String(url).endsWith("/load_document"))
            window.benchReads.push(JSON.parse(options.body).id);
          return fetchOriginal(url, options);
        };
      });
      for (let trial = 0; trial < 5; trial++) {
        await page.evaluate(() => {
          window.benchReads.length = 0;
          window.benchPeak = 0;
          function sample() {
            window.benchPeak = Math.max(
              window.benchPeak,
              performance.memory.usedJSHeapSize,
            );
            window.benchRaf = requestAnimationFrame(sample);
          }
          sample();
        });
        const start = await clock();
        await click(row("Baseline target"));
        const openMs = (await clock()) - start;

        await page.evaluate(() => cancelAnimationFrame(window.benchRaf));

        const { typeMs, clickToKeyMs } = await typeProbe(start);
        const ids = await page.evaluate(() => [...new Set(window.benchReads)]);
        const targetId = await page
          .locator("affine-editor-container")
          .evaluate((editor) => editor.doc.id);
        assert.deepEqual(ids, [targetId]);
        const reads = ids.length;
        await record({
          kind: "workspace",
          size,
          trial,
          openMs,
          reads,
          typeMs,
          clickToKeyMs,
          peakJsHeapMiB: await page.evaluate(() => window.benchPeak / 1048576),
        });
        if (openMs > 30000) break;
        await click(row("Baseline start"));
      }
      // Force the target to be the last edited document for normal startup.
      await click(row("Baseline target"));
      await typeProbe(await clock());
      await stop();
      const coldStart = performance.now();
      await launch();
      const coldMs = performance.now() - coldStart;
      assert.equal(
        await page.getByLabel("Document title", { exact: true }).inputValue(),
        "Baseline target",
      );
      await record({ kind: "process-cold", size, coldMs });
      if (size < 1000) await click(row("Baseline start"));
    }
  }
} catch (error) {
  console.error("BENCHMARK FAILURE", error);
  throw error;
} finally {
  await stop();
}
