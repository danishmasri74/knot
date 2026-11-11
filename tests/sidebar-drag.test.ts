import { describe, it, expect } from "vitest";
import {
  membershipAfterDrop,
  reorderedCollections,
} from "../src/app/useSidebarDrag";
describe("sidebar membership gestures", () => {
  it("moves only the grabbed membership, including an existing destination", () => {
    expect(
      membershipAfterDrop(["work", "research"], "work", "personal", false),
    ).toEqual(["research", "personal"]);
    expect(
      membershipAfterDrop(["work", "research"], "work", "research", false),
    ).toEqual(["research"]);
  });
  it("copies, removes, and adds from uncollected without duplicates", () => {
    expect(
      membershipAfterDrop(["work", "research"], "work", "research", true),
    ).toEqual(["work", "research"]);
    expect(
      membershipAfterDrop(["work", "research"], "work", null, false),
    ).toEqual(["research"]);
    expect(membershipAfterDrop([], null, "work", false)).toEqual(["work"]);
  });
  it("inserts on either side in both directions", () => {
    expect(reorderedCollections(["a", "b", "c"], "a", "c", true)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(reorderedCollections(["a", "b", "c"], "c", "a", false)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});
