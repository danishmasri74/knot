import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
const load = () => import("../src/services/sidebar-side");

describe("sidebar side preference", () => {
  it("defaults to the left and reads a saved right", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    let side = await load();
    expect(side.getSidebarSide()).toBe("left");
    side.setSidebarSide("right");
    vi.resetModules();
    side = await load();
    expect(side.getSidebarSide()).toBe("right");
  });
  it("keeps the choice for the session when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const side = await load();
    expect(side.getSidebarSide()).toBe("left");
    side.setSidebarSide("right");
    expect(side.getSidebarSide()).toBe("right");
  });
});
