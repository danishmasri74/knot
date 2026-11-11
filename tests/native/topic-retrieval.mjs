import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
const root = path.resolve("test-results/topic-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9296",
      KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9296",
    },
  });
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9296");
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
  await page
    ?.evaluate(() => {
      window.holdTopicSave = false;
      for (const done of window.releaseTopicSaves ?? []) done();
    })
    .catch(() => {});
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
  browser = null;
  child = null;
}
try {
  await launch();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 40; n++) {
    const p = pdf.addPage();
    if (n === 37)
      p.drawText("KNOT-QX-742 requires external ventilation in warm rooms.", {
        x: 40,
        y: 700,
        font,
        size: 12,
      });
  }
  const pdfBytes = Array.from(await pdf.save());
  const fixture = await page.evaluate(async (pdfBytes) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const Y = await import("/node_modules/.vite/deps/yjs.js");
    const ids = [];
    for (let i = 0; i < 225; i++)
      ids.push(await invoke("create_object", { kind: "note" }));
    ids.sort();
    const target = ids.at(-1),
      semantic = ids.at(-2);
    const c = new DocCollection({
      schema: new Schema().register(AffineSchemas),
    });
    c.meta.initialize();
    let block;
    for (const id of ids) {
      const d = c.createDoc({ id });
      d.load();
      const title =
        id === target
          ? "Closed variant"
          : id === semantic
            ? "Memory study"
            : "Fixture " + ids.indexOf(id);
      const r = d.addBlock("affine:page", { title: new Text(title) });
      d.addBlock("affine:surface", {}, r);
      const n = d.addBlock("affine:note", {}, r);
      const text =
        id === target
          ? "Product KNOT-QX-742 uses 17 watts. This unique variant has a ceramic housing."
          : id === semantic
            ? "Reviewing at increasing intervals improves durable recall."
            : "";
      const b = d.addBlock("affine:paragraph", { text: new Text(text) }, n);
      if (id === target) block = b;
      await invoke("save_document", {
        id,
        snapshot: {
          collection: Array.from(Y.encodeStateAsUpdate(c.doc)),
          document: Array.from(Y.encodeStateAsUpdate(d.spaceDoc)),
          title,
        },
      });
    }
    const pdfId = await invoke("create_object", { kind: "note" });
    const key = crypto.randomUUID();
    await invoke("put_blob", {
      object: pdfId,
      key,
      bytes: pdfBytes,
      name: "Qualification.pdf",
      mime: "application/pdf",
    });
    const pd = c.createDoc({ id: pdfId });
    pd.load();
    const pr = pd.addBlock("affine:page", { title: new Text("Qualification") });
    pd.addBlock("affine:surface", {}, pr);
    const pn = pd.addBlock("affine:note", {}, pr);
    pd.addBlock(
      "affine:attachment",
      {
        name: "Qualification.pdf",
        type: "application/pdf",
        sourceId: key,
        size: pdfBytes.length,
      },
      pn,
    );
    await invoke("save_document", {
      id: pdfId,
      snapshot: {
        collection: Array.from(Y.encodeStateAsUpdate(c.doc)),
        document: Array.from(Y.encodeStateAsUpdate(pd.spaceDoc)),
        title: "Qualification",
      },
    });
    const shared = crypto.randomUUID();
    const deck = JSON.parse(await invoke("load_card_deck"));
    deck[shared] = {
      id: shared,
      nodes: [
        {
          props: {
            "sys:flavour": { type: "json", value: "affine:paragraph" },
            "prop:type": { type: "json", value: "text" },
            "prop:text": {
              type: "text",
              delta: [{ insert: "KNOT-QX-742 uses 19 watts under peak load." }],
            },
          },
          children: [],
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await invoke("save_documents", {
      documents: [],
      deck: JSON.stringify(deck),
    });
    for (let i = 0; i < 2; i++) {
      const placement = await invoke("create_object", { kind: "whiteboard" });
      const doc = c.createDoc({ id: placement });
      doc.load();
      const root = doc.addBlock("affine:page", {
        title: new Text("Repeated placement"),
      });
      doc.addBlock("affine:surface", {}, root);
      const note = doc.addBlock("affine:note", {}, root);
      doc.addBlock(
        "affine:paragraph",
        { text: new Text("KNOT-QX-742 uses 19 watts under peak load.") },
        note,
      );
      doc.spaceDoc.getMap("knot:card-links").set(note, shared);
      doc.spaceDoc.getMap("knot:card-generations").set(note, 0);
      await invoke("save_document", {
        id: placement,
        snapshot: {
          collection: Array.from(Y.encodeStateAsUpdate(c.doc)),
          document: Array.from(Y.encodeStateAsUpdate(doc.spaceDoc)),
          title: "Repeated placement",
        },
      });
    }
    c.dispose();
    const catalog = await invoke("topic_catalog");
    return {
      target,
      semantic,
      block,
      pdfId,
      shared: "deck:" + shared,
      key,
      count: catalog.sources.length,
    };
  }, pdfBytes);
  assert(fixture.count > 200);
  // A fresh reconciler only backfills changes; request-time search never loads the catalog bodies.
  const measurements = await page.evaluate(async (fixture) => {
    const { startTopicIndex, topicIndex } =
      await import("/src/services/workspace-topic.ts");
    startTopicIndex();
    const index = topicIndex();
    const begin = performance.now();
    await index.ready;
    const backfillMs = performance.now() - begin;
    const signal = new AbortController().signal;
    const times = [];
    let exact;
    for (let n = 0; n < 5; n++) {
      const t = performance.now();
      exact = await index.search("KNOT-QX-742", signal);
      times.push(performance.now() - t);
    }
    const semantic = await index.search(
      "How can I remember material for longer?",
      signal,
    );
    const noMatch = await index.search(
      "quasar spectroscopy flux resonance",
      signal,
    );
    window.topicExpected = fixture;
    return { backfillMs, times, exact, semantic, noMatch };
  }, fixture);
  await writeFile(
    path.join(root, "retrieval.json"),
    JSON.stringify({ fixture, measurements }, null, 2),
  );
  console.log(
    JSON.stringify({
      root,
      semanticSources: measurements.semantic.citationSources.length,
    }),
  );
  assert(
    measurements.exact.citationSources.some(
      (p) => p.document === fixture.target,
    ),
  );
  assert(
    measurements.semantic.citationSources.some(
      (p) => p.document === fixture.semantic,
    ),
  );
  assert(measurements.semantic.coverage.semantic);
  assert(
    measurements.exact.citationSources.some(
      (p) => p.document === fixture.shared && p.text.includes("19 watts"),
    ),
  );
  assert(
    measurements.exact.citationSources.some(
      (p) => p.document === fixture.pdfId && p.pdf?.page === 37,
    ),
  );
  assert(measurements.exact.coverage.failed > 0);
  assert.equal(measurements.noMatch.citationSources.length, 0);
  await page.evaluate(() => {
    const original = window.fetch;
    window.topicRequests = [];
    window.topicSearchCount = 0;
    window.fetch = async (url, options) => {
      const command = String(url).split("/").at(-1);
      if (command === "save_documents" && window.holdTopicSave) {
        await new Promise((resolve) =>
          (window.releaseTopicSaves ??= []).push(resolve),
        );
      }
      if (command === "topic_search") {
        window.topicSearchCount++;
        if (window.holdTopicSearch)
          await new Promise((r) => setTimeout(r, 1500));
      }
      if (!command.startsWith("ai_")) return original(url, options);
      const args = options?.body ? JSON.parse(options.body) : {};
      if (command === "ai_connected") return response(true);
      if (command === "ai_models") return response(["gpt-5.4-mini"]);
      if (command === "ai_cancel" || command === "ai_diagnostics_outcome")
        return response(null);
      if (command === "ai_respond") {
        window.topicRequests.push(args);
        const channel = Number(args.onEvent.split(":")[1]);
        window.__TAURI_INTERNALS__.runCallback(channel, {
          index: 0,
          message: {
            delta:
              "The variant uses 17 watts. " +
              JSON.parse(args.context)
                .citationSources.map((s) => s.citation)
                .join(" "),
          },
        });
        window.__TAURI_INTERNALS__.runCallback(channel, {
          index: 1,
          end: true,
        });
        return response(null);
      }
      throw Error("Unexpected AI command " + command);
    };
    function response(data) {
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", "Tauri-Response": "ok" },
      });
    }
  });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Ask Knot", exact: true })
    .click();
  await page.getByLabel("Ask Knot message").waitFor({ timeout: 30000 });
  assert.match(await page.locator(".ask-context").textContent(), /Workspace/);
  await page
    .getByLabel("Ask Knot message")
    .fill("What do my notes say about KNOT-QX-742?");
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page.waitForFunction(() => window.topicRequests.length === 1);
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached", timeout: 120000 });
  const outbound = await page.evaluate(() => window.topicRequests[0]);
  assert.equal(JSON.parse(outbound.context).sourceMode, "workspace");
  assert.equal(outbound.image, undefined);
  assert.equal(outbound.pdfInput, undefined);
  assert(!outbound.context.includes('"vector"'));
  await page.locator(".ask-sources summary").click();
  const sources = await page.locator(".ask-sources > div").all();
  const note = page
    .locator(".ask-sources > div")
    .filter({ hasText: "ceramic housing" });
  await note.getByRole("button", { name: "Open source", exact: true }).click();
  void sources;
  await page.waitForFunction(
    (target) =>
      document.querySelector("affine-editor-container")?.doc.id === target,
    fixture.target,
    { timeout: 60000 },
  );
  await page.screenshot({ path: path.join(root, "citation.png") });
  await page.locator(".ask-sources summary").click();
  const sharedCard = page
    .locator(".ask-sources > div")
    .filter({ hasText: "19 watts under peak load" });
  await sharedCard
    .getByRole("button", { name: "Open source", exact: true })
    .click();
  await page.waitForFunction((shared) => {
    const doc = document.querySelector("affine-editor-container")?.doc;
    return doc?.root?.children.some(
      (note) => doc.spaceDoc.getMap("knot:card-links").get(note.id) === shared,
    );
  }, fixture.shared.slice(5));
  await page
    .locator("affine-editor-container")
    .getByText("KNOT-QX-742 uses 19 watts under peak load.", { exact: true })
    .first()
    .waitFor();
  await page.getByRole("tab", { name: "Ask Knot", exact: true }).click();
  const pdfSource = page
    .locator(".ask-sources > div")
    .filter({ hasText: "external ventilation" });
  await pdfSource
    .getByRole("button", { name: "Open source", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".pdf-reader")
        ?.textContent.includes("Page 37 of 40"),
    null,
    { timeout: 30000 },
  );
  await page.screenshot({ path: path.join(root, "pdf-page37.png") });
  await page.getByRole("tab", { name: "Ask Knot", exact: true }).click();
  await page
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
  await page.evaluate(() => {
    window.holdTopicSave = true;
    const doc = document.querySelector("affine-editor-container").doc;
    const block = doc.getBlocksByFlavour("affine:paragraph")[0].model;
    block.text.insert("DIRTY-ZX-901 is an unsaved retrieval checkpoint. ", 0);
    if (!block.text.toString().includes("DIRTY-ZX-901"))
      throw Error("Synthetic edit did not apply");
  });
  await page.waitForTimeout(200);
  await page.getByLabel("Ask Knot message").fill("DIRTY-ZX-901");
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached", timeout: 120000 });
  const dirtyRequest = await page.evaluate(() => ({
    context: window.topicRequests.at(-1)?.context,
    scope: document.querySelector(".ask-context")?.textContent,
    error: document.querySelector(".ask-error")?.textContent,
  }));
  if (!dirtyRequest.context?.includes("DIRTY-ZX-901"))
    console.log(
      "DIRTY FAILURE",
      JSON.stringify({ scope: dirtyRequest.scope, error: dirtyRequest.error }),
    );
  assert(dirtyRequest.context?.includes("DIRTY-ZX-901"));
  assert(
    !(
      await page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("load_card_deck"),
      )
    ).includes("DIRTY-ZX-901"),
  );
  await page.evaluate(() => {
    window.holdTopicSave = false;
    for (const done of window.releaseTopicSaves ?? []) done();
    window.releaseTopicSaves = [];
  });
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
  console.log(
    "PASS unsaved canonical card overlay replaces persisted text without persisting before save",
  );
  await page.evaluate(() => {
    window.holdTopicSave = true;
    const doc = document.querySelector("affine-editor-container").doc;
    const Text =
      doc.getBlocksByFlavour("affine:paragraph")[0].model.text.constructor;
    const note = doc.addBlock("affine:note", {}, doc.root.id);
    doc.addBlock(
      "affine:paragraph",
      {
        text: new Text("NEW-CARD-QZ-448 is a card that has never been saved."),
      },
      note,
    );
  });
  await page.waitForTimeout(200);
  await page.getByLabel("Ask Knot message").fill("NEW-CARD-QZ-448");
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached", timeout: 120000 });
  const firstSave = await page.evaluate(() =>
    JSON.parse(window.topicRequests.at(-1).context),
  );
  assert(
    firstSave.citationSources.some(
      (source) =>
        source.text.includes("NEW-CARD-QZ-448") &&
        source.id.startsWith("card:"),
    ),
  );
  assert(
    !(
      await page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("load_card_deck"),
      )
    ).includes("NEW-CARD-QZ-448"),
  );
  await page.evaluate(() => {
    window.holdTopicSave = false;
    for (const done of window.releaseTopicSaves ?? []) done();
    window.releaseTopicSaves = [];
  });
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
  console.log(
    "PASS first-save card uses its verified eligible owner without persisting dirty content",
  );
  const beforeScope = await page.evaluate(() => window.topicSearchCount);
  await page.getByRole("button", { name: "Source scope", exact: true }).click();
  await page
    .getByRole("button", { name: "No note sources", exact: true })
    .click();
  await page
    .getByLabel("Ask Knot message")
    .fill("Explain KNOT-QX-742 without notes");
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached" });
  const none = await page.evaluate(() => window.topicRequests.at(-1));
  assert.equal(JSON.parse(none.context).text, "");
  assert.equal(JSON.parse(none.context).citationSources.length, 0);
  assert.equal(none.messages.length, 1);
  assert.equal(await page.evaluate(() => window.topicSearchCount), beforeScope);
  await page.getByRole("button", { name: "Source scope", exact: true }).click();
  await page
    .getByRole("button", { name: "Automatic sources", exact: true })
    .click();
  await page.evaluate(() => {
    window.holdTopicSearch = true;
  });
  const calls = await page.evaluate(() => window.topicRequests.length);
  await page.getByLabel("Ask Knot message").fill("KNOT-QX-742");
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page.waitForFunction((n) => window.topicSearchCount > n, beforeScope);
  await page.evaluate(async () => {
    const prefs = await import("/src/services/ai-preferences.ts");
    prefs.setWorkspaceSearchEnabled(false);
  });
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => window.topicRequests.length), calls);
  await page.evaluate(async () => {
    window.holdTopicSearch = false;
    const prefs = await import("/src/services/ai-preferences.ts");
    prefs.setWorkspaceSearchEnabled(true);
  });
  console.log(
    "PASS No note sources drops prior evidence and disabling search cancels before transmission",
  );
  // Deletion is authoritative immediately, before a background reconcile.
  await page.evaluate(async (target) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    await invoke("delete_object", { id: target });
    const { topicIndex } = await import("/src/services/workspace-topic.ts");
    const result = await topicIndex().search(
      "KNOT-QX-742",
      new AbortController().signal,
    );
    if (result.citationSources.some((s) => s.document === target))
      throw Error("Trashed evidence leaked");
  }, fixture.target);
  await writeFile(
    path.join(root, "report.json"),
    JSON.stringify({ fixture, measurements, outbound }, null, 2),
  );
  console.log(
    JSON.stringify({
      root,
      backfillMs: measurements.backfillMs,
      warmMs: measurements.times,
      exact: measurements.exact.citationSources.map((s) => s.document),
      semantic: measurements.semantic.citationSources.map((s) => s.document),
    }),
  );
} finally {
  await stop();
}
