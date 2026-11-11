import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { verifyPanAlignment } from "../canvas-pan-alignment.mjs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

// The source is opened read-only by SQLite's online backup API. Never copy a
// live database without its WAL, or run a benchmark against the user's files.
const label = process.argv[2] ?? "before";
const root = path.resolve(`test-results/canvas-panning-${label}`);
assert.ok(root.startsWith(path.resolve("test-results") + path.sep));
await mkdir(path.join(root, "Workspace"), { recursive: true });
const source =
  process.env.KNOT_PAN_SOURCE ?? path.resolve("test-results/panning-source");
execFileSync("python", [
  "-c",
  "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()",
  path.join(source, "knot.db"),
  path.join(root, "Workspace/knot.db"),
]);
const snapshotDb = new DatabaseSync(path.join(root, "Workspace/knot.db"));
assert.ok(
  snapshotDb
    .prepare(
      "SELECT id FROM objects WHERE title='Software Testing' AND deleted_at IS NULL",
    )
    .get(),
  "Use scripts/snapshot-panning-workspace.ps1 to snapshot the active desktop workspace first",
);
snapshotDb.close();
await cp(
  path.join(source, "workspace.json"),
  path.join(root, "Workspace/workspace.json"),
);
await cp(path.join(source, "assets"), path.join(root, "Workspace/assets"), {
  recursive: true,
});
const profile = path.join(root, "webview");
const child = spawn(
  path.resolve(process.env.KNOT_BENCH_EXE ?? "src-tauri/target/debug/knot.exe"),
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
let browser;
const samples = [];
try {
  for (let i = 0; i < 150 && !browser; i++) {
    try {
      const port = (
        await readFile(
          path.join(profile, "EBWebView/DevToolsActivePort"),
          "utf8",
        )
      ).split(/\s/)[0];
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 1000,
      });
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Isolated WebView2 must start");
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(240000);
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector(".editor-area")?.getAttribute("aria-busy") ===
          "false" && !document.querySelector(".editor-area")?.inert,
    );
  await page.waitForSelector(".app-shell");
  await ready();
  if (
    (await page.getByLabel("Document title", { exact: true }).inputValue()) !==
    "Software Testing"
  ) {
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page
      .locator(".library-row-open")
      .filter({ hasText: "Software Testing" })
      .first()
      .click();
    await ready();
  }
  if (!(await page.locator("affine-edgeless-root").count()))
    await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await ready();
  await page.waitForSelector("affine-edgeless-root");
  const fixture = await page.evaluate(() => {
    const root = document.querySelector("affine-edgeless-root");
    const notes = [...root.querySelectorAll("affine-edgeless-note")];
    const chapter = notes.find(
      (n) =>
        n.textContent.includes("Chapter 2") &&
        n.textContent.includes("Fundamentals"),
    );
    if (!chapter) throw Error("Chapter 2 missing");
    const v = root.gfx.viewport;
    window.panChapter = chapter.model.id;
    window.panOriginalState = JSON.stringify(
      root.doc.spaceDoc.getMap("blocks").toJSON(),
    );
    return {
      chapter: JSON.parse(chapter.model.xywh),
      chapterId: chapter.model.id,
      cards: notes.length,
      elements: root.surfaceBlockModel.elementModels.length,
      viewport: {
        width: v.width,
        height: v.height,
        center: [v.centerX, v.centerY],
        zoom: v.zoom,
      },
      window: {
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
        screenWidth: screen.width,
        screenHeight: screen.height,
      },
      descendants: chapter.querySelectorAll("*").length,
      previews: notes.filter((n) => n.querySelector("[data-knot-note-preview]"))
        .length,
      layers: [...root.querySelector("gfx-viewport").children].map((n) => ({
        tag: n.tagName,
        z: getComputedStyle(n).zIndex,
      })),
    };
  });
  fixture.executableSha256 = createHash("sha256")
    .update(
      await readFile(
        path.resolve(
          process.env.KNOT_BENCH_EXE ?? "src-tauri/target/debug/knot.exe",
        ),
      ),
    )
    .digest("hex");
  fixture.display = JSON.parse(
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | Where-Object CurrentRefreshRate | Select-Object CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, encoding: "utf8" },
    ),
  );
  await writeFile(
    path.join(root, "fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  console.log("fixture", JSON.stringify(fixture));
  async function position(zoom, route) {
    return page.evaluate(
      async ({ zoom, route }) => {
        const root = document.querySelector("affine-edgeless-root"),
          v = root.gfx.viewport;
        const n = root.host.std.view.getBlock(window.panChapter);
        const [x, y, w] = JSON.parse(n.model.xywh);
        const center =
          route === "empty"
            ? [x + 100000, y + 100000]
            : [x + w + v.width / (2 * zoom) - 120 / zoom, y + 250];
        v.setViewport(zoom, center);
        await new Promise((r) => setTimeout(r, 1000));
        const b = root.getBoundingClientRect();
        return {
          center,
          x: b.x + Math.min(400, b.width / 2),
          y: b.y + Math.min(350, b.height / 2),
        };
      },
      { zoom, route },
    );
  }
  async function drag(start, measure = true) {
    await page.keyboard.press("Escape");
    await page.mouse.click(start.x, start.y);
    await page.keyboard.down("Space");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (measure)
      await page.evaluate(() => {
        window.panStats = {
          gaps: [],
          transforms: 0,
          mounts: 0,
          previews: 0,
          storage: 0,
          active: true,
        };
        const s = window.panStats;
        let last = performance.now();
        function frame(t) {
          if (!s.active) return;
          s.gaps.push(t - last);
          last = t;
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        window.panObserver = new MutationObserver((records) => {
          for (const r of records) {
            if (
              r.type === "attributes" &&
              r.target.matches(
                "affine-edgeless-note, affine-frame, affine-edgeless-text",
              )
            ) {
              const before = /transform:([^;]+)/.exec(r.oldValue ?? "")?.[1];
              const after = /transform:([^;]+)/.exec(
                r.target.getAttribute("style") ?? "",
              )?.[1];
              if (before !== after) s.transforms++;
            }
            if (r.type === "childList")
              for (const n of r.addedNodes)
                if (n.nodeType === 1)
                  s.mounts += n.matches?.("affine-paragraph")
                    ? 1
                    : (n.querySelectorAll?.("affine-paragraph").length ?? 0);
          }
        });
        window.panObserver.observe(
          document.querySelector("affine-edgeless-root"),
          {
            subtree: true,
            attributes: true,
            attributeFilter: ["style"],
            attributeOldValue: true,
            childList: true,
          },
        );
        performance.clearMarks("knot:canvas-preview-build");
        window.panInvoke = window.__TAURI_INTERNALS__.invoke;
        window.__TAURI_INTERNALS__.invoke = (...args) => {
          s.storage++;
          return window.panInvoke(...args);
        };
      });
    const input = await page.context().newCDPSession(page);
    const dispatched = [];
    for (let i = 1; i <= 120; i++) {
      const delta = i <= 60 ? i * 4 : (120 - i) * 4;
      // Keep input arriving while the renderer is busy. Awaiting each CDP ack
      // makes the input source itself pause during expensive paints.
      dispatched.push(
        input.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: start.x + delta,
          y: start.y + delta / 4,
          buttons: 1,
        }),
      );
      await new Promise((r) => setTimeout(r, 16));
      if (i === 60) {
        const center = await page.evaluate(() => {
          const v = document.querySelector("affine-edgeless-root").gfx.viewport;
          return [v.centerX, v.centerY];
        });
        if (Math.abs(center[0] - start.center[0]) <= 10) {
          console.log(
            "INPUT FAILURE",
            await page.evaluate(({ x, y }) => {
              const r = document.querySelector("affine-edgeless-root"),
                v = r.gfx.viewport;
              return {
                center: [v.centerX, v.centerY],
                tool: r.gfx.tool.currentToolName$.value,
                locked: v.locked,
                active: document.activeElement?.outerHTML.slice(0, 200),
                hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 300),
                rect: r.getBoundingClientRect().toJSON(),
                left: v.left,
                top: v.top,
              };
            }, start),
          );
          await page.screenshot({ path: path.join(root, "input-failure.png") });
        }
        assert.ok(
          Math.abs(center[0] - start.center[0]) > 10,
          "Intermediate viewport must move",
        );
      }
    }
    await Promise.all(dispatched);
    await input.detach();
    // Keep release/click latency separate from the movement frame distribution.
    await page.evaluate(() => {
      window.panStats.active = false;
    });
    const release = performance.now();
    await page.mouse.up();
    await page.keyboard.up("Space");
    await page.mouse.click(start.x, start.y);
    const result = await page.evaluate(async () => {
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      const s = window.panStats;
      s.active = false;
      window.panObserver.disconnect();
      window.__TAURI_INTERNALS__.invoke = window.panInvoke;
      const v = document.querySelector("affine-edgeless-root").gfx.viewport;
      const gaps = s.gaps.sort((a, b) => a - b);
      return {
        p50: gaps[Math.floor(gaps.length * 0.5)],
        p95: gaps[Math.floor(gaps.length * 0.95)],
        worst: gaps.at(-1),
        over50: gaps.filter((g) => g > 50).length,
        frames: gaps.length,
        transforms: s.transforms,
        mounts: s.mounts,
        storage: s.storage,
        previews: performance.getEntriesByName("knot:canvas-preview-build")
          .length,
        center: [v.centerX, v.centerY],
      };
    });
    result.releaseToClickMs = performance.now() - release;
    assert.ok(
      Math.abs(result.center[0] - start.center[0]) < 1 &&
        Math.abs(result.center[1] - start.center[1]) < 1,
      "Return center must match",
    );
    return result;
  }
  for (const zoom of [0.15, 1])
    for (const route of ["chapter-edge", "empty"]) {
      for (let trial = 0; trial < 5; trial++) {
        const start = await position(zoom, route);
        const result = { zoom, route, trial, start, ...(await drag(start)) };
        samples.push(result);
        await writeFile(
          path.join(root, "samples.json"),
          JSON.stringify(samples, null, 2),
        );
        console.log(JSON.stringify(result));
      }
    }
  // Trace separately: profiler overhead never contributes to trial statistics.
  const client = await page.context().newCDPSession(page);
  const start = await position(0.15, "chapter-edge");
  await client.send("Tracing.start", {
    categories: "devtools.timeline,blink,cc",
    transferMode: "ReturnAsStream",
  });
  await drag(start);
  const complete = new Promise((r) =>
    client.once("Tracing.tracingComplete", r),
  );
  await client.send("Tracing.end");
  const { stream } = await complete;
  let trace = "";
  for (;;) {
    const chunk = await client.send("IO.read", { handle: stream });
    trace += chunk.data;
    if (chunk.eof) break;
  }
  await client.send("IO.close", { handle: stream });
  await writeFile(path.join(root, "rendering-trace.json"), trace);
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(
        document
          .querySelector("affine-edgeless-root")
          .doc.spaceDoc.getMap("blocks")
          .toJSON(),
      ),
    ),
    await page.evaluate(() => window.panOriginalState),
    "Pure panning must preserve document content and geometry",
  );
  if (process.env.KNOT_PAN_ALIGNMENT === "1") await verifyPanAlignment(page);
  await page.screenshot({ path: path.join(root, "desktop.png") });
} finally {
  await browser?.close();
  if (child.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if($p -and (!$p.CloseMainWindow() -or !$p.WaitForExit(120000))){throw 'Disposable app stayed open'}; exit 0`,
      ],
      { windowsHide: true },
    );
}
