import { useCallback, useLayoutEffect, useState } from "react";
import {
  MAX_COLUMNS,
  emptyLayout,
  layoutReducer,
  tabIdentity,
  validatedWidths,
  withCanvas,
  type LayoutAction,
  type PaneTab,
  type WorkspaceLayout,
} from "./workspace-layout";

/** The Library keeps its own tabs, columns and sizes per workspace, the way
 * each notebook does. Its tabs: the Library itself (always there) and Ask
 * Knot. */
export const libraryLayoutKey = (workspace: string) =>
  `knot.library-layout.v1.${JSON.stringify([workspace])}`;

const libraryKinds = new Set(["library", "ask"]);

export function libraryLayoutTab(
  workspace: string,
  kind: "library" | "ask",
): PaneTab {
  const tab = { kind, workspaceId: workspace };
  return { ...tab, id: tabIdentity(tab) };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Restore only valid Library tabs of this workspace; the Library tab comes
 * back as the leftmost column if it's missing. */
export function validatedLibraryLayout(
  value: unknown,
  workspace: string,
): WorkspaceLayout {
  const next = emptyLayout();
  if (
    record(value) &&
    value.version === 2 &&
    record(value.tabs) &&
    Array.isArray(value.groups)
  ) {
    const candidates = new Map<string, PaneTab>();
    for (const [id, tab] of Object.entries(value.tabs)) {
      if (
        !record(tab) ||
        typeof tab.kind !== "string" ||
        !libraryKinds.has(tab.kind) ||
        tab.workspaceId !== workspace ||
        tab.documentId !== undefined ||
        tab.noteId !== undefined
      )
        continue;
      const candidate = libraryLayoutTab(
        workspace,
        tab.kind as "library" | "ask",
      );
      if (id === candidate.id) candidates.set(id, candidate);
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
      if (next.groups.length === MAX_COLUMNS) {
        next.groups.at(-1)!.tabIds.push(...tabIds);
        continue;
      }
      next.groups.push({
        id: group.id,
        tabIds,
        activeTabId: tabIds.includes(String(group.activeTabId))
          ? String(group.activeTabId)
          : tabIds[0],
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
  }
  const library = libraryLayoutTab(workspace, "library");
  // withCanvas adds a main tab as the leftmost column (a Library layout never
  // has a canvas, so it always adds it).
  return next.tabs[library.id] ? next : withCanvas(next, library);
}

export function readLibraryLayout(workspace: string) {
  try {
    return validatedLibraryLayout(
      JSON.parse(localStorage.getItem(libraryLayoutKey(workspace)) ?? "null"),
      workspace,
    );
  } catch {
    return validatedLibraryLayout(null, workspace);
  }
}

export function useLibraryLayout(workspace: string | null) {
  const load = () => ({
    workspace,
    // Before a workspace is chosen the Library still shows (nothing saved).
    layout: workspace
      ? readLibraryLayout(workspace)
      : validatedLibraryLayout(null, ""),
  });
  const [saved, setSaved] = useState(load);
  // Adjust before children render, so a workspace never gets another's tabs.
  let current = saved;
  if (saved.workspace !== workspace) {
    current = load();
    setSaved(current);
  }
  useLayoutEffect(() => {
    if (!saved.workspace) return;
    try {
      localStorage.setItem(
        libraryLayoutKey(saved.workspace),
        JSON.stringify(saved.layout),
      );
    } catch {
      // Keep the Library usable when preference storage is unavailable.
    }
  }, [saved]);
  const dispatch = useCallback((action: LayoutAction) => {
    setSaved((previous) => {
      const layout = layoutReducer(previous.layout, action);
      // Nothing closes the Library tab, but never lose it either.
      const library = libraryLayoutTab(previous.workspace ?? "", "library");
      return {
        ...previous,
        layout: layout.tabs[library.id] ? layout : withCanvas(layout, library),
      };
    });
  }, []);
  return [current.layout, dispatch] as const;
}
