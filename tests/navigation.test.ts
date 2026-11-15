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

it("notifies arrow controls after asynchronous tab navigation commits", async () => {
  const history = new NavigationHistory<{ id: string }>();
  const controls: { back: boolean; forward: boolean }[] = [];
  const stop = history.subscribe(() =>
    controls.push({ back: history.canBack, forward: history.canForward }),
  );
  for (const id of [
    "library:notebooks",
    "library:collections",
    "library:cardDeck",
  ])
    history.visit({ id });
  expect(controls.at(-1)).toEqual({ back: true, forward: false });
  let finish!: () => void;
  const moving = history.move(
    -1,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  expect(controls.at(-1)).toEqual({ back: true, forward: false });
  const revision = history.getSnapshot();
  finish();
  await moving;
  expect(history.getSnapshot()).toBeGreaterThan(revision);
  expect(controls.at(-1)).toEqual({ back: true, forward: true });
  await history.move(-1, async () => {});
  expect(controls.at(-1)).toEqual({ back: false, forward: true });
  await history.move(1, async () => {});
  expect(controls.at(-1)).toEqual({ back: true, forward: true });
  const beforeFailure = history.getSnapshot();
  await expect(
    history.move(1, async () => {
      throw Error("Save failed");
    }),
  ).rejects.toThrow();
  expect(history.getSnapshot()).toBe(beforeFailure);
  history.visit({ id: "library:notebooks" });
  expect(controls.at(-1)).toEqual({ back: true, forward: false });
  stop();
  const count = controls.length;
  history.clear();
  expect(controls).toHaveLength(count);
});
it("replaces the current entry and removes entries matching a test", async () => {
    const history = new NavigationHistory<{ id: string; tab?: string }>();
    history.visit({ id: "a" });
    history.replace({ id: "tab:a:1", tab: "1" });
    history.visit({ id: "tab:a:2", tab: "2" });
    expect(history.current?.id).toBe("tab:a:2");
    const opened: string[] = [];
    await history.move(-1, async (item) => void opened.push(item.id));
    expect(opened).toEqual(["tab:a:1"]);
    expect(history.canBack).toBe(false);
    history.removeWhere((item) => item.id.startsWith("tab:a:"));
    expect(history.current).toBeUndefined();
    expect(history.canForward).toBe(false);
  });
