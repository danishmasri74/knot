import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  DOCUMENT_TYPE,
  SLIDES_TYPE,
  isSlidesName,
  office,
  officeJob,
  officeKind,
  officeTitle,
  originalProps,
  pageLabel,
  setOfficeJob,
  subscribeOfficeJobs,
  unconvertedOffice,
} from "../src/services/office";

describe("Office files", () => {
  it("recognises decks and documents by name", () => {
    expect(isSlidesName("Q3 review.pptx")).toBe(true);
    expect(isSlidesName("Q3 REVIEW.PPTX ")).toBe(true);
    expect(isSlidesName("report.pdf")).toBe(false);
    expect(isSlidesName(undefined)).toBe(false);
    expect(officeKind("Essay.docx")).toBe("document");
    expect(officeKind("ESSAY.DOCX ")).toBe("document");
    expect(officeKind("deck.pptx")).toBe("slides");
    expect(officeKind("old.doc")).toBeUndefined();
    expect(officeKind("macro.docm")).toBeUndefined();
    expect(officeKind(42)).toBeUndefined();
  });

  it("finds unconverted files by type, or by name when the type is vague", () => {
    expect(unconvertedOffice(SLIDES_TYPE, "deck")).toBe("slides");
    expect(unconvertedOffice(DOCUMENT_TYPE, "essay")).toBe("document");
    expect(unconvertedOffice("application/octet-stream", "a.pptx")).toBe(
      "slides",
    );
    expect(unconvertedOffice("application/octet-stream", "a.docx")).toBe(
      "document",
    );
    // A converted file keeps its name but is a PDF now.
    expect(unconvertedOffice("application/pdf", "a.pptx")).toBeUndefined();
    expect(unconvertedOffice("application/pdf", "a.docx")).toBeUndefined();
    expect(unconvertedOffice("text/plain", "notes.txt")).toBeUndefined();
  });

  it("labels pages as slides for decks only", () => {
    expect(pageLabel("Q3 review.pptx", 3)).toBe("slide 3");
    expect(pageLabel("Essay.docx", 3)).toBe("p. 3");
    expect(pageLabel("paper.pdf", 3)).toBe("p. 3");
    expect(officeTitle("Q3 review.pptx", "slides")).toBe("Q3 review");
    expect(officeTitle(".pptx", "slides")).toBe("Slides");
    expect(officeTitle("Essay.DOCX", "document")).toBe("Essay");
    expect(officeTitle(".docx", "document")).toBe("Document");
  });

  it("keeps the deck props older Knot reads, and separate document props", () => {
    expect(originalProps.slides.source).toBe("prop:slidesSourceId");
    expect(originalProps.document.source).not.toBe(
      originalProps.slides.source,
    );
  });

  it("sends the kind to the converter", async () => {
    await office.convert("k", "document");
    expect(invoke).toHaveBeenCalledWith("convert_office", {
      key: "k",
      kind: "document",
    });
    await office.openOriginal("k", "Essay.docx", "document");
    expect(invoke).toHaveBeenCalledWith("open_office_original", {
      key: "k",
      name: "Essay.docx",
      kind: "document",
    });
  });

  it("tracks conversion jobs and notifies listeners", () => {
    const listener = vi.fn();
    const stop = subscribeOfficeJobs(listener);
    setOfficeJob("k", { state: "converting" });
    expect(officeJob("k")).toEqual({ state: "converting" });
    setOfficeJob("k", undefined);
    expect(officeJob("k")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setOfficeJob("k", { state: "missing" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
