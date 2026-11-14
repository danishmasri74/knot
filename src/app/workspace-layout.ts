export type PaneKind =
  "note" | "pdf" | "browser" | "cardDeck" | "ask" | "reference" | "video";
export const supportingKinds = new Set<string>([
  "note",
  "pdf",
  "browser",
  "cardDeck",
  "ask",
  "reference",
  "video",
]);
export type PaneTab = {
  id: string;
  kind: PaneKind;
  workspaceId: string;
  documentId?: string;
  noteId?: string;
};
export type PaneGroup = {
  id: string;
  tabIds: string[];
  activeTabId: string;
  preferredWidth: number;
};
export type WorkspaceLayout = {
  version: 1;
  hidden: boolean;
  tabs: Record<string, PaneTab>;
  groups: PaneGroup[];
  lastUsedGroupId: string | null;
};
export const emptyLayout = (): WorkspaceLayout => ({
  version: 1,
  hidden: false,
  tabs: {},
  groups: [],
  lastUsedGroupId: null,
});
export type LayoutAction =
  | { type: "visibility"; hidden: boolean }
  | { type: "open"; tab: PaneTab; width?: number; beside?: string }
  | { type: "activate" | "close"; id: string }
  | { type: "move"; id: string; group: string; index?: number }
  | { type: "split"; id: string; side: "left" | "right" }
  | { type: "merge"; group: string }
  | { type: "swap"; slotWidths?: number[] }
  | {
      type: "resizePair";
      left: string;
      right: string;
      leftWidth: number;
      total: number;
    }
  | { type: "resize"; group: string; width: number }
  | { type: "document"; id?: string }
  | { type: "workspace" };
export function tabIdentity(tab: Omit<PaneTab, "id">) {
  return JSON.stringify([
    tab.workspaceId,
    tab.kind,
    tab.documentId ?? "",
    tab.noteId ?? "",
  ]);
}
export const minimumWidth = (state: WorkspaceLayout, group: PaneGroup) =>
  group.tabIds.some((id) => ["note", "pdf"].includes(state.tabs[id].kind))
    ? 360
    : 320;
export function validatedWidths(value: unknown): number[] {
  if (!Array.isArray(value)) return [480, 480];
  return [0, 1].map((index) =>
    typeof value[index] === "number" && Number.isFinite(value[index])
      ? Math.max(320, Math.min(1000, value[index]))
      : 480,
  );
}
export function layoutReducer(
  state: WorkspaceLayout,
  action: LayoutAction,
): WorkspaceLayout {
  if (action.type === "workspace") return emptyLayout();
  const next: WorkspaceLayout = {
    ...state,
    tabs: { ...state.tabs },
    groups: state.groups.map((g) => ({ ...g, tabIds: [...g.tabIds] })),
  };
  const containing = (id: string) =>
    next.groups.find((g) => g.tabIds.includes(id));
  const remove = (id: string) => {
    const group = containing(id);
    if (!group) return;
    const index = group.tabIds.indexOf(id);
    group.tabIds.splice(index, 1);
    if (group.activeTabId === id)
      group.activeTabId = group.tabIds[index] ?? group.tabIds[index - 1];
  };
  switch (action.type) {
    case "visibility":
      next.hidden = action.hidden;
      break;
    case "open": {
      next.hidden = false;
      let group = containing(action.tab.id);
      if (!group) {
        const source = action.beside ? containing(action.beside) : undefined;
        group = source
          ? next.groups.find((g) => g.id !== source.id)
          : (next.groups.find((g) => g.id === next.lastUsedGroupId) ??
            next.groups.at(-1));
        if (!group) {
          group = {
            id: next.groups.some((g) => g.id === "pane-1")
              ? "pane-2"
              : "pane-1",
            tabIds: [],
            activeTabId: action.tab.id,
            preferredWidth: action.width ?? 480,
          };
          next.groups.push(group);
        }
        next.tabs[action.tab.id] = action.tab;
        group.tabIds.push(action.tab.id);
      }
      group.activeTabId = action.tab.id;
      next.lastUsedGroupId = group.id;
      break;
    }
    case "activate": {
      const group = containing(action.id);
      if (group) {
        next.hidden = false;
        group.activeTabId = action.id;
        next.lastUsedGroupId = group.id;
      }
      break;
    }
    case "close":
      remove(action.id);
      delete next.tabs[action.id];
      break;
    case "move": {
      const target = next.groups.find((g) => g.id === action.group);
      if (!target || !next.tabs[action.id]) break;
      remove(action.id);
      target.tabIds.splice(
        Math.max(
          0,
          Math.min(action.index ?? target.tabIds.length, target.tabIds.length),
        ),
        0,
        action.id,
      );
      target.activeTabId = action.id;
      next.lastUsedGroupId = target.id;
      break;
    }
    case "split": {
      const source = containing(action.id);
      if (next.groups.length >= 2 || !source || source.tabIds.length < 2) break;
      remove(action.id);
      const group = {
        id: source.id === "pane-1" ? "pane-2" : "pane-1",
        tabIds: [action.id],
        activeTabId: action.id,
        preferredWidth: source.preferredWidth,
      };
      if (action.side === "left") next.groups.unshift(group);
      else next.groups.push(group);
      next.lastUsedGroupId = group.id;
      break;
    }
    case "merge": {
      const source = next.groups.find((g) => g.id === action.group);
      const target = next.groups.find((g) => g.id !== action.group);
      if (source && target) {
        target.tabIds.push(...source.tabIds);
        target.activeTabId = source.activeTabId;
        next.groups = [target];
        next.lastUsedGroupId = target.id;
      }
      break;
    }
    case "swap": {
      const widths =
        action.slotWidths?.length === next.groups.length &&
        action.slotWidths.every((width) => Number.isFinite(width) && width > 0)
          ? action.slotWidths
          : next.groups.map((group) => group.preferredWidth);
      next.groups.reverse();
      next.groups.forEach((group, index) => {
        group.preferredWidth = Math.max(
          minimumWidth(next, group),
          widths[index],
        );
      });
      break;
    }
    case "resizePair": {
      const left = next.groups.find((g) => g.id === action.left),
        right = next.groups.find((g) => g.id === action.right);
      if (
        left &&
        right &&
        action.total >= minimumWidth(next, left) + minimumWidth(next, right) &&
        Number.isFinite(action.leftWidth) &&
        Number.isFinite(action.total)
      ) {
        const width = Math.max(
          minimumWidth(next, left),
          Math.min(action.total - minimumWidth(next, right), action.leftWidth),
        );
        left.preferredWidth = width;
        right.preferredWidth = action.total - width;
      }
      break;
    }
    case "resize": {
      const group = next.groups.find((g) => g.id === action.group);
      if (group && Number.isFinite(action.width))
        group.preferredWidth = Math.max(
          minimumWidth(next, group),
          Math.min(1000, action.width),
        );
      break;
    }
    case "document":
      for (const tab of Object.values(next.tabs))
        if (tab.documentId && tab.documentId !== action.id) {
          remove(tab.id);
          delete next.tabs[tab.id];
        }
      break;
  }
  next.groups = next.groups.filter((g) => g.tabIds.length);
  if (!next.groups.some((g) => g.id === next.lastUsedGroupId))
    next.lastUsedGroupId = next.groups.at(-1)?.id ?? null;
  return next;
}
/** Responsive projection never mutates membership or preferred widths. */
export function projectLayout(state: WorkspaceLayout, available: number) {
  let groups = state.groups;
  const minimums = groups.map((g) => minimumWidth(state, g));
  const collapsed =
    groups.length === 2 &&
    available < 362 + minimums.reduce((a, b) => a + b, 0);
  if (collapsed) {
    const focused =
      groups.find((g) => g.id === state.lastUsedGroupId) ?? groups[0];
    groups = [
      {
        ...focused,
        tabIds: groups.flatMap((g) => g.tabIds),
        preferredWidth: Math.max(...groups.map((g) => g.preferredWidth)),
      },
    ];
  }
  const single =
    groups.length > 0 && available < 361 + minimumWidth(state, groups[0]);
  const budget = Math.max(0, available - (single ? 0 : 360) - groups.length);
  const desired = groups.reduce(
    (n, g) => n + Math.max(minimumWidth(state, g), g.preferredWidth),
    0,
  );
  const surplus = Math.max(
    0,
    budget - groups.reduce((n, g) => n + minimumWidth(state, g), 0),
  );
  const wantedSurplus =
    desired - groups.reduce((n, g) => n + minimumWidth(state, g), 0);
  const widths = groups.map((g) =>
    single
      ? available
      : Math.min(
          Math.max(minimumWidth(state, g), g.preferredWidth),
          minimumWidth(state, g) +
            (wantedSurplus
              ? (surplus *
                  Math.max(0, g.preferredWidth - minimumWidth(state, g))) /
                wantedSurplus
              : 0),
        ),
  );
  return { groups, widths, single, collapsed };
}

