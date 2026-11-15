export type PaneKind =
  | "canvas"
  | "note"
  | "pdf"
  | "browser"
  | "cardDeck"
  | "ask"
  | "reference"
  | "video";
export const supportingKinds = new Set<string>([
  "canvas",
  "note",
  "pdf",
  "browser",
  "cardDeck",
  "ask",
  "reference",
  "video",
]);
/** Up to two content columns sit beside the sidebar. */
export const MAX_COLUMNS = 2;
/** Width of a collapsed column while another column is expanded. */
export const RAIL_WIDTH = 40;
/** What each kind of tab does when it isn't visible, and how narrow it gets.
 * "sleep" tabs drop their editor when hidden (WorkspacePanes passes them
 * "asleep"); "alive" tabs keep running.
 * Identity (tabIdentity) already keeps one Canvas, Ask, Card Deck, Browser
 * and Links tab per notebook; notes, PDFs and videos are one per item. */
export const tabPolicy: Record<
  PaneKind,
  { idle: "alive" | "sleep"; minWidth: number }
> = {
  canvas: { idle: "alive", minWidth: 360 },
  note: { idle: "sleep", minWidth: 360 },
  pdf: { idle: "alive", minWidth: 360 },
  video: { idle: "alive", minWidth: 320 },
  browser: { idle: "alive", minWidth: 320 },
  ask: { idle: "alive", minWidth: 320 },
  cardDeck: { idle: "alive", minWidth: 320 },
  reference: { idle: "alive", minWidth: 320 },
};
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
  version: 2;
  hidden: boolean;
  tabs: Record<string, PaneTab>;
  groups: PaneGroup[];
  lastUsedGroupId: string | null;
  /** One column can fill the width; the others shrink to rails. */
  expandedGroupId: string | null;
};
export const emptyLayout = (): WorkspaceLayout => ({
  version: 2,
  hidden: false,
  tabs: {},
  groups: [],
  lastUsedGroupId: null,
  expandedGroupId: null,
});
export type LayoutAction =
  | { type: "visibility"; hidden: boolean }
  | {
      type: "open";
      tab: PaneTab;
      width?: number;
      beside?: string;
      /** Open in this column (a column's + menu). */
      group?: string;
    }
  | { type: "close"; id: string }
  /** stay: pick the tab a collapsed column will show, without bringing the
   * column back (a rail's tab icons). */
  | { type: "activate"; id: string; stay?: boolean }
  | { type: "move"; id: string; group: string; index?: number }
  | { type: "split"; id: string; side: "left" | "right" }
  | { type: "merge"; group: string; into?: string }
  | { type: "swap"; slotWidths?: number[] }
  | { type: "moveColumn"; group: string; index: number }
  /** Expand a column (by its id, or the column holding a tab). */
  | { type: "expand"; group?: string; id?: string }
  | { type: "restore" }
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
export function canvasTab(workspace: string, notebook: string): PaneTab {
  const tab = {
    kind: "canvas" as const,
    workspaceId: workspace,
    documentId: notebook,
  };
  return { ...tab, id: tabIdentity(tab) };
}
export const hasCanvas = (state: WorkspaceLayout) =>
  Object.values(state.tabs).some((tab) => tab.kind === "canvas");
/** Before tabs, the canvas was a fixed area left of the supporting columns.
 * Put it back in that place as the leftmost column. */
export function withCanvas(
  state: WorkspaceLayout,
  tab: PaneTab,
): WorkspaceLayout {
  if (hasCanvas(state)) return state;
  const next: WorkspaceLayout = {
    ...state,
    tabs: { ...state.tabs, [tab.id]: tab },
    groups: state.groups.map((g) => ({ ...g, tabIds: [...g.tabIds] })),
  };
  // No room for another column: the other columns share one, so the canvas
  // still gets its own column on the left.
  if (next.groups.length >= MAX_COLUMNS) {
    const last = next.groups.at(-1)!;
    next.groups = [
      {
        ...last,
        tabIds: next.groups.flatMap((g) => g.tabIds),
      },
    ];
    next.lastUsedGroupId = last.id;
  }
  next.groups.unshift({
    id: unusedGroupId(next),
    tabIds: [tab.id],
    activeTabId: tab.id,
    preferredWidth: 480,
  });
  next.lastUsedGroupId ??= next.groups[0].id;
  return next;
}
function unusedGroupId(state: WorkspaceLayout) {
  for (let n = 1; ; n++)
    if (!state.groups.some((g) => g.id === `pane-${n}`)) return `pane-${n}`;
}
const containsCanvas = (state: WorkspaceLayout, group: PaneGroup) =>
  group.tabIds.some((id) => state.tabs[id]?.kind === "canvas");
