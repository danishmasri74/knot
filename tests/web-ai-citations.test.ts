import { expect, test } from "vitest";
import { composeAiContext } from "../src/services/ai-context-composer";
import {
  validateSourceRefs,
  webProvenance,
  readDurableWebSource,
} from "../src/services/web-ai-evidence";
import type { WebAttempt } from "../src/services/web-source-types";
const source: WebAttempt = {
  id: "a",
  url: "https://example.com",
  state: "partial",
  capture: {
    version: 1,
    sourceId: "a",
    captureId: "capture",
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com",
    title: "Article",
    author: null,
    published: null,
    fetchedAt: "123",
    contentType: "text/html",
    method: "v1",
    contentHash: "hash",
    warnings: ["Visual content not captured"],
    sections: [{ id: "s1", text: "Captured fact", kind: "text", headings: [] }],
  },
};
test("legacy proposals load; web proposals require refs from their exact frozen request", () => {
  const context = composeAiContext("{}", [source]);
  expect(() => validateSourceRefs({ blocks: [{}] })).not.toThrow();
  expect(() => validateSourceRefs({ blocks: [{}] }, context)).toThrow(
    "missing or unknown",
  );
  expect(() =>
    validateSourceRefs({ blocks: [{ sourceRefs: ["capture/s1"] }] }, context),
  ).not.toThrow();
  expect(() =>
    validateSourceRefs({ blocks: [{ sourceRefs: ["earlier/s1"] }] }, context),
  ).toThrow();
  expect(() =>
    validateSourceRefs(
      { blocks: [], mindmap: [{ sourceRefs: ["fake"] }] },
      context,
    ),
  ).toThrow();
  const records = webProvenance(context, ["capture/s1"]);
  expect(records[0].sections[0].text).toBe("Captured fact");
  expect(records[0].warnings).toContain("Visual content not captured");
  expect(readDurableWebSource(JSON.stringify(records[0]))?.finalUrl).toBe(
    "https://example.com",
  );
  expect(
    readDurableWebSource('{"version":1,"finalUrl":"javascript:alert(1)"}'),
  ).toBeNull();
  expect(() => webProvenance(context, ["unknown"])).toThrow();
});
