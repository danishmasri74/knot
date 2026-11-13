import { Channel, invoke } from "@tauri-apps/api/core";
import {
  WEB_LIMITS,
  type NativeWebResult,
  type WebAttempt,
  type WebCapture,
} from "./web-source-types";
import type { extractWebSource } from "./web-source-extraction";

export function normalizeWebUrl(
  candidate: string,
  bare = false,
): string | null {
  try {
    const url = new URL(
      bare && !/^https?:\/\//i.test(candidate)
        ? `https://${candidate}`
        : candidate,
    );
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      (bare && !url.hostname.includes(".") && !url.hostname.includes(":")) ||
      url.href.length > 8192
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function detectWebUrls(text: string, bare = false): string[] {
  const candidates = bare
    ? text.split(/[\s<>]+/)
    : (text.match(/https?:\/\/[^\s<>"`]+/gi) ?? []);
  return [
    ...new Set(
      candidates.flatMap((candidate) => {
        // Remove Markdown/prose wrappers, but do not rewrite a signed query value.
        const wrapper = candidate.match(/([)\]])[.,;:!?]*$/);
        if (wrapper) {
          const close = wrapper[1],
            open = close === ")" ? "(" : "[";
          if (candidate.split(close).length > candidate.split(open).length)
            candidate = candidate.slice(0, candidate.lastIndexOf(close));
        }
        if (!candidate.includes("?") || candidate.includes("#"))
          candidate = candidate.replace(/[.,;:!?]+$/, "");
        while (
          candidate.endsWith(")") &&
          (candidate.match(/\)/g)?.length ?? 0) >
            (candidate.match(/\(/g)?.length ?? 0)
        )
          candidate = candidate.slice(0, -1);
        while (
          candidate.endsWith("]") &&
          (candidate.match(/\]/g)?.length ?? 0) >
            (candidate.match(/\[/g)?.length ?? 0)
        )
          candidate = candidate.slice(0, -1);
        const url = normalizeWebUrl(candidate, bare);
        return url ? [url] : [];
      }),
    ),
  ];
}
export function webFetchKey(url: string) {
  const value = new URL(url);
  value.hash = "";
  return value.href;
}
export function webSourceLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch {
    return "Website";
  }
}

/** Pages with scripts and less text than this are rendered if they also look
 * like an app shell; below EMPTY_TEXT they are rendered regardless. */
const SCRIPT_PAGE_TEXT = 400;
const EMPTY_TEXT = 50;
/** Markers of a page that fills itself in with JavaScript. */
const APP_SHELL =
  /<noscript[\s>]|<script[^>]*\btype=["']?module|<app-root[\s>]|<[a-z]+[^>]*\bid=["']?(?:root|app|__next|__nuxt|___gatsby|svelte)["']?[^>]*>\s*<\//i;
/**
 * Whether a fetched page should be loaded in the hidden renderer: it ships
 * scripts and its text is missing, or small with app-shell markers. A short
 * ordinary page (like example.com) is not rendered again. Login, challenge,
 * paywall and error pages are not retried; rendering doesn't fix those.
 */
export function needsRenderedCapture(
  body: string,
  contentType: string,
  outcome: { textLength: number } | { error: string },
): boolean {
  if (!/html/i.test(contentType)) return false;
  if ("error" in outcome) return /require JavaScript/i.test(outcome.error);
  if (!/<script[\s>]/i.test(body)) return false;
  return (
    outcome.textLength < EMPTY_TEXT ||
    (outcome.textLength < SCRIPT_PAGE_TEXT && APP_SHELL.test(body))
  );
}
export function isHashRoute(url: string) {
  return /^#(?:!|\/)/.test(new URL(url).hash);
}
type Page = { finalUrl: string; contentType: string; fetchedAt: string };
type Extracted = Omit<
  ReturnType<typeof extractWebSource>,
  "fullText" | "docTitle"
> & { fullText?: string | null; docTitle?: string | null };

/** The declared full-text address, resolved against the page; same-site
 * http links are upgraded when the page itself was served over https. */
export function fullTextUrl(
  href: string | null | undefined,
  base: string,
): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    const page = new URL(base);
    if (
      url.protocol === "http:" &&
      page.protocol === "https:" &&
      url.hostname === page.hostname
    )
      url.protocol = "https:";
    return normalizeWebUrl(url.href);
  } catch {
    return null;
  }
}
function withWarning(extracted: Extracted, warning: string): Extracted {
  return { ...extracted, warnings: [...extracted.warnings, warning] };
}
/**
 * A landing page plus the full-text PDF it declares, as one source: the
 * page's passages first (citation, abstract, metadata), then the PDF's,
 * which keep their page numbers and link to the PDF.
 */
