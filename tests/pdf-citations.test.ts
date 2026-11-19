import { expect, it } from "vitest";
import {
  PDF_CITATION,
  resolvePdfCitation,
  shortPdfName,
} from "../src/services/pdf-citations";

const levels = { key: "a", name: "12-Test+Levels+and+Test+Types.pptx", document: "doc" };
const maintenance = { key: "b", name: "13-Maintenance+Testing.pptx", document: "doc" };

it("opens the only PDF at the cited slide or page", () => {
  expect(resolvePdfCitation("(slide 3)", [levels])).toEqual({
    pdf: levels,
    page: 3,
    label: "slide 3",
  });
  expect(resolvePdfCitation("(p. 12)", [levels])?.page).toBe(12);
  expect(resolvePdfCitation("(slides 3–4)", [levels])?.label).toBe("slides 3–4");
  expect(resolvePdfCitation("(pp. 3-4)", [levels])?.label).toBe("pp. 3–4");
  expect(resolvePdfCitation("(slide 3)", [])).toBeUndefined();
});

it("needs the file name when several were sent", () => {
  const both = [levels, maintenance];
  expect(resolvePdfCitation("(slide 3)", both)).toBeUndefined();
  const cited = resolvePdfCitation("(13-Maintenance+Testing.pptx, slide 5)", both);
  expect(cited?.pdf).toBe(maintenance);
  expect(cited?.label).toBe("13-Maintenance Testing, slide 5");
  // Loose spellings of the name still match.
  expect(
    resolvePdfCitation("(12-Test Levels and Test Types, p. 2)", both)?.pdf,
  ).toBe(levels);
  expect(resolvePdfCitation("(Other.pdf, slide 1)", both)).toBeUndefined();
});

it("finds citations inside answer text", () => {
  const text =
    "Unit testing (slide 3) and maintenance (13-Maintenance+Testing.pptx, slide 2) differ (see notes).";
  expect(text.match(new RegExp(PDF_CITATION, "g"))).toEqual([
    "(slide 3)",
    "(13-Maintenance+Testing.pptx, slide 2)",
  ]);
  expect(shortPdfName("12-Test+Levels.pptx.pdf")).toBe("12-Test Levels");
});
