import { expect, test } from "vitest";
import { matchPassage } from "../src/services/cited-sentence";
import {
  linksNeedingExcerpts,
  readExcerpt,
  withExcerpts,
} from "../src/services/web-search-excerpts";
import type {
  LinkCitation,
  WebAttempt,
} from "../src/services/web-source-types";

const sections = [
  {
    id: "s1",
    kind: "text" as const,
    headings: [],
    text: "Python is a high-level programming language created by Guido van Rossum.",
  },
  {
    id: "s2",
    kind: "text" as const,
    headings: ["Releases"],
    text:
      "Python 3.13 was released in October 2024. It added an experimental free-threaded build that runs without the global interpreter lock. " +
      "The release also included a new interactive interpreter with multi-line editing and colour output. " +
      "Support for some older platforms was removed in this version, following the deprecation schedule.",
  },
  {
    id: "s3",
    kind: "text" as const,
    headings: ["Community"],
    text: "The Python Software Foundation manages the language and its community events.",
  },
];

test("the best section is found, then narrowed to the matching sentence", () => {
  const hit = matchPassage(
    "Python 3.13 shipped an experimental build without the global interpreter lock.",
    sections,
  );
  expect(hit?.section.id).toBe("s2");
  expect(hit?.sentence?.text).toBe(
    "It added an experimental free-threaded build that runs without the global interpreter lock.",
  );
  expect(matchPassage("Rust has a borrow checker.", sections)).toBeNull();
});

const link = (n: number, url: string): LinkCitation => ({
  kind: "link",
  document: "",
  id: url,
  url,
  title: "Python",
  text: "Python",
  citation: `[S${n}]`,
});

test("links get passages, or say why not", () => {
  const answer =
    "Python 3.13 added an experimental build without the global interpreter lock [S1]. It is popular with beginners [S2]. Its foundation runs events [S3].";
  const attempts: WebAttempt[] = [
    {
      id: "a",
      url: "https://python.example/",
      state: "ready",
      capture: {
        version: 1,
        sourceId: "a",
        captureId: "c",
        requestedUrl: "https://python.example/",
        finalUrl: "https://www.python.example/",
        title: "Python",
        author: null,
        published: null,
        fetchedAt: "1",
        contentType: "text/html",
        method: "semantic-main-v1",
        contentHash: "h",
        warnings: [],
        sections,
      },
    },
    {
      id: "b",
      url: "https://blocked.example/",
      state: "failed",
      reason: "HTTP 403",
    },
  ];
  const links = [
    link(1, "https://python.example/"),
    link(2, "https://python.example/"),
    link(3, "https://blocked.example/"),
  ];
  expect(linksNeedingExcerpts(links)).toEqual([
    "https://python.example/",
    "https://blocked.example/",
  ]);
  const [found, none, unavailable] = withExcerpts(answer, links, attempts);
  expect(found).toMatchObject({
    excerptState: "found",
    excerpt:
      "It added an experimental free-threaded build that runs without the global interpreter lock.",
    excerptUrl: "https://www.python.example/",
  });
  expect(none.excerptState).toBe("none");
  expect(unavailable.excerptState).toBe("unavailable");
  expect(linksNeedingExcerpts([found, none, unavailable])).toEqual([]);
  expect(readExcerpt(found)).toMatchObject({
    url: "https://www.python.example/",
    page: undefined,
  });
});

test("stored excerpts are checked before use", () => {
  const base = link(1, "https://site.example/");
  expect(readExcerpt(base)).toBeNull();
  expect(
    readExcerpt({
      ...base,
      excerptState: "found",
      excerpt: "x",
      passage: "x y",
      excerptUrl: "javascript:alert(1)",
      excerptPage: 3,
    }),
  ).toEqual({
    excerpt: "x",
    passage: "x y",
    page: 3,
    url: "https://site.example/",
  });
});
