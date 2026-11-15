import { invoke } from "@tauri-apps/api/core";
import { DOMParser } from "linkedom/worker";

export type LinkPreview = {
  title: string | null;
  description: string | null;
  image: string | null;
  icon: string | null;
};

function webUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Inert parsing: no scripts or subresources from the fetched page are loaded. */
export function extractLinkPreview(
  html: string,
  finalUrl: string,
): LinkPreview {
  const doc = new DOMParser().parseFromString(
    html,
    "text/html",
  ) as unknown as Document;
  const clean = (value: string | null | undefined, limit: number) =>
    value?.replace(/\s+/g, " ").trim().slice(0, limit) || null;
  const meta = (...names: string[]) => {
    for (const name of names) {
      for (const element of doc.querySelectorAll("meta")) {
        if (
          (
            element.getAttribute("property") ?? element.getAttribute("name")
          )?.toLowerCase() === name
        ) {
          const value = element.getAttribute("content")?.trim();
          if (value) return value;
        }
      }
    }
    return null;
  };
  const base =
    webUrl(
      doc.querySelector("base[href]")?.getAttribute("href") ?? "",
      finalUrl,
    ) ?? finalUrl;
  const image =
    [
      "og:image:secure_url",
      "og:image",
      "og:image:url",
      "twitter:image",
      "twitter:image:src",
    ]
      .map((name) => meta(name))
      .filter((value): value is string => !!value)
      .map((value) => webUrl(value, base))
      .find(Boolean) ?? null;
  const icon =
    Array.from(doc.querySelectorAll("link[href]"))
      .filter((el) =>
        /^(?:shortcut\s+)?icon$|^apple-touch-icon$/i.test(
          el.getAttribute("rel") ?? "",
        ),
      )
      .map((el) => webUrl(el.getAttribute("href")!, base))
      .find(Boolean) ?? new URL("/favicon.ico", finalUrl).href;
  return {
    title:
      clean(
        meta("og:title", "twitter:title") ??
          doc.querySelector("title")?.textContent,
        500,
      ) ?? new URL(finalUrl).hostname,
    description: clean(
      meta("og:description", "twitter:description", "description"),
      2000,
    ),
    image,
    icon,
  };
}

type Page = {
  body?: string;
  finalUrl?: string;
  contentType?: string;
  message?: string;
};
const pending = new Map<string, Promise<LinkPreview>>();

/** Share concurrent card requests, but never retain a failed fetch across retries. */
export async function queryLinkPreview(
  value: string,
  signal?: AbortSignal,
): Promise<LinkPreview> {
  signal?.throwIfAborted();
  const url = webUrl(
    /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`,
  );
  if (!url) throw new Error("Use an HTTP or HTTPS link.");
  let job = pending.get(url);
  if (!job) {
    job = invoke<Page>("link_preview_fetch", { url })
      .then((page) => {
        if (!page.body || !page.finalUrl || !page.contentType?.includes("html"))
          throw new Error(page.message ?? "This link has no page preview.");
        return extractLinkPreview(page.body, page.finalUrl);
      })
      .finally(() => pending.delete(url));
    pending.set(url, job);
  }
  const result = await job;
  signal?.throwIfAborted();
  return result;
}
