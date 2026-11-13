import { expect, test } from "vitest";
import {
  pdfAuthor,
  pdfParagraphs,
  pdfPrintedTitle,
  type PdfTextItem,
} from "../src/services/web-pdf-extraction";
import { passageUrl } from "../src/services/text-fragment";

const line = (str: string, y: number, height = 10): PdfTextItem[] => [
  { str, transform: [1, 0, 0, 1, 72, y], height },
  { str: "", hasEOL: true },
];

test("PDF lines join into paragraphs at larger gaps and rejoin hyphenated words", () => {
  const items = [
    ...line("Attention Is All You Need", 700, 17),
    ...line("The dominant sequence trans-", 650),
    ...line("duction models are based on", 638),
    ...line("recurrent networks.", 626),
    ...line("A new paragraph starts after a gap.", 590),
    // Next column: back up the page.
    ...line("Second column text.", 700),
  ];
  expect(pdfParagraphs(items)).toEqual([
    "Attention Is All You Need",
    "The dominant sequence transduction models are based on recurrent networks.",
    "A new paragraph starts after a gap.",
    "Second column text.",
  ]);
  expect(pdfPrintedTitle(items)).toBe("Attention Is All You Need");
});

test("printed titles join wrapped lines and skip tiny text", () => {
  expect(
    pdfPrintedTitle([
      ...line("arXiv:1706.03762v7", 760, 8),
      ...line("A Very Long Title That", 700, 18),
      ...line("Wraps Onto Two Lines", 680, 18),
      ...line("Body text", 600, 10),
    ]),
  ).toBe("A Very Long Title That Wraps Onto Two Lines");
  expect(pdfPrintedTitle([])).toBeNull();
});

test("metadata authors keep names and drop system codes", () => {
  expect(pdfAuthor("Ashish Vaswani")).toBe("Ashish Vaswani");
  expect(pdfAuthor("SE:W:CAR:MP")).toBeNull();
  expect(pdfAuthor("user_123")).toBeNull();
  expect(pdfAuthor(null)).toBeNull();
});

test("PDF passages link to their page", () => {
  expect(passageUrl("https://arxiv.org/pdf/1706.03762", "Any passage text", 4)).toBe(
    "https://arxiv.org/pdf/1706.03762#page=4",
  );
  expect(passageUrl("https://example.com/a.pdf#page=2", undefined, 7)).toBe(
    "https://example.com/a.pdf#page=7",
  );
});
