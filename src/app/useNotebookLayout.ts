import {
  useCallback,
  useLayoutEffect,
  useState,
  type MutableRefObject,
} from "react";
import {
  MAX_COLUMNS,
  canvasTab,
  emptyLayout,
  layoutReducer,
  supportingKinds,
  tabIdentity,
  validatedWidths,
  withCanvas,
  type LayoutAction,
  type PaneTab,
  type WorkspaceLayout,
} from "./workspace-layout";

export const notebookLayoutKey = (workspace: string, notebook: string) =>
  `knot.notebook-layout.v1.${JSON.stringify([workspace, notebook])}`;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Restore only valid membership belonging to this workspace and notebook.
 * Layouts saved before the canvas was a tab (version 1), notebooks with no
 * saved layout and empty layouts get the Canvas tab as their leftmost column. */
export function validatedNotebookLayout(
  value: unknown,
  workspace: string,
  notebook: string,
): WorkspaceLayout {
  const restored = restoredLayout(value, workspace, notebook);
  // A notebook with nothing open comes back with its canvas.
  return record(value) && value.version === 2 && restored.groups.length
    ? restored
    : withCanvas(restored, canvasTab(workspace, notebook));
}
function restoredLayout(
  value: unknown,
  workspace: string,
  notebook: string,
): WorkspaceLayout {
  const next = emptyLayout();
  if (
    !record(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !record(value.tabs) ||
    !Array.isArray(value.groups)
  )
    return next;
  next.hidden = value.hidden === true;
  const candidates = new Map<string, PaneTab>();
  for (const [id, tab] of Object.entries(value.tabs)) {
    if (
      !record(tab) ||
      tab.id !== id ||
      tab.workspaceId !== workspace ||
      typeof tab.kind !== "string" ||
      !(supportingKinds.has(tab.kind) || tab.kind === "backlinks") ||
      (tab.documentId !== undefined && tab.documentId !== notebook) ||
      (tab.noteId !== undefined && typeof tab.noteId !== "string") ||
      (!["browser", "cardDeck"].includes(tab.kind) &&
        tab.documentId !== notebook) ||
      (tab.kind === "note" && !tab.noteId)
    )
      continue;
    const candidate = tab as PaneTab;
    if (id !== tabIdentity(candidate)) continue;
    const normalized =
      tab.kind === "backlinks"
        ? { ...candidate, kind: "reference" as const }
        : candidate;
    candidates.set(id, { ...normalized, id: tabIdentity(normalized) });
  }
  const used = new Set<string>();
  for (const group of value.groups) {
    if (
      !record(group) ||
      typeof group.id !== "string" ||
      !group.id ||
      next.groups.some((g) => g.id === group.id) ||
      !Array.isArray(group.tabIds)
    )
      continue;
    const tabIds = group.tabIds.flatMap((id) => {
      const tab = typeof id === "string" ? candidates.get(id) : undefined;
      if (!tab || used.has(tab.id)) return [];
      used.add(tab.id);
      next.tabs[tab.id] = tab;
      return [tab.id];
    });
    if (!tabIds.length) continue;
    // Layouts saved with more columns than Knot now allows fold the extra
    // columns' tabs into the last one, so no tab is lost.
    if (next.groups.length === MAX_COLUMNS) {
      next.groups.at(-1)!.tabIds.push(...tabIds);
      continue;
    }
    next.groups.push({
      id: group.id,
      tabIds,
      activeTabId:
        tabIds.find(
          (id) => id === candidates.get(String(group.activeTabId))?.id,
        ) ?? tabIds[0],
      preferredWidth: validatedWidths([group.preferredWidth])[0],
    });
  }
  next.lastUsedGroupId =
    next.groups.find((g) => g.id === value.lastUsedGroupId)?.id ??
    next.groups.at(-1)?.id ??
    null;
  next.expandedGroupId =
    next.groups.length > 1
      ? (next.groups.find((g) => g.id === value.expandedGroupId)?.id ?? null)
      : null;
  return next;
}

/** A notebook deleted for good no longer needs its saved layout. */
export function forgetNotebookLayout(workspace: string, notebook: string) {
  try {
    localStorage.removeItem(notebookLayoutKey(workspace, notebook));
  } catch {
    /* Nothing to clean up without storage. */
  }
}
export function readNotebookLayout(workspace: string, notebook: string) {
  try {
    return validatedNotebookLayout(
      JSON.parse(
        localStorage.getItem(notebookLayoutKey(workspace, notebook)) ?? "null",
      ),
      workspace,
      notebook,
    );
  } catch {
    return validatedNotebookLayout(null, workspace, notebook);
  }
}

export type AskContinuation = { workspace: string; notebook: string };
export function continuedAskLayout(
  layout: WorkspaceLayout,
  workspace: string,
  notebook: string,
) {
  const tab = {
    kind: "ask" as const,
    workspaceId: workspace,
    documentId: notebook,
  };
  return layoutReducer(layout, {
    type: "open",
    tab: { ...tab, id: tabIdentity(tab) },
  });
}
export function useNotebookLayout(
  workspace: string | null,
  notebook?: string,
  continuation?: MutableRefObject<AskContinuation | null>,
) {
  const key =
    workspace && notebook ? notebookLayoutKey(workspace, notebook) : null;
  const load = () => ({
    key,
    askMountKey: 0,
    layout:
      workspace && notebook
        ? readNotebookLayout(workspace, notebook)
        : emptyLayout(),
  });
  const [saved, setSaved] = useState(load);
  // Adjust before children render, so a notebook never receives another's panes.
  let current = saved;
  if (saved.key !== key) {
    current = load();
    current.askMountKey = saved.askMountKey + 1;
    const request = continuation?.current;
    if (
      request &&
      workspace === request.workspace &&
      notebook === request.notebook
    ) {
      current.layout = continuedAskLayout(current.layout, workspace, notebook);
      current.askMountKey = saved.askMountKey;
    }

    setSaved(current);
  }
  useLayoutEffect(() => {
    const request = continuation?.current;
    if (
      request &&
      (workspace !== request.workspace ||
        saved.key === notebookLayoutKey(request.workspace, request.notebook))
    )
      continuation.current = null;
    if (!saved.key) return;
    try {
      localStorage.setItem(saved.key, JSON.stringify(saved.layout));
    } catch {
      // Keep panes usable when local preference storage is unavailable.
    }
  }, [saved]);
  // Editor controllers retain callbacks registered before a notebook loads.
  // Like useReducer's dispatch, always update the current state and scope.
  const dispatch = useCallback((action: LayoutAction) => {
    setSaved((previous) => ({
      ...previous,
      layout: layoutReducer(previous.layout, action),
    }));
  }, []);
  return [current.layout, dispatch, current.askMountKey] as const;
}
