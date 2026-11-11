import { invoke } from "@tauri-apps/api/core";
import { DocCollection, Schema, Text, type Doc } from "@blocksuite/store";
import {
  AffineSchemas,
  databaseViewInitTemplate,
  type DatabaseBlockModel,
  type SurfaceBlockModel,
} from "@blocksuite/blocks";
import * as Y from "yjs";
import { pdfSourceUrl } from "../editor/blocksuite/pdf-highlights";

export interface TourStatus {
  pending: boolean;
  welcome_id: string | null;
  version: number;
}
export const tourStatus = () => invoke<TourStatus>("getting_started_status");
const assetNames = [
  "reading-corner.svg",
  "layout-study.svg",
  "reading-corner-brief.pdf",
  "project-checklist.txt",
  "create-collection.png",
  "collection-membership.png",
  "views.png",
  "document-actions.png",
];
const mime = (name: string) =>
  name.endsWith(".svg")
    ? "image/svg+xml"
    : name.endsWith(".png")
      ? "image/png"
      : name.endsWith(".pdf")
        ? "application/pdf"
        : "text/plain";
export async function createGettingStarted(fresh = false): Promise<string> {
  if (!fresh) {
    const status = await tourStatus();
    if (status.welcome_id) return status.welcome_id;
  }
  const assets = await Promise.all(
    assetNames.map(async (name) => {
      const response = await fetch(`/getting-started/${name}`);
      if (!response.ok)
        throw new Error(`Could not load Getting Started asset: ${name}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const bitmap = name.endsWith(".png")
        ? await createImageBitmap(new Blob([bytes], { type: "image/png" }))
        : null;
      const dimensions = bitmap
        ? { width: bitmap.width, height: bitmap.height }
        : null;
      bitmap?.close();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      return {
        key: `tour-${hash}`,
        name,
        mime: mime(name),
        bytes: Array.from(bytes),
        dimensions,
      };
    }),
  );
  const welcomeId = crypto.randomUUID(),
    projectId = crypto.randomUUID();
  const collection = new DocCollection({
    id: crypto.randomUUID(),
    schema: new Schema().register(AffineSchemas),
    idGenerator: () => crypto.randomUUID(),
  });
  collection.meta.initialize();
  function make(id: string, title: string) {
    const doc = collection.createDoc({ id });
    doc.load();
    collection.setDocMeta(id, { title });
    const root = doc.addBlock("affine:page", { title: new Text(title) });
    const surface = doc.addBlock("affine:surface", {}, root);
    return { doc, root, surface };
  }
  const welcome = make(welcomeId, "Welcome to Knot"),
    project = make(projectId, "Example project");
  const { doc, root, surface } = welcome;
  const board = doc.getBlock(surface)!.model as SurfaceBlockModel;
  const p = (
    parent: string,
    text: string,
    type: "text" | "h1" | "h2" | "h3" | "quote" = "text",
    target: Doc = doc,
  ) =>
    target.addBlock("affine:paragraph", { type, text: new Text(text) }, parent);
  const todo = (parent: string, text: string, checked = false) =>
    doc.addBlock(
      "affine:list",
      { type: "todo", checked, text: new Text(text) },
      parent,
    );
  const tryIt = (parent: string, text: string) => {
    p(parent, "Try it", "h3");
    p(parent, text);
  };
  const image = (
    parent: string,
    name: string,
    width: number,
    height: number,
    caption: string,
  ) => {
    const asset = assets.find((a) => a.name === name)!;
    if (asset.dimensions) {
      width = Math.min(width, asset.dimensions.width);
      height = (width * asset.dimensions.height) / asset.dimensions.width;
    }
    return doc.addBlock(
      "affine:image",
      { sourceId: asset.key, width, height, caption },
      parent,
    );
  };
  function section(index: number, title: string, intro: string) {
    const x = ((index - 1) % 3) * 1250,
      y = Math.floor((index - 1) / 3) * 1550;
    const frame = doc.addBlock(
      "affine:frame",
      {
        title: new Text(`${String(index).padStart(2, "0")} / ${title}`),
        xywh: `[${x},${y},1170,1450]`,
        background: "#f4f5f0",
      },
      surface,
    );
    const note = doc.addBlock(
      "affine:note",
      {
        xywh: `[${x + 40},${y + 60},${index === 1 ? 840 : 1090},500]`,
        background: "--affine-background-primary-color",
      },
      root,
    );
    p(note, `${String(index).padStart(2, "0")} · ${title}`, "h1");
    p(note, intro);
    doc.updateBlock(doc.getBlock(frame)!.model, {
      childElementIds: { [note]: true },
    });
    return { note, x, y, frame };
  }
  try {
    let s = section(
      1,
      "Start here",
      "A little space to think. Learn Knot by planning a reading corner: collect ideas, connect them, and turn them into action. Everything here is yours to edit.",
    );
    p(s.note, "Your first five minutes", "h2");
    todo(s.note, "Edit this sentence to describe a corner you would enjoy.");
    todo(s.note, "Tick this checkbox.");
    todo(s.note, "Switch between Page and Canvas.");
    image(
      s.note,
      "views.png",
      320,
      64,
      "Page reads your notes; Canvas shows their spatial relationships.",
    );
    p(s.note, "Find your way", "h2");
    p(
      s.note,
      "Expand Welcome to Knot in the sidebar and choose any numbered note. The Whiteboard entry returns to Canvas. On Canvas, use the hand tool to pan and the bottom-left controls to zoom. Use the collapsible table of contents to navigate to a note, or press Ctrl+Shift+Home outside a text field to see the whole board.",
    );
    p(
      s.note,
      "Follow sections 01–13 from left to right, then continue on the next row. Try the PDF in 09 · Read and annotate PDFs and the video player in 13 · Watch a YouTube video. Spatial examples live in sections 05 and 06.",
    );
    p(
      s.note,
      "Saved means your edits are stored on this device. You can change or delete these examples like any other content.",
    );
    tryIt(
      s.note,
      "Tick a box, then open 02 · Capture ideas from this notebook’s sidebar.",
    );

    s = section(
      2,
      "Capture ideas",
      "Start with a rough thought. Notes become movable cards on the whiteboard.",
    );
    p(s.note, "My reading corner", "h2");
    p(
      s.note,
      "A comfortable chair, a warm lamp, and a few favorite books. Twenty quiet minutes at the end of the day.",
    );
    image(
      s.note,
      "reading-corner.svg",
      800,
      460,
      "An original illustration for this sample project.",
    );
    p(s.note, "One question worth keeping", "h3");
    p(s.note, "Where is the light most comfortable in the evening?", "quote");
    tryIt(
      s.note,
      "Edit this idea. In Canvas, select the card edge to move or resize it. Add another card with the Note tool.",
    );

    s = section(
      3,
      "Write and format",
      "Give your ideas enough structure to find them again. Select text for formatting, or type / in a new paragraph to insert a block.",
    );
    p(s.note, "A plan with personality", "h2");
    const rich = new Y.Text();
    rich.applyDelta([
      { insert: "Make room for " },
      { insert: "quiet reading", attributes: { bold: true } },
      { insert: ", keep it " },
      { insert: "simple", attributes: { italic: true } },
      { insert: ", and " },
      {
        insert: "reuse what you own",
        attributes: { background: "var(--affine-text-highlight-yellow)" },
      },
      { insert: ". " },
      { insert: "Buy everything today", attributes: { strike: true } },
    ]);
    doc.addBlock("affine:paragraph", { text: new Text(rich) }, s.note);
    p(s.note, "Small steps", "h3");
    doc.addBlock(
      "affine:list",
      { type: "bulleted", text: new Text("Comfort before decoration") },
      s.note,
    );
    doc.addBlock(
      "affine:list",
      { type: "numbered", text: new Text("Measure the available space") },
      s.note,
    );
    doc.addBlock(
      "affine:list",
      { type: "numbered", text: new Text("Try a chair you already own") },
      s.note,
    );
    todo(s.note, "Test the evening light");
    p(s.note, "A good corner invites you to stay.", "quote");
    doc.addBlock("affine:divider", {}, s.note);
    doc.addBlock(
      "affine:code",
      {
        language: "javascript",
        text: new Text(
          "const minutesPerDay = 20;\nconst weeklyReading = minutesPerDay * 7;",
        ),
      },
      s.note,
    );
    tryIt(
      s.note,
      "Bold a phrase, add a checklist item, then type / to explore headings, lists, tables, and more.",
    );

    s = section(
      4,
      "Collect sources",
      "Keep links, images, PDFs, and files beside your notes. Bundled assets work without an internet connection.",
    );
    const link = new Text([
      {
        insert: "Browse public-domain books at Project Gutenberg",
        attributes: { link: "https://www.gutenberg.org/" },
      },
    ]);
    doc.addBlock("affine:paragraph", { text: link }, s.note);
    doc.addBlock(
      "affine:bookmark",
      {
        url: "https://www.gutenberg.org/",
        title: "Project Gutenberg",
        description:
          "An external source for reading inspiration. Opening the website needs internet access.",
      },
      s.note,
    );
    image(
      s.note,
      "layout-study.svg",
      640,
      368,
      "A simple layout study: leave a clear walking path.",
    );
    const checklist = assets.find((a) => a.name === "project-checklist.txt")!;
    doc.addBlock(
      "affine:attachment",
      {
        sourceId: checklist.key,
        name: checklist.name,
        type: checklist.mime,
        size: checklist.bytes.length,
      },
      s.note,
    );
    image(
      s.note,
      "document-actions.png",
      300,
      350,
      "Document actions → Attach imports a copy; your original stays untouched.",
    );
    tryIt(
      s.note,
      "Resize the image. Drag a file from Explorer onto a note or Canvas, or use Document actions → Attach.",
    );

    s = section(
      5,
      "Map your ideas",
      "A mind map keeps related ideas together. Switch to Canvas to explore the editable map beneath this note.",
    );
    p(
      s.note,
      "Space → quiet corner. Furniture → chair and shelf. Lighting → window and lamp. Budget → reuse first.",
    );
    tryIt(
      s.note,
      "In Canvas, select a branch to rename it. Use its contextual controls to add another idea.",
    );
    const nodes: Record<string, { index: string; parent?: string }> = {};
    const shape = (
      text: string,
      x: number,
      y: number,
      w = 180,
      h = 65,
      shapeType = "rect",
      fillColor = "#dce9df",
    ) =>
      board.addElement({
        type: "shape",
        xywh: JSON.stringify([x, y, w, h]),
        shapeType,
        filled: true,
        fillColor,
        strokeColor: "#54776a",
        strokeWidth: 2,
        shapeStyle: "General",
        text: new Y.Text(text),
        fontSize: 20,
        color: "#243c33",
        radius: 0.12,
      });
    const center = shape("Reading corner", s.x + 100, s.y + 660, 240, 80);
    nodes[center] = { index: "a0" };
    ["Space", "Furniture", "Lighting", "Budget"].forEach((label, i) => {
      const node = shape(label, s.x + 460, s.y + 480 + i * 200, 190, 65);
      nodes[node] = { index: `a${i}`, parent: center };
      const leaf = shape(
        ["Quiet corner", "Chair + shelf", "Window + lamp", "Reuse first"][i],
        s.x + 780,
        s.y + 480 + i * 200,
        230,
        65,
      );
      nodes[leaf] = { index: "a0", parent: node };
    });
    const mindmapId = board.addElement({
      type: "mindmap",
      children: nodes,
      style: 4,
      layoutType: 0,
    });
    doc.updateBlock(doc.getBlock(s.frame)!.model, {
      childElementIds: { [s.note]: true, [mindmapId]: true },
    });

    s = section(
      6,
      "Connect and explain",
      "Arrows make relationships visible. This flowchart uses connected native shapes, so you can move the steps and keep their connections.",
    );
    p(
      s.note,
      "Read the decision: measure → check the fit → arrange or adjust → try reading. Switch to Canvas to edit the diagram.",
    );
    tryIt(
      s.note,
      "Move the decision diamond. Change a label, or use the Connector tool to connect another step. Try the Pen and Eraser tools in the empty space.",
    );
    const connect = (
      from: string,
      to: string,
      label = "",
      source = [0.5, 1],
      target = [0.5, 0],
    ) =>
      board.addElement({
        type: "connector",
        source: { id: from, position: source },
        target: { id: to, position: target },
        mode: 1,
        stroke: "#54776a",
        strokeWidth: 2,
        rearEndpointStyle: "Arrow",
        ...(label
          ? {
              text: new Y.Text(label),
              labelDisplay: true,
              labelXYWH: [0, 0, 90, 28],
            }
          : {}),
      });
    const a = shape("Measure the space", s.x + 120, s.y + 490, 260, 75, "rect");
    const b = shape(
      "Does it fit?",
      s.x + 150,
      s.y + 650,
      200,
      150,
      "diamond",
      "#f5dfb1",
    );
    const c = shape("Arrange the corner", s.x + 120, s.y + 910, 260, 75);
    const d = shape(
      "Adjust the layout",
      s.x + 700,
      s.y + 690,
      260,
      75,
      "rect",
      "#f4dccf",
    );
    const e = shape(
      "Read for 20 minutes",
      s.x + 120,
      s.y + 1120,
      260,
      75,
      "ellipse",
    );
    const arrows = [
      connect(a, b),
      connect(b, c, "Yes"),
      connect(b, d, "No", [1, 0.5], [0, 0.5]),
      connect(d, a, "Try again", [0.5, 0], [1, 0.5]),
      connect(c, e),
    ];
    doc.updateBlock(doc.getBlock(s.frame)!.model, {
      childElementIds: Object.fromEntries(
        [s.note, a, b, c, d, e, ...arrows].map((id) => [id, true]),
      ),
    });

    s = section(
      7,
      "Plan your tasks",
      "Move work from an idea to a finished result. This is a real kanban database with editable task cards.",
    );
    const databaseId = doc.addBlock(
      "affine:database",
      { title: new Text("Reading corner tasks") },
      s.note,
    );
    const database = doc.getBlock(databaseId)!.model as DatabaseBlockModel;
    databaseViewInitTemplate(database, "kanban");
    [
      "Measure the corner",
      "Test the evening light",
      "Choose a favorite book",
      "Arrange the shelf",
    ].forEach((text, i) =>
      doc.updateBlock(database.children[i], { text: new Text(text) }),
    );
    const statusColumn = database.columns.find((c) => c.name === "Status")!;
    const options = (
      statusColumn.data as {
        options: { id: string; value: string; color: string }[];
      }
    ).options;
    const cells = { ...database.cells };
    database.children.forEach((row, i) => {
      cells[row.id] = {
        ...cells[row.id],
        [statusColumn.id]: {
          columnId: statusColumn.id,
          value: options[Math.min(i, 2)].id,
        },
      };
    });
    doc.updateBlock(database, {
      cells,
      views: database.views.map((view) => ({
        ...view,
        groupProperties: [
          ...options.map((option) => ({
            key: option.id,
            hide: false,
            manuallyCardSort: [],
          })),
          { key: "Ungroups", hide: false, manuallyCardSort: [] },
        ],
        columns: database.columns.map((column) => ({
          id: column.id,
          hide: column.type === "title",
        })),
      })),
      columns: database.columns.map((c) =>
        c.id === statusColumn.id
          ? {
              ...c,
              data: {
                ...c.data,
                options: options.map((o, i) => ({
                  ...o,
                  value: ["To do", "Doing", "Done"][i],
                })),
              },
            }
          : c,
      ),
    });
    tryIt(
      s.note,
      "Drag “Measure the corner” into Doing. Add a task for something you want to try.",
    );

    s = section(
      8,
      "Use math and tables",
      "Use a formula when a relationship is clearer than a sentence. These are fictional planning numbers, in example units.",
    );
    doc.addBlock(
      "affine:latex",
      {
        latex: "C_{total} = (C_{chair} + C_{lamp} + C_{shelf}) \\times (1 + r)",
      },
      s.note,
    );
    doc.addBlock(
      "affine:latex",
      { latex: "(120 + 35 + 45) \\times 1.10 = 220" },
      s.note,
    );
    p(
      s.note,
      "The extra 10% leaves room for small changes. Double-click a formula to edit its LaTeX.",
    );
    const tableId = doc.addBlock(
      "affine:database",
      { title: new Text("Budget notes") },
      s.note,
    );
    const table = doc.getBlock(tableId)!.model as DatabaseBlockModel;
    databaseViewInitTemplate(table, "table");
    ["Chair", "Lamp", "Shelf", "Contingency"].forEach((text, i) =>
      doc.updateBlock(table.children[i], { text: new Text(text) }),
    );
    const costId = table.columns.find((column) => column.name === "Status")!.id;
    doc.updateBlock(table, {
      columns: table.columns.map((column) =>
        column.id === costId
          ? {
              ...column,
              type: "number",
              name: "Cost",
              data: { decimal: 0, format: "number" },
            }
          : column,
      ),
      cells: Object.fromEntries(
        table.children.map((row, i) => [
          row.id,
          { [costId]: { columnId: costId, value: [120, 35, 45, 20][i] } },
        ]),
      ),
    });
    tryIt(
      s.note,
      "Change a formula and edit a table row. Formulas here display math; they do not automatically calculate database values.",
    );

    s = section(
      9,
      "Read and annotate PDFs",
      "Read a PDF beside your notes. Save useful passages as highlight cards with a route back to the source.",
    );
    const pdf = assets.find((a) => a.name === "reading-corner-brief.pdf")!;
    doc.addBlock(
      "affine:attachment",
      {
        sourceId: pdf.key,
        name: pdf.name,
        type: pdf.mime,
        size: pdf.bytes.length,
        embed: false,
      },
      s.note,
    );
    p(s.note, "A passage worth keeping", "h2");
    p(s.note, "Choose a quiet corner with comfortable light.", "quote");
    const source = new Text([
      {
        insert: "Reading Corner Brief · page 1 · Open highlighted source",
        attributes: {
          link: pdfSourceUrl({
            documentId: welcomeId,
            key: pdf.key,
            name: pdf.name,
            page: 1,
            rects: [[48 / 595, 326 / 842, 270 / 595, 16 / 842]],
          }),
        },
      },
    ]);
    doc.addBlock("affine:paragraph", { text: source }, s.note);
    p(
      s.note,
      "Document actions → PDF reader opens the reader beside your notes. Select text in the same reader to save a highlight card. Use the page and zoom controls to read comfortably.",
    );
    tryIt(
      s.note,
      "Follow the source link above. Then open PDF reader, select your own passage, and create a highlight card.",
    );
    const pdfPreview = doc.addBlock(
      "affine:attachment",
      {
        sourceId: pdf.key,
        name: pdf.name,
        type: pdf.mime,
        size: pdf.bytes.length,
        embed: true,
        style: "cubeThick",
        xywh: `[${s.x + 320},${s.y + 600},500,744]`,
      },
      surface,
    );
    doc.updateBlock(doc.getBlock(s.frame)!.model, {
      childElementIds: { [s.note]: true, [pdfPreview]: true },
    });
    p(
      s.note,
      "On Canvas, the PDF page is displayed below this note. Click Open PDF reader beneath it to read both pages. The bundled PDF works offline.",
    );

    s = section(
      10,
      "Link your knowledge",
      "One idea can appear in more than one place. A shared card stays connected to its source document.",
    );
    doc.addBlock(
      "affine:embed-linked-doc",
      { pageId: projectId, style: "horizontal" },
      s.note,
    );
    p(s.note, "Shared project note", "h2");
    doc.addBlock(
      "affine:embed-synced-doc",
      {
        pageId: projectId,
        style: "syncedDoc",
        xywh: `[${s.x + 100},${s.y + 750},900,420]`,
      },
      surface,
    );
    p(
      s.note,
      "The shared card sits below this note on Canvas. Select it and choose Open → Open this doc to edit its source. Use the header Back button to return.",
    );
    p(
      s.note,
      "Document actions → Reference can insert a link or place a shared note. Open Backlinks on Example project to see this tour pointing to it.",
    );
    tryIt(
      s.note,
      "Open Example project, change its project intention, and return to the shared card.",
    );

    s = section(
      11,
      "Organize your library",
      "Collections group notebooks. A notebook can belong to several collections without duplicating its content.",
    );
    p(s.note, "1. Create a collection", "h2");
    p(
      s.note,
      "Click + beside Library, type a name, then choose Create collection.",
    );
    image(
      s.note,
      "create-collection.png",
      450,
      320,
      "Library + opens this compact creation form.",
    );
    p(s.note, "2. Add a notebook", "h2");
    p(
      s.note,
      "Open the notebook’s ⋯ menu and check a collection. Find or create also lets you make one here.",
    );
    image(
      s.note,
      "collection-membership.png",
      360,
      290,
      "The notebook’s menu controls collection membership.",
    );
    p(s.note, "3. Keep it close", "h2");
    p(
      s.note,
      "Use the star beside the document title to favorite a notebook. Press Ctrl+K to search across your workspace.",
    );
    tryIt(
      s.note,
      "Create “My projects”, add Example project, favorite it, then search for “reading”.",
    );

    s = section(
      12,
      "Make it yours",
      "You have captured, connected, and organized a small project. Now use the space below for something of your own.",
    );
    todo(s.note, "Write a note about my own idea");
    todo(s.note, "Add an image or PDF");
    todo(s.note, "Connect two ideas on Canvas");
    todo(s.note, "Move a task into Done");
    p(s.note, "My next idea", "h2");
    p(s.note, "Start typing here…");
    p(s.note, "Explore more", "h2");
    p(
      s.note,
      "Export: Document actions → Export offers Markdown, PNG, or PDF. Exports are for sharing; use a workspace backup to preserve everything.",
    );
    p(
      s.note,
      "Backups: Settings → Backups creates and verifies local archives. Restore opens a separate workspace and retains the original.",
    );
    p(
      s.note,
      "Trash: Deleted notebooks can be restored from Trash. Items are permanently removed after 30 days; manual permanent deletion cannot be undone.",
    );
    p(
      s.note,
      "Your edits save automatically. Wait for Saved before closing. Ctrl+S flushes pending edits or retries a failed save.",
    );
    p(
      s.note,
      "You can keep, rename, or delete this tour. Settings → General lets you open it again or create a fresh copy without overwriting this one.",
    );
    tryIt(s.note, "Choose one real project and make your first note.");

    s = section(
      13,
      "Watch a YouTube video",
      "Keep a playable video beside your notes. This is a real YouTube embed, available in Page and Canvas. Playback needs an internet connection.",
    );
    p(s.note, "Sample video · Me at the zoo", "h2");
    doc.addBlock(
      "affine:embed-youtube",
      {
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        videoId: "jNQXAC9IVRw",
        title: "Me at the zoo",
        description: "A short sample to try the embedded YouTube player.",
        style: "video",
      },
      s.note,
    );
    p(s.note, "My viewing notes", "h2");
    p(s.note, "Write one detail you noticed, or a question to come back to.");
    tryIt(
      s.note,
      "Play the video, then write a note below it. To add your own, paste a YouTube link into an empty paragraph and choose the embed option.",
    );

    const projectNote = project.doc.addBlock(
      "affine:note",
      { xywh: "[40,60,700,500]" },
      project.root,
    );
    p(projectNote, "Example project", "h1", project.doc);
    p(projectNote, "Project intention", "h2", project.doc);
    p(
      projectNote,
      "Make a comfortable reading corner using furniture I already own.",
      "text",
      project.doc,
    );
    p(
      projectNote,
      "Change this sentence, then return to Welcome to Knot to see the shared card update.",
      "text",
      project.doc,
    );
    p(
      projectNote,
      "Decision: try the chair by the window for one week.",
      "quote",
      project.doc,
    );
    p(
      projectNote,
      "Open Document actions → Backlinks to find the tour that references this project.",
      "text",
      project.doc,
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const documents = [welcome, project].map(({ doc }) => {
      const single = new DocCollection({
        id: doc.id,
        schema: collection.schema,
      });
      single.meta.initialize();
      single.createDoc({ id: doc.id });
      single.setDocMeta(doc.id, {
        title: collection.meta.getDocMeta(doc.id)!.title,
      });
      const snapshot = {
        title: collection.meta.getDocMeta(doc.id)!.title,
        collection: Array.from(Y.encodeStateAsUpdate(single.doc)),
        document: Array.from(Y.encodeStateAsUpdate(doc.spaceDoc)),
      };
      for (const d of single.docs.values()) d.dispose();
      single.dispose();
      single.doc.destroy();
      return { id: doc.id, snapshot };
    });
    return await invoke<string>("install_getting_started", {
      tour: { documents, assets },
      fresh,
    });
  } finally {
    for (const d of collection.docs.values()) d.dispose();
    collection.dispose();
    collection.doc.destroy();
  }
}
