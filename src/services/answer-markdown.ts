import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type {
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import type { AiContent } from "../features/editor/blocksuite/ai-content";
import { quizLines, validQuizQuestions, type AiQuestion } from "./ai-quiz";

/** The fenced block an answer's inline quiz comes in (BASE_QUIZ in ai.rs). */
export const QUIZ_LANG = "knot-quiz";
/** Questions one chat quiz shows; saving uses the Card Deck limits. */
export const MAX_CHAT_QUESTIONS = 10;

/** A quiz block's questions, or undefined while incomplete or invalid. */
export function readQuiz(value: string): AiQuestion[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    const list =
      parsed && typeof parsed === "object" && "questions" in parsed
        ? (parsed as { questions: unknown }).questions
        : parsed;
    if (!Array.isArray(list)) return;
    const questions = list.slice(0, MAX_CHAT_QUESTIONS);
    return validQuizQuestions(questions) ? questions : undefined;
  } catch {
    return;
  }
}

/** An answer as plain text, with quiz blocks as readable questions. */
export function plainAnswer(text: string): string {
  return text.replace(
    /```knot-quiz[^\n]*\n([\s\S]*?)(?:```|$)/g,
    (block, body: string) => {
      const questions = readQuiz(body);
      return questions ? quizLines(questions).join("\n") : block;
    },
  );
}

/**
 * Ask Knot answers as GitHub Markdown (see docs/AI-RICH-ANSWERS-PLAN.md).
 * The tree is drawn by AnswerMarkdown.tsx as React elements, never HTML, and
 * converted to native blocks when an answer is saved as a card.
 */
export function parseAnswer(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

/** Links an answer may open: web and email only. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return;
  }
}

/** Phrasing as the inline Markdown that note blocks understand (bold,
 * italic); links keep their text, code its characters. */
export function phrasingText(nodes: PhrasingContent[]): string {
  return nodes
    .map((node): string => {
      switch (node.type) {
        case "text":
          return node.value;
        case "inlineCode":
          return node.value;
        case "strong":
          return `**${phrasingText(node.children)}**`;
        case "emphasis":
          return `*${phrasingText(node.children)}*`;
        case "delete":
        case "link":
        case "linkReference":
          return phrasingText(node.children);
        case "break":
          return "\n";
        case "image":
        case "imageReference":
          return node.alt ?? "";
        default:
          return "";
      }
    })
    .join("");
}

/** Text of any node, for headings, cells and plain fallbacks. */
function plain(node: RootContent): string {
  if ("children" in node)
    return node.type === "paragraph" || node.type === "heading" || node.type === "tableCell"
      ? phrasingText(node.children as PhrasingContent[])
      : (node.children as RootContent[]).map(plain).filter(Boolean).join("\n");
  return "value" in node ? String(node.value) : "";
}

const MAX_BLOCKS = 200;

/**
 * An answer as native note blocks: headings, paragraphs, bulleted, numbered
 * and to-do items (nested ones indented with their parent's marker kept in
 * the text), tables, quotes and code as paragraphs. Quizzes become lines.
 */
export function answerBlocks(root: Root): AiContent[] {
  const blocks: AiContent[] = [];
  const push = (block: AiContent) => {
    if (blocks.length < MAX_BLOCKS && (block.text.trim() || block.type === "table"))
      blocks.push(block);
  };
  const list = (node: List, depth: number) => {
    for (const item of node.children as ListItem[]) {
      const [first, ...rest] = item.children;
      const text =
        "  ".repeat(depth) +
        (first?.type === "paragraph" ? phrasingText(first.children) : first ? plain(first) : "");
      push({
        type:
          typeof item.checked === "boolean"
            ? "todo"
            : node.ordered
              ? "numbered"
              : "bulleted",
        text,
      });
      for (const child of rest)
        if (child.type === "list") list(child, depth + 1);
        else push({ type: "paragraph", text: plain(child) });
    }
  };
  const table = (node: Table) => {
    const [head, ...body] = node.children;
    const columns = (head?.children ?? []).slice(0, 8).map((cell) => plain(cell));
    push({
      type: "table",
      text: "",
      columns,
      rows: body
        .slice(0, 40)
        .map((row) =>
          columns.map((_, i) => (row.children[i] ? plain(row.children[i]) : "")),
        ),
    });
  };
  const visit = (node: RootContent) => {
    switch (node.type) {
      case "heading":
        push({
          type: node.depth <= 1 ? "h1" : node.depth === 2 ? "h2" : "h3",
          text: phrasingText(node.children),
        });
        break;
      case "paragraph":
        push({ type: "paragraph", text: phrasingText(node.children) });
        break;
      case "list":
        list(node, 0);
        break;
      case "table":
        table(node);
        break;
      case "blockquote":
        for (const child of node.children)
          push({ type: "paragraph", text: `“${plain(child)}”` });
        break;
      case "code":
        if (node.lang === QUIZ_LANG) {
          for (const line of quizLines(readQuiz(node.value)))
            push({ type: "paragraph", text: line });
          break;
        }
        for (const line of node.value.split("\n"))
          push({ type: "paragraph", text: line });
        break;
      default:
        break;
    }
  };
  root.children.forEach(visit);
  return blocks;
}
