// Reroute points on a real canvas: Alt+click splits an arrow with a dot,
// another arrow joins it (heads fixed), the canvas map reads both as direct
// links bundled through R1, the dot keeps its size, double-click goes to the
// target, right-click offers the route actions, Delete rejoins the arrows
// with their label, undo brings the dot back, deleting the target card
// removes the dot that routed to it, and arranging dissolves dots.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(`${e.message} ${e.stack?.split("\n").slice(1, 5).join(" ")}`),
  );
  await page.goto(process.env.KNOT_TEST_URL ?? "http://127.0.0.1:1420");
  await page.waitForSelector(".app-shell");
  await page.evaluate(async () => {
    const { DocCollection, Schema, Text } =
      await import("/node_modules/.vite/deps/@blocksuite_store.js");
    const { AffineSchemas } = await import("/node_modules/.vite/deps/@blocksuite_blocks.js");
    const { AffineEditorContainer } =
      await import("/node_modules/.vite/deps/@blocksuite_presets.js");
    const Y = await import("/node_modules/.vite/deps/yjs.js");
    const reroute = await import("/src/features/editor/blocksuite/reroute.ts");
    const c = new DocCollection({ schema: new Schema().register(AffineSchemas) });
    c.meta.initialize();
    const d = c.createDoc();
    d.load();
    const root = d.addBlock("affine:page", { title: new Text("Testing") });
    const surfaceId = d.addBlock("affine:surface", {}, root);
    const note = (xywh, text) => {
      const id = d.addBlock("affine:note", { xywh }, root);
      d.addBlock("affine:paragraph", { text: new Text(text) }, id);
      return id;
    };
    const ids = {
      unit: note("[0,0,240,100]", "Unit tests"),
      integration: note("[0,400,240,100]", "Integration tests"),
      testing: note("[700,200,240,100]", "Testing"),
    };
    const editor = new AffineEditorContainer();
    editor.doc = d;
    editor.mode = "edgeless";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff";
    document.body.append(host);
    host.append(editor);
    await editor.updateComplete;
    await new Promise((r) => setTimeout(r, 400));
    const surface = d.getBlock(surfaceId).model;
    ids.unitArrow = surface.addElement({
      type: "connector",
      source: { id: ids.unit },
      target: { id: ids.testing },
      text: new Y.Text("part of"),
      labelXYWH: [0, 0, 70, 26],
      labelDisplay: true,
    });
    ids.integrationArrow = surface.addElement({
      type: "connector",
      source: { id: ids.integration },
      target: { id: ids.testing },
    });
    const canvas = editor.querySelector("affine-edgeless-root");
    canvas.gfx.viewport.setViewport(1, [470, 250]);
    d.resetHistory();
    window.__reroute = { d, surface, canvas, ids, reroute, stop: reroute.observeReroutes(editor, d) };
    await new Promise((r) => setTimeout(r, 400));
  });

  const state = () =>
    page.evaluate(async () => {
      const { surface, d, ids, reroute } = window.__reroute;
      const { captureCanvasMap } = await import("/src/features/editor/blocksuite/canvas-map.ts");
      const { formatCanvasMap } = await import("/src/services/canvas-map-format.ts");
      const names = Object.fromEntries(
        Object.entries(ids).map(([k, v]) => [v, k]),
      );
      const dots = [...reroute.rerouteDots(surface)];
      const name = (id) => names[id] ?? (dots.includes(id) ? `dot${dots.indexOf(id) + 1}` : id);
      return {
        dots: dots.map((id) => ({ id, xywh: surface.getElementById(id).xywh })),
        arrows: surface.elementModels
          .filter((e) => e.type === "connector")
          .map((e) => ({
            from: name(e.source.id),
            to: name(e.target.id),
            label: String(e.text ?? ""),
            rear: e.rearEndpointStyle,
            front: e.frontEndpointStyle,
          }))
          .sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)),
        map: formatCanvasMap(captureCanvasMap(d)),
        selected: window.__reroute.canvas.gfx.selection.selectedElements.map((e) => name(e.id)),
      };
    });
  /** Client point of a model point. */
  const client = (x, y) =>
    page.evaluate(([x, y]) => {
      const { viewport } = window.__reroute.canvas.gfx;
      const [vx, vy] = viewport.toViewCoord(x, y);
      return [vx + viewport.left, vy + viewport.top];
    }, [x, y]);
  const midpoint = (id) =>
    page.evaluate((id) => {
      const path = window.__reroute.surface.getElementById(id).absolutePath;
      const a = path[0];
      const b = path[path.length - 1];
      return window.__reroute.surface.getElementById(id).getNearestPoint([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }, id);
  const ids = await page.evaluate(() => window.__reroute.ids);

  // Alt+click the unit arrow.
  const [mx, my] = await midpoint(ids.unitArrow);
  const [cx, cy] = await client(mx, my);
  await page.keyboard.down("Alt");
  await page.mouse.click(cx, cy);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(200);
  let s = await state();
  assert.equal(s.dots.length, 1, "Alt+click adds a dot");
  assert.deepEqual(s.selected, ["dot1"], "the new dot is selected");
  assert.deepEqual(
    s.arrows.map((a) => [a.from, a.to, a.label, a.rear]),
    [
      ["dot1", "testing", "part of", "Arrow"],
      ["integration", "testing", "", "Arrow"],
      ["unit", "dot1", "", "None"],
    ],
    JSON.stringify(s.arrows),
  );

  // The integration arrow joins the dot: its head into the dot goes.
  await page.evaluate(() => {
    const { surface, ids, reroute } = window.__reroute;
    const dot = [...reroute.rerouteDots(surface)][0];
    surface.updateElement(ids.integrationArrow, { target: { id: dot } });
  });
  await page.waitForTimeout(100);
  s = await state();
  assert.equal(
    s.arrows.find((a) => a.from === "integration").rear,
    "None",
    "no arrowhead into a dot",
  );
  const lines = s.map.split("\n");
  const handle = (title) => lines.find((l) => l.includes(`"${title}"`))?.split(" ")[0];
  assert.ok(lines.includes(`arrow ${handle("Unit tests")} -part of-> ${handle("Testing")} via R1`), s.map);
  assert.ok(lines.includes(`arrow ${handle("Integration tests")} -part of-> ${handle("Testing")} via R1`), s.map);
  assert.ok(!lines.some((l) => l.startsWith("T")), "the dot is not described as a shape");

  // Resizing snaps back to the dot size, keeping its centre.
  await page.evaluate(() => {
    const { surface, reroute } = window.__reroute;
    const dot = [...reroute.rerouteDots(surface)][0];
    const [x, y] = JSON.parse(surface.getElementById(dot).xywh);
    surface.updateElement(dot, { xywh: JSON.stringify([x, y, 80, 80]) });
  });
  await page.waitForTimeout(100);
  s = await state();
  const [, , w, h] = JSON.parse(s.dots[0].xywh);
  assert.deepEqual([w, h], [14, 14], "dots keep their size");

  // Double-click the dot goes to the card it points at.
  const [dx, dy, dw, dh] = JSON.parse(s.dots[0].xywh);
  const [px, py] = await client(dx + dw / 2, dy + dh / 2);
  await page.mouse.click(1, 1);
  await page.mouse.dblclick(px, py);
  await page.waitForTimeout(200);
  s = await state();
  assert.deepEqual(s.selected, ["testing"], "double-click goes to the target");
  assert.equal(
    await page.evaluate(() => !!document.querySelector("affine-edgeless-root edgeless-shape-text-editor, edgeless-shape-text-editor")),
    false,
    "double-click does not edit the dot's text",
  );

  // Right-click the dot offers the route actions.
  const [rx, ry] = await client(dx + dw / 2, dy + dh / 2);
  await page.mouse.click(rx, ry, { button: "right" });
  const items = await page.$$eval(".card-deck-menu.knot-dropdown [role=menuitem]", (b) =>
    b.map((x) => x.textContent),
  );
  assert.deepEqual(items, ["Go to target", "Go to source", "Remove reroute point"]);
  // Going to the source of a bundle asks which one.
  // (The test's editor overlay sits above the menu; click it directly.)
  await page.evaluate(() =>
    document.querySelector(".card-deck-menu [role=menuitem]:nth-child(2)").click(),
  );
  const sources = await page.$$eval(".card-deck-menu.knot-dropdown [role=menuitem]", (b) =>
    b.map((x) => x.textContent).sort(),
  );
  assert.deepEqual(sources, ["Integration tests", "Unit tests"]);
  await page.keyboard.press("Escape");

  // Delete rejoins both arrows, each keeping the label.
  await page.evaluate(() => {
    const { surface, canvas, reroute } = window.__reroute;
    canvas.gfx.selection.set({ elements: [...reroute.rerouteDots(surface)], editing: false });
    canvas.focus();
  });
  await page.keyboard.press("Delete");
  await page.waitForTimeout(150);
  s = await state();
  assert.equal(s.dots.length, 0, "Delete removes the dot");
  assert.deepEqual(
    s.arrows.map((a) => [a.from, a.to, a.label, a.rear]),
    [
      ["integration", "testing", "part of", "Arrow"],
      ["unit", "testing", "part of", "Arrow"],
    ],
    JSON.stringify(s.arrows),
  );

  // Undo brings the dot and its arrows back.
  await page.evaluate(() => window.__reroute.d.undo());
  await page.waitForTimeout(150);
  s = await state();
  assert.equal(s.dots.length, 1, "undo restores the dot");
  assert.equal(s.arrows.filter((a) => a.to === "dot1").length, 2);

  // Arranging the cards dissolves the dot between them.
  await page.evaluate(() => {
    const { d, surface, ids, reroute } = window.__reroute;
    d.transact(() =>
      reroute.dissolveDotsAmong(surface, new Set([ids.unit, ids.integration, ids.testing])),
    );
  });
  s = await state();
  assert.equal(s.dots.length, 0, "arranging dissolves dots among the cards");
  await page.evaluate(() => window.__reroute.d.undo());
  await page.waitForTimeout(150);

  // Deleting the target card as the editor does (with its arrows) removes
  // the dot and the arrows that led into it.
  await page.evaluate(() => {
    const { d, surface, ids } = window.__reroute;
    d.transact(() => {
      for (const e of [...surface.elementModels])
        if (e.type === "connector" && e.target.id === ids.testing) surface.deleteElement(e.id);
      d.deleteBlock(d.getBlock(ids.testing).model);
    });
  });
  await page.waitForTimeout(150);
  s = await state();
  assert.equal(s.dots.length, 0, "a dot routing nothing is removed");
  assert.deepEqual(s.arrows, [], JSON.stringify(s.arrows));

  assert.deepEqual(errors, []);
  console.log(
    "Reroute points: Alt+click split, bundling, map via R1, size, double-click and right-click jumps, Delete rejoin, undo, arrange and cleanup",
  );
} finally {
  await browser.close();
}
