// OCR resource measurement (docs/WORKSPACE-OCR-PLAN.md, Verification):
// 200 distinct images and a 50-page scanned PDF in an isolated workspace.
// Samples Knot's CPU (knot.exe, where OCR runs), total system CPU and
// main-thread stalls in the window while background OCR works.
// Needs `pnpm dev` and a debug build. Leave the computer alone while it runs:
// OCR only works after 30 s without keyboard or mouse input.
// Run: node tests/native/ocr-benchmark.mjs [minutes=6]
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

const minutes = Number(process.argv[2] ?? 6);
const root = path.resolve("test-results/ocr-bench-" + Date.now());
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9299",
    KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9299",
  },
});
let browser;
for (let i = 0; i < 150 && !browser; i++)
  browser = await chromium
    .connectOverCDP("http://127.0.0.1:9299")
    .catch(() => new Promise((r) => setTimeout(r, 200)).then(() => undefined));
assert(browser);
const page = browser.contexts()[0].pages()[0];
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForSelector(".app-shell", { timeout: 90000 });

// Images of printed text, drawn in the page; each one different.
const pictures = (count, lines, width, height) =>
  page.evaluate(
    async ({ count, lines, width, height }) => {
      const out = [];
      for (let i = 0; i < count; i++) {
        const canvas = new OffscreenCanvas(width, height);
        const g = canvas.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, width, height);
        g.fillStyle = "#111";
        g.font = "28px Segoe UI";
        for (let l = 0; l < lines; l++)
          g.fillText(
            `Item ${i} line ${l}: notes about cells, energy and proteins`,
            40,
            60 + l * 44,
          );
        const blob = await canvas.convertToBlob({ type: "image/png" });
        out.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
      }
      return out;
    },
    { count, lines, width, height },
  );
const images = await pictures(200, 6, 1200, 330);
const pages = await pictures(50, 24, 1240, 1754);
const pdf = await PDFDocument.create();
for (const bytes of pages) {
  const png = await pdf.embedPng(Uint8Array.from(bytes));
  pdf.addPage([595, 842]).drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
}
const scan = Array.from(await pdf.save());

await page.evaluate(async () => {
  const { setOcrPreferences } = await import("/src/services/ai-preferences.ts");
  setOcrPreferences({ enabled: true, battery: true, paused: false });
});
await page.evaluate(
  async ({ images, scan }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const Y = await import("/node_modules/.vite/deps/yjs.js");
    const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
    c.meta.initialize();
    // 20 notes with 10 images each, and one note with the scanned PDF.
    for (let n = 0; n < 20; n++) {
      const id = await invoke("create_object", { kind: "note" });
      const d = c.createDoc({ id });
      d.load();
      const r = d.addBlock("affine:page", { title: new Text(`Photos ${n}`) });
      d.addBlock("affine:surface", {}, r);
      const note = d.addBlock("affine:note", {}, r);
      for (let i = 0; i < 10; i++) {
        const key = crypto.randomUUID();
        await invoke("put_blob", {
          object: id,
          key,
          bytes: images[n * 10 + i],
          name: `photo-${n}-${i}.png`,
          mime: "image/png",
        });
        d.addBlock("affine:image", { sourceId: key }, note);
      }
      await invoke("save_document", {
        id,
        snapshot: {
          collection: Array.from(Y.encodeStateAsUpdate(c.doc)),
          document: Array.from(Y.encodeStateAsUpdate(d.spaceDoc)),
          title: `Photos ${n}`,
        },
      });
    }
    const id = await invoke("create_object", { kind: "note" });
    const key = crypto.randomUUID();
    await invoke("put_blob", { object: id, key, bytes: scan, name: "Scan.pdf", mime: "application/pdf" });
    const d = c.createDoc({ id });
    d.load();
    const r = d.addBlock("affine:page", { title: new Text("Scan") });
    d.addBlock("affine:surface", {}, r);
    const note = d.addBlock("affine:note", {}, r);
    d.addBlock("affine:attachment", { name: "Scan.pdf", type: "application/pdf", sourceId: key, size: scan.length }, note);
    await invoke("save_document", {
      id,
      snapshot: {
        collection: Array.from(Y.encodeStateAsUpdate(c.doc)),
        document: Array.from(Y.encodeStateAsUpdate(d.spaceDoc)),
        title: "Scan",
      },
    });
    c.dispose();
    window.dispatchEvent(new Event("knot-topic-sources-changed"));
    // Main-thread stalls: gaps between 16 ms timer ticks.
    window.ocrStalls = [];
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      window.ocrStalls.push(now - last - 16);
      last = now;
    }, 16);
  },
  { images, scan },
);

