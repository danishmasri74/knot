/**
 * Passages for web-search citations. OpenAI's search cites links only; after
 * the answer, Knot captures the cited pages with its own fetcher (on this
 * device, no model call) and finds the passage on each page that matches the
 * answer sentence carrying the link's marker. A match shows where the page
 * supports the claim; it is not proof of what the search read.
 */
import { claimsFor, matchPassage } from "./cited-sentence";
import { normalizeWebUrl } from "./web-sources";
import type { LinkCitation, WebAttempt } from "./web-source-types";

const EXCERPT_CHARS = 1200;
const PASSAGE_CHARS = 6000;

/** Links that still need a passage, in the order the answer cites them. */
export function linksNeedingExcerpts(links: LinkCitation[]): string[] {
  return [...new Set(links.filter((l) => !l.excerptState).map((l) => l.url))];
}

export function withExcerpts(
  answer: string,
  links: LinkCitation[],
  attempts: WebAttempt[],
): LinkCitation[] {
  return links.map((link) => {
    if (link.excerptState) return link;
    const capture = attempts.find((a) => a.url === link.url)?.capture;
    if (!capture) return { ...link, excerptState: "unavailable" };
    const claim = link.citation ? claimsFor(answer, link.citation) : "";
    const match = claim ? matchPassage(claim, capture.sections) : null;
    if (!match) return { ...link, excerptState: "none" };
    const { section, sentence } = match;
    return {
      ...link,
      excerptState: "found",
      excerpt: (sentence?.text ?? section.text).slice(0, EXCERPT_CHARS),
      passage: section.text.slice(0, PASSAGE_CHARS),
      ...(section.page && { excerptPage: section.page }),
      excerptUrl:
        (section.url && normalizeWebUrl(section.url)) || capture.finalUrl,
    };
  });
}

/** A stored excerpt, checked before it is shown or linked. */
export function readExcerpt(link: LinkCitation) {
  if (
    link.excerptState !== "found" ||
    typeof link.excerpt !== "string" ||
    typeof link.passage !== "string"
  )
    return null;
  return {
    excerpt: link.excerpt,
    passage: link.passage,
    page:
      Number.isInteger(link.excerptPage) && link.excerptPage! > 0
        ? link.excerptPage
        : undefined,
    url:
      (typeof link.excerptUrl === "string" &&
        normalizeWebUrl(link.excerptUrl)) ||
      link.url,
  };
}
