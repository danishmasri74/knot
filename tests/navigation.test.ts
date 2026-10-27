import { describe, expect, it } from "vitest";
import { NavigationHistory } from "../src/services/navigation";

describe("document navigation", () => {
  it("keeps its position when saving or opening fails", async () => {
    const history = new NavigationHistory<{ id: string }>();
    history.visit({ id: "a" });
    history.visit({ id: "b" });
    await expect(
      history.move(-1, async () => {
        throw Error("save failed");
      }),
    ).rejects.toThrow("save failed");
    expect(history.canForward).toBe(false);
    const opened: string[] = [];
    await history.move(-1, async (item) => {
      opened.push(item.id);
    });
    expect(opened).toEqual(["a"]);
    expect(history.canBack).toBe(false);
    expect(history.canForward).toBe(true);
  });

  it("discards the forward branch after opening another document", async () => {
    const history = new NavigationHistory<{ id: string }>();
    for (const id of ["a", "b", "c"]) history.visit({ id });
    await history.move(-1, async () => {});
    history.visit({ id: "d" });
    history.visit({ id: "d" });
    expect(history.canForward).toBe(false);
    await history.move(-1, async (item) => {
      expect(item.id).toBe("b");
    });
  });

  it("uses renamed titles, removes deleted documents and clears on workspace changes", async () => {
    const history = new NavigationHistory<{ id: string; title: string }>();
    for (const id of ["a", "b", "c"]) history.visit({ id, title: id });
    history.update("a", { title: "Renamed" });
    history.remove("b");
    await history.move(-1, async (item) => {
      expect(item.title).toBe("Renamed");
    });
    history.clear();
    expect(history.canBack).toBe(false);
    expect(history.canForward).toBe(false);
  });
});
