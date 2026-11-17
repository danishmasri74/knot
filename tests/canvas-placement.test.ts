import { describe, expect, it } from "vitest";
import {
  fitInViewport,
  placeInView,
  revealInViewport,
} from "../src/features/editor/blocksuite/canvas-viewport";

function viewport(x: number, y: number, w: number, h: number, zoom = 1) {
  const v = {
    zoom,
    centerX: x + w / 2,
    centerY: y + h / 2,
    get viewportBounds() {
      return { x: v.centerX - w / 2, y: v.centerY - h / 2, w, h };
    },
    setCenter(cx: number, cy: number) {
      v.centerX = cx;
      v.centerY = cy;
    },
  };
  return v;
}

it("places a new note in the middle of the view, below notes it would cover", () => {
  const v = viewport(0, 0, 1000, 800);
  expect(placeInView(v, { w: 400, h: 200 }, [])).toEqual({ x: 300, y: 300 });
  const notes = [
    { x: 250, y: 250, w: 500, h: 150 },
    { x: 280, y: 420, w: 300, h: 100 },
    { x: 2000, y: 300, w: 400, h: 200 },
  ];
  // Clears the first note (ends at 400 + 40), then the second (ends at 520 + 40).
  expect(placeInView(v, { w: 400, h: 200 }, notes)).toEqual({ x: 300, y: 560 });
});

it("pans the least distance to show a box, and leaves visible boxes alone", () => {
  const v = viewport(0, 0, 1000, 800);
  revealInViewport(v, { x: 100, y: 100, w: 200, h: 100 });
  expect([v.centerX, v.centerY]).toEqual([500, 400]);
  // Half hidden on the right (a side panel narrowed the view): shift right only.
  revealInViewport(v, { x: 900, y: 100, w: 300, h: 100 });
  expect([v.centerX, v.centerY]).toEqual([732, 400]);
  expect(v.viewportBounds.x + v.viewportBounds.w).toBe(1232);
  // Above the view: shift up.
  revealInViewport(v, { x: 600, y: -300, w: 200, h: 100 });
  expect(v.viewportBounds.y).toBe(-332);
  // Larger than the view: align its top-left corner.
  revealInViewport(v, { x: 0, y: 0, w: 5000, h: 5000 });
  expect([v.viewportBounds.x, v.viewportBounds.y]).toEqual([-32, -32]);
});

describe("fitInViewport", () => {
  const viewport = (zoom = 1) => {
    const calls: [number, [number, number] | undefined][] = [];
    return {
      calls,
      zoom,
      centerX: 400,
      centerY: 300,
      width: 800 * zoom,
      height: 600 * zoom,
      viewportBounds: { x: 0, y: 0, w: 800, h: 600 },
      setCenter() {},
      setViewport(z: number, c?: [number, number]) {
        calls.push([z, c]);
      },
    };
  };

  it("leaves visible content alone", () => {
    const v = viewport();
    fitInViewport(v, { x: 100, y: 100, w: 200, h: 200 });
    expect(v.calls).toEqual([]);
  });

  it("centres off-screen content, zooming out only to fit", () => {
    const near = viewport();
    fitInViewport(near, { x: 2000, y: 0, w: 300, h: 200 });
    expect(near.calls).toEqual([[1, [2150, 100]]]);
    const wide = viewport();
    fitInViewport(wide, { x: 2000, y: 0, w: 2000, h: 1000 }, 0);
    expect(wide.calls[0][0]).toBeCloseTo(0.4);
  });
});
