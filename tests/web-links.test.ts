import { describe, expect, it } from "vitest";
import {
  classifyWebLink,
  normalizeWebAddress,
} from "../src/services/web-links";

describe("mini browser URL boundary", () => {
  it("normalizes hostnames without turning phrases into searches", () => {
    expect(normalizeWebAddress(" example.com/read?q=1#part ")).toBe(
      "https://example.com/read?q=1#part",
    );
    expect(normalizeWebAddress("http://127.0.0.1:9444/fixture")).toBe(
      "http://127.0.0.1:9444/fixture",
    );
    for (const value of [
      "",
      "find this article",
      "example",
      "https://",
      "https://user:secret@example.com",
    ])
      expect(() => normalizeWebAddress(value)).toThrow();
  });
  it("reserves the complete internal namespace even for malformed PDF links", () => {
    for (const value of [
      "https://knot.invalid/pdf#bad-json",
      "https://knot.invalid/no-such-route",
      "https://knot.invalid./pdf",
      "https://child.knot.invalid/",
    ]) {
      expect(classifyWebLink(value).kind).toBe("reserved");
      expect(() => normalizeWebAddress(value)).toThrow();
    }
  });
  it("rejects executable and privileged URLs while leaving existing external protocols and attachments alone", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///C:/workspace",
      "tauri://localhost/",
      "http://tauri.localhost/",
      "http://ipc.localhost/",
      "http://localhost:1420/",
      "http://127.0.0.1:1420/",
    ]) {
      expect(classifyWebLink(value).kind).toBe("blocked");
      expect(() => normalizeWebAddress(value)).toThrow();
    }
    for (const value of [
      "mailto:reader@example.com",
      "tel:+123456",
      "blob:http://tauri.localhost/attachment",
    ])
      expect(classifyWebLink(value).kind).toBe("other");
    expect(classifyWebLink("https://example.com/article")).toEqual({
      kind: "web",
      url: "https://example.com/article",
    });
  });
});
