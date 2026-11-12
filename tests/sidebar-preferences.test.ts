import { afterEach, expect, it, vi } from "vitest";
import {
  carrySidebarPreferences,
  orderedFavorites,
  readSidebarPreferences,
  expandedPlace,
  startupNotebook,
} from "../src/app/useSidebarPreferences";

afterEach(() => vi.unstubAllGlobals());
it("reopens the last available notebook while prioritizing the first-run tour", () => {
  const rows = [{ id: "oop" }, { id: "testing" }, { id: "tour" }];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "knot.sidebar.work"
        ? JSON.stringify({ recent: ["deleted", "testing", "oop"] })
        : null,
  });
  expect(startupNotebook(rows, "work", null)?.id).toBe("testing");
  expect(startupNotebook(rows, "work", "tour")?.id).toBe("tour");
  expect(startupNotebook(rows, "other", null)?.id).toBe("oop");
  expect(startupNotebook([], "work", null)).toBeUndefined();
});
it("restores sidebar preferences independently for each workspace", () => {
  const storage = new Map([
    [
      "knot.sidebar.work",
      JSON.stringify({ recent: ["new", "old"], pinned: ["research"] }),
    ],
    ["knot.sidebar.home", JSON.stringify({ recent: ["personal"], pinned: [] })],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
  });
  expect(readSidebarPreferences("work")).toEqual({
    recent: ["new", "old"],
    pinned: ["research"],
    favoriteOrder: [],
    openCollections: [],
    favoritesClosed: false,
  });
  expect(readSidebarPreferences("home")).toEqual({
    recent: ["personal"],
    pinned: [],
    favoriteOrder: [],
    openCollections: [],
    favoritesClosed: false,
  });
  expect(readSidebarPreferences("new")).toEqual({
    recent: [],
    pinned: [],
    favoriteOrder: [],
    openCollections: [],
    favoritesClosed: false,
  });
});
it("recovers from invalid stored preferences and removes duplicate IDs", () => {
  const getItem = vi.fn().mockReturnValue("invalid");
  vi.stubGlobal("localStorage", { getItem });
  expect(readSidebarPreferences("work")).toEqual({
    recent: [],
    pinned: [],
    favoriteOrder: [],
    openCollections: [],
    favoritesClosed: false,
  });
  getItem.mockReturnValue(
    JSON.stringify({ recent: ["a", 4, "a", "b"], pinned: null }),
  );
  expect(readSidebarPreferences("work")).toEqual({
    recent: ["a", "b"],
    pinned: [],
    favoriteOrder: [],
    openCollections: [],
    favoritesClosed: false,
  });
});

it("keeps saved favorite order while adding new favorites and ignoring removed ones", () => {
  expect(orderedFavorites(["a", "b", "c"], ["b", "gone", "a", "b"])).toEqual([
    "b",
    "a",
    "c",
  ]);
});
it("restores favorite order independently from recent visits", () => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({ recent: ["a", "b"], favoriteOrder: ["b", "a", "b", 5] }),
  });
  expect(readSidebarPreferences("work")).toEqual({
    recent: ["a", "b"],
    pinned: [],
    favoriteOrder: ["b", "a"],
    openCollections: [],
    favoritesClosed: false,
  });
});
it("carries sidebar preferences into a restored workspace without overwriting its own", () => {
  const storage = new Map([
    [
      "knot.sidebar.Workspace",
      JSON.stringify({ recent: ["a"], pinned: ["c"] }),
    ],
    ["knot.sidebar.restored-2", JSON.stringify({ recent: ["own"] })],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  carrySidebarPreferences("Workspace", "restored-1");
  expect(readSidebarPreferences("restored-1").pinned).toEqual(["c"]);
  carrySidebarPreferences("Workspace", "restored-2");
  expect(readSidebarPreferences("restored-2").recent).toEqual(["own"]);
  carrySidebarPreferences(null, "restored-3");
  expect(storage.has("knot.sidebar.restored-3")).toBe(false);
});
it("restores which sidebar sections are open", () => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({ openCollections: ["c", "c", 3], favoritesClosed: true }),
  });
  const preferences = readSidebarPreferences("work");
  expect(preferences.openCollections).toEqual(["c"]);
  expect(preferences.favoritesClosed).toBe(true);
});
it("expands the open notebook in one sidebar place only", () => {
  const places = ["@favorites", "@recent", "research"];
  expect(expandedPlace(places, "research")).toBe("research");
  expect(expandedPlace(places, null)).toBe("@favorites");
  expect(expandedPlace(["@recent"], "@favorites")).toBe("@recent");
  expect(expandedPlace([], "@recent")).toBeNull();
});
