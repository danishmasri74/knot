import { useEffect, useState } from "react";

type Preferences = {
  recent: string[];
  pinned: string[];
  favoriteOrder: string[];
  /** Pinned collections left open, so pinning keeps a collection in view. */
  openCollections: string[];
  favoritesClosed: boolean;
};
const empty = (): Preferences => ({
  recent: [],
  pinned: [],
  favoriteOrder: [],
  openCollections: [],
  favoritesClosed: false,
});
/** The one sidebar place that expands the open notebook: the place it was
 * opened from while it is still shown there, otherwise the first place. */
export function expandedPlace(places: string[], chosen: string | null) {
  return chosen && places.includes(chosen) ? chosen : (places[0] ?? null);
}
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
/** A restored backup opens as a new workspace with the same notebooks and
 * collections, so it keeps the sidebar's recents, pins and favorites order. */
export function carrySidebarPreferences(
  from: string | null | undefined,
  to: string | null | undefined,
) {
  if (!from || !to || from === to) return;
  const target = `knot.sidebar.${to}`;
  const source = localStorage.getItem(`knot.sidebar.${from}`);
  if (source !== null && localStorage.getItem(target) === null)
    localStorage.setItem(target, source);
}
/** A newly pinned collection starts open so its notebooks are in view. */
function withPin(preferences: Preferences, id: string): Preferences {
  if (preferences.pinned.includes(id)) return preferences;
  return {
    ...preferences,
    pinned: [...preferences.pinned, id],
    openCollections: [...new Set([...preferences.openCollections, id])],
  };
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
      openCollections: ids(value.openCollections),
      favoritesClosed: value.favoritesClosed === true,
    };
  } catch {
    return empty();
  }
}
export function useSidebarPreferences(
  workspace: string | null,
  active?: string,
) {
  const [, refresh] = useState(0);
  const preferences = workspace ? readSidebarPreferences(workspace) : empty();
  const save = (next: Preferences) => {
    if (!workspace) return;
    localStorage.setItem(`knot.sidebar.${workspace}`, JSON.stringify(next));
    refresh((value) => value + 1);
  };
  const markRecent = (ids: string[]) => {
    if (!workspace || !ids.length) return;
    const current = readSidebarPreferences(workspace);
    localStorage.setItem(
      `knot.sidebar.${workspace}`,
      JSON.stringify({
        ...current,
        recent: [...new Set([...ids, ...current.recent])].slice(0, 100),
      }),
    );
    refresh((value) => value + 1);
  };
  useEffect(() => {
    if (active) markRecent([active]);
    // markRecent reads current storage, so it needs no dependency.
  }, [workspace, active]);
  return {
    ...preferences,
    markRecent,
    reorderFavorites: (favoriteOrder: string[]) =>
      save({ ...preferences, favoriteOrder }),
    togglePin: (id: string) =>
      save(
        preferences.pinned.includes(id)
          ? {
              ...preferences,
              pinned: preferences.pinned.filter((entry) => entry !== id),
            }
          : withPin(preferences, id),
      ),
    toggleCollectionOpen: (id: string) =>
      save({
        ...preferences,
        openCollections: preferences.openCollections.includes(id)
          ? preferences.openCollections.filter((entry) => entry !== id)
          : [...preferences.openCollections, id],
      }),
    setFavoritesOpen: (open: boolean) =>
      save({ ...preferences, favoritesClosed: !open }),
    pin: (id: string) => save(withPin(preferences, id)),
  };
}
