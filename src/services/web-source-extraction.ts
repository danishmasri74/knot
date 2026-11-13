import { Readability } from "@mozilla/readability";
// The worker entry has no Node imports, browser rendering, scripts or resource loader.
import { DOMParser } from "linkedom/worker";
import { WEB_LIMITS, type WebSection } from "./web-source-types";

const BLOCK = new Set(
  "address article aside blockquote center dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main menu nav ol p pre section summary table tbody td tfoot th thead tr ul".split(
    " ",
  ),
);
const BLOCK_SELECTOR = [...BLOCK].join(",");

const isBlock = (n: Node) =>
  n.nodeType === 1 && BLOCK.has((n as Element).tagName.toLowerCase());
const hasBlock = (n: Element) => !!n.querySelector(BLOCK_SELECTOR);
/**
 * Rendered text: source line breaks and indentation collapse to spaces and
 * only <br> breaks a line. Code keeps its non-breaking-space indentation.
 */
function flow(nodes: Node[], code = false): string {
  const raw = (n: Node): string =>
    n.nodeType === 3
      ? (n.textContent ?? "").replace(code ? /[ \t\r\n\f]+/g : /\s+/g, " ")
      : n.nodeType === 1 && (n as Element).tagName.toLowerCase() === "br"
        ? "\n"
        : Array.from(n.childNodes).map(raw).join("");
  const lines = nodes.map(raw).join("").split("\n");
  return (
    code
      ? lines.map((line) => line.replace(/\u00a0/g, " ").trimEnd())
      : lines.map((line) => line.replace(/ +/g, " ").trim())
  )
    .join("\n")
    .replace(/\n{2,}/g, code ? "\n\n" : "\n")
    .replace(/^\n+|\n+$/g, "");
}
/** Code laid out with <br> inside a <div> (no <pre>), as on w3schools. */
const CODE_DIV = /\b(?:w3-code|code|highlight|syntax)\b/i;

