import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  answerBlocks,
  parseAnswer,
  safeHref,
} from "../src/services/answer-markdown";
import { AnswerMarkdown } from "../src/app/AnswerMarkdown";

const draw = (text: string) =>
  renderToStaticMarkup(
    <AnswerMarkdown
      text={text}
      renderText={(value) =>
        value.split(/(\[S\d+\])/).map((part, i) =>
          /^\[S\d+\]$/.test(part) ? <sup key={i}>{part.slice(2, -1)}</sup> : part,
        )
      }
      onLink={() => {}}
    />,
  );

describe("drawing answers", () => {
  it("draws tables, nested lists, checklists, quotes and code", () => {
    const html = draw(
      [
        "| Level | Tests |",
        "| --- | :---: |",
        "| **Component** | Parts [S1] |",
        "",
        "- One",
        "  - Nested *idea*",
        "",
        "Checklist:",
        "",
        "- [x] Done",
        "- [ ] Todo",
        "",
        "> Quoted",
        "",
        "```js",
        "a()",
        "```",
      ].join("\n"),
    );
    expect(html).toContain("<table>");
    expect(html).toContain('<th style="text-align:center">Tests</th>');
    expect(html).not.toContain("<span>Level</span>");
    expect(html).toContain("<strong>Component</strong>");
    expect(html).toContain("<sup>1</sup>");
    expect(html).toMatch(/<li>.*<ul>.*<em>idea<\/em>/s);
    expect(html).toContain('class="ask-tasks"');
    expect(html).toMatch(/<input type="checkbox" disabled="" aria-label="Done" checked=""\/>/);
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<div class="ask-code">');
  });

  it("never interprets HTML or unsafe links, and never loads images", () => {
    const html = draw(
      '<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://example.com) ![chart](https://evil.test/a.png)',
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("ask-image-alt");
    expect(html).not.toContain("evil.test");
  });

  it("lets Knot draw its own fenced blocks", () => {
    const html = renderToStaticMarkup(
      <AnswerMarkdown
        text={"Intro\n\n```knot-quiz\n{}\n```"}
        renderText={(v) => [v]}
        onLink={() => {}}
        renderCode={(node) => (node.lang === "knot-quiz" ? <b>quiz</b> : undefined)}
      />,
    );
    expect(html).toContain("<b>quiz</b>");
  });
});

describe("saving answers as blocks", () => {
  it("turns structure into native blocks", () => {
    const blocks = answerBlocks(
      parseAnswer(
        [
          "## Levels",
          "Some **bold** and *italic* text.",
          "1. First",
          "   - Inner",
          "- [ ] Check",
          "",
          "| A | B |",
          "| - | - |",
          "| 1 | 2 |",
        ].join("\n"),
      ),
    );
    expect(blocks).toEqual([
      { type: "h2", text: "Levels" },
      { type: "paragraph", text: "Some **bold** and *italic* text." },
      { type: "numbered", text: "First" },
      { type: "bulleted", text: "  Inner" },
      { type: "todo", text: "Check" },
      { type: "table", text: "", columns: ["A", "B"], rows: [["1", "2"]] },
    ]);
  });
});

it("allows only web and email links", () => {
  expect(safeHref("https://a.test/x")).toBe("https://a.test/x");
  expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
  expect(safeHref("javascript:alert(1)")).toBeUndefined();
  expect(safeHref("file:///C:/x")).toBeUndefined();
  expect(safeHref("not a url")).toBeUndefined();
});
