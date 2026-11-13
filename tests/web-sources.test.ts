import { expect, test, vi, beforeEach } from "vitest";
import {
  detectWebUrls,
  normalizeWebUrl,
  webFetchKey,
  webSourceLabel,
  WebSourceCoordinator,
  extractInWorker,
  needsRenderedCapture,
  isHashRoute,
} from "../src/services/web-sources";
import {
  composeAiContext,
  retainedWebAttempts,
} from "../src/services/ai-context-composer";
import { readCitationSources } from "../src/services/ai-citations";
import type { WebAttempt } from "../src/services/web-source-types";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  Channel: class {
    onmessage?: (event: unknown) => void;
  },
}));
beforeEach(() => {
  mock.invoke.mockReset();
});
test("extraction workers terminate at the deadline and on cancellation", async () => {
  const terminate = vi.fn();
  vi.useFakeTimers();
  vi.stubGlobal(
    "Worker",
    class {
      terminate = terminate;
      postMessage() {}
    },
  );
  try {
    const controller = new AbortController();
    const timed = expect(
      extractInWorker("slow", "text/html", controller.signal),
    ).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(3000);
    await timed;
    expect(terminate).toHaveBeenCalledTimes(1);
    const cancelled = expect(
      extractInWorker("slow", "text/html", controller.signal),
    ).rejects.toThrow("stopped");
    controller.abort();
    await cancelled;
    expect(terminate).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
export const source = (id: string, text = `Evidence ${id}`): WebAttempt => ({
  id,
  url: `https://example.com/${id}#part`,
  state: "ready",
  capture: {
    version: 1,
    sourceId: id,
    captureId: `capture-${id}`,
    requestedUrl: `https://example.com/${id}#part`,
    finalUrl: `https://example.com/${id}`,
    title: id,
    author: null,
    published: null,
    fetchedAt: "123",
    contentType: "text/html",
    method: "semantic-main-v1",
    contentHash: id,
    warnings: [],
    sections: [{ id: "section-1", headings: [id], kind: "text", text }],
  },
});
test("URL detection preserves balanced parentheses, queries and fragments, deduplicates Markdown and trims punctuation", () => {
  expect(
    detectWebUrls(
      "Read [A](https://example.com/a_(b)?signature=x%2By#two), and https://example.com/a_(b)?signature=x%2By#two.\nhttps://example.org/guide!",
    ),
  ).toEqual([
    "https://example.com/a_(b)?signature=x%2By#two",
    "https://example.org/guide",
  ]);
  expect(detectWebUrls("example.com/a\nhttps://example.org", true)).toEqual([
    "https://example.com/a",
    "https://example.org/",
  ]);
  expect(normalizeWebUrl("https://user:pass@example.com")).toBeNull();
  expect(normalizeWebUrl("javascript:alert(1)")).toBeNull();
  expect(webFetchKey("https://example.com/a?q=1#one")).toBe(
    "https://example.com/a?q=1",
  );
  expect(webSourceLabel("https://example.com/a?secret=private#one")).toBe(
    "example.com/a",
  );
  expect(detectWebUrls("https://example.com/a?token=end!", true)).toEqual([
    "https://example.com/a?token=end!",
  ]);
  expect(detectWebUrls("[signed](https://example.com/a?token=end!),")).toEqual([
    "https://example.com/a?token=end!",
  ]);
});
test("mixed sources retain note context, stable web identities, failures and frozen selected passages", () => {
  const input = JSON.stringify({
    document: "note",
    structure: [{ id: "block", text: "Note evidence" }],
  });
  const context = composeAiContext(
    input,
    [
      source("a"),
      {
        id: "b",
        url: "https://example.org",
        state: "failed",
        reason: "HTTP 403",
      },
    ],
    "Explain",
  );
  const sources = readCitationSources(context);
  expect(sources).toHaveLength(2);
  expect(sources[1]).toMatchObject({
    kind: "web",
    citation: "[S2]",
    ref: "capture-a/section-1",
    text: "Evidence a",
  });
  expect(JSON.parse(context).webOutcomes[1].state).toBe("failed");
  expect(retainedWebAttempts(context)[0].capture?.sections[0].text).toBe(
    "Evidence a",
  );
  expect(composeAiContext("{}", [source("a")])).toContain("Evidence a");
  expect(() =>
    composeAiContext("{}", [
      { id: "a", url: "https://example.com", state: "failed" },
    ]),
  ).toThrow("None of the websites");
  expect(retainedWebAttempts("legacy invalid")).toEqual([]);
});
test("UTF-8 budget selects across all sources, discloses omissions and never silently drops a source", () => {
  const attempts = [source("a"), source("b")];
  for (const attempt of attempts)
    attempt.capture!.sections = Array.from({ length: 80 }, (_, i) => ({
      id: `section-${i}`,
      text: "世界".repeat(1200),
      kind: "text",
      headings: [`Heading ${i}`],
    }));
  const context = composeAiContext("{}", attempts, "Heading 79");
  expect(new TextEncoder().encode(context).length).toBeLessThan(180000);
  expect(new Set(readCitationSources(context).map((s) => s.document))).toEqual(
    new Set(["a", "b"]),
  );
  expect(
    JSON.parse(context).webEvidence.every(
      (e: { omitted: string[] }) => e.omitted.length > 0,
    ),
  ).toBe(true);
  expect(context).toContain("Selected sections only");
  const continued = composeAiContext("{}", retainedWebAttempts(context));
  expect(JSON.parse(continued).webEvidence[0].omitted.length).toBe(
    JSON.parse(context).webEvidence[0].omitted.length,
  );
  expect(() =>
    composeAiContext(JSON.stringify({ text: "x".repeat(169000) }), attempts),
  ).toThrow("every website");
});
test("identical documents use one evidence table entry", () => {
  const a = source("a"),
    b = source("b");
  b.capture!.contentHash = a.capture!.contentHash;
  expect(JSON.parse(composeAiContext("{}", [a, b])).webEvidence).toHaveLength(
    1,
  );
});
test("cancellation retains completed outcomes and ignores late native callbacks", async () => {
  let deliver: ((event: unknown) => void) | undefined;
  let finish: (() => void) | undefined;
  mock.invoke.mockImplementation(
    (command: string, args: { onEvent: { onmessage: typeof deliver } }) => {
      if (command === "web_sources_cancel") return Promise.resolve();
      deliver = args.onEvent.onmessage;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  );
  const coordinator = new WebSourceCoordinator(),
    updates: WebAttempt[] = [];
  const run = coordinator.capture(
    "workspace/chat",
    [
      { id: "a", url: "https://example.com/a", state: "queued" },
      { id: "b", url: "https://example.com/b", state: "queued" },
    ],
    (a) => updates.push(a),
  );
  deliver!({
    url: "https://example.com/a",
    status: "finished",
    result: { url: "https://example.com/a", code: "http", message: "HTTP 404" },
  });
  coordinator.cancel();
  const count = updates.length;
  deliver!({
    url: "https://example.com/b",
    status: "finished",
    result: { code: "http", message: "late" },
  });
  finish!();
  await expect(run).rejects.toThrow("stopped");
  expect(updates).toHaveLength(count);
  expect(updates.filter((a) => a.id === "a").at(-1)?.state).toBe("failed");
  expect(updates.filter((a) => a.id === "b").at(-1)?.state).toBe("cancelled");
});
test("batch waits for ordered channel delivery after native command completion", async () => {
  let deliver: ((event: unknown) => void) | undefined;
  mock.invoke.mockImplementation(
    (_command: string, args: { onEvent?: { onmessage: typeof deliver } }) => {
      deliver = args.onEvent?.onmessage;
      return Promise.resolve();
    },
  );
  const coordinator = new WebSourceCoordinator(),
    updates: WebAttempt[] = [];
  let settled = false;
  const run = coordinator
    .capture(
      "workspace/chat",
      [{ id: "a", url: "https://example.com/a", state: "queued" }],
      (a) => updates.push(a),
    )
    .then(() => {
      settled = true;
    });
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  deliver!({
    url: "https://example.com/a",
    status: "finished",
    result: { url: "https://example.com/a", code: "http", message: "HTTP 403" },
  });
  deliver!({ url: "", status: "complete" });
  await run;
  expect(updates.at(-1)?.state).toBe("failed");
});

test("only script-built pages go to the rendered fallback", () => {
  const html = "text/html; charset=utf-8";
  const shell = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
  expect(needsRenderedCapture(shell, html, { textLength: 120 })).toBe(true);
  expect(
    needsRenderedCapture("<body><noscript>Enable JavaScript</noscript><script></script>", html, { textLength: 300 }),
  ).toBe(true);
  // A short ordinary page with an analytics script is not rendered again.
  expect(
    needsRenderedCapture("<body><h1>Example</h1><p>Short page.</p><script>track()</script>", html, { textLength: 180 }),
  ).toBe(false);
  expect(needsRenderedCapture("<body><script></script>", html, { textLength: 10 })).toBe(true);
  expect(needsRenderedCapture(shell, html, { textLength: 5000 })).toBe(false);
  expect(needsRenderedCapture("<p>No scripts</p>", html, { textLength: 0 })).toBe(false);
  expect(needsRenderedCapture(shell, "text/plain", { textLength: 0 })).toBe(false);
  expect(
    needsRenderedCapture(shell, html, {
      error: "No readable text was captured. The page may require JavaScript.",
    }),
  ).toBe(true);
  expect(
    needsRenderedCapture(shell, html, {
      error: "This page requires login or a browser challenge.",
    }),
  ).toBe(false);
  expect(isHashRoute("https://example.com/#/guide")).toBe(true);
  expect(isHashRoute("https://example.com/#!/guide")).toBe(true);
  expect(isHashRoute("https://example.com/page#section")).toBe(false);
});

test("hash-route pages are captured through the hidden renderer", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      onmessage?: (event: { data: unknown }) => void;
      terminate() {}
      postMessage({ body }: { body: string }) {
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              result: {
                title: "Guide",
                author: null,
                published: null,
                method: "semantic-main-v1",
                warnings: [],
                sections: [
                  { id: "section-1", kind: "text", headings: [], text: body.replace(/<[^>]+>/g, "") },
                ],
              },
            },
          }),
        );
      }
    },
  );
  mock.invoke.mockImplementation(async (command: string) => {
    if (command === "web_sources_render")
      return {
        finalUrl: "https://example.com/#/guide",
        body: "<main><p>Rendered guide text</p></main>",
        contentType: "text/html",
        fetchedAt: "1",
      };
    throw new Error(`unexpected ${command}`);
  });
  try {
    const updates: WebAttempt[] = [];
    await new WebSourceCoordinator().capture(
      "s",
      [{ id: "a", url: "https://example.com/#/guide", state: "queued" }],
      (a) => updates.push(a),
    );
    expect(mock.invoke).toHaveBeenCalledWith("web_sources_render", {
      id: expect.any(String),
      url: "https://example.com/#/guide",
    });
    const last = updates.at(-1)!;
    expect(last.state).toBe("ready");
    expect(last.capture?.method).toBe("rendered-semantic-main-v1");
    expect(last.capture?.sections[0].text).toBe("Rendered guide text");
  } finally {
    vi.unstubAllGlobals();
  }
});

