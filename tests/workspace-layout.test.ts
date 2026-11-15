import { describe, it, expect } from "vitest";
import {
  MAX_COLUMNS,
  canvasTab,
  edgeMove,
  emptyLayout,
  layoutReducer,
  projectLayout,
  tabIdentity,
  validatedWidths,
  withCanvas,
  type WorkspaceLayout,
  type PaneTab,
} from "../src/app/workspace-layout";
const note: PaneTab = {
  id: "note",
  kind: "note",
  workspaceId: "w",
  documentId: "d",
  noteId: "n",
};
const pdf: PaneTab = {
  id: "pdf",
  kind: "pdf",
  workspaceId: "w",
  documentId: "d",
};
const browser: PaneTab = { id: "browser", kind: "browser", workspaceId: "w" };
const opened = () =>
  [note, pdf, browser].reduce(
    (s, tab) => layoutReducer(s, { type: "open", tab }),
    emptyLayout(),
  );
const invariant = (s: WorkspaceLayout) => {
  const ids = s.groups.flatMap((g) => g.tabIds);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.sort()).toEqual(Object.keys(s.tabs).sort());
  expect(s.groups.length).toBeLessThanOrEqual(MAX_COLUMNS);
  for (const g of s.groups) {
    expect(g.tabIds.length).toBeGreaterThan(0);
    expect(g.tabIds).toContain(g.activeTabId);
  }
};
describe("supporting workspace layout", () => {
  const ask: PaneTab = {
    id: "ask",
    kind: "ask",
    workspaceId: "w",
    documentId: "d",
  };
  it("opens PDF questions in a new column without hiding or moving the PDF", () => {
    const before = layoutReducer(emptyLayout(), {
      type: "open",
      tab: pdf,
      width: 640,
    });
    const next = layoutReducer(before, {
      type: "open",
      tab: ask,
      beside: pdf.id,
      width: 480,
    });
    expect(next.groups).toHaveLength(2);
    expect(next.groups[0]).toEqual(before.groups[0]);
    expect(next.groups[1].activeTabId).toBe(ask.id);
    expect(next.groups[1].preferredWidth).toBe(480);
    expect(next.lastUsedGroupId).toBe(next.groups[1].id);
    invariant(next);
  });
  it("uses the other existing column for PDF questions on either side", () => {
    for (const side of ["left", "right"] as const) {
      const before = layoutReducer(opened(), {
        type: "split",
        id: pdf.id,
        side,
      });
      const source = before.groups.find((g) => g.tabIds.includes(pdf.id))!;
      const other = before.groups.find((g) => g.id !== source.id)!;
      const next = layoutReducer(before, {
        type: "open",
        tab: ask,
        beside: pdf.id,
      });
      expect(next.groups).toHaveLength(2);
      expect(next.groups.find((g) => g.id === source.id)).toEqual(source);
      expect(next.groups.find((g) => g.id === other.id)?.tabIds).toEqual([
        ...other.tabIds,
        ask.id,
      ]);
      expect(next.groups.find((g) => g.id === other.id)?.activeTabId).toBe(
        ask.id,
      );
      invariant(next);
    }
  });
  it("reactivates an existing AI tab in place, including hidden columns", () => {
    let before = layoutReducer(opened(), { type: "open", tab: ask });
    before = layoutReducer(before, { type: "split", id: ask.id, side: "left" });
    before = layoutReducer(before, { type: "open", tab: note });
    // Put another tab in front of AI to check reuse of inactive tabs too.
    before = layoutReducer(before, {
      type: "move",
      id: note.id,
      group: before.groups[0].id,
    });
    before = layoutReducer(before, { type: "visibility", hidden: true });
    const next = layoutReducer(before, {
      type: "open",
      tab: ask,
      beside: pdf.id,
    });
    expect(next.groups.map((g) => g.tabIds)).toEqual(
      before.groups.map((g) => g.tabIds),
    );
    expect(next.groups[0].activeTabId).toBe(ask.id);
    expect(next.hidden).toBe(false);
    expect(Object.keys(next.tabs)).toHaveLength(
      Object.keys(before.tabs).length,
    );
    invariant(next);
  });
  it("deduplicates and reactivates without moving tabs", () => {
    let s = opened();
    s = layoutReducer(s, { type: "split", id: "pdf", side: "left" });
    const membership = s.groups.map((g) => g.tabIds);
    s = layoutReducer(s, { type: "open", tab: pdf });
    expect(s.groups.map((g) => g.tabIds)).toEqual(membership);
    expect(Object.keys(s.tabs)).toHaveLength(3);
    invariant(s);
    expect(tabIdentity(note)).not.toBe(
      tabIdentity({ ...note, documentId: "other" }),
    );
  });
  it("closes with the right neighbor then the left and prunes empty groups", () => {
    let s = layoutReducer(opened(), { type: "activate", id: "pdf" });
    s = layoutReducer(s, { type: "close", id: "pdf" });
    expect(s.groups[0].activeTabId).toBe("browser");
    s = layoutReducer(s, { type: "close", id: "browser" });
    expect(s.groups[0].activeTabId).toBe("note");
    s = layoutReducer(s, { type: "close", id: "note" });
    expect(s.groups).toHaveLength(0);
    invariant(s);
  });
  it("preserves invariants through moves, splits, merges and lifecycle changes", () => {
    let s = opened();
    const actions = [
      { type: "split", id: "pdf", side: "left" },
      { type: "split", id: "browser", side: "right" },
      { type: "swap" },
      { type: "move", id: "note", group: "pane-2", index: 0 },
      { type: "merge", group: "pane-2" },
      { type: "document", id: "new" },
      { type: "workspace" },
    ] as const;
    for (const action of actions) {
      s = layoutReducer(s, action);
      invariant(s);
    }
    expect(s.tabs).toEqual({});
  });
  it("projects narrow layouts without destroying membership or widths", () => {
    const s = layoutReducer(opened(), {
      type: "split",
      id: "pdf",
      side: "left",
    });
    const before = JSON.stringify(s);
    expect(projectLayout(s, 1500).groups).toHaveLength(2);
    expect(projectLayout(s, 1000).collapsed).toBe(false);
    expect(projectLayout(s, 650).collapsed).toBe(true);
    expect(projectLayout(s, 650).single).toBe(true);
    for (const available of [360, 650, 760, 850, 1082, 1200, 1600]) {
      const p = projectLayout(s, available);
      expect(p.widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
        available,
      );
    }
    expect(JSON.stringify(s)).toBe(before);
  });
  it("redistributes interior widths without shrinking either adjacent group", () => {
    let s = layoutReducer(opened(), { type: "split", id: "pdf", side: "left" });
    s = layoutReducer(s, {
      type: "resizePair",
      left: "pane-2",
      right: "pane-1",
      leftWidth: 9999,
      total: 960,
    });
    expect(s.groups.map((g) => g.preferredWidth)).toEqual([600, 360]);
    expect(s.groups.reduce((n, g) => n + g.preferredWidth, 0)).toBe(960);
    expect(
      projectLayout(
        layoutReducer(opened(), {
          type: "resize",
          group: "pane-1",
          width: 320,
        }),
        1000,
      ).widths[0],
    ).toBeGreaterThanOrEqual(360);
  });
  it("does not swap a sole tab already on the requested edge", () => {
    const s = layoutReducer(opened(), {
      type: "split",
      id: "pdf",
      side: "left",
    });
    expect(edgeMove(s, "pdf", "left")).toBeNull();
    expect(edgeMove(s, "pdf", "right")).toEqual({ type: "swap" });
  });
  it("keeps resized column slots in place when swapping their contents", () => {
    let state = layoutReducer(opened(), {
      type: "split",
      id: "pdf",
      side: "left",
    });
    state = layoutReducer(state, {
      type: "resizePair",
      left: "pane-2",
      right: "pane-1",
      leftWidth: 500,
      total: 1200,
    });
    const swapped = layoutReducer(state, { type: "swap" });
    expect(swapped.groups.map((g) => g.id)).toEqual(
      [...state.groups].reverse().map((g) => g.id),
    );
    expect(swapped.groups.map((g) => g.preferredWidth)).toEqual([500, 700]);
    expect(swapped.groups.map((g) => g.tabIds)).toEqual(
      [...state.groups].reverse().map((g) => g.tabIds),
    );
    invariant(swapped);
  });
  it("validates geometry independently of content", () => {
    expect(validatedWidths([NaN, -20])).toEqual([480, 320]);
    expect(validatedWidths({ tabs: "invalid" })).toEqual([480, 480]);
    const s = layoutReducer(opened(), {
      type: "resize",
      group: "pane-1",
      width: 99999,
    });
    expect(s.groups[0].preferredWidth).toBe(1000);
  });
  describe("canvas tab", () => {
    const canvas = canvasTab("w", "d");
    const withTools = () =>
      [pdf, browser].reduce(
        (s, tab) => layoutReducer(s, { type: "open", tab }),
        withCanvas(emptyLayout(), canvas),
      );
    it("fills the space the other column leaves", () => {
      const s = withTools();
      expect(s.groups[0].tabIds).toEqual([canvas.id]);
      const p = projectLayout(s, 1400);
      expect(p.widths.reduce((a, b) => a + b, 0) + p.groups.length - 1).toBe(
        1400,
      );
      expect(p.widths[0]).toBeGreaterThan(p.widths[1]);
    });
    it("opens tools beside the canvas instead of covering it", () => {
      let s = withCanvas(emptyLayout(), canvas);
      s = layoutReducer(s, { type: "open", tab: pdf });
      expect(s.groups).toHaveLength(2);
      expect(s.groups[0].activeTabId).toBe(canvas.id);
      s = layoutReducer(s, { type: "activate", id: canvas.id });
      s = layoutReducer(s, { type: "open", tab: note });
      expect(s.groups[0].tabIds).toEqual([canvas.id]);
      expect(s.groups[1].tabIds).toEqual([pdf.id, note.id]);
    });
    it("keeps at most two columns and moves columns", () => {
      const s = withTools();
      expect(MAX_COLUMNS).toBe(2);
      const split = layoutReducer(s, { type: "split", id: pdf.id, side: "right" });
      expect(split.groups).toHaveLength(2);
      const moved = layoutReducer(s, { type: "swap" });
      expect(moved.groups[1].tabIds).toEqual([canvas.id]);
      invariant(moved);
    });
    it("reopens a closed canvas in its own column on the left", () => {
      let s = withTools();
      s = layoutReducer(s, { type: "close", id: canvas.id });
      expect(s.groups).toHaveLength(1);
      s = layoutReducer(s, { type: "open", tab: canvas });
      expect(s.groups[0].tabIds).toEqual([canvas.id]);
      expect(s.groups).toHaveLength(2);
    });
    it("moves to an edge: swaps columns, or joins the edge column when full", () => {
      const s = withTools();
      expect(edgeMove(s, canvas.id, "left")).toBeNull();
      expect(edgeMove(s, canvas.id, "right")).toEqual({ type: "swap" });
      expect(edgeMove(s, pdf.id, "left")).toEqual({
        type: "move",
        id: pdf.id,
        group: s.groups[0].id,
      });
    });
    it("gives the canvas its own column when the columns are already full", () => {
      let s = layoutReducer(opened(), { type: "split", id: pdf.id, side: "left" });
      s = withCanvas(s, canvas);
      expect(s.groups.map((g) => g.tabIds)).toEqual([
        [canvas.id],
        [pdf.id, note.id, browser.id],
      ]);
    });
    it("hiding columns leaves only the canvas column", () => {
      const s = layoutReducer(withTools(), { type: "visibility", hidden: true });
      const p = projectLayout(s, 1200);
      expect(p.groups.map((g) => g.tabIds)).toEqual([[canvas.id]]);
      expect(p.widths).toEqual([1200]);
    });
  });
  describe("expanding a column", () => {
    const canvas = canvasTab("w", "d");
    const two = () =>
      [pdf, browser].reduce(
        (s, tab) => layoutReducer(s, { type: "open", tab }),
        withCanvas(emptyLayout(), canvas),
      );
    it("fills the width and shrinks the other column to a rail", () => {
      const s = layoutReducer(two(), { type: "expand", id: pdf.id });
      const p = projectLayout(s, 1200);
      expect(p.groups.map((g) => g.tabIds)).toEqual([[pdf.id, browser.id]]);
      expect(p.rails.map((r) => r.group.tabIds)).toEqual([[canvas.id]]);
      expect(p.lefts).toEqual([41]);
      expect(p.widths[0] + 41).toBe(1200);
    });
    it("turns a column that doesn't fit into a rail instead of merging", () => {
      // Canvas (360) + PDF column (360) need 721px.
      const s = layoutReducer(two(), { type: "activate", id: pdf.id });
      const p = projectLayout(s, 600);
      expect(p.collapsed).toBe(true);
      expect(p.groups.map((g) => g.tabIds)).toEqual([[pdf.id, browser.id]]);
      expect(p.rails.map((r) => r.group.tabIds)).toEqual([[canvas.id]]);
      expect(p.rails[0].left).toBe(0);
      expect(p.lefts[0]).toBe(41);
      expect(p.widths[0] + 41).toBe(600);
    });
    it("lets a rail choose its tab without bringing the column back", () => {
      let s = layoutReducer(two(), { type: "expand", id: canvas.id });
      s = layoutReducer(s, { type: "activate", id: pdf.id, stay: true });
      expect(s.expandedGroupId).toBe(s.groups[0].id);
      expect(s.groups[1].activeTabId).toBe(pdf.id);
      expect(s.lastUsedGroupId).toBe(s.groups[0].id);
      // Navigating to it on purpose does bring it back.
      expect(layoutReducer(s, { type: "activate", id: pdf.id }).expandedGroupId).toBeNull();
    });
    it("opens new tabs in the expanded column", () => {
      let s = layoutReducer(two(), { type: "expand", id: pdf.id });
      s = layoutReducer(s, { type: "open", tab: note });
      expect(s.groups.find((g) => g.id === s.expandedGroupId)?.tabIds).toEqual([
        pdf.id,
        browser.id,
        note.id,
      ]);
    });
    it("restores when a tab in another column is shown or tabs move", () => {
      const s = layoutReducer(two(), { type: "expand", id: pdf.id });
      expect(layoutReducer(s, { type: "activate", id: canvas.id }).expandedGroupId).toBeNull();
      expect(
        layoutReducer(s, { type: "move", id: browser.id, group: s.groups[0].id })
          .expandedGroupId,
      ).toBeNull();
      expect(layoutReducer(s, { type: "restore" }).expandedGroupId).toBeNull();
    });
    it("ends when only one column is left", () => {
      let s = layoutReducer(two(), { type: "expand", id: pdf.id });
      s = layoutReducer(s, { type: "close", id: canvas.id });
      expect(s.expandedGroupId).toBeNull();
    });
  });
});
