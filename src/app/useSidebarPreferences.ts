import { useEffect, useState } from "react";

type Preferences = {
  recent: string[];
  pinned: string[];
  favoriteOrder: string[];
};
export function startupNotebook<T extends { id: string }>(
  rows: T[],
  workspace: string | null,
  tourId: string | null,
) {
  const recent = workspace ? readSidebarPreferences(workspace).recent : [];
  return (
    rows.find((row) => row.id === tourId) ??
    recent.map((id) => rows.find((row) => row.id === id)).find(Boolean) ??
    rows[0]
  );
}
export function orderedFavorites(favorites: string[], order: string[]) {
  return [...new Set([...order, ...favorites])].filter((id) =>
    favorites.includes(id),
  );
}
export function readSidebarPreferences(workspace: string): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(`knot.sidebar.${workspace}`) ?? "{}",
    );
    const ids = (input: unknown): string[] =>
      Array.isArray(input)
        ? [
            ...new Set(
              input.filter((id): id is string => typeof id === "string"),
            ),
          ]
        : [];
    return {
      recent: ids(value.recent),
      pinned: ids(value.pinned),
      favoriteOrder: ids(value.favoriteOrder),
    };
  } catch {
    return { recent: [], pinned: [], favoriteOrder: [] };
  }
}
export function useSidebarPreferences(
  workspace: string | null,
  active?: string,
) {
  const [, refresh] = useState(0);
  const preferences = workspace
    ? readSidebarPreferences(workspace)
    : { recent: [], pinned: [], favoriteOrder: [] };
  const save = (next: Preferences) => {
    if (!workspace) return;
    localStorage.setItem(`knot.sidebar.${workspace}`, JSON.stringify(next));
    refresh((value) => value + 1);
  };
  useEffect(() => {
    if (!workspace || !active) return;
    const current = readSidebarPreferences(workspace);
    localStorage.setItem(
      `knot.sidebar.${workspace}`,
      JSON.stringify({
        ...current,
        recent: [active, ...current.recent.filter((id) => id !== active)].slice(
          0,
          100,
        ),
      }),
    );
    refresh((value) => value + 1);
  }, [workspace, active]);
  return {
    ...preferences,
    reorderFavorites: (favoriteOrder: string[]) =>
      save({ ...preferences, favoriteOrder }),
    togglePin: (id: string) =>
      save({
        ...preferences,
        pinned: preferences.pinned.includes(id)
          ? preferences.pinned.filter((entry) => entry !== id)
          : [...preferences.pinned, id],
      }),
    pin: (id: string) =>
      save({
        ...preferences,
        pinned: [...new Set([...preferences.pinned, id])],
      }),
  };
}
