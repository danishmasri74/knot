import { describe, expect, it } from "vitest";
import {
  aiConnectorPorts,
  layoutAiCards,
} from "../src/features/editor/blocksuite/ai-layout";

describe("AI canvas layout", () => {
  it("keeps a 20-card summary compact and prevents overlaps with long content", () => {
    const bounds = layoutAiCards(
      Array.from({ length: 20 }, (_, i) => "Topic ".repeat(i === 2 ? 300 : 30)),
      [],
      900,
    );
    expect(new Set(bounds.map((b) => b[0])).size).toBe(4);
    expect(new Set(bounds.map((b) => b[1])).size).toBe(5);
    for (let i = 0; i < bounds.length; i++) {
      const [x, y, w, h] = bounds[i];
      expect(x).toBeGreaterThanOrEqual(900);
      for (const [bx, by, bw, bh] of bounds.slice(i + 1))
        expect(x + w <= bx || bx + bw <= x || y + h <= by || by + bh <= y).toBe(
          true,
        );
    }
  });
  it("groups linked topics and handles cycles and disconnected topics", () => {
    const bounds = layoutAiCards(
      ["A", "B", "C", "D", "E"],
      [
        { from: 0, to: 4 },
        { from: 4, to: 0 },
      ],
    );
    expect(bounds[4][0] - bounds[0][0]).toBe(520);
    expect(bounds).toHaveLength(5);
  });
  it("routes skip-over connections outside the row and downward links through edges", () => {
    expect(aiConnectorPorts([0, 0, 360, 240], [1040, 0, 360, 240])).toEqual({
      source: [0.5, 0],
      target: [0.5, 0],
    });
    expect(aiConnectorPorts([0, 0, 360, 240], [0, 400, 360, 240])).toEqual({
      source: [0.5, 1],
      target: [0.5, 0],
    });
  });
});
