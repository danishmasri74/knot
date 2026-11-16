import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  SLIDES_TYPE,
  isSlidesName,
  isUnconvertedSlides,
  pageLabel,
  setSlideJob,
  slideJob,
  slidesTitle,
  subscribeSlideJobs,
} from "../src/services/slides";

describe("slide decks", () => {
  it("recognises decks by name and unconverted decks by type", () => {
    expect(isSlidesName("Q3 review.pptx")).toBe(true);
    expect(isSlidesName("Q3 REVIEW.PPTX ")).toBe(true);
    expect(isSlidesName("report.pdf")).toBe(false);
    expect(isSlidesName(undefined)).toBe(false);
    expect(isUnconvertedSlides(SLIDES_TYPE, "deck")).toBe(true);
    expect(isUnconvertedSlides("application/octet-stream", "a.pptx")).toBe(
      true,
    );
    // A converted deck keeps its name but is a PDF now.
    expect(isUnconvertedSlides("application/pdf", "a.pptx")).toBe(false);
  });

  it("labels pages as slides for decks only", () => {
    expect(pageLabel("Q3 review.pptx", 3)).toBe("slide 3");
    expect(pageLabel("paper.pdf", 3)).toBe("p. 3");
    expect(slidesTitle("Q3 review.pptx")).toBe("Q3 review");
    expect(slidesTitle(".pptx")).toBe("Slides");
  });

  it("tracks conversion jobs and notifies listeners", () => {
    const listener = vi.fn();
    const stop = subscribeSlideJobs(listener);
    setSlideJob("k", { state: "converting" });
    expect(slideJob("k")).toEqual({ state: "converting" });
    setSlideJob("k", undefined);
    expect(slideJob("k")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setSlideJob("k", { state: "missing" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
