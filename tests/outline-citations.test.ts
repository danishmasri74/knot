import { describe, expect, it } from "vitest";
import { citedParts } from "../src/app/ScenePreview";

const pdfs = [
  { key: "k12", name: "12-Test+Levels+and+Test+Types.pptx" },
  { key: "k13", name: "13-Maintenance+Testing.pptx" },
];

describe("outline section citations", () => {
  it("links the named deck and the slides it cites without a name", () => {
    const parts = citedParts(
      "Source: 12-Test+Levels+and+Test+Types.pptx, slides 1–5, all substantive content. Introduce levels (slide 2). Make a table (slide 3).",
      pdfs,
    );
    const links = parts.filter((p) => typeof p !== "string");
    expect(links.map((l) => [l.pdf.key, l.page])).toEqual([["k12", 1], ["k12", 2], ["k12", 3]]);
    expect(parts[0]).toBe("Source: ");
    expect(parts.filter((p) => typeof p === "string").join("")).toContain("all substantive content. Introduce levels ");
  });

  it("leaves unnamed citations as text when the deck can't be told", () => {
    expect(citedParts("Introduce levels (slide 2).", pdfs).every((p) => typeof p === "string")).toBe(true);
    expect(citedParts("Anything (slide 2)", [])).toEqual(["Anything (slide 2)"]);
  });
});
