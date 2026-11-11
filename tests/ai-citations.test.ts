import { expect, test } from "vitest";
import {
  readCitationSources,
  withCitationSources,
} from "../src/services/ai-citations";
test("citations retain request order and disambiguate identical block IDs across documents", () => {
  const sources = readCitationSources(
    JSON.stringify({
      document: "a",
      structure: [{ id: "same", text: "Original" }],
      surroundingReadOnly: [{ id: "other", text: "Excluded" }],
      addedNotes: [
        { document: "b", structure: [{ id: "same", text: "Second" }] },
      ],
    }),
  );
  expect(sources.map((s) => [s.document, s.id, s.text])).toEqual([
    ["a", "same", "Original"],
    ["b", "same", "Second"],
  ]);
});
test("missing and malformed saved contexts cannot resolve sources", () => {
  expect(readCitationSources()).toEqual([]);
  expect(readCitationSources("invalid")).toEqual([]);
});

test("explicit IDs distinguish welcome heading from Maya evidence and survive saved requests", () => {
  const context = withCitationSources(
    JSON.stringify({
      document: "welcome",
      structure: [
        { id: "intro", text: "01 · Start here" },
        { id: "maya", text: "Maya owns the export work." },
      ],
    }),
  );
  const data = JSON.parse(context);
  expect(data.citationSources[1]).toMatchObject({
    citation: "[S2]",
    id: "maya",
    text: "Maya owns the export work.",
  });
  data.structure.reverse();
  expect(readCitationSources(JSON.stringify(data))[1].id).toBe("maya");
  expect(withCitationSources(context)).toBe(context);
});
