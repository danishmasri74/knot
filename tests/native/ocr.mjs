// Offline OCR end to end (docs/WORKSPACE-OCR-PLAN.md), in an isolated
// workspace with mocked AI replies. Needs `pnpm dev` and a debug build.
// Windows OCR only runs after 30 s without keyboard or mouse input on this
// computer, so leave the computer alone while it waits.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve("test-results/ocr-" + Date.now());
await mkdir(root, { recursive: true });
// Distinct text per source: search drops repeated copies of the same text.
const image = Array.from(await readFile("tests/fixtures/ocr-text.png"));
const board = Array.from(await readFile("tests/fixtures/ocr-board.png"));
const scan = Array.from(await readFile("tests/fixtures/ocr-scan.pdf"));
let child, browser, page;
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9298",
      KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9298",
    },
  });
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9298");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert(browser);
  page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector(".app-shell", { timeout: 90000 });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
}
async function stop() {
  if (child?.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${child.pid}; if(-not $p.CloseMainWindow()){throw 'Close failed'}; if(-not $p.WaitForExit(30000)){throw 'Save/close did not finish'}`,
      ],
      { windowsHide: true },
    );
  await browser?.close();
}
const status = () =>
  page.evaluate(() => window.__TAURI_INTERNALS__.invoke("ocr_status"));
async function search(query) {
  return page.evaluate(async (query) => {
    const { topicIndex } = await import("/src/services/workspace-topic.ts");
    const index = topicIndex();
    await index.ready;
    return index.search(query, new AbortController().signal);
  }, query);
}
async function until(check, label, ms) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last.done) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Error(`Timed out: ${label} (${JSON.stringify(last)})`);
}

try {
  await launch();
  // Allow reading on battery so the test also runs on an unplugged laptop.
  await page.evaluate(async () => {
    const { setOcrPreferences } = await import("/src/services/ai-preferences.ts");
    setOcrPreferences({ enabled: true, battery: true, paused: false });
  });
  const fixture = await page.evaluate(
    async ({ image, board, scan }) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const { DocCollection, Schema, Text } =
        await import("/node_modules/.vite/deps/@blocksuite_store.js");
      const { AffineSchemas } =
        await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
      const Y = await import("/node_modules/.vite/deps/yjs.js");
      const c = new DocCollection({
        schema: new Schema().register(AffineSchemas),
      });
      c.meta.initialize();
      async function save(id, d, title) {
        await invoke("save_document", {
          id,
          snapshot: {
            collection: Array.from(Y.encodeStateAsUpdate(c.doc)),
            document: Array.from(Y.encodeStateAsUpdate(d.spaceDoc)),
            title,
          },
        });
      }
      async function withImage(kind, title, bytes) {
        const id = await invoke("create_object", { kind });
        const key = crypto.randomUUID();
        await invoke("put_blob", {
          object: id,
          key,
          bytes,
          name: "whiteboard.png",
          mime: "image/png",
        });
        const d = c.createDoc({ id });
        d.load();
        const r = d.addBlock("affine:page", { title: new Text(title) });
        d.addBlock("affine:surface", {}, r);
        const n = d.addBlock(
          "affine:note",
          kind === "whiteboard" ? { xywh: "[0,0,600,400]" } : {},
          r,
        );
        d.addBlock("affine:paragraph", { text: new Text("Meeting photo") }, n);
        const block = d.addBlock(
          "affine:image",
          { sourceId: key, caption: "Whiteboard photo", width: 900, height: 260 },
          n,
        );
        await save(id, d, title);
        return { id, block, key };
      }
      const note = await withImage("note", "Biology meeting", image);
      const canvas = await withImage("whiteboard", "Biology board", board);
      const pdfId = await invoke("create_object", { kind: "note" });
      const pdfKey = crypto.randomUUID();
      await invoke("put_blob", {
        object: pdfId,
        key: pdfKey,
        bytes: scan,
        name: "Handout.pdf",
        mime: "application/pdf",
      });
      const pd = c.createDoc({ id: pdfId });
      pd.load();
      const pr = pd.addBlock("affine:page", { title: new Text("Handout") });
      pd.addBlock("affine:surface", {}, pr);
      const pn = pd.addBlock("affine:note", {}, pr);
      pd.addBlock(
        "affine:attachment",
        {
          name: "Handout.pdf",
          type: "application/pdf",
          sourceId: pdfKey,
          size: scan.length,
        },
        pn,
      );
      await save(pdfId, pd, "Handout");
      c.dispose();
      window.dispatchEvent(new Event("knot-topic-sources-changed"));
      return { note, canvas, pdfId, pdfKey };
    },
    { image, board, scan },
  );

  // Background OCR: the two images and page 2 of the PDF.
  console.log("Waiting for background OCR (leave the keyboard and mouse alone)…");
  const started = Date.now();
  const lookup = () =>
    page.evaluate(async (f) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const { activation } = await invoke("topic_catalog");
      const r = await invoke("ocr_lookup", {
        activation,
        units: [
          { key: f.note.key, page: 0 },
          { key: f.canvas.key, page: 0 },
          { key: f.pdfKey, page: 2 },
        ],
      });
      return r.map((lines) => !!lines?.length);
    }, fixture);
  const read = await until(
    async () => {
      const s = await status();
      const ours = await lookup();
      return { ...s, ours, done: ours.every(Boolean) };
    },
    "OCR reads the image and the scanned page",
    6 * 60000,
  );
  console.log(
    `OCR read ${read.read} items in ${Math.round((Date.now() - started) / 1000)} s (language ${read.language}).`,
  );
  // Getting Started images in the fresh workspace are read too.
  assert.equal(read.backlog, 0);

  // The renderer re-indexes the sources holding them.
  const found = await until(
    async () => {
      const r = await search("chlorophyll mitochondria ribosomes");
      const kinds = {
        note: r.citationSources.some(
          (s) => s.document === fixture.note.id && s.image?.rects?.length,
        ),
        canvas: r.citationSources.some(
          (s) => s.document === fixture.canvas.id && s.image,
        ),
        scan: r.citationSources.some(
          (s) =>
            s.document === fixture.pdfId &&
            s.ocr &&
            s.pdf?.page === 2 &&
            s.pdf.rects.length,
        ),
      };
      return { kinds, failed: r.coverage.failed, done: Object.values(kinds).every(Boolean) };
    },
    "search finds the OCR text in the note, canvas and scan",
    90000,
  ).catch(async (error) => {
    const plain = await search("Meeting photo");
    console.log(
      "DEBUG plain-text hits:",
      plain.citationSources.map((s) => [s.document, s.title]),
      "status:",
      await status(),
    );
    throw error;
  });
  assert.equal(found.failed, 0, "the scanned PDF is no longer partial");
  console.log("PASS: workspace search finds text read from the image (note and canvas) and the scanned page.");

  // Ask Knot citations, with a mocked answer citing every source.
  // Citations in Ask Knot, from a saved chat holding a finished answer that
  // cites every OCR source. No answer is generated, so nothing is sent to an
  // AI provider (Tauri's IPC can't be mocked from the page).
  const evidence = await search("chlorophyll mitochondria ribosomes");
  await page.evaluate(async (evidence) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const { active } = await invoke("workspace_catalog");
    const { saveChatRecord } = await import("/src/services/ai-chats.ts");
    const cited = evidence.citationSources.map((s) => s.citation).join(" ");
    await saveChatRecord(
      active,
      "ocr-citations",
      JSON.stringify({
        id: "ocr-citations",
        documentId: "",
        title: "OCR citations",
        updated: Date.now(),
        turns: [
          { role: "user", content: "What do my notes say about chlorophyll?" },
          {
            role: "assistant",
            content: "Your notes mention chlorophyll, mitochondria and ribosomes. " + cited,
            request: { mode: "auto", context: JSON.stringify(evidence), sourceMode: "workspace" },
          },
        ],
      }),
    );
  }, evidence);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Ask Knot", exact: true })
    .click();
  await page.getByRole("button", { name: "Chat history" }).click();
  await page.locator(".ask-history-item").filter({ hasText: "OCR citations" }).click();
  const sourcesOpen = async () => {
    await page.getByRole("tab", { name: "Ask Knot", exact: true }).click().catch(() => {});
    await page.locator(".ask-sources summary").waitFor();
    if (!(await page.locator(".ask-sources[open]").count()))
      await page.locator(".ask-sources summary").click();
  };
  await sourcesOpen();
  const imageSources = page
    .locator(".ask-sources > div")
    .filter({ hasText: "Text read from image" });
  // Getting Started pictures can be cited too.
  assert((await imageSources.count()) >= 2);
  for (const [target, words] of [
    [fixture.note, "chlorophyll"],
    [fixture.canvas, "Mitochondria"],
  ]) {
    await sourcesOpen();
    await imageSources
      .filter({ hasText: words })
      .getByRole("button", { name: "Open image" })
      .click();
    await page.waitForFunction(
      (id) => document.querySelector("affine-editor-container")?.doc.id === id,
      target.id,
      { timeout: 30000 },
    );
    await page.waitForSelector(".ocr-line-highlight", { timeout: 10000 });
    // Every mark sits on the picture it was read from.
    const placement = await page.evaluate((block) => {
      const img = document.querySelector(`[data-block-id="${block}"] img`);
      const b = img?.getBoundingClientRect();
      const marks = [...document.querySelectorAll(".ocr-line-highlight")].map(
        (m) => m.getBoundingClientRect(),
      );
      return {
        marks: marks.length,
        inside:
          !!b &&
          marks.every(
            (m) =>
              m.left >= b.left - 2 &&
              m.top >= b.top - 2 &&
              m.right <= b.right + 2 &&
              m.bottom <= b.bottom + 2,
          ),
      };
    }, target.block);
    assert.equal(placement.marks, 3, "one mark per line read");
    assert(placement.inside, `marks sit on the picture (${words})`);
    await page.screenshot({ path: path.join(root, `image-${words}.png`) });
    // Let the marks fade before the next citation.
    await page.waitForSelector(".ocr-line-highlight", { state: "detached", timeout: 10000 });
  }
  console.log("PASS: Open image reaches the note and the canvas and marks the read lines.");
  await sourcesOpen();
  const scanSource = page
    .locator(".ask-sources > div")
    .filter({ hasText: "Text read from scanned page" });
  await scanSource.getByRole("button", { name: "Open source", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".pdf-reader")?.textContent.includes("Page 2 of 2"),
    null,
    { timeout: 30000 },
  );
  await page.waitForSelector(".pdf-reader .pdf-highlight", { timeout: 15000 });
  await page.screenshot({ path: path.join(root, "scan-page2.png") });
  console.log("PASS: a scanned-page citation opens the PDF at page 2 with the lines highlighted.");

  // Phase 3: the scanned page has a selectable text layer from OCR lines.
  const layer = await page.evaluate(() => {
    const frame = document.querySelector('.pdf-reader .pdf-page[data-page="2"]');
    const spans = [...(frame?.querySelectorAll(".textLayer span") ?? [])];
    return {
      text: spans.map((s) => s.textContent).join(" | "),
      note: !!document.querySelector(".pdf-reader .pdf-ocr-note"),
      unread: document.querySelector(".pdf-reader")?.textContent.includes("hasn't read"),
    };
  });
  assert.match(layer.text, /Ribosomes build proteins/);
  assert(layer.note, "the page says its text was read from the scan");
  assert(!layer.unread);
  // Select a line and make a highlight from it, as on a text PDF.
  await page.evaluate(() => {
    const frame = document.querySelector('.pdf-reader .pdf-page[data-page="2"]');
    const span = [...frame.querySelectorAll(".textLayer span")].find((s) =>
      s.textContent.includes("Ribosomes"),
    );
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.waitForSelector(".pdf-selection-panel", { timeout: 10000 });
  await page.screenshot({ path: path.join(root, "scan-selection.png") });
  await page.keyboard.press("Escape");
  console.log("PASS: a scanned page has selectable text and a selection makes a highlight draft.");

  // Phase 3: Ask Knot finds the saved text of the open note's images.
  const noteText = await page.evaluate(async (target) => {
    const { noteImageRefs, noteImageTexts } = await import("/src/services/note-image-text.ts");
    const doc = { id: target.id, getBlocksByFlavour: (f) => document.querySelector("affine-editor-container").doc.getBlocksByFlavour(f) };
    return (await noteImageTexts(noteImageRefs(doc, null))).map((e) => e.lines.map((l) => l.text).join(" "));
  }, fixture.canvas);
  assert(noteText.some((t) => t.includes("Mitochondria release energy")), JSON.stringify(noteText));
  console.log("PASS: Ask Knot's note context gets the open canvas's image text.");

  // Phase 3: Ctrl+K search finds text in images and scans and opens them.
  for (const [query, label, check] of [
    ["Mitochondria release", "Text in image", async () => {
      await page.waitForFunction(
        (id) => document.querySelector("affine-editor-container")?.doc.id === id,
        fixture.canvas.id,
        { timeout: 30000 },
      );
      await page.waitForSelector(".ocr-line-highlight", { timeout: 10000 });
    }],
    ["Ribosomes build", "Text in scan", async () => {
      await page.waitForFunction(
        () => document.querySelector(".pdf-reader")?.textContent.includes("Page 2 of 2"),
        null,
        { timeout: 30000 },
      );
      await page.waitForSelector(".pdf-reader .pdf-highlight", { timeout: 10000 });
    }],
  ]) {
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Search workspace" });
    await box.waitFor();
    await box.fill(query);
    const hit = page.locator("#global-search-results [role=option]").filter({ hasText: label });
    await hit.first().waitFor({ timeout: 30000 }).catch(async (error) => {
      console.log(
        "DEBUG ocr_search:",
        JSON.stringify(
          await page.evaluate(async (q) => {
            const invoke = window.__TAURI_INTERNALS__.invoke;
            const { activation } = await invoke("topic_catalog");
            return invoke("ocr_search", { activation, query: q }).catch((e) => String(e));
          }, query),
        ),
        "options:",
        await page.locator("#global-search-results [role=option]").allTextContents(),
      );
      throw error;
    });
    await page.screenshot({ path: path.join(root, `search-${label.replaceAll(" ", "-")}.png`) });
    const wanted = await page.evaluate(async (q) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const { activation } = await invoke("topic_catalog");
      return invoke("ocr_search", { activation, query: q });
    }, query);
    await hit.first().click();
    await check().catch(async (error) => {
      console.log(
        "DEBUG wanted:",
        JSON.stringify(wanted.map((m) => [m.document, m.key, m.block])),
        "images in open doc:",
        JSON.stringify(
          await page.evaluate(() => {
            const doc = document.querySelector("affine-editor-container")?.doc;
            return doc
              ? doc.getBlocksByFlavour("affine:image").map(({ model }) => [model.id, model.sourceId, doc.getParent(model)?.id])
              : null;
          }),
        ),
        "deck card:",
        JSON.stringify(
          await page.evaluate(async (deckId) => {
            const deck = JSON.parse(await window.__TAURI_INTERNALS__.invoke("load_card_deck"));
            return deck[deckId]?.nodes?.map((n) => [n.props["sys:flavour"]?.value, n.props["prop:sourceId"]?.value, n.children?.map((c) => [c.props["sys:flavour"]?.value, c.props["prop:sourceId"]?.value])]);
          }, wanted[0]?.document?.slice(5)),
        ),
      );
      throw error;
    });
  }
  console.log("PASS: Ctrl+K finds text in an image and a scan and opens each with the lines marked.");

  // Pause shows in status; turning OCR off removes its passages; turning it
  // back on restores them from the cache without reading again.
  await page.evaluate(async () => {
    const { setOcrPreferences } = await import("/src/services/ai-preferences.ts");
    setOcrPreferences({ paused: true });
  });
  await until(async () => {
    const s = await status();
    return { phase: s.phase, done: s.phase === "paused" };
  }, "paused status", 70000);
  await page.evaluate(async () => {
    const { setOcrPreferences } = await import("/src/services/ai-preferences.ts");
    setOcrPreferences({ paused: false, enabled: false });
  });
  await until(async () => {
    const r = await search("chlorophyll mitochondria ribosomes");
    const left = r.citationSources.filter((s) => s.image || s.ocr).length;
    return { left, done: left === 0 };
  }, "OCR text leaves search when turned off", 90000);
  const offAt = Date.now();
  await page.evaluate(async () => {
    const { setOcrPreferences } = await import("/src/services/ai-preferences.ts");
    setOcrPreferences({ enabled: true });
  });
  await until(async () => {
    const r = await search("chlorophyll mitochondria ribosomes");
    const back = r.citationSources.filter((s) => s.image || s.ocr).length;
    return { back, done: back > 0 };
  }, "OCR text returns from the cache", 90000);
  const again = await status();
  assert.equal(again.read, read.read, "nothing was read twice");
  console.log(
    `PASS: Pause, off and on work; text came back from the cache in ${Math.round((Date.now() - offAt) / 1000)} s without reading again.`,
  );
  await stop();
  console.log("PASS: Knot closed normally.");
} catch (error) {
  await page?.screenshot({ path: path.join(root, "failure.png") }).catch(() => {});
  await stop().catch(() => {});
  throw error;
}
