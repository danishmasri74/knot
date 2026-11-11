import { chromium } from "playwright";
import assert from "node:assert/strict";

// Reopening a canvas after a full page reload must reuse saved preview SVGs,
// recapture only edited cards, and prune deleted cards from the cache.
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/card-deck-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="editor" style="width:1000px;height:850px"></div></body></html>',
    }),
  );
  const origin = process.env.KNOT_TEST_ORIGIN ?? "http://127.0.0.1:1420";

  // Load the harness with persisted documents and cache files from a previous
  // "session", open Board A on the canvas and run the real loading gate.
  async function open(state, seed) {
    await page.goto(`${origin}/card-deck-test`);
    return page.evaluate(
      async ({ state, seed }) => {
        const RefreshRuntime = (await import("/@react-refresh")).default;
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import("/src/styles/app.css");
        await import("/node_modules/@toeverything/theme/dist/style.css?import");
        const catalog = [
          { id: "a", title: "Board A", kind: "whiteboard", updated_at: 1 },
        ];
        window.saved = state.saved;
        window.deck = state.deck;
        window.disk = new Map(
          state.disk.map(([key, fingerprint, bytes]) => [
            key,
            { fingerprint, bytes: new Uint8Array(bytes) },
          ]),
        );
        window.prunes = [];
        window.__TAURI_INTERNALS__ = {
          invoke: async (cmd, args, options) => {
            if (cmd === "filter_objects")
              return args.offset === 0 ? catalog : [];
            if (cmd === "load_document") return window.saved[args.id] ?? null;
            if (cmd === "load_card_deck") return window.deck;
            if (cmd === "save_documents") {
              for (const write of args.documents)
                window.saved[write.id] = write.snapshot;
              window.deck = args.deck;
              return;
            }
            if (cmd === "list_blobs") return [];
            if (cmd === "canvas_preview_load") {
              const parts = args.keys.map(([note, fingerprint]) => {
                const entry = window.disk.get(`${args.document}/${note}`);
                return entry?.fingerprint === fingerprint
                  ? entry.bytes
                  : new Uint8Array();
              });
              const out = new Uint8Array(
                parts.reduce((sum, part) => sum + 4 + part.length, 0),
              );
              const view = new DataView(out.buffer);
              let offset = 0;
              for (const part of parts) {
                view.setUint32(offset, part.length, true);
                out.set(part, offset + 4);
                offset += 4 + part.length;
              }
              return out.buffer;
            }
            if (cmd === "canvas_preview_save") {
              const headers = options.headers;
              const get = (name) =>
                headers instanceof Headers ? headers.get(name) : headers[name];
              assert(args instanceof Uint8Array);
              window.disk.set(`${get("knot-document")}/${get("knot-note")}`, {
                fingerprint: get("knot-fingerprint"),
                bytes: args.slice(),
              });
              return;
            }
            if (cmd === "canvas_preview_prune") {
              window.prunes.push(args);
              for (const key of [...window.disk.keys()])
                if (
                  key.startsWith(`${args.document}/`) &&
                  !args.keep.includes(key.slice(args.document.length + 1))
                )
                  window.disk.delete(key);
              return 0;
            }
            throw Error("Unexpected " + cmd);
          },
        };
        function assert(condition) {
          if (!condition) throw Error("Raw preview body expected");
        }
        const { openEditor } = await import(
          "/src/features/editor/blocksuite/adapter.ts"
        );
        window.cache = await import(
          "/src/features/editor/blocksuite/canvas-preview-cache.ts"
        );
        window.session = await openEditor(catalog[0], () => {});
        document.querySelector("#editor").append(window.session.editor);
        await new Promise((resolve) => {
          const wait = () =>
            document.querySelector(
              "affine-edgeless-note .affine-note-block-container",
            )
              ? resolve()
              : requestAnimationFrame(wait);
          wait();
        });
        const doc = window.session.doc;
        if (seed) {
          await window.session.setMode("page");
          const first = doc.getBlocksByFlavour("affine:note")[0].model;
          doc.updateBlock(first, { xywh: "[0,0,448,200]" });
          for (let i = 1; i < 41; i++) {
            const id = doc.addBlock(
              "affine:note",
              {
                xywh: JSON.stringify([10000 + i * 500, 10000, 448, 200]),
                index: "b" + i.toString().padStart(2, "0"),
              },
              doc.root,
            );
            for (let j = 0; j < 8; j++)
              doc.addBlock(
                "affine:paragraph",
                {
                  text: new doc.Text(`Note ${i} paragraph ${j}`),
                  type: j === 0 ? "h2" : "text",
                },
                id,
              );
          }
          await window.session.setMode("edgeless");
        }
        document
          .querySelector("affine-edgeless-root")
          .gfx.viewport.setViewport(1, [0, 0]);
        const { waitForEditorView } = await import(
          "/src/app/view-readiness.ts"
        );
        performance.clearMarks();
        const started = performance.now();
        await waitForEditorView(window.session.editor, "edgeless");
        const ms = performance.now() - started;
        const marks = (name) =>
          performance
            .getEntriesByName(name)
            .map((mark) => mark.detail)
            .sort();
        const previews = {};
        for (const note of document.querySelectorAll("affine-edgeless-note")) {
          const canvas = note.querySelector("[data-knot-note-preview] canvas");
          previews[note.model.id] = canvas
            ? [canvas.width, canvas.height]
            : null;
        }
        return {
          ms,
          builds: marks("knot:canvas-preview-build"),
          hits: marks("knot:canvas-preview-cache-hit"),
          previews,
          notes: doc.getBlocksByFlavour("affine:note").map((b) => b.id),
        };
      },
      { state, seed },
    );
  }
  async function exportState() {
    return page.evaluate(async () => {
      await window.session.flush();
      await window.cache.flushPreviewCache();
      return {
        saved: window.saved,
        deck: window.deck,
        disk: [...window.disk].map(([key, { fingerprint, bytes }]) => [
          key,
          fingerprint,
          [...bytes],
        ]),
      };
    });
  }

  const first = await open({ saved: {}, deck: "{}", disk: [] }, true);
  assert.equal(first.notes.length, 41);
  assert.equal(first.hits.length, 0, "An empty cache has no hits");
  assert.equal(first.builds.length, 41, "Every card is captured once");
  const afterFirst = await exportState();
  assert.equal(
    afterFirst.disk.length,
    41,
    "Every fresh capture is saved to the preview cache",
  );
  assert(
    afterFirst.disk.every(([, fingerprint]) => /^[0-9a-f]{64}$/.test(fingerprint)),
  );

  const second = await open(afterFirst, false);
  assert.deepEqual(
    second.builds,
    [],
    "An unchanged canvas reopens without capturing any card",
  );
  assert.equal(second.hits.length, 41, "Every card is restored from disk");
  assert.deepEqual(
    second.previews,
    first.previews,
    "Restored previews have the same rendered size as fresh captures",
  );
  assert(
    Object.values(second.previews).every(Boolean),
    "Every card shows a restored preview",
  );

  // Edit one card and delete another, then reopen.
  const [edited, removed] = await page.evaluate(() => {
    const doc = window.session.doc;
    const notes = doc.getBlocksByFlavour("affine:note");
    const edited = notes[5].model;
    edited.children[1].text.insert("Changed ", 0);
    const removed = notes[7].model;
    doc.deleteBlock(removed);
    return [edited.id, removed.id];
  });
  const afterEdit = await exportState();
  const third = await open(afterEdit, false);
  assert.deepEqual(third.builds, [edited], "Only the edited card is captured");
  assert.equal(third.hits.length, 39, "Unchanged cards are still restored");
  assert(!third.notes.includes(removed));
  const afterThird = await exportState();
  const cached = afterThird.disk.map(([key]) => key.slice(2));
  assert(!cached.includes(removed), "Deleted cards are pruned from the cache");
  assert.equal(cached.length, 40);
  assert.equal(
    afterThird.disk.find(([key]) => key === `a/${edited}`)[1] !==
      afterEdit.disk.find(([key]) => key === `a/${edited}`)?.[1],
    true,
    "The edited card is saved under its new fingerprint",
  );

  // A corrupt cache file falls back to a fresh capture instead of failing.
  const corrupt = {
    ...afterThird,
    disk: afterThird.disk.map((entry, i) =>
      i === 0 ? [entry[0], entry[1], [1, 2, 3]] : entry,
    ),
  };
  const fourth = await open(corrupt, false);
  assert.equal(fourth.builds.length, 1, "A corrupt entry is recaptured");
  assert.equal(fourth.hits.length, 40);

  assert.deepEqual(errors, []);
  console.log(
    "Canvas preparation ms (fresh, cached):",
    Math.round(first.ms),
    Math.round(second.ms),
  );
  console.log(
    "PASS preview cache reuse across reloads, edit invalidation, prune and corrupt-entry fallback",
  );
} finally {
  await browser.close();
}
