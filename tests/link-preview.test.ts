import { beforeEach, expect, test, vi } from "vitest";
import {
  extractLinkPreview,
  queryLinkPreview,
} from "../src/services/link-preview";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
beforeEach(() => {
  mock.invoke.mockReset();
});

test("reads Open Graph metadata and resolves assets after redirects and base tags", () => {
  const preview = extractLinkPreview(
    `
    <html><head><base href="/assets/"><title>Fallback</title>
    <meta property="og:title" content="A &amp; B">
    <meta name="description" content="Fallback description">
    <meta property="og:description" content="  Speak\n confidently. ">
    <meta property="og:image" content="cover.jpg?v=2">
    <link rel="icon" href="//cdn.example.com/icon.png">
    </head></html>`,
    "https://example.com/redirected/page",
  );
  expect(preview).toEqual({
    title: "A & B",
    description: "Speak confidently.",
    image: "https://example.com/assets/cover.jpg?v=2",
    icon: "https://cdn.example.com/icon.png",
  });
});

test("falls back to Twitter metadata and rejects executable or credential-bearing assets", () => {
  expect(
    extractLinkPreview(
      `<title>Plain title</title>
    <meta property="og:image" content="javascript:alert(1)">
    <meta name="twitter:image" content="/cover.png">
    <meta name="twitter:description" content="Description">
    <link rel="icon" href="https://user:pass@example.com/icon">`,
      "https://example.com/page",
    ),
  ).toEqual({
    title: "Plain title",
    description: "Description",
    image: "https://example.com/cover.png",
    icon: "https://example.com/favicon.ico",
  });
  expect(
    extractLinkPreview("<html></html>", "https://example.com/page").image,
  ).toBeNull();
});

test("shares in-flight requests; an aborted card does not cancel another card", async () => {
  let finish!: (value: unknown) => void;
  mock.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const first = queryLinkPreview("example.com", controller.signal);
  const second = queryLinkPreview("https://example.com/");
  controller.abort();
  finish({
    body: "<title>Example</title>",
    finalUrl: "https://example.com/",
    contentType: "text/html",
  });
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  await expect(second).resolves.toMatchObject({ title: "Example" });
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  expect(mock.invoke).toHaveBeenCalledWith("link_preview_fetch", {
    url: "https://example.com/",
  });
});

test("failed previews can retry and invalid URL schemes never reach the fetcher", async () => {
  mock.invoke
    .mockResolvedValueOnce({ message: "Offline" })
    .mockResolvedValueOnce({
      body: "<title>Recovered</title>",
      finalUrl: "https://example.com/",
      contentType: "text/html",
    });
  await expect(queryLinkPreview("https://example.com")).rejects.toThrow(
    "Offline",
  );
  await expect(queryLinkPreview("https://example.com")).resolves.toMatchObject({
    title: "Recovered",
  });
  await expect(queryLinkPreview("file:///C:/secret")).rejects.toThrow("HTTP");
  expect(mock.invoke).toHaveBeenCalledTimes(2);
});
