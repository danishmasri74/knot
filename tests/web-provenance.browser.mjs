import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  await page.route("**/web-provenance-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="editor" style="width:1000px;height:850px"></div></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/web-provenance-test");
  const result = await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/node_modules/.vite/deps/@blocksuite_presets_effects.js");
    await import("/node_modules/.vite/deps/@blocksuite_blocks_effects.js");
    await import("/src/styles/app.css");
    const { openEditor } =
      await import("/src/features/editor/blocksuite/adapter.ts");
    const { captureAiContext, applyAiProposal } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const { composeAiContext } =
      await import("/src/services/ai-context-composer.ts");
    const { cardRequestContext } =
      await import("/src/features/editor/blocksuite/card-suggestions.ts");
    const { structuredAiBlocks } =
      await import("/src/features/editor/blocksuite/ai.ts");
    const { exportCitedExcerpts } =
      await import("/src/features/editor/blocksuite/cited-excerpt-adapters.ts");
    const { Job } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { HtmlAdapter, MixTextAdapter } =
      await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    let snapshots = {},
      deck = "{}";
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === "filter_objects")
          return [
            { id: "web-a", title: "Web A", kind: "whiteboard", updated_at: 1 },
            { id: "web-b", title: "Web B", kind: "whiteboard", updated_at: 1 },
          ];
        if (command === "load_document") return snapshots[args.id] ?? null;
        if (command === "load_card_deck") return deck;
        if (command === "save_documents") {
          for (const doc of args.documents) snapshots[doc.id] = doc.snapshot;
          deck = args.deck;
          return;
        }
        if (command === "list_blobs") return [];
        throw Error(command);
      },
    };
    const a = await openEditor(
      { id: "web-a", title: "Web A", kind: "whiteboard", updated_at: 1 },
      () => {},
    );
    document.querySelector("#editor").append(a.editor);
    await a.editor.updateComplete;
    const attempt = {
      id: "source",
      url: "https://example.com/guide",
      state: "ready",
      capture: {
        version: 1,
        sourceId: "source",
        captureId: "capture",
        requestedUrl: "https://example.com/guide",
        finalUrl: "https://example.com/guide",
        title: "A captured guide",
        author: null,
        published: null,
        fetchedAt: "123",
        contentType: "text/html",
        method: "semantic-main-v1",
        contentHash: "hash",
        warnings: [],
        sections: [
          {
            id: "s1",
            headings: [],
            kind: "text",
            text: "Deterministic captured fact.",
          },
        ],
      },
    };
    const context = composeAiContext("{}", [attempt]);
    // A scene: two cards and an arrow, each citing the captured page.
    const card = (id, text, place) => ({
      id, kind: "card", ref: "", text, content: [], nodes: [], shape: "", in: "",
      place: place ?? { rel: "", of: "", align: "", gap: 0 }, cell: [], width: 0, color: "",
      direction: "", order: 0, role: "", sourceRefs: ["capture/s1"],
    });
    const proposal = {
      replacements: [],
      blocks: [],
      scene: {
        plan: "", anchor: { near: "", side: "" }, sections: [],
        objects: [card("a", "Supported card"), card("b", "Related card", { rel: "rightOf", of: "a", align: "", gap: 0 })],
        arrangements: [],
        connectors: [{ from: "a", to: "b", label: "supports", heads: "to", style: "", color: "", reason: "", sourceRefs: ["capture/s1"] }],
        notes: [],
      },
    };
    a.doc.resetHistory();
    const captured = {
      ...captureAiContext(a.editor, "workspace", null),
      webContext: context,
    };
    const undo = applyAiProposal(
      a.doc,
      "workspace",
      captured,
      proposal,
      "canvas",
    );
    const sourceCount = a.doc.getBlocksByFlavour("knot:web-source").length;
    if (sourceCount !== 3)
      throw Error("Per-content/connector provenance missing");
    undo();
    if (a.doc.getBlocksByFlavour("knot:web-source").length)
      throw Error("Source orphan after Undo");
    applyAiProposal(
      a.doc,
      "workspace",
      { ...captureAiContext(a.editor, "workspace", null), webContext: context },
      proposal,
      "canvas",
    );
    const job = new Job({ collection: a.collection });
    const exported = job.docToSnapshot(a.doc);
    exportCitedExcerpts(exported.blocks);
    const html = await new HtmlAdapter(job).fromDocSnapshot({
      snapshot: exported,
      assets: job.assetsManager,
    });
    const text = await new MixTextAdapter(job).fromDocSnapshot({
      snapshot: exported,
      assets: job.assetsManager,
    });
    if (
      !html.file.includes("https://example.com/guide") ||
      !text.file.includes("Deterministic captured fact.")
    )
      throw Error("Export lost evidence");
    const sourceBefore =
      a.doc.getBlocksByFlavour("knot:web-source")[0].model.evidence;
    await a.flush();
    if (!deck.includes("knot:web-source"))
      throw Error("Card Deck lost provenance");
    const cardId = Object.values(JSON.parse(deck)).find(
      (card) =>
        !card.deleted &&
        JSON.stringify(card.nodes).includes("Supported card") &&
        JSON.stringify(card.nodes).includes("knot:web-source"),
    ).id;
    a.destroy();
    const b = await openEditor(
      { id: "web-b", title: "Web B", kind: "whiteboard", updated_at: 1 },
      () => {},
    );
    document.querySelector("#editor").replaceChildren(b.editor);
    await b.editor.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await b.placeCard(cardId);
    if (
      !b.doc
        .getBlocksByFlavour("knot:web-source")
        .some(({ model }) => model.evidence === sourceBefore)
    )
      throw Error(
        "Shared card evidence changed: " +
          JSON.stringify(
            b.doc
              .getBlocksByFlavour("knot:web-source")
              .map(({ model }) => model.evidence),
          ),
      );
    await b.flush();
    b.destroy();
    const reopened = await openEditor(
      { id: "web-a", title: "Web A", kind: "whiteboard", updated_at: 1 },
      () => {},
    );
    document.querySelector("#editor").replaceChildren(reopened.editor);
    if (
      reopened.doc.getBlocksByFlavour("knot:web-source").length !== sourceCount
    )
      throw Error("Snapshot reopen lost provenance");
    const sourcedCard = reopened.doc
      .getBlocksByFlavour("affine:note")
      .find(({ model }) =>
        model.children.some((child) => child.flavour === "knot:web-source"),
      ).model;
    const improveContext = JSON.parse(
      cardRequestContext(reopened.doc.id, structuredAiBlocks(sourcedCard)),
    );
    if (
      !improveContext.citationSources.some(
        (s) => s.kind === "web" && s.ref === "capture/s1",
      )
    )
      throw Error("Card improvement lost original web evidence");
    if (improveContext.citationSources.some((s) => s.webSource))
      throw Error("Card improvement repeated serialized provenance");
    const stale = {
      ...captureAiContext(reopened.editor, "workspace", null),
      webContext: context,
    };
    reopened.doc
      .getBlocksByFlavour("affine:paragraph")[0]
      .model.text.insert("change", 0);
    let rejected = false;
    try {
      applyAiProposal(reopened.doc, "workspace", stale, proposal, "canvas");
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Stale proposal applied");
    const mindmap = {
      replacements: [],
      blocks: [],
      scene: {
        plan: "", anchor: { near: "", side: "" }, sections: [],
        objects: [{
          id: "m", kind: "mindmap", ref: "", text: "", content: [], shape: "", in: "",
          place: { rel: "", of: "", align: "", gap: 0 }, cell: [], width: 0, color: "", direction: "",
          order: 0, role: "", sourceRefs: [],
          nodes: [
            { text: "Root", parent: -1, sourceRefs: ["capture/s1"] },
            { text: "Fact", parent: 0, sourceRefs: ["capture/s1"] },
          ],
        }],
        arrangements: [],
        connectors: [],
        notes: [],
      },
    };
    const before = reopened.doc.getBlocksByFlavour("knot:web-source").length;
    const undoMap = applyAiProposal(
      reopened.doc,
      "workspace",
      {
        ...captureAiContext(reopened.editor, "workspace", null),
        webContext: context,
      },
      mindmap,
      "canvas",
    );
    await undoMap.settled;
    if (
      reopened.doc.getBlocksByFlavour("knot:web-source").length !==
      before + 2
    )
      throw Error("Mind map companion missing");
    undoMap();
    if (reopened.doc.getBlocksByFlavour("knot:web-source").length !== before)
      throw Error("Mind map Undo lost grouping");
    return {
      sourceCount,
      exported: true,
      shared: true,
      reopened: true,
      stale: rejected,
      groupedUndo: true,
    };
  });
  assert.equal(result.sourceCount, 3);
  console.log(
    "PASS canvas web provenance, connector support, one Undo, Card Deck sharing, save/reopen, HTML/text export, mind-map companion and stale protection",
    result,
  );
} finally {
  await browser.close();
}
