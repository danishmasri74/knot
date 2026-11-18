import { describe, expect, it } from "vitest";
import { aiInlineRuns } from "../src/features/editor/blocksuite/ai-content";
import { parsePdfSourceUrl } from "../src/features/editor/blocksuite/pdf-highlights";

describe("slide citations on canvas cards", () => {
  it("turns the model's citation into a readable link to that slide", async () => {
    // Loading the editor modules the first time is slow.
    const { sceneCitations } = await import("../src/features/editor/blocksuite/scene-apply");
    const cite = sceneCitations({
      document: "doc-1",
      pdfFiles: [
        { key: "k11", name: "11-Testing+in+the+Context+of+a+Software+Development+Lifecycle.pptx" },
        { key: "k13", name: "13-Maintenance+Testing.pptx" },
      ],
    } as never)!;
    const runs = aiInlineRuns(
      "Shift-left starts at **requirements** (11-Testing+in+the+Context+of+a+Software+Development+Lifecycle.pptx, slide 7).",
      cite,
    );
    expect(runs.map((r) => r.insert).join("")).toBe(
      "Shift-left starts at requirements (11-Testing in the Context of a Software Development Lifecycle, slide 7).",
    );
    expect(runs.find((r) => r.insert === "requirements")?.attributes).toEqual({ bold: true });
    const link = runs.find((r) => r.attributes?.link)!;
    expect(parsePdfSourceUrl(link.attributes!.link!)).toMatchObject({ key: "k11", documentId: "doc-1", page: 7, rects: [] });
    // A citation for a file that wasn't sent stays as text.
    expect(aiInlineRuns("See (other.pptx, slide 2)", cite).some((r) => r.attributes?.link)).toBe(false);
    // Without decks there is nothing to link.
    expect(sceneCitations({ document: "doc-1" } as never)).toBeUndefined();
  }, 60_000);
});
