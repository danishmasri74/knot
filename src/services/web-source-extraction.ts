import { Readability } from "@mozilla/readability";
// The worker entry has no Node imports, browser rendering, scripts or resource loader.
import { DOMParser } from "linkedom/worker";
import { WEB_LIMITS, type WebSection } from "./web-source-types";

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
    if (
      doc.querySelector('input[type="password"]') ||
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
      "script,style,noscript,form,nav,header,footer,aside,[hidden],[aria-hidden=true]",
    ))
      node.remove();
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
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag[1]);
        headings.length = level - 1;
        headings[level - 1] = node.textContent?.trim() ?? "";
        add(node.textContent ?? "", "text", headings.filter(Boolean));
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
      } else if (
        ["p", "li", "blockquote"].includes(tag) &&
        !node.querySelector("p,pre,table")
      ) {
        add(
          node.textContent ?? "",
          tag === "li" ? "list" : "text",
          headings.filter(Boolean),
        );
      } else {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 1) walk(child as Element);
          else if (child.nodeType === 3)
            add(child.textContent ?? "", "text", headings.filter(Boolean));
        }
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
