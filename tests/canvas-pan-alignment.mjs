import assert from "node:assert/strict";

// Shared by the synthetic browser regression and the disposable desktop board.
export async function verifyPanAlignment(page) {
  const ids = await page.evaluate(async () => {
    const root = document.querySelector("affine-edgeless-root"),
      d = root.doc;
    const surface = d.getBlocksByFlavour("affine:surface")[0].model;
    const note = d.addBlock(
      "affine:note",
      { xywh: "[20000,20000,400,200]", index: "t0" },
      d.root,
    );
    d.addBlock(
      "affine:paragraph",
      { text: new d.Text("Panning alignment target") },
      note,
    );
    const frame = d.addBlock(
      "affine:frame",
      { xywh: "[20500,20000,200,250]", index: "s0" },
      surface.id,
    );
    const text = d.addBlock(
      "affine:edgeless-text",
      { xywh: "[20450,20000,200,100]", index: "t1", rotate: 25, scale: 1.2 },
      surface.id,
    );
    d.addBlock("affine:paragraph", { text: new d.Text("Rotated text") }, text);
    const shape = (xywh, index, color) =>
      surface.addElement({
        type: "shape",
        shapeType: "rect",
        xywh,
        index,
        fillColor: color,
        filled: true,
        strokeWidth: 0,
      });
    const below = shape("[19980,20040,100,100]", "s1", "#ff0000");
    const above = shape("[20340,20040,100,100]", "u0", "#00ff00");
    const connector = surface.addElement({
      type: "connector",
      source: { position: [20050, 20250] },
      target: { position: [20350, 20250] },
      stroke: "#0000ff",
      strokeWidth: 4,
      index: "v0",
    });
    root.gfx.viewport.setViewport(1, [20250, 20150]);
    await new Promise((r) => setTimeout(r, 1000));
    d.captureSync();
    window.panAlignment = { note, frame, text, below, above, connector };
    return window.panAlignment;
  });
  async function sample() {
    return page.evaluate(async () => {
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      const r = document.querySelector("affine-edgeless-root"),
        v = r.gfx.viewport;
      const ids = window.panAlignment;
      const errors = [];
      for (const id of [ids.note, ids.frame, ids.text]) {
        const el = r.host.std.view.getBlock(id),
          b = JSON.parse(el.model.xywh),
          rect = el.getBoundingClientRect();
        const [x, y] = v.toViewCoord(b[0], b[1]);
        errors.push({ id, dx: rect.x - v.left - x, dy: rect.y - v.top - y });
      }
      const pixels = [];
      // Read the actual raster layers at known model positions, in z order.
      // Red protrudes below the card, green overlaps above it, blue is connector.
      for (const [mx, my] of [
        [19990, 20080],
        [20380, 20080],
        [20200, 20250],
      ]) {
        const [x, y] = v.toViewCoord(mx, my);
        const stack = [
          ...r.querySelectorAll(
            ".affine-edgeless-surface-block-container canvas",
          ),
        ].sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex));
        const colors = [];
        for (const c of stack) {
          const rect = c.getBoundingClientRect();
          const px = Math.round(((v.left + x - rect.x) * c.width) / rect.width),
            py = Math.round(((v.top + y - rect.y) * c.height) / rect.height);
          if (px >= 0 && py >= 0 && px < c.width && py < c.height) {
            const rgba = [
              ...c.getContext("2d").getImageData(px, py, 1, 1).data,
            ];
            if (rgba[3]) colors.push(rgba);
          }
        }
        pixels.push(colors.at(-1));
      }
      const points = [
        [20020, 20080],
        [20380, 20080],
      ].map(([x, y]) => {
        const p = v.toViewCoord(x, y);
        return { x: v.left + p[0], y: v.top + p[1] };
      });
      return {
        errors,
        pixels,
        points,
        center: [v.centerX, v.centerY],
        geometry: [ids.note, ids.frame, ids.text].map(
          (id) => r.doc.getBlock(id).model.xywh,
        ),
      };
    });
  }
  async function check() {
    const s = await sample();
    for (const e of s.errors)
      assert.ok(
        Math.abs(e.dx) < 1 && Math.abs(e.dy) < 1,
        `DOM/model alignment: ${JSON.stringify(e)}`,
      );
    assert.ok(
      s.pixels[0]?.[0] > 200 && s.pixels[0]?.[1] < 80,
      "Below-card red shape must paint at model point",
    );
    assert.ok(
      s.pixels[1]?.[1] > 200 && s.pixels[1]?.[0] < 80,
      "Above-card green shape must paint at model point",
    );
    assert.ok(
      s.pixels[2]?.[2] > 200 && s.pixels[2]?.[0] < 80,
      "Connector must paint at model point",
    );
    return s;
  }
  const before = await check();
  const writes = await page.evaluate(async () => {
    const root = document.querySelector("affine-edgeless-root");
    const notes = [...root.querySelectorAll("affine-edgeless-note")];
    const originals = notes.map((n) => n.getCSSTransform);
    let calls = 0;
    notes.forEach(
      (n, i) =>
        (n.getCSSTransform = function (...args) {
          calls++;
          return originals[i].apply(this, args);
        }),
    );
    for (let i = 0; i < 20; i++) {
      root.gfx.viewport.setCenter(20250 + i, 20150);
      await new Promise(requestAnimationFrame);
    }
    root.gfx.viewport.setCenter(20250, 20150);
    notes.forEach((n, i) => (n.getCSSTransform = originals[i]));
    return calls;
  });
  assert.equal(writes, 0, "Fixed-zoom panning must skip per-card transforms");
  for (const delta of [
    [90, 45],
    [-70, -30],
    [130, -60],
    [0, 0],
  ]) {
    await page.evaluate(([dx, dy]) => {
      const v = document.querySelector("affine-edgeless-root").gfx.viewport;
      v.setCenter(20250 + dx, 20150 + dy);
    }, delta);
    const s = await check();
    assert.deepEqual(
      s.geometry,
      before.geometry,
      `Panning must not edit model geometry at ${delta}`,
    );
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() =>
        document
          .querySelector("affine-edgeless-root")
          .gfx.selection.set({ elements: [], editing: false }),
      );
      await page.mouse.click(s.points[i].x, s.points[i].y);
      const selected = await page.evaluate(() =>
        document
          .querySelector("affine-edgeless-root")
          .gfx.selection.selectedElements.map((e) => e.id),
      );
      if (selected[0] !== (i === 0 ? ids.note : ids.above)) {
        console.log({ ids, delta, i, selected, point: s.points[i] });
        console.log(
          await page.evaluate(({ x, y }) => {
            const r = document.querySelector("affine-edgeless-root"),
              v = r.gfx.viewport,
              p = v.toModelCoord(x - v.left, y - v.top);
            return {
              model: p,
              pick: r.gfx.getElementByPoint(...p, { all: true }).map((e) => ({
                id: e.id,
                index: e.index,
                groups: e.groups.map((g) => [g.id, g.index]),
              })),
              target: document.elementFromPoint(x, y)?.outerHTML.slice(0, 250),
              host: r.host.getBoundingClientRect().toJSON(),
            };
          }, s.points[i]),
        );
        await page.screenshot({ path: "test-results/panning-hit-failure.png" });
      }
      assert.deepEqual(
        selected,
        [i === 0 ? ids.note : ids.above],
        "Topmost click must follow the painted card/shape",
      );
    }
  }
  for (const zoom of [0.15, 0.6, 1]) {
    await page.evaluate(
      (zoom) =>
        document
          .querySelector("affine-edgeless-root")
          .gfx.viewport.setViewport(zoom, [20250, 20150]),
      zoom,
    );
    const s = await check();
    assert.deepEqual(
      s.geometry,
      before.geometry,
      "Zoom must preserve saved geometry",
    );
  }
  console.log(
    "PASS intermediate DOM/raster/connector alignment and above/below-card actual clicks",
  );
}
