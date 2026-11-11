import { expect, test } from "vitest";
import * as Y from "yjs";
import {
  findCardPlacement,
  liveCardPlacements,
  savedCardPlacements,
} from "../src/services/topic-card-location";

function owner() {
  const doc = new Y.Doc(),
    envelope = new Y.Doc();
  envelope.getMap("meta").set("pages", [{ id: "owner" }]);
  const blocks = doc.getMap<Y.Map<unknown>>("blocks");
  const children = new Y.Array<string>();
  children.push(["placed"]);
  blocks.set(
    "root",
    new Y.Map<unknown>([
      ["sys:flavour", "affine:page"],
      ["sys:children", children],
    ]),
  );
  blocks.set("placed", new Y.Map([["sys:flavour", "affine:note"]]));
  blocks.set("orphan", new Y.Map([["sys:flavour", "affine:note"]]));
  doc.getMap("knot:card-links").set("placed", "shared");
  doc.getMap("knot:card-links").set("orphan", "shared");
  const snapshot = {
    collection: Array.from(Y.encodeStateAsUpdate(envelope)),
    document: Array.from(Y.encodeStateAsUpdate(doc)),
  };
  envelope.destroy();
  return { doc, snapshot };
}

test("saved citations resolve a real root-owned placement, excluding orphan links and wrong identities", () => {
  const { doc, snapshot } = owner();
  try {
    expect(savedCardPlacements("owner", snapshot, "shared")).toEqual([
      "placed",
    ]);
    expect(savedCardPlacements("owner", snapshot)).toEqual(["shared"]);
    expect(liveCardPlacements(doc, "other")).toEqual([]);
    expect(() =>
      savedCardPlacements("another-workspace-id", snapshot, "shared"),
    ).toThrow("identity");
  } finally {
    doc.destroy();
  }
});

test("unsaved removal overrides stored placements; unplaced cards return the deck fallback", async () => {
  const { doc, snapshot } = owner();
  try {
    doc.getMap("knot:card-links").delete("placed");
    let loads = 0;
    const result = await findCardPlacement(
      "shared",
      ["owner"],
      () => doc,
      async () => {
        loads++;
        return snapshot;
      },
      () => true,
    );
    expect(result).toBeUndefined();
    expect(loads).toBe(0);
    expect(
      await findCardPlacement(
        "shared",
        ["owner"],
        () => undefined,
        async () => snapshot,
        () => true,
      ),
    ).toEqual({ document: "owner", placement: "placed" });
  } finally {
    doc.destroy();
  }
});

test("workspace switch discards a pending saved placement lookup", async () => {
  const { doc, snapshot } = owner();
  let current = true;
  try {
    await expect(
      findCardPlacement(
        "shared",
        ["owner"],
        () => undefined,
        async () => {
          current = false;
          return snapshot;
        },
        () => current,
      ),
    ).rejects.toThrow("Workspace changed");
  } finally {
    doc.destroy();
  }
});
