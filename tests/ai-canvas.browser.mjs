import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  console.log(
    await page.evaluate(async () => {
      const { DocCollection, Schema, Text } =
        await import("/node_modules/.vite/deps/@blocksuite_store.js");
      const { AffineSchemas } =
        await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
      const { applyAiProposal, captureAiContext } =
        await import("/src/features/editor/blocksuite/ai.ts");
      const { AffineEditorContainer } =
        await import("/node_modules/.vite/deps/@blocksuite_presets.js");
      const c = new DocCollection({
        schema: new Schema().register(AffineSchemas),
      });
      c.meta.initialize();
      const d = c.createDoc();
      d.load();
      const root = d.addBlock("affine:page", { title: new Text("test") });
      d.addBlock("affine:surface", {}, root);
      const editor = new AffineEditorContainer();
      editor.doc = d;
      editor.mode = "edgeless";
      document.querySelector(".editor-area").replaceChildren(editor);
      await editor.updateComplete;
      d.resetHistory();
      const ctx = captureAiContext(editor, "test", null);
      const undo = applyAiProposal(
        d,
        "test",
        ctx,
        {
          replacements: [],
          blocks: [
            { type: "paragraph", text: "Start [S1] [S2]" },
            { type: "paragraph", text: "Finish" },
          ],
          connections: [{ from: 0, to: 1, label: "next [S3]" }],
        },
        "canvas",
      );
      if (d.getBlocksByFlavour("affine:note").length !== 2)
        throw Error("cards missing");
      if (
        d
          .getBlocksByFlavour("affine:paragraph")
          .some(({ model }) => /\[S\d+\]/.test(String(model.text)))
      )
        throw Error("Internal source markers leaked into cards");
      const surface = d.getBlocksByFlavour("affine:surface")[0].model;
      const edge = surface.elementModels[0];
      if (
        !edge ||
        String(edge.text) !== "next" ||
        !edge.source.id ||
        !edge.target.id
      )
        throw Error("connector missing");
      // Show on canvas goes to the first new card.
      if (
        d.getBlock(undo.noteId)?.model.children[0]?.text?.toString() !==
        "Start"
      )
        throw Error("first card not reported for Show on canvas");
      undo();
      if (
        d.getBlocksByFlavour("affine:note").length ||
        surface.elementModels.length
      )
        throw Error("undo failed");
      const undoMap = applyAiProposal(
        d,
        "test",
        captureAiContext(editor, "test", null),
        {
          blocks: [],
          replacements: [],
          connections: [],
          mindmap: [
            { text: "Testing [S4]", parent: -1 },
            { text: "Methods", parent: 0 },
            { text: "Unit", parent: 1 },
            { text: "Goals", parent: 0 },
          ],
        },
        "canvas",
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      const map = surface.elementModels.find(
        (element) => element.type === "mindmap",
      );
      if (
        map?.children.size !== 4 ||
        map.tree.children.length !== 2 ||
        map.tree.children[0].children.length !== 1
      )
        throw Error("Mind map hierarchy missing");
      if (
        surface.elementModels.some((element) =>
          /\[S\d+\]/.test(String(element.text)),
        )
      )
        throw Error("Internal source markers leaked into mind map");
      if (undoMap.noteId) throw Error("a mind map has no card to open");
      undoMap();
      if (surface.elementModels.length)
        throw Error("Mind map undo left elements");
      applyAiProposal(
        d,
        "test",
        captureAiContext(editor, "test", null),
        {
          replacements: [],
          blocks: Array.from({ length: 20 }, (_, i) => ({
            type: "paragraph",
            text:
              `Topic ${i}: ` +
              "Summary of the topic. ".repeat(i === 2 ? 60 : 8),
          })),
          connections: Array.from({ length: 19 }, (_, i) => ({
            from: 0,
            to: i + 1,
            label: "includes",
          })),
        },
        "canvas",
      );
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const cards = d
        .getBlocksByFlavour("affine:note")
        .map((b) => JSON.parse(b.model.xywh));
      if (
        new Set(cards.map((b) => b[0])).size !== 4 ||
        new Set(cards.map((b) => b[1])).size !== 5
      )
        throw Error("Summary was not arranged into a compact layout");
      for (let i = 0; i < cards.length; i++) {
        const [x, y, w, h] = cards[i];
        for (const [bx, by, bw, bh] of cards.slice(i + 1))
          if (!(x + w <= bx || bx + bw <= x || y + h <= by || by + bh <= y))
            throw Error("Rendered cards overlap");
      }
      if (surface.elementModels.some((edge) => edge.mode !== 1))
        throw Error("Expected elbow connectors");
      const renderer = editor.std.view.getBlock(surface.id).renderer;
      const { setAppearance } = await import("/src/services/appearance.ts");
      for (const theme of ["light", "dark"]) {
        setAppearance(theme);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const colors = surface.elementModels.map((edge) => {
          const color = renderer.getColorValue(edge.stroke, "", true);
          if (!/^#[0-9a-f]{6}$/i.test(color) || color !== edge.stroke[theme])
            throw Error(`Invalid ${theme} connector color: ${color}`);
          return color;
        });
        if (new Set(colors).size !== colors.length)
          throw Error(`Repeated connector color in ${theme} theme`);
      }

      const rich = {
        replacements: [],
        blocks: [
          {
            type: "paragraph",
            text: "Testing overview",
            children: [
              { type: "h3", text: "Key principles" },
              { type: "bulleted", text: "Test early" },
              { type: "numbered", text: "Analyze requirements" },
              { type: "todo", text: "Review the plan" },
            ],
          },
          {
            type: "table",
            text: "Comparison",
            columns: ["Type", "Scope"],
            rows: [
              ["Unit", "Component"],
              ["System", "Complete system"],
            ],
          },
          {
            type: "kanban",
            text: "Testing workflow",
            columns: ["Planned", "Running", "Complete"],
            rows: [
              ["Review requirements", "Complete"],
              ["Run tests", "Running"],
            ],
          },
        ],
        connections: [],
      };
      const undoRich = applyAiProposal(
        d,
        "test",
        captureAiContext(editor, "test", null),
        rich,
        "canvas",
      );
      const databases = d
        .getBlocksByFlavour("affine:database")
        .map((b) => b.model);
      if (
        databases.length !== 2 ||
        databases[0].views[0].mode !== "table" ||
        databases[1].views[0].mode !== "kanban"
      )
        throw Error(
          "Native data views missing: " +
            JSON.stringify(
              databases.map((b) => [
                String(b.title),
                b.views.map((v) => v.mode),
                b.children.length,
              ]),
            ),
        );
      if (databases.some((b) => b.children.length !== 2))
        throw Error("Template rows leaked");
      const table = databases[0];
      const scope = table.columns.find((c) => c.name === "Scope");
      if (
        String(table.cells[table.children[0].id][scope.id].value) !==
        "Component"
      )
        throw Error("Table cell lost");
      const status = databases[1].columns.find((c) => c.name === "Status");
      if (
        databases[1].cells[databases[1].children[0].id][status.id].value !==
        status.data.options[2].id
      )
        throw Error("Kanban group lost");
      const richCard = d.getBlocksByFlavour("affine:note")[20].model;
      if (
        richCard.children.map((b) => b.type).join(",") !==
        "h2,h3,bulleted,numbered,todo"
      )
        throw Error("Card formatting lost");
      undoRich();
      if (d.getBlocksByFlavour("affine:database").length)
        throw Error("Rich undo failed");
      applyAiProposal(
        d,
        "test",
        captureAiContext(editor, "test", null),
        rich,
        "canvas",
      );
      await editor.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 700));
      const { validateProposal } =
        await import("/src/features/editor/blocksuite/ai.ts");
      for (const invalid of [
        { type: "table", text: "Bad", columns: ["A", "B"], rows: [["one"]] },
        {
          type: "kanban",
          text: "Bad",
          columns: ["Planned"],
          rows: [["Task", "Unknown"]],
        },
        {
          type: "paragraph",
          text: "Bad",
          children: [{ type: "paragraph", text: "Nested", children: [] }],
        },
      ]) {
        let rejected = false;
        try {
          validateProposal({ replacements: [], blocks: [invalid] });
        } catch {
          rejected = true;
        }
        if (!rejected) throw Error("Malformed rich content accepted");
      }
      const { observeAiToolbar } =
        await import("/src/features/editor/blocksuite/ai-toolbar.ts");
      let captured;
      const stop = observeAiToolbar(
        () => editor,
        () => {
          captured = captureAiContext(editor, "test", null);
        },
      );
      const canvas = editor.querySelector("affine-edgeless-root");
      const notes = d
        .getBlocksByFlavour("affine:note")
        .map(({ model }) => model.id);
      for (const count of [1, 2]) {
        canvas.gfx.selection.set({
          elements: notes.slice(0, count),
          editing: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const widget = editor.querySelector("edgeless-element-toolbar-widget");
        const button = widget?.renderRoot.querySelector(
          '[aria-label="Ask AI"]',
        );
        if (!button)
          throw Error("Missing Ask AI for " + count + " selected cards");
        button.click();
        if (
          !captured?.text.includes("Topic 0:") ||
          captured.text.includes("Topic 1:") !== (count === 2)
        )
          throw Error(
            "Wrong context for " + count + " selected cards: " + captured?.text,
          );
      }
      const picture = d.addBlock(
        "affine:image",
        { sourceId: "selected-picture", xywh: "[0,0,200,120]" },
        surface.id,
      );
      canvas.gfx.selection.set({ elements: [picture], editing: false });
      if (
        captureAiContext(editor, "test", null).selectedImageKey !==
        "selected-picture"
      )
        throw Error("Canvas selection lost the image blob key");
      stop();
      canvas.gfx.selection.set({ elements: [], editing: false });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const mixed = validateProposal({
        replacements: [],
        blocks: [
          { type: "paragraph", text: "**Cause** and *context*" },
          { type: "paragraph", text: "Effect" },
        ],
        connections: [{ from: 0, to: 1, label: "leads to" }],
        mindmap: [
          { text: "Overview", parent: -1 },
          { text: "Cause", parent: 0 },
        ],
      });
      const previousNotes = d.getBlocksByFlavour("affine:note").length;
      const undoMixed = applyAiProposal(
        d,
        "test",
        captureAiContext(editor, "test", null),
        mixed,
        "canvas",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const mixedNotes = d
        .getBlocksByFlavour("affine:note")
        .slice(previousNotes);
      const mixedMap = surface.elementModels.find(
        (element) => element.type === "mindmap",
      );
      if (mixedNotes.length !== 2 || !mixedMap)
        throw Error("Mixed proposal lost content");
      const runs = mixedNotes[0].model.children[0].text.toDelta();
      if (
        !runs.some((r) => r.insert === "Cause" && r.attributes?.bold) ||
        !runs.some((r) => r.insert === "context" && r.attributes?.italic)
      )
        throw Error("Native emphasis missing");
      const mapBounds = JSON.parse(mixedMap.xywh);
      for (const { model } of mixedNotes) {
        const [x, , width] = JSON.parse(model.xywh);
        if (x + width >= mapBounds[0]) throw Error("Mixed layout overlaps");
      }
      const mixedEdge = surface.elementModels.find(
        (element) =>
          element.type === "connector" && String(element.text) === "leads to",
      );
      if (!mixedEdge || mixedEdge.rearEndpointStyle !== "Arrow")
        throw Error("Mixed arrow missing");
      undoMixed();
      if (
        d.getBlocksByFlavour("affine:note").length !== previousNotes ||
        surface.elementModels.some((element) => element.type === "mindmap")
      )
        throw Error("Mixed undo failed");
      const imageId = d.addBlock(
        "affine:image",
        { sourceId: "selected-image", xywh: "[0,0,100,100]" },
        surface.id,
      );
      const pdfId = d.addBlock(
        "affine:attachment",
        {
          sourceId: "selected-pdf",
          name: "Brief.pdf",
          type: "application/pdf",
          xywh: "[120,0,100,100]",
        },
        surface.id,
      );
      const selectionCanvas = editor.querySelector("affine-edgeless-root");
      selectionCanvas.gfx.selection.set({
        elements: [imageId],
        editing: false,
      });
      const imageContext = captureAiContext(editor, "test", null);
      if (imageContext.selectedImageKey !== "selected-image")
        throw Error("Selected image missing");
      selectionCanvas.gfx.selection.set({ elements: [pdfId], editing: false });
      const pdfContext = captureAiContext(editor, "test", null);
      if (
        pdfContext.pdfSource?.key !== "selected-pdf" ||
        pdfContext.selectionLabel !== "Brief.pdf" ||
        pdfContext.selectedImageKey
      )
        throw Error("Selected PDF missing");
      const bookmarkId = d.addBlock(
        "affine:bookmark",
        { url: "https://example.org/guide", xywh: "[240,0,100,100]" },
        surface.id,
      );
      selectionCanvas.gfx.selection.set({
        elements: [bookmarkId],
        editing: false,
      });
      const website = captureAiContext(editor, "test", null);
      if (
        website.selectionKind !== "website" ||
        website.selectionLabel !== "example.org" ||
        website.websiteUrl !== "https://example.org/guide"
      )
        throw Error("Untitled website did not use its domain");
      d.updateBlock(d.getBlock(bookmarkId).model, { title: "Example guide" });
      if (
        captureAiContext(editor, "test", null).selectionLabel !==
        "Example guide"
      )
        throw Error("Website title was not used");
      d.updateBlock(d.getBlock(bookmarkId).model, {
        url: "https://youtu.be/dQw4w9WgXcQ",
      });
      if (captureAiContext(editor, "test", null).websiteUrl)
        throw Error("A YouTube link must not be fetched as a page");
      const card = d.getBlocksByFlavour("affine:note")[0]?.model;
      if (card) {
        selectionCanvas.gfx.selection.set({
          elements: [card.id],
          editing: false,
        });
        const cardContext = captureAiContext(editor, "test", null);
        if (!cardContext.selectionLabel || cardContext.pdfSource)
          throw Error("Selected card missing");
      }
      selectionCanvas.gfx.selection.set({ elements: [], editing: false });
      const cleared = captureAiContext(editor, "test", null);
      if (
        cleared.selectedImageKey ||
        cleared.pdfSource ||
        cleared.selectionKey !== "[[],[],[]]"
      )
        throw Error("Deselect retained attachment");
      return "Canvas selection attachments, layout, native headings/lists/table/kanban, cells, validation, and undo passed";
    }),
  );
} finally {
  await browser.close();
}
