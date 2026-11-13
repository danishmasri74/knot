import { describe, expect, it } from "vitest";
import { passageUrl, textDirective } from "../src/services/text-fragment";

describe("passage deep links", () => {
  it("uses the whole text for a short passage and escapes directive syntax", () => {
    expect(textDirective("  Rust 1.80 — fast, safe & well-loved  ")).toBe(
      "Rust%201.80%20%E2%80%94%20fast%2C%20safe%20%26%20well%2Dloved",
    );
  });
  it("uses start and end terms for a long passage", () => {
    const passage =
      "The quick brown fox jumps over the lazy dog while the cat watches from the old fence.";
    expect(textDirective(passage)).toBe(
      "The%20quick%20brown%20fox%20jumps,watches%20from%20the%20old%20fence.",
    );
  });
  it("takes terms from the first and last element of joined content", () => {
    expect(textDirective("Name | Price\nApple | $1\nPear | $2")).toBe(
      "Name,%242",
    );
    expect(textDirective("first item text\nsecond item text")).toBe(
      "first%20item%20text,second%20item%20text",
    );
  });
  it("caps long words so links stay short", () => {
    const long = "x".repeat(120);
    const directive = textDirective(`${long} a b c d e f g h i j k l`)!;
    expect(directive.startsWith(`${long},`)).toBe(true);
  });
  it("appends to the page address and keeps element anchors", () => {
    expect(passageUrl("https://example.com/a?q=1", "Hello world")).toBe(
      "https://example.com/a?q=1#:~:text=Hello%20world",
    );
    expect(passageUrl("https://example.com/a#intro", "Hello world")).toBe(
      "https://example.com/a#intro:~:text=Hello%20world",
    );
    expect(
      passageUrl("https://example.com/a#:~:text=old", "Hello world"),
    ).toBe("https://example.com/a#:~:text=Hello%20world");
  });
  it("falls back to the plain address", () => {
    expect(passageUrl("https://example.com/", "   ")).toBe(
      "https://example.com/",
    );
    expect(passageUrl("https://example.com/", undefined)).toBe(
      "https://example.com/",
    );
    expect(passageUrl("", "Hello")).toBe("");
    expect(passageUrl("mailto:a@example.com", "Hello")).toBe(
      "mailto:a@example.com",
    );
  });
});
