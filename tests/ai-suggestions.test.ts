import { describe, expect, it } from "vitest";
import { parseAiSuggestions } from "../src/services/ai-suggestions";
describe("AI suggestions", () => {
  it("keeps useful distinct suggestions and rejects invalid entries", () => {
    expect(
      parseAiSuggestions(
        JSON.stringify([
          { label: "Quiz me", prompt: "Quiz me on the note" },
          { label: "Quiz me", prompt: "Duplicate" },
          { label: "", prompt: "Empty" },
        ]),
      ),
    ).toEqual([{ label: "Quiz me", prompt: "Quiz me on the note" }]);
  });
  it("rejects malformed output and excessive suggestions", () => {
    expect(() => parseAiSuggestions("not json")).toThrow();
    expect(() => parseAiSuggestions("{}")).toThrow();
    expect(() => parseAiSuggestions("[1,2,3,4]")).toThrow();
  });
  it("filters oversized prompts and remote links", () => {
    expect(
      parseAiSuggestions(
        JSON.stringify([
          { label: "Open", prompt: "https://example.com" },
          { label: "Long", prompt: "x".repeat(401) },
        ]),
      ),
    ).toEqual([]);
  });
});
