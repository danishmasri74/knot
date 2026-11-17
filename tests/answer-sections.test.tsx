import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { answerSections, parseAnswer } from "../src/services/answer-markdown";
import { AnswerMarkdown } from "../src/app/AnswerMarkdown";
import { citedPages } from "../src/services/pdf-citations";

const notes = (count: number, filler = 400) =>
  ["# Atomic notes", "Intro line."]
    .concat(
      Array.from({ length: count }, (_, i) => [
        `## ${i + 1}. Level ${i + 1}`,
        `**What does it test?** ${"x".repeat(filler)}`,
      ]).flat(),
    )
    .join("\n\n");

it("folds long answers with four or more sections", () => {
  const text = notes(5);
  const plan = answerSections(parseAnswer(text), text.length)!;
  expect(plan.preamble.map((n) => n.type)).toEqual(["heading", "paragraph"]);
  expect(plan.sections).toHaveLength(5);
  expect(plan.sections[0].hint).toBe("What does it test?");
  // Too few sections, or too short: left as it is.
  const three = notes(3, 800);
  expect(answerSections(parseAnswer(three), three.length)).toBeUndefined();
  const short = notes(5, 10);
  expect(answerSections(parseAnswer(short), short.length)).toBeUndefined();
});

it("draws sections open with the fold toolbar, only when finished", () => {
  const text = notes(5);
  const draw = (foldable: boolean) =>
    renderToStaticMarkup(
      <AnswerMarkdown text={text} renderText={(v) => [v]} onLink={() => {}} foldable={foldable} />,
    );
  const folded = draw(true);
  expect(folded).toContain("Cover answers");
  expect(folded.match(/aria-expanded="true"/g)).toHaveLength(5);
  expect(draw(false)).not.toContain("Cover answers");
});

it("lists the distinct pages an answer cites", () => {
  const pdfs = [{ key: "a", name: "Levels.pptx" }];
  const cited = citedPages("A (slide 3). B (slide 3). C (slide 4). D (p. 2)", pdfs);
  expect(cited.map((c) => c.page)).toEqual([3, 4, 2]);
  expect(citedPages("(slide 1) (slide 2) (slide 3)", pdfs, 2)).toHaveLength(2);
});