// CPU sampling: knot.exe process time and total CPU, every 5 s.
const cores = os.cpus().length;
const sample = () => {
  const out = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `$p=Get-Process -Id ${child.pid}; $t=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; "$($p.TotalProcessorTime.TotalMilliseconds) $($p.WorkingSet64) $t"`,
    ],
    { windowsHide: true, encoding: "utf8" },
  ).trim();
  const [cpu, memory, total] = out.split(/\s+/).map(Number);
  return { at: Date.now(), cpu, memory, total };
};
const samples = [];
const statuses = [];
let previous = sample();
const end = Date.now() + minutes * 60000;
console.log(`Measuring for ${minutes} min. Leave the keyboard and mouse alone.`);
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, 5000));
  const now = sample();
  const status = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("ocr_status"),
  );
  const stalls = await page.evaluate(() => window.ocrStalls.splice(0));
  samples.push({
    seconds: Math.round((now.at - previous.at) / 1000),
    knotCpuPercentOfMachine:
      ((now.cpu - previous.cpu) / (now.at - previous.at) / cores) * 100,
    knotCpuPercentOfOneCore: ((now.cpu - previous.cpu) / (now.at - previous.at)) * 100,
    systemCpuPercent: now.total,
    workingSetMb: now.memory / 1048576,
    phase: status.phase,
    read: status.read,
    waiting: status.waiting,
    worstStallMs: Math.max(0, ...stalls),
    stallsOver50ms: stalls.filter((s) => s > 50).length,
  });
  statuses.push(status);
  previous = now;
  const s = samples.at(-1);
  console.log(
    `${s.phase.padEnd(11)} read ${String(s.read).padStart(3)} waiting ${String(s.waiting).padStart(3)} | Knot ${s.knotCpuPercentOfMachine.toFixed(1)}% of machine (${s.knotCpuPercentOfOneCore.toFixed(0)}% of a core) | system ${s.systemCpuPercent}% | worst stall ${s.worstStallMs.toFixed(0)} ms`,
  );
}
const reading = samples.filter((s) => s.phase === "reading" || s.phase === "resting");
const avg = (list, key) => list.reduce((n, s) => n + s[key], 0) / Math.max(1, list.length);
const summary = {
  cores,
  minutes,
  readAtEnd: samples.at(-1)?.read,
  ratePerMinute: (samples.at(-1)?.read ?? 0) / minutes,
  whileReading: {
    samples: reading.length,
    knotCpuPercentOfMachine: avg(reading, "knotCpuPercentOfMachine"),
    peakKnotCpuPercentOfMachine: Math.max(0, ...reading.map((s) => s.knotCpuPercentOfMachine)),
    systemCpuPercent: avg(reading, "systemCpuPercent"),
    worstStallMs: Math.max(0, ...reading.map((s) => s.worstStallMs)),
    stallsOver50ms: reading.reduce((n, s) => n + s.stallsOver50ms, 0),
    peakWorkingSetMb: Math.max(0, ...reading.map((s) => s.workingSetMb)),
  },
};
await writeFile(path.join(root, "ocr-benchmark.json"), JSON.stringify({ summary, samples }, null, 2));
console.log(JSON.stringify(summary, null, 2));
execFileSync(
  "powershell",
  ["-NoProfile", "-Command", `$p=Get-Process -Id ${child.pid}; [void]$p.CloseMainWindow(); [void]$p.WaitForExit(30000)`],
  { windowsHide: true },
);
await browser.close();
