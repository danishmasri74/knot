import { expect, test } from "vitest";
import { usesNoteSources } from "../src/services/ai-source-scope";
test("standalone canvas creation omits canvas sources", () => {
 expect(usesNoteSources("auto", "canvas", "Can you create a card that explains ISTQB", false, false)).toBe(false);
});
test("explicit sources and source-based requests are preserved", () => {
 for (const prompt of ["Summarize this canvas", "Create cards based on my notes"]) expect(usesNoteSources("auto", "canvas", prompt, false, false)).toBe(true);
 expect(usesNoteSources("auto", "canvas", "Explain ISTQB", true, false)).toBe(true);
 expect(usesNoteSources("auto", "canvas", "Explain ISTQB", false, true)).toBe(true);
 expect(usesNoteSources("current", "canvas", "Explain ISTQB", false, false)).toBe(true);
 expect(usesNoteSources("none", "rewrite", "Rewrite", true, false)).toBe(true);
});
