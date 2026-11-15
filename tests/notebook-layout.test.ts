import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canvasTab,
  emptyLayout,
  layoutReducer,
  tabIdentity,
  withCanvas,
  type PaneTab,
} from "../src/app/workspace-layout";
import {
  notebookLayoutKey,
  readNotebookLayout,
  validatedNotebookLayout,
} from "../src/app/useNotebookLayout";

const tab = (kind: PaneTab["kind"], noteId?: string): PaneTab => {
  const value = {
    kind,
    workspaceId: "workspace",
    documentId: kind === "browser" ? undefined : "testing",
    noteId,
  };
  return { ...value, id: tabIdentity(value) };
};
const note = tab("note", "note-1"),
  pdf = tab("pdf"),
  browser = tab("browser");
afterEach(() => vi.unstubAllGlobals());
const layout = () => {
  let state = [note, pdf, browser].reduce(
    (s, t) => layoutReducer(s, { type: "open", tab: t }),
    emptyLayout(),
  );
  state = layoutReducer(state, { type: "split", id: pdf.id, side: "left" });
  state = layoutReducer(state, { type: "resize", group: "pane-2", width: 625 });
  return layoutReducer(state, { type: "activate", id: note.id });
};

describe("notebook pane preferences", () => {
  it("turns saved hidden columns into Focus on the canvas column", () => {
    const state = layoutReducer(layout(), { type: "visibility", hidden: true });
    // No canvas to focus: the columns simply come back.
    expect(validatedNotebookLayout(state, "workspace", "testing")).toEqual(
      layout(),
    );
    const withBoard = layoutReducer(
      withCanvas(layout(), canvasTab("workspace", "testing")),
      { type: "visibility", hidden: true },
    );
    const restored = validatedNotebookLayout(withBoard, "workspace", "testing");
    expect(restored.hidden).toBe(false);
    expect(restored.expandedGroupId).toBe(
      restored.groups.find((g) =>
        g.tabIds.some((id) => restored.tabs[id].kind === "canvas"),
      )?.id,
    );
  });
  it("accepts older visible layouts", () => {
    const state = layoutReducer(layout(), { type: "visibility", hidden: true });
    expect(layoutReducer(state, { type: "visibility", hidden: false })).toEqual(
      layout(),
    );
    const legacy = { ...layout(), hidden: undefined };
    expect(validatedNotebookLayout(legacy, "workspace", "testing").hidden).toBe(
      false,
    );
    const reopened = layoutReducer(state, { type: "open", tab: pdf });
    expect(reopened.hidden).toBe(false);
    expect(reopened.groups.map((g) => g.tabIds)).toEqual(
      state.groups.map((g) => g.tabIds),
    );
  });
  it("round-trips columns, tab order, focus, and widths", () => {
    const state = layout();
    expect(
      validatedNotebookLayout(
        JSON.parse(JSON.stringify(state)),
        "workspace",
        "testing",
      ),
    ).toEqual(state);
    expect(validatedNotebookLayout(emptyLayout(), "workspace", "oop")).toEqual(
      withCanvas(emptyLayout(), canvasTab("workspace", "oop")),
    );
  });
  it("isolates notebook and workspace keys, including ambiguous identifiers", () => {
    expect(notebookLayoutKey("workspace", "testing")).not.toBe(
      notebookLayoutKey("workspace", "oop"),
    );
    expect(notebookLayoutKey("workspace", "testing")).not.toBe(
      notebookLayoutKey("other", "testing"),
    );
    expect(notebookLayoutKey("a.b", "c")).not.toBe(
      notebookLayoutKey("a", "b.c"),
    );
    expect(validatedNotebookLayout(layout(), "other", "testing")).toEqual(
      withCanvas(emptyLayout(), canvasTab("other", "testing")),
    );
    const restored = validatedNotebookLayout(layout(), "workspace", "oop");
    expect(Object.values(restored.tabs)).toEqual([browser]);
  });
  it("repairs corrupt membership, active tabs, focus, and widths", () => {
    const state = layout();
    const value = {
      ...state,
      groups: [
        {
          ...state.groups[0],
          preferredWidth: -12,
          activeTabId: "missing",
          tabIds: [pdf.id, pdf.id, "missing"],
        },
        {
          ...state.groups[1],
          preferredWidth: Infinity,
          tabIds: [pdf.id, note.id, browser.id],
        },
        { id: "extra", tabIds: [browser.id] },
      ],
      lastUsedGroupId: "missing",
    };
    const restored = validatedNotebookLayout(value, "workspace", "testing");
    expect(restored.groups.map((g) => g.tabIds)).toEqual([
      [pdf.id],
      [note.id, browser.id],
    ]);
    expect(restored.groups.map((g) => g.preferredWidth)).toEqual([320, 480]);
    expect(restored.groups[0].activeTabId).toBe(pdf.id);
    expect(restored.lastUsedGroupId).toBe(restored.groups[1].id);
  });
  it("ignores invalid versions, malformed records and unknown tab kinds", () => {
    // Anything unusable falls back to the default: the Canvas tab alone.
    const fallback = withCanvas(emptyLayout(), canvasTab("workspace", "testing"));
    for (const value of [
      null,
      [],
      {},
      { ...layout(), version: 3 },
      { ...layout(), tabs: [] },
    ]) {
      expect(validatedNotebookLayout(value, "workspace", "testing")).toEqual(
        fallback,
      );
    }
    const state = layout();
    const invalid = {
      ...state,
      tabs: Object.fromEntries(
        Object.entries(state.tabs).map(([id, t]) => [
          id,
          { ...t, kind: "unknown" },
        ]),
      ),
    };
    expect(validatedNotebookLayout(invalid, "workspace", "testing")).toEqual(
      fallback,
    );
  });
  it("gives layouts saved before the canvas was a tab a canvas column on the left", () => {
    const legacy = { ...layout(), version: 1 };
    const migrated = validatedNotebookLayout(legacy, "workspace", "testing");
    // Two columns at most: the old supporting columns share one.
    expect(migrated.groups).toHaveLength(2);
    expect(migrated.groups[0].tabIds).toEqual([
      canvasTab("workspace", "testing").id,
    ]);
    expect(migrated.groups[1].tabIds).toEqual(
      layout().groups.flatMap((g) => g.tabIds),
    );
    // A saved version 2 layout whose canvas was closed stays closed.
    expect(validatedNotebookLayout(layout(), "workspace", "testing")).toEqual(
      layout(),
    );
  });
  it("folds columns beyond the limit into the last one", () => {
    const wide = layout();
    const extra = tab("note", "note-2");
    const saved = {
      ...wide,
      tabs: { ...wide.tabs, [extra.id]: extra },
      groups: [
        ...wide.groups,
        {
          id: "pane-9",
          tabIds: [extra.id],
          activeTabId: extra.id,
          preferredWidth: 480,
        },
      ],
    };
    const restored = validatedNotebookLayout(saved, "workspace", "testing");
    expect(restored.groups).toHaveLength(2);
    expect(restored.groups[1].tabIds).toContain(extra.id);
    expect(Object.keys(restored.tabs)).toHaveLength(4);
  });
  it("falls back safely when storage is unavailable or contains invalid JSON", () => {
    // No browser storage in this test environment.
    const fallback = withCanvas(emptyLayout(), canvasTab("workspace", "testing"));
    expect(readNotebookLayout("workspace", "testing")).toEqual(fallback);
    vi.stubGlobal("localStorage", { getItem: () => "invalid JSON" });
    expect(readNotebookLayout("workspace", "testing")).toEqual(fallback);
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(layout()) });
    expect(readNotebookLayout("workspace", "testing")).toEqual(layout());
  });
});
