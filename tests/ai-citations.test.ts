import { expect, test } from "vitest";
import {
  linkCitations,
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
test("web search links become numbered sources after the message's own", () => {
  const url = "https://example.com/news?utm_source=openai";
  const text = `Version 2 shipped ([example.com](${url})). It adds sync ([example.com](${url})).`;
  const first = text.indexOf("([");
  const { text: shown, links } = linkCitations(
    text,
    [
      {
        url,
        title: "Release news",
        start: first,
        end: first + `([example.com](${url}))`.length,
      },
      // Offsets that miss the link (for example after an emoji) fall back to
      // the Markdown link with the same URL.
      { url, title: "Release news", start: 0, end: 3 },
    ],
    4,
  );
  expect(shown).toBe("Version 2 shipped [S5]. It adds sync [S5].");
  expect(links).toEqual([
    {
      kind: "link",
      document: "",
      id: "https://example.com/news",
      url: "https://example.com/news",
      title: "Release news",
      text: "Release news",
      citation: "[S5]",
    },
  ]);
  // A cited link that cannot be placed is still listed as a source.
  const other = linkCitations(
    "No links here.",
    [{ url: "https://a.org/x" }],
    0,
  );
  expect(other.text).toBe("No links here. [S1]");
  expect(other.links[0].title).toBe("a.org");
  // Links are readable citation sources; other schemes are not.
  const context = JSON.stringify({
    citationSources: [
      ...links,
      {
        kind: "link",
        document: "",
        id: "x",
        text: "x",
        title: "x",
        url: "javascript:alert(1)",
      },
    ],
  });
  expect(readCitationSources(context).map((source) => source.citation)).toEqual(
    ["[S5]"],
  );
});