export function extractWebSource(body: string, contentType: string) {
  const warnings: string[] = [];
  let title = "",
    author: string | null = null,
    published: string | null = null;
  let method = "plain-text-v1";
  const sections: WebSection[] = [];
  let chars = 0;
  const add = (text: string, kind: WebSection["kind"], headings: string[]) => {
    text = text.trim();
    if (!text) return;
    if (
      sections.length >= WEB_LIMITS.sections ||
      chars >= WEB_LIMITS.extractedChars
    ) {
      if (!warnings.includes("Extraction truncated at the content limit."))
        warnings.push("Extraction truncated at the content limit.");
      return;
    }
    // Split long passages, keeping all boundaries explicit and bounded.
    for (let offset = 0; offset < text.length;) {
      if (
        sections.length >= WEB_LIMITS.sections ||
        chars >= WEB_LIMITS.extractedChars
      ) {
        if (!warnings.includes("Extraction truncated at the content limit."))
          warnings.push("Extraction truncated at the content limit.");
        break;
      }
      let end = Math.min(
        text.length,
        offset +
          Math.min(WEB_LIMITS.passageChars, WEB_LIMITS.extractedChars - chars),
      );
      if (end < text.length) {
        const boundary = Math.max(
          text.lastIndexOf("\n", end - 1),
          text.lastIndexOf(". ", end - 1),
        );
        if (boundary > offset + WEB_LIMITS.passageChars / 2) end = boundary + 1;
        if (
          /[\uD800-\uDBFF]/.test(text[end - 1]) &&
          /[\uDC00-\uDFFF]/.test(text[end])
        )
          end--;
      }
      if (end <= offset) {
        warnings.push("Extraction truncated at the content limit.");
        break;
      }
      const part = text.slice(offset, end);
      offset = end;
      sections.push({
        id: `section-${sections.length + 1}`,
        kind,
        headings: [...headings],
        text: part,
      });
      chars += part.length;
    }
  };
  if (contentType === "text/plain") {
    for (const part of body.split(/\n\s*\n/)) add(part, "text", []);
  } else {
    const doc = new DOMParser().parseFromString(body, "text/html");
    if (doc.querySelectorAll("*").length > WEB_LIMITS.nodes)
      throw new Error(
        "This page exceeds the safe DOM limit. Try a smaller page.",
      );
    title = doc.querySelector("title")?.textContent?.trim() ?? "";
    const visible = (doc.body?.textContent ?? "").slice(0, 20_000);
    // A password field marks a sign-in page only when the page has little
    // else to read; tutorials about forms include demo password inputs.
    const pageText =
      (doc.body?.textContent ?? "").length -
      Array.from(doc.querySelectorAll("script,style")).reduce<number>(
        (n, e) => n + ((e as Element).textContent?.length ?? 0),
        0,
      );
    if (
      (doc.querySelector('input[type="password"]') && pageText < 3000) ||
      /^(just a moment|access denied|verify (you are|that you)|attention required|sign in|log in|login|404\b|403\b|page not found|not found|server error)/i.test(
        title,
      ) ||
      /checking your browser|enable javascript and cookies to continue|verify you are human/i.test(
        visible,
      )
    )
      throw new Error(
        "This page requires login or a browser challenge. Open it externally; browser capture is not available yet.",
      );
    if (
      /subscribe to (read|continue)|this (article|content) is (for|only available to) subscribers/i.test(
        visible,
      )
    )
      warnings.push("Possible paywall: only the captured text is available.");
    if (doc.querySelector("iframe,canvas,video,svg,img"))
      warnings.push("Images, embedded and visual content were not captured.");
    for (const node of doc.querySelectorAll(
      // Page furniture: navigation, dialogs, buttons, and wiki edit links,
      // navigation boxes and category footers.
      "script,style,noscript,form,nav,header,footer,aside,[hidden],[aria-hidden=true],button,dialog,[role=dialog],[aria-modal=true],[role=navigation],.mw-editsection,.navbox,.navbar,.catlinks,.printfooter,.mw-jump-link",
    ))
      node.remove();
    // Readability would turn their <br> lines into paragraphs.
    for (const div of Array.from(doc.querySelectorAll("div")) as Element[])
      if (CODE_DIV.test(div.getAttribute("class") ?? "") && !hasBlock(div)) {
        const pre = (doc as unknown as Document).createElement("pre");
        pre.textContent = flow([div], true);
        div.replaceWith(pre);
      }
    let root = doc.querySelector("main,article,[role=main]");
    // Readability supplies article metadata; docs retain native heading/code/table structure.
    const article = new Readability(
      doc.cloneNode(true) as unknown as Document,
      { charThreshold: 0, maxElemsToParse: WEB_LIMITS.nodes },
    ).parse();
    author = article?.byline ?? null;
    published = article?.publishedTime ?? null;
    if (!title) title = article?.title ?? "";
    if (root) method = "semantic-main-v1";
    else if (article?.content) {
      root = new DOMParser().parseFromString(
        `<html><body>${article.content}</body></html>`,
        "text/html",
      ).body;
      method = "readability-v1";
    } else {
      // Small valid text pages are useful; empty script shells are not.
      root = doc.body;
      method = "bounded-text-v1";
      warnings.push(
        "No article region found; completeness could not be determined.",
      );
    }
    const headings: string[] = [];
    const walk = (node: Element) => {
      const tag = node.tagName.toLowerCase();
      const kind = tag === "li" ? "list" : "text";
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag[1]);
        const text = flow([node]);
        headings.length = level - 1;
        headings[level - 1] = text;
        add(text, "text", headings.filter(Boolean));
      } else if (tag === "pre")
        add(node.textContent ?? "", "code", headings.filter(Boolean));
      else if (tag === "table") {
        // Cells render as one line of flowing text, like the browser shows them.
        const rows = Array.from(node.querySelectorAll("tr")).map((row) =>
          Array.from(row.querySelectorAll("th,td")).map((cell) =>
            (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
          ),
        );
        // A table with at most one filled cell per row is layout, such as a
        // note banner beside an icon cell: keep its text, not "| text".
        if (rows.every((cells) => cells.filter(Boolean).length <= 1))
          add(
            rows.flatMap((cells) => cells.filter(Boolean)).join("\n"),
            "text",
            headings.filter(Boolean),
          );
        else
          add(
            rows.map((cells) => cells.join(" | ")).join("\n"),
            "table",
            headings.filter(Boolean),
          );
      } else if (!hasBlock(node)) {
        // Paragraphs, list items, captions and other inline-only content
        // read as one passage, links included.
        add(flow([node]), kind, headings.filter(Boolean));
      } else {
        // Mixed content: each run of inline text between blocks is one
        // passage, so "see [link]." is not split at the link.
        let run: Node[] = [];
        const flush = () => {
          if (run.length) add(flow(run), kind, headings.filter(Boolean));
          run = [];
        };
        for (const child of Array.from(node.childNodes)) {
          if (isBlock(child)) {
            flush();
            walk(child as Element);
          } else if (child.nodeType === 1 && hasBlock(child as Element)) {
            // An inline wrapper (such as a link) around blocks.
            flush();
            walk(child as Element);
          } else if (child.nodeType === 1 || child.nodeType === 3) run.push(child);
        }
        flush();
      }
    };
    if (root) walk(root as unknown as Element);
  }
  if (!sections.length)
    throw new Error(
      "No readable text was captured. The page may require JavaScript. Open it externally or attach a saved document.",
    );
  return {
    title: title.slice(0, 300),
    author,
    published,
    method,
    sections,
    warnings,
  };
}
