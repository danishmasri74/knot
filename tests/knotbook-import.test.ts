import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  buildImport,
  nextTitle,
  type InspectedPackage,
  type ImportChoice,
} from "../src/services/knotbook-import";

function notebook(
  id: string,
  title: string,
  build: (blocks: Y.Map<unknown>, links: Y.Map<string>) => void,
) {
  const envelope = new Y.Doc();
  const pages = new Y.Array<Y.Map<unknown>>();
  envelope.getMap("meta").set("pages", pages);
  const page = new Y.Map<unknown>();
  pages.push([page]);
  page.set("id", id);
  page.set("title", title);
  const body = new Y.Doc();
  build(body.getMap("blocks"), body.getMap<string>("knot:card-links"));
  return {
    collection: [...Y.encodeStateAsUpdate(envelope)],
    document: [...Y.encodeStateAsUpdate(body)],
  };
}
function read(bytes: number[]) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(bytes));
  return doc;
}

// Physics shows Waves on its canvas and mentions it inline; both use card-1.
const physics = notebook("physics", "Physics", (blocks, links) => {
  const card = new Y.Map();
  blocks.set("b1", card);
  card.set("sys:flavour", "affine:embed-synced-doc");
  card.set("prop:pageId", "waves");
  const paragraph = new Y.Map();
  blocks.set("b2", paragraph);
  const text = new Y.Text();
  paragraph.set("prop:text", text);
  text.insert(0, "see ");
  text.insert(4, "Waves", {
    reference: { type: "LinkedPage", pageId: "waves" },
  });
  links.set("instance-1", "card-1");
});
const waves = notebook("waves", "Waves", (_blocks, links) =>
  links.set("instance-2", "card-1"),
);

const pkg: InspectedPackage = {
  manifest: {
    sharedBy: "Danish",
    exportedAt: 0,
    root: "physics",
    notebooks: [
      {
        id: "physics",
        title: "Physics",
        kind: "whiteboard",
        updatedAt: 0,
        sha256: "",
        role: "root",
        parent: null,
        attachments: [],
      },
      {
        id: "waves",
        title: "Waves",
        kind: "note",
        updatedAt: 0,
        sha256: "",
        role: "canvas",
        parent: "physics",
        attachments: [],
      },
    ],
    unshared: [],
  },
  notebooks: [
    { id: "physics", ...physics, status: "new", existing_title: null },
    { id: "waves", ...waves, status: "library", existing_title: "Waves" },
  ],
  cards: { "card-1": { id: "card-1", text: "Wave speed" } },
  size: 0,
};
const all = (replace = false) =>
  new Map<string, ImportChoice>([
    ["physics", { include: true, replace: false }],
    ["waves", { include: true, replace }],
  ]);
let counter = 0;
const ids = () => `new-${++counter}`;

describe("buildImport", () => {
  it("keep both gives the copy a new ID, a free title, new cards, and repoints references", () => {
    counter = 0;
    const plan = buildImport(
      pkg,
      all(false),
      { "card-1": { id: "card-1", text: "Mine" } },
      new Set(["waves", "waves 2"]),
      ids,
    );
    const [p, w] = plan.items;
    expect(p).toMatchObject({
      sourceId: "physics",
      targetId: "physics",
      mode: "new",
      title: "Physics",
    });
    expect(w).toMatchObject({
      sourceId: "waves",
      targetId: "new-1",
      mode: "new",
      title: "Waves 3",
    });

    const body = read(p.document);
    const blocks = body.getMap<Y.Map<unknown>>("blocks");
    expect(blocks.get("b1")!.get("prop:pageId")).toBe("new-1");
    const delta = (blocks.get("b2")!.get("prop:text") as Y.Text).toDelta() as {
      attributes?: { reference?: { pageId: string } };
    }[];
    expect(delta[1].attributes?.reference?.pageId).toBe("new-1");

    // Physics (new) uses card-1 first, and the recipient's card-1 differs, so the
    // shared card gets a new ID rather than overwriting theirs.
    const cardIds = Object.keys(plan.cards);
    expect(cardIds).toHaveLength(1);
    expect(cardIds[0]).not.toBe("card-1");
    expect((plan.cards[cardIds[0]] as { id: string }).id).toBe(cardIds[0]);
    expect(body.getMap<string>("knot:card-links").get("instance-1")).toBe(
      cardIds[0],
    );

    const envelope = read(w.collection);
    const page = (
      envelope.getMap("meta").get("pages") as Y.Array<Y.Map<unknown>>
    ).get(0);
    expect(page.get("id")).toBe("new-1");
    expect(page.get("title")).toBe("Waves 3");
  });

  it("replace keeps IDs and leaves unchanged notebooks byte for byte", () => {
    const plan = buildImport(pkg, all(true), {}, new Set(), ids);
    expect(plan.items.map((i) => [i.targetId, i.mode])).toEqual([
      ["physics", "new"],
      ["waves", "replace"],
    ]);
    expect(plan.items[0].document).toBe(pkg.notebooks[0].document);
    expect(plan.items[1].collection).toBe(pkg.notebooks[1].collection);
    expect(Object.keys(plan.cards)).toEqual(["card-1"]);
  });

  it("only imports what's ticked", () => {
    const choices = new Map<string, ImportChoice>([
      ["physics", { include: false, replace: false }],
      ["waves", { include: true, replace: true }],
    ]);
    expect(
      buildImport(pkg, choices, {}, new Set(), ids).items.map(
        (i) => i.sourceId,
      ),
    ).toEqual(["waves"]);
  });

  it("refuses a notebook whose envelope doesn't match its ID", () => {
    const broken: InspectedPackage = {
      ...pkg,
      notebooks: [
        { id: "physics", ...waves, status: "new", existing_title: null },
      ],
    };
    const choices = new Map([["physics", { include: true, replace: false }]]);
    expect(() => buildImport(broken, choices, {}, new Set(), ids)).toThrow();
  });
});

describe("nextTitle", () => {
  it("skips titles in use, ignoring case", () => {
    expect(nextTitle("Waves", new Set())).toBe("Waves 2");
    expect(nextTitle("Waves", new Set(["waves 2"]))).toBe("Waves 3");
    expect(nextTitle("  ", new Set())).toBe("Untitled 2");
  });
});