export function mergeFullText(
  landing: Extracted,
  pdf: Extracted,
  pdfUrl: string,
): Extracted {
  let chars = landing.sections.reduce((n, s) => n + s.text.length, 0);
  const sections = [...landing.sections];
  let truncated = false;
  for (const section of pdf.sections) {
    if (
      sections.length >= WEB_LIMITS.sections ||
      chars + section.text.length > WEB_LIMITS.extractedChars
    ) {
      truncated = true;
      break;
    }
    sections.push({ ...section, id: `pdf-${section.id}`, url: pdfUrl });
    chars += section.text.length;
  }
  return {
    title: landing.docTitle ?? pdf.title ?? landing.title,
    author: landing.author ?? pdf.author,
    published: landing.published,
    method: `${landing.method}+${pdf.method}`,
    sections,
    warnings: [
      ...new Set([
        ...landing.warnings,
        ...pdf.warnings,
        `Includes the full-text PDF this page links to (${pdfUrl}).`,
        ...(truncated ? ["Extraction truncated at the content limit."] : []),
      ]),
    ],
  };
}
type RenderedPage = {
  finalUrl: string;
  body: string;
  contentType: string;
  fetchedAt: string;
};

export function extractInWorker(
  body: string,
  contentType: string,
  signal: AbortSignal,
): Promise<ReturnType<typeof extractWebSource>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./web-source-extract.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new Error("Capture stopped"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("Extraction timed out. Try a smaller page."));
    }, WEB_LIMITS.extractionMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("The extraction worker failed."));
    };
    worker.postMessage({ body, contentType });
  });
}