const pdfMock = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock("../src/services/web-pdf-extraction", () => ({
  extractPdfSource: pdfMock.extract,
}));

test("PDF links are read as text with page-tagged passages", async () => {
  pdfMock.extract.mockResolvedValue({
    title: "Attention Is All You Need",
    author: null,
    published: null,
    method: "pdf-text-v1",
    warnings: ["PDF text only: figures, images and scanned pages were not read."],
    sections: [
      { id: "section-1", kind: "text", headings: ["Page 4"], text: "Scaled dot-product attention.", page: 4 },
    ],
  });
  mock.invoke.mockImplementation(async (command: string, args: { onEvent: { onmessage: (e: unknown) => void } }) => {
    if (command !== "web_sources_fetch") throw new Error(`unexpected ${command}`);
    const url = "https://arxiv.org/pdf/1706.03762";
    args.onEvent.onmessage({ url, status: "fetching" });
    args.onEvent.onmessage({
      url,
      status: "finished",
      result: { url, finalUrl: url, body: "JVBERi0xLjc=", contentType: "application/pdf", fetchedAt: "1" },
    });
    args.onEvent.onmessage({ url: "", status: "complete" });
  });
  const updates: WebAttempt[] = [];
  await new WebSourceCoordinator().capture(
    "s",
    [{ id: "a", url: "https://arxiv.org/pdf/1706.03762", state: "queued" }],
    (a) => updates.push(a),
  );
  expect(pdfMock.extract).toHaveBeenCalledWith("JVBERi0xLjc=", "https://arxiv.org/pdf/1706.03762", expect.anything());
  const last = updates.at(-1)!;
  expect(last.state).toBe("partial");
  expect(last.capture?.contentType).toBe("application/pdf");
  expect(last.capture?.sections[0].page).toBe(4);
});