/** A sole tab already on the requested side is an unchanged drop. */
export function edgeMove(
  state: WorkspaceLayout,
  id: string,
  side: "left" | "right",
): LayoutAction | null {
  if (state.groups.length === 2) {
    const index = state.groups.findIndex((g) => g.tabIds.includes(id));
    return index < 0 || index === (side === "left" ? 0 : 1)
      ? null
      : { type: "swap" };
  }
  return { type: "split", id, side };
}

/** Preview the destination using the same transition and sizing as the drop.
 * Right offsets stay valid when the supporting area grows into the canvas. */
export function edgeDropPreview(
  state: WorkspaceLayout,
  id: string,
  side: "left" | "right",
  available: number,
) {
  const source = state.groups.find((g) => g.tabIds.includes(id));
  if (
    !source ||
    (state.groups.length === 1 && source.tabIds.length < 2) ||
    (state.groups.length === 2 && source.tabIds.length !== 1)
  )
    return null;
  const move = edgeMove(state, id, side);
  if (!move) return null;
  const action =
    move.type === "swap"
      ? { ...move, slotWidths: projectLayout(state, available).widths }
      : move;
  const next = projectLayout(layoutReducer(state, action), available);
  if (next.single || next.collapsed || next.groups.length !== 2) return null;
  const index = next.groups.findIndex((g) => g.tabIds.includes(id));
  return {
    action,
    ...dropBounds(next.widths, index),
  };
}

function dropBounds(widths: number[], index: number) {
  return {
    width: widths[index],
    right: 1 + widths.slice(index + 1).reduce((n, width) => n + width + 1, 0),
  };
}

/** Moving a column preserves its tabs while respecting the resized destination. */
export function columnDropPreview(
  state: WorkspaceLayout,
  group: string,
  side: "left" | "right",
  available: number,
) {
  const source = state.groups.findIndex((g) => g.id === group);
  if (
    state.groups.length !== 2 ||
    source < 0 ||
    source === (side === "left" ? 0 : 1)
  )
    return null;
  const action = {
    type: "swap",
    slotWidths: projectLayout(state, available).widths,
  } as const;
  const next = projectLayout(layoutReducer(state, action), available);
  if (next.single || next.collapsed) return null;
  return {
    action,
    ...dropBounds(
      next.widths,
      next.groups.findIndex((g) => g.id === group),
    ),
  };
}
