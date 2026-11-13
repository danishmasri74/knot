import { describe, expect, it } from "vitest";
import {
  citedSentence,
  claimsFor,
  sentenceSpans,
} from "../src/services/cited-sentence";

const passage =
  "The reef knot is an ancient and simple binding knot. It is used to secure a rope around an object. " +
  "Sailors tie it when reefing sails, which gives the knot its name. " +
  "The knot is not recommended for joining two ropes because it can spill under load. " +
  "Several deaths have been attributed to its misuse as a bend. " +
  "Variants include the slipped reef knot, which is common in shoelaces.";

describe("sentence-level website citations", () => {
  it("splits sentences without breaking abbreviations or decimals", () => {
    const spans = sentenceSpans("Use e.g. a 3.5 m rope. Then tie it! Done?\nNext line");
    expect(spans.map((s) => s.text)).toEqual([
      "Use e.g. a 3.5 m rope.",
      "Then tie it!",
      "Done?",
      "Next line",
    ]);
    for (const s of spans)
      expect("Use e.g. a 3.5 m rope. Then tie it! Done?\nNext line".slice(s.start, s.end)).toBe(s.text);
  });
  it("finds the sentence a paraphrased claim relies on", () => {
    const hit = citedSentence(
      "It shouldn't be used to join two ropes, since it can spill.",
      passage,
    );
    expect(hit?.text).toBe(
      "The knot is not recommended for joining two ropes because it can spill under load.",
    );
    expect(passage.slice(hit!.start, hit!.end)).toBe(hit!.text);
  });
  it("adds a neighbouring sentence when the claim draws on both", () => {
    const hit = citedSentence(
      "Joining two ropes with it can spill, and misuse as a bend has caused deaths.",
      passage,
    );
    expect(hit?.text).toBe(
      "The knot is not recommended for joining two ropes because it can spill under load. Several deaths have been attributed to its misuse as a bend.",
    );
  });
  it("keeps the whole passage when nothing clearly matches", () => {
    expect(citedSentence("Bowlines make a fixed loop.", passage)).toBeNull();
    expect(citedSentence("The knot", passage)).toBeNull();
    expect(citedSentence("Sailors reef sails.", "Short passage. Sailors reef sails.")).toBeNull();
  });
  it("collects the answer sentences that cite a marker", () => {
    const answer =
      "The reef knot is ancient [S1]. It spills under load. [S2] Shoelaces use a slipped version [S1][S3].";
    expect(claimsFor(answer, "[S1]").replace(/\s+/g, " ").trim()).toBe(
      "The reef knot is ancient . Shoelaces use a slipped version .",
    );
    expect(claimsFor(answer, "[S2]").trim()).toBe("It spills under load.");
    expect(claimsFor("[S4] Leading claim here.", "[S4]").trim()).toBe(
      "Leading claim here.",
    );
  });
});
