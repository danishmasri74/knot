import { describe, it, expect } from "vitest";
import {
  normalizeEditorPreferences,
  editorFontFamily,
} from "../src/services/editor-preferences";
describe("editor preferences", () => {
  it("bounds stored sizes and rejects invalid values", () => {
    expect(normalizeEditorPreferences({ fontSize: 100 }).fontSize).toBe(24);
    expect(normalizeEditorPreferences({ fontSize: NaN }).fontSize).toBe(16);
    expect(normalizeEditorPreferences({ fontSize: 1 }).fontSize).toBe(12);
  });
  it("quotes a custom family as one font and provides a fallback", () => {
    expect(
      editorFontFamily(
        normalizeEditorPreferences({
          fontStyle: "custom",
          customFont: "Georgia",
        }),
      ),
    ).toBe('"Georgia", Inter, "Segoe UI", sans-serif');
    expect(
      editorFontFamily(
        normalizeEditorPreferences({ fontStyle: "custom", customFont: " " }),
      ),
    ).toContain("sans-serif");
  });
});
