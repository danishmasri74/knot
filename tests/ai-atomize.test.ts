import { expect, it } from "vitest";
import {
  ATOMIZE_RELATIONS,
  clearPlacement,
  relationStroke,
  uncoveredPassages,
} from "../src/services/ai-atomize";

it("colors each relation type the same way", () => {
  expect(relationStroke("leads to")).toBe(ATOMIZE_RELATIONS["leads to"]);
  expect(relationStroke(" Contrasts  With ")).toBe(
    ATOMIZE_RELATIONS["contrasts with"],
  );
  expect(relationStroke("related")).toBeUndefined();
  const colors = Object.values(ATOMIZE_RELATIONS).map((c) => c.light);
  expect(new Set(colors).size).toBe(colors.length);
});

it("finds source passages the new cards leave out", () => {
  const source = [
    "Testing shows the presence of defects, not their absence.",
    "Exhaustive testing is impossible except for trivial cases.",
    "Early testing saves time and money because defects found late cost more.",
    "Intro",
  ];
  const cards = [
    "Testing shows defects are present, never that they are absent",
    "Early testing saves money: late defects cost more time",
  ];
  expect(uncoveredPassages(source, cards)).toEqual([
    "Exhaustive testing is impossible except for trivial cases.",
  ]);
  expect(uncoveredPassages(source, [...cards, "Exhaustive testing impossible beyond trivial cases"])).toEqual([]);
  // Sentences in one block are checked separately; repeats count once.
  expect(
    uncoveredPassages(
      ["Pesticide paradox needs revised tests. Pesticide paradox needs revised tests."],
      [],
    ),
  ).toEqual(["Pesticide paradox needs revised tests."]);
});

it("keeps a replacement group clear of other cards", () => {
  expect(clearPlacement(0, 0, [], [400, 300])).toEqual([0, 0, 400, 300]);
  const placed = clearPlacement(0, 0, [[100, 100, 200, 200]], [400, 300]);
  expect(placed[0]).toBe(0);
  expect(placed[1]).toBeGreaterThanOrEqual(340);
});