/** One generation owns all callbacks; cancelled/late results cannot escape it. */
export class WebSourceCoordinator {
  private active?: {
    id: string;
    controller: AbortController;
    stopped: () => void;
  };
  cancel() {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    active.stopped();
    void invoke("web_sources_cancel", { id: active.id }).catch(() => {});
    this.active = undefined;
  }
  async capture(
    session: string,
    attempts: WebAttempt[],
    update: (attempt: WebAttempt) => void,
  ) {
    this.cancel();
    if (attempts.length > WEB_LIMITS.urls)
      throw new Error(`Use at most ${WEB_LIMITS.urls} website URLs.`);
    const id = crypto.randomUUID(),
      controller = new AbortController();
    const finished = new Set<string>();
    const report = (attempt: WebAttempt) => {
      if (["ready", "partial", "failed", "cancelled"].includes(attempt.state))
        finished.add(attempt.id);
      update(attempt);
    };
    this.active = {
      id,
      controller,
      stopped: () =>
        attempts
          .filter((a) => !finished.has(a.id))
          .forEach((a) =>
            report({ ...a, state: "cancelled", reason: "Capture stopped" }),
          ),
    };
    const pending: Promise<void>[] = [];
    const groups = new Map<string, WebAttempt[]>();
    const hashRoutes: WebAttempt[] = [];
    for (const attempt of attempts) {
      if (isHashRoute(attempt.url)) {
        // The route lives after "#", so only a rendered page has its content.
        hashRoutes.push(attempt);
        update({ ...attempt, state: "queued" });
        continue;
      }
      const key = webFetchKey(attempt.url);
      groups.set(key, [...(groups.get(key) ?? []), attempt]);
      update({ ...attempt, state: "queued" });
    }
    const valid = () => this.active?.id === id && !controller.signal.aborted;
    const finish = async (
      group: WebAttempt[],
      page: Page,
      { fullText: _fullText, docTitle, ...extracted }: Extracted,
      rendered: boolean,
    ) => {
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
              extracted.sections.map((s) => s.text).join("\n"),
            ),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (!valid()) return;
      const captureId = crypto.randomUUID();
      for (const attempt of group) {
        const capture: WebCapture = {
          version: 1,
          sourceId: attempt.id,
          captureId,
          requestedUrl: attempt.url,
          finalUrl: page.finalUrl,
          fetchedAt: page.fetchedAt,
          contentType: page.contentType,
          contentHash: hash,
          ...extracted,
          method: rendered ? `rendered-${extracted.method}` : extracted.method,
          // A scholarly page's own title beats the site name in <title>.
          title: docTitle || extracted.title || webSourceLabel(page.finalUrl),
        };
        report({
          ...attempt,
          capture,
          state: capture.warnings.length ? "partial" : "ready",
          reason: undefined,
        });
      }
    };
    // Landing pages that declare a full-text PDF finish after the main batch,
    // which reads those PDFs in a second fetch (one native batch at a time).
    const followUps: {
      group: WebAttempt[];
      page: Page;
      extracted: Extracted;
      rendered: boolean;
      pdf: string;
    }[] = [];
    const complete = async (
      group: WebAttempt[],
      page: Page,
      extracted: Extracted,
      rendered: boolean,
    ) => {
      const pdf = fullTextUrl(extracted.fullText, page.finalUrl);
      if (
        pdf &&
        webFetchKey(pdf) !== webFetchKey(page.finalUrl) &&
        !groups.has(webFetchKey(pdf))
      ) {
        followUps.push({ group, page, extracted, rendered, pdf });
        group.forEach((a) => update({ ...a, state: "fetching" }));
        return;
      }
      await finish(group, page, extracted, rendered);
    };
    const readFullTexts = async () => {
      const handled = new Set<(typeof followUps)[number]>();
      const work: Promise<void>[] = [];
      try {
        let done: () => void = () => {};
        const finished = new Promise<void>((resolve) => (done = resolve));
        const followChannel = new Channel<{
          url: string;
          status: string;
          result?: NativeWebResult;
        }>();
        // Each PDF is read as soon as it arrives.
        followChannel.onmessage = (event) => {
          if (event.status === "complete") done();
          else if (event.result)
            for (const follow of followUps.filter((f) => f.pdf === event.url)) {
              handled.add(follow);
              work.push(readFullText(follow, event.result));
            }
        };
        await Promise.all([
          invoke("web_sources_fetch", {
            id,
            session,
            urls: [...new Set(followUps.map((f) => f.pdf))],
            onEvent: followChannel,
          }),
          finished,
        ]);
      } catch {
        // Landing pages still finish below, with a warning.
      }
      for (const follow of followUps)
        if (!handled.has(follow)) work.push(readFullText(follow, undefined));
      await Promise.all(work);
    };
    const readFullText = async (
      follow: (typeof followUps)[number],
      result: NativeWebResult | undefined,
    ) => {
      if (!valid()) return;
      let merged = withWarning(
        follow.extracted,
        `The full-text PDF this page links to could not be read (${follow.pdf}).`,
      );
      if (result?.body && result.contentType === "application/pdf") {
        follow.group.forEach((a) => update({ ...a, state: "extracting" }));
        try {
          const { extractPdfSource } = await import("./web-pdf-extraction");
          const pdf = await extractPdfSource(
            result.body,
            result.finalUrl!,
            controller.signal,
          );
          merged = mergeFullText(follow.extracted, pdf, result.finalUrl!);
        } catch (error) {
          merged = withWarning(
            follow.extracted,
            `The full-text PDF this page links to could not be read: ${String(error).replace(/^(?:Error: )+/, "")}`,
          );
        }
      } else if (result?.message)
        merged = withWarning(
          follow.extracted,
          `The full-text PDF this page links to could not be read: ${result.message}`,
        );
      await finish(follow.group, follow.page, merged, follow.rendered);
    };
    // Rendering runs one page at a time, after the plain fetch showed the page
    // needs its scripts (or for hash routes, straight away).
    let renderTurn = Promise.resolve();
    const render = (
      url: string,
      group: WebAttempt[],
      failed: (error: unknown) => Promise<void> | void,
    ) => {
      const run = renderTurn.then(async () => {
        if (!valid()) return;
        group.forEach((a) => update({ ...a, state: "fetching" }));
        try {
          const page = await invoke<RenderedPage>("web_sources_render", {
            id,
            url,
          });
          if (!valid()) return;
          group.forEach((a) => update({ ...a, state: "extracting" }));
          const extracted = await extractInWorker(
            page.body,
            page.contentType,
            controller.signal,
          );
          if (!valid()) return;
          await complete(group, page, extracted, true);
        } catch (error) {
          if (valid()) await failed(error);
        }
      });
      renderTurn = run.catch(() => {});
      return run;
    };
    for (const attempt of hashRoutes)
      pending.push(
        render(attempt.url, [attempt], (error) =>
          report({
            ...attempt,
            state: "failed",
            reason: `This page builds its content with JavaScript and could not be rendered: ${String(error).replace(/^(?:Error: )+/, "")} Open it externally or attach a saved document.`,
          }),
        ),
      );
    let resolveDelivered: () => void = () => {};
    const delivered = new Promise<void>((resolve, reject) => {
      resolveDelivered = resolve;
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error("Capture stopped")),
        { once: true },
      );
    });
    void delivered.catch(() => {});
    const channel = new Channel<{
      url: string;
      status: string;
      result?: NativeWebResult;
    }>();
    channel.onmessage = (event) => {
      if (!valid()) return;
      if (event.status === "complete") {
        resolveDelivered();
        return;
      }
      const group = groups.get(event.url) ?? [];
      if (!event.result) {
        group.forEach((a) => update({ ...a, state: "fetching" }));
        return;
      }
      const result = event.result;
      pending.push(
        (async () => {
          if (result.code || result.body === undefined) {
            group.forEach((a) =>
              report({
                ...a,
                state: "failed",
                reason: result.message ?? "Capture failed",
              }),
            );
            return;
          }
          group.forEach((a) => update({ ...a, state: "extracting" }));
          const body = result.body;
          const contentType = result.contentType!;
          if (contentType === "application/pdf") {
            // PDF links: the body is the file as base64; read its text here.
            try {
              const { extractPdfSource } = await import("./web-pdf-extraction");
              const extracted = await extractPdfSource(
                body,
                result.finalUrl!,
                controller.signal,
              );
              if (!valid()) return;
              await finish(
                group,
                {
                  finalUrl: result.finalUrl!,
                  contentType,
                  fetchedAt: result.fetchedAt!,
                },
                extracted,
                false,
              );
            } catch (error) {
              if (valid())
                group.forEach((a) =>
                  report({
                    ...a,
                    state: "failed",
                    reason: String(error).replace(/^(?:Error: )+/, ""),
                  }),
                );
            }
            return;
          }
          let extracted: Awaited<ReturnType<typeof extractInWorker>>;
          try {
            extracted = await extractInWorker(
              body,
              contentType,
              controller.signal,
            );
          } catch (error) {
            if (!valid()) return;
            const reason = String(error).replace(/^(?:Error: )+/, "");
            const fail = (extra = "") =>
              group.forEach((a) =>
                report({ ...a, state: "failed", reason: reason + extra }),
              );
            if (needsRenderedCapture(body, contentType, { error: reason }))
              await render(event.url, group, () =>
                fail(" Rendering the page with its scripts did not help."),
              );
            else fail();
            return;
          }
          if (!valid()) return;
          const textLength = extracted.sections.reduce(
            (n, s) => n + s.text.length,
            0,
          );
          const page = {
            finalUrl: result.finalUrl!,
            contentType,
            fetchedAt: result.fetchedAt!,
          };
          if (needsRenderedCapture(body, contentType, { textLength }))
            // Keep the plain capture when rendering fails.
            await render(event.url, group, () =>
              complete(group, page, extracted, false),
            );
          else await complete(group, page, extracted, false);
        })(),
      );
    };
    const deadline = setTimeout(() => {
      if (this.active?.id === id) this.cancel();
    }, WEB_LIMITS.batchMs);
    try {
      if (groups.size)
        await Promise.all([
          invoke("web_sources_fetch", {
            id,
            session,
            urls: [...groups.keys()],
            onEvent: channel,
          }),
          delivered,
        ]);
      await Promise.all(pending);
      if (!valid()) throw new Error("Capture stopped");
      if (followUps.length) await readFullTexts();
      if (!valid()) throw new Error("Capture stopped");
    } catch (error) {
      if (valid())
        attempts
          .filter((a) => !finished.has(a.id))
          .forEach((a) =>
            report({
              ...a,
              state: "failed",
              reason: "The source batch could not finish. Retry this source.",
            }),
          );
      throw error;
    } finally {
      clearTimeout(deadline);
      controller.abort();
      if (this.active?.id === id) this.active = undefined;
    }
  }
}
