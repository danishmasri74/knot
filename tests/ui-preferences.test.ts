import { expect, it } from "vitest";
import { isDurablePreference, refill } from "../src/services/ui-preferences";

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  } as unknown as Storage & { map: Map<string, string> };
}

it("keeps preferences durable but leaves drafts and foreign keys in the WebView", () => {
  expect(isDurablePreference("knot.editor-preferences")).toBe(true);
  expect(isDurablePreference("knot.sidebar.Workspace")).toBe(true);
  expect(isDurablePreference("knot.appearance")).toBe(true);
  expect(isDurablePreference("knot.ai.draft.v1:Workspace")).toBe(false);
  expect(isDurablePreference("knot.ai.draft-image.v1:Workspace")).toBe(false);
  expect(isDurablePreference("knot.ui-mirror.v1")).toBe(false);
  expect(isDurablePreference("other")).toBe(false);
});

it("refills a reset storage from the saved copy without overwriting newer values", () => {
  const reset = storage({ "knot.updates.lastCheck": "2" });
  const saved = JSON.stringify({
    "knot.editor-preferences": '{"fontSize":18}',
    "knot.sidebar.Workspace": '{"pinned":["c"]}',
    "knot.updates.lastCheck": "1",
    "knot.ai.draft.v1:Workspace": "draft",
    "knot.bad": 5,
  });
  expect(refill(reset, saved)).toBe(2);
  expect(reset.map.get("knot.editor-preferences")).toBe('{"fontSize":18}');
  expect(reset.map.get("knot.sidebar.Workspace")).toBe('{"pinned":["c"]}');
  expect(reset.map.get("knot.updates.lastCheck")).toBe("2");
  expect(reset.map.has("knot.ai.draft.v1:Workspace")).toBe(false);
  expect(refill(reset, null)).toBe(0);
});
