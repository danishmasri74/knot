import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  lastPage,
  lastVideo,
  rememberPage,
  rememberVideo,
  rememberVideoPosition,
} from "../src/services/resume";

const source = {
  videoId: "dQw4w9WgXcQ",
  title: "A talk",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  documentId: "doc",
  blockId: "block",
};
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("remembers the last video and its position per workspace", () => {
  expect(lastVideo("work")).toBeNull();
  rememberVideo("work", source);
  rememberVideoPosition("work", source.videoId, 90_000);
  expect(lastVideo("work")).toEqual({ source, position: 90_000 });
  expect(lastVideo("home")).toBeNull();
  expect(lastVideo(null)).toBeNull();
  // Reopening the same video keeps the moment; another video starts over.
  rememberVideo("work", source);
  expect(lastVideo("work")?.position).toBe(90_000);
  rememberVideoPosition("work", "otherVideo1", 5_000);
  expect(lastVideo("work")?.position).toBe(90_000);
  rememberVideo("work", { ...source, videoId: "otherVideo1" });
  expect(lastVideo("work")?.position).toBe(0);
});

it("remembers only web pages and ignores damaged entries", () => {
  rememberPage("work", { url: "about:blank", title: "" });
  expect(lastPage("work")).toBeNull();
  rememberPage("work", { url: "https://example.com/a", title: "Example" });
  expect(lastPage("work")).toEqual({
    url: "https://example.com/a",
    title: "Example",
  });
  storage.set("knot.resume.web.home", "{not json");
  storage.set(
    "knot.resume.video.home",
    JSON.stringify({ source: { videoId: 1 } }),
  );
  expect(lastPage("home")).toBeNull();
  expect(lastVideo("home")).toBeNull();
});