export const minimumWidth = (state: WorkspaceLayout, group: PaneGroup) =>
  Math.max(
    320,
    ...group.tabIds.map((id) => tabPolicy[state.tabs[id]?.kind]?.minWidth ?? 320),
  );
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
  const newGroup = (width: number | undefined, at: number) => {
    const group: PaneGroup = {
      id: unusedGroupId(next),
      tabIds: [],
      activeTabId: "",
      preferredWidth: width ?? 480,
    };
    next.groups.splice(at, 0, group);
    return group;
  };
  switch (action.type) {
    case "visibility":
      next.hidden = action.hidden;
      break;
    case "open": {
      next.hidden = false;
      let group = containing(action.tab.id);
      const expanded = next.groups.find((g) => g.id === next.expandedGroupId);
      // While a column is expanded, new tabs open in it. An existing tab in
      // another column brings the columns back.
      if (expanded && group && group !== expanded) next.expandedGroupId = null;
      const chosen = next.groups.find((g) => g.id === action.group);
      if (!group && chosen) {
        group = chosen;
        next.tabs[action.tab.id] = action.tab;
        if (action.tab.kind === "canvas") group.tabIds.unshift(action.tab.id);
        else group.tabIds.push(action.tab.id);
      }
      if (!group && expanded) {
        group = expanded;
        next.tabs[action.tab.id] = action.tab;
        group.tabIds.push(action.tab.id);
      }
      if (!group) {
        const canvas = action.tab.kind === "canvas";
        // Opening a tool never covers the canvas while there's another
        // column or room for one.
        const free = (g: PaneGroup) => canvas || !containsCanvas(next, g);
        const source = action.beside ? containing(action.beside) : undefined;
        if (source) {
          const at = next.groups.indexOf(source);
          group =
            next.groups.find((g, i) => i > at && free(g)) ??
            next.groups.find((g) => g !== source && free(g)) ??
            (next.groups.length < MAX_COLUMNS
              ? newGroup(action.width, at + 1)
              : next.groups.find((g) => g !== source));
        } else if (canvas) {
          // A reopened canvas returns to its own column on the left.
          group =
            next.groups.length < MAX_COLUMNS
              ? newGroup(action.width, 0)
              : next.groups[0];
        } else {
          const last = next.groups.find((g) => g.id === next.lastUsedGroupId);
          group =
            (last && free(last) ? last : undefined) ??
            [...next.groups].reverse().find(free) ??
            (next.groups.length && next.groups.length < MAX_COLUMNS
              ? newGroup(action.width, canvas ? 0 : next.groups.length)
              : (last ?? next.groups.at(-1)));
        }
        group ??= newGroup(action.width, 0);
        next.tabs[action.tab.id] = action.tab;
        if (action.tab.kind === "canvas") group.tabIds.unshift(action.tab.id);
        else group.tabIds.push(action.tab.id);
      }
      group.activeTabId = action.tab.id;
      next.lastUsedGroupId = group.id;
      break;
    }
    case "activate": {
      const group = containing(action.id);
      if (group && action.stay) {
        group.activeTabId = action.id;
        break;
      }
      if (group) {
        next.hidden = false;
        if (next.expandedGroupId && next.expandedGroupId !== group.id)
          next.expandedGroupId = null;
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
      if (
        next.groups.length >= MAX_COLUMNS ||
        !source ||
        source.tabIds.length < 2
      )
        break;
      remove(action.id);
      const group = newGroup(
        source.preferredWidth,
        action.side === "left" ? 0 : next.groups.length,
      );
      group.tabIds.push(action.id);
      group.activeTabId = action.id;
      next.lastUsedGroupId = group.id;
      break;
    }
    case "merge": {
      const index = next.groups.findIndex((g) => g.id === action.group);
      const source = next.groups[index];
      const target =
        next.groups.find((g) => g.id === action.into && g !== source) ??
        next.groups[index > 0 ? index - 1 : index + 1];
      if (source && target) {
        target.tabIds.push(...source.tabIds);
        target.activeTabId = source.activeTabId;
        next.groups.splice(index, 1);
        next.lastUsedGroupId = target.id;
      }
      break;
    }
    case "swap": {
      // Two columns trade places; their slots keep the widths they had.
      if (next.groups.length !== 2) break;
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
    case "expand": {
      const group = action.id
        ? containing(action.id)
        : next.groups.find((g) => g.id === action.group);
      if (group) {
        next.hidden = false;
        next.expandedGroupId = group.id;
        next.lastUsedGroupId = group.id;
        if (action.id) group.activeTabId = action.id;
      }
      break;
    }
    case "restore":
      next.expandedGroupId = null;
      break;
    case "moveColumn": {
      const index = next.groups.findIndex((g) => g.id === action.group);
      if (index < 0) break;
      const [group] = next.groups.splice(index, 1);
      next.groups.splice(
        Math.max(0, Math.min(action.index, next.groups.length)),
        0,
        group,
      );
      next.lastUsedGroupId = group.id;
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
  // Moving tabs or columns ends an expand.
  if (["move", "split", "merge", "swap", "moveColumn"].includes(action.type))
    next.expandedGroupId = null;
  next.groups = next.groups.filter((g) => g.tabIds.length);
  if (!next.groups.some((g) => g.id === next.lastUsedGroupId))
    next.lastUsedGroupId = next.groups.at(-1)?.id ?? null;
  if (
    next.groups.length < 2 ||
    !next.groups.some((g) => g.id === next.expandedGroupId)
  )
    next.expandedGroupId = null;
  return next;
}
/** The column that takes the space the others leave: the canvas column, or
 * the first column when no canvas is open. */
export function fillIndex(state: WorkspaceLayout, groups = state.groups) {
  const index = groups.findIndex((g) => containsCanvas(state, g));
  return index < 0 ? 0 : index;
}
export type Rail = { group: PaneGroup; left: number };
export type Projection = {
  /** Columns shown at full size, left to right. */
  groups: PaneGroup[];
  widths: number[];
  /** Where each shown column starts. */
  lefts: number[];
  single: boolean;
  /** Some columns didn't fit and became rails. */
  collapsed: boolean;
  /** Columns shown as 40px rails (expanded neighbour, or too narrow). */
  rails: Rail[];
};
/** Responsive projection never mutates membership or preferred widths. */
export function projectLayout(
  state: WorkspaceLayout,
  available: number,
): Projection {
  const all = state.groups;
  if (state.hidden) {
    // "Hide columns" leaves only the canvas column.
    const groups = all.filter((g) => containsCanvas(state, g));
    return {
      groups,
      widths: groups.map(() => available),
      lefts: groups.map(() => 0),
      single: true,
      collapsed: false,
      rails: [],
    };
  }
  const expanded = all.findIndex((g) => g.id === state.expandedGroupId);
  if (expanded >= 0 && all.length > 1)
    return placed(state, all, new Set([expanded]), available, false);
  const mins = all.map((g) => minimumWidth(state, g));
  const fits = (shown: Set<number>) =>
    [...shown].reduce((n, i) => n + mins[i], 0) +
      shown.size -
      1 +
      (all.length - shown.size) * (RAIL_WIDTH + 1) <=
    available;
  const everything = new Set(all.map((_, i) => i));
  if (all.length < 2 || fits(everything))
    return placed(state, all, everything, available, false);
  // Too narrow for every column: the one used last stays, then the canvas,
  // then its nearest neighbours, while they fit; the rest become rails.
  const focused = Math.max(
    0,
    all.findIndex((g) => g.id === state.lastUsedGroupId),
  );
  const canvas = all.findIndex((g) => containsCanvas(state, g));
  const order = [
    ...(canvas >= 0 && canvas !== focused ? [canvas] : []),
    ...all
      .map((_, i) => i)
      .filter((i) => i !== focused && i !== canvas)
      .sort((a, b) => Math.abs(a - focused) - Math.abs(b - focused)),
  ];
  const shown = new Set([focused]);
  for (const index of order) {
    const next = new Set([...shown, index]);
    if (fits(next)) shown.add(index);
  }
  return placed(state, all, shown, available, true);
}
/** Lays out shown columns and rails in their original order. */
function placed(
  state: WorkspaceLayout,
  all: PaneGroup[],
  shown: Set<number>,
  available: number,
  collapsed: boolean,
): Projection {
  const groups = all.filter((_, i) => shown.has(i));
  const railCount = all.length - groups.length;
  const widths = columnWidths(
    state,
    groups,
    Math.max(0, available - railCount * (RAIL_WIDTH + 1)),
  );
  const lefts: number[] = [];
  const rails: Rail[] = [];
  let left = 0;
  all.forEach((group, index) => {
    if (shown.has(index)) {
      lefts.push(left);
      left += widths[lefts.length - 1] + 1;
    } else {
      rails.push({ group, left });
      left += RAIL_WIDTH + 1;
    }
  });
  return {
    groups,
    widths,
    lefts,
    single: groups.length === 1,
    collapsed,
    rails,
  };
}
/** Shown columns share the width: the fill column (the canvas column, or the
 * first) takes what the others leave. */
function columnWidths(
  state: WorkspaceLayout,
  groups: PaneGroup[],
  available: number,
) {
  if (groups.length < 2) return groups.map(() => available);
  const fill = fillIndex(state, groups);
  const mins = groups.map((g) => minimumWidth(state, g));
  const budget = available - (groups.length - 1) - mins[fill];
  const others = groups.map((g, i) => (i === fill ? 0 : 1));
  const wanted = groups.map((g, i) =>
    others[i] ? Math.max(mins[i], g.preferredWidth) : 0,
  );
  const minOthers = mins.reduce((n, m, i) => n + (others[i] ? m : 0), 0);
  const wantedSurplus = wanted.reduce(
    (n, w, i) => n + w - (others[i] ? mins[i] : 0),
    0,
  );
  const surplus = Math.max(0, budget - minOthers);
  const widths = groups.map((g, i) =>
    others[i]
      ? wantedSurplus <= surplus
        ? wanted[i]
        : mins[i] + (surplus * (wanted[i] - mins[i])) / wantedSurplus
      : 0,
  );
  widths[fill] =
    available - (groups.length - 1) - widths.reduce((a, b) => a + b, 0);
  return widths;
}

/** Where a tab dropped on the left or right edge goes. Null when the drop
 * would change nothing. */
export function edgeMove(
  state: WorkspaceLayout,
  id: string,
  side: "left" | "right",
): LayoutAction | null {
  const groups = state.groups;
  const index = groups.findIndex((g) => g.tabIds.includes(id));
  if (index < 0) return null;
  const edge = side === "left" ? 0 : groups.length - 1;
  const source = groups[index];
  if (source.tabIds.length === 1)
    return index === edge
      ? null
      : groups.length === 2
        ? { type: "swap" }
        : { type: "moveColumn", group: source.id, index: edge };
  if (groups.length < MAX_COLUMNS) return { type: "split", id, side };
  return index === edge ? null : { type: "move", id, group: groups[edge].id };
}

/** Preview the destination using the same transition and sizing as the drop. */
export function edgeDropPreview(
  state: WorkspaceLayout,
  id: string,
  side: "left" | "right",
  available: number,
) {
  const source = state.groups.find((g) => g.tabIds.includes(id));
  if (!source || (state.groups.length === 1 && source.tabIds.length < 2))
    return null;
  const move = edgeMove(state, id, side);
  if (!move) return null;
  const action =
    move.type === "swap"
      ? { ...move, slotWidths: projectLayout(state, available).widths }
      : move;
  const next = projectLayout(layoutReducer(state, action), available);
  if (next.collapsed || next.groups.length < 2) return null;
  const index = next.groups.findIndex((g) => g.tabIds.includes(id));
  return {
    action,
    ...dropBounds(next.widths, index),
  };
}

function dropBounds(widths: number[], index: number) {
  return {
    width: widths[index],
    left: widths.slice(0, index).reduce((n, width) => n + width + 1, 0),
  };
}

/** Moving a column to an edge keeps its tabs. */
export function columnDropPreview(
  state: WorkspaceLayout,
  group: string,
  side: "left" | "right",
  available: number,
) {
  const source = state.groups.findIndex((g) => g.id === group);
  const edge = side === "left" ? 0 : state.groups.length - 1;
  if (state.groups.length < 2 || source < 0 || source === edge) return null;
  const action: LayoutAction =
    state.groups.length === 2
      ? { type: "swap", slotWidths: projectLayout(state, available).widths }
      : { type: "moveColumn", group, index: edge };
  const next = projectLayout(layoutReducer(state, action), available);
  if (next.collapsed) return null;
  return {
    action,
    ...dropBounds(
      next.widths,
      next.groups.findIndex((g) => g.id === group),
    ),
  };
}
