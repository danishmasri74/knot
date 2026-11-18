/**
 * A schematic picture of a scene's draft for the model's review: frames as
 * titled outlines, cards and shapes as boxes with their titles, existing
 * canvas objects greyed, and arrows along the paths the editor will draw,
 * labels at their real size. It shows the layout, not the finished styling; nothing is
 * drawn on the user's canvas.
 */
import type { Scene } from "./scene";
import { arrowRoute, labelBox, type ArrowShape } from "./scene-report";
import type { Box } from "./scene-solver";

const MAX_W = 1400;
const MAX_H = 1000;
const INK = "#2b2b2b";
const MUTED = "#8a8a86";
const LINE = "#5b7fc4";

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
      if (out.length === lines) break;
    } else line = next;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && ctx.measureText(out[lines - 1]).width > width)
    out[lines - 1] = `${out[lines - 1].slice(0, Math.max(1, Math.floor(out[lines - 1].length * 0.85)))}…`;
  return out;
}

/** PNG data URL of the draft, or "" where there's no canvas to draw on. */
export function sceneSchematic(
  scene: Scene,
  boxes: Map<string, Box>,
  existing: { box: Box; title: string }[] = [],
  shape: ArrowShape = "elbowed",
): string {
  if (typeof document === "undefined") return "";
  const all = [...boxes.values(), ...existing.map((e) => e.box)];
  if (!all.length) return "";
  const x0 = Math.min(...all.map((b) => b[0])) - 60;
  const y0 = Math.min(...all.map((b) => b[1])) - 80;
  const w = Math.max(...all.map((b) => b[0] + b[2])) - x0 + 60;
  const h = Math.max(...all.map((b) => b[1] + b[3])) - y0 + 60;
  const scale = Math.min(MAX_W / w, MAX_H / h, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const at = (b: Box): Box => [(b[0] - x0) * scale, (b[1] - y0) * scale, b[2] * scale, b[3] * scale];
  const font = (px: number, weight = 400) => {
    ctx.font = `${weight} ${Math.max(9, px * scale)}px Inter, "Segoe UI", sans-serif`;
  };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";

  const title = (text: string, b: Box, px: number, lines: number, align: "left" | "center" = "left") => {
    font(px, 600);
    const pad = 12 * scale;
    const rows = wrap(ctx, text, Math.max(10, b[2] - pad * 2), lines);
    const lh = Math.max(9, px * scale) * 1.25;
    rows.forEach((row, i) => {
      const y = align === "center" ? b[1] + b[3] / 2 - (rows.length * lh) / 2 + i * lh : b[1] + pad + i * lh;
      const x = align === "center" ? b[0] + (b[2] - ctx.measureText(row).width) / 2 : b[0] + pad;
      ctx.fillText(row, x, y);
    });
  };

  // Existing canvas content, for context.
  for (const e of existing) {
    const b = at(e.box);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = MUTED;
    ctx.strokeRect(b[0], b[1], b[2], b[3]);
    ctx.setLineDash([]);
    ctx.fillStyle = MUTED;
    title(`(existing) ${e.title}`, b, 18, 2);
  }
  const objects = scene.objects.filter((o) => boxes.has(o.id));
  for (const o of objects.filter((o) => o.kind === "frame")) {
    const b = at(boxes.get(o.id)!);
    ctx.strokeStyle = MUTED;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(b[0], b[1], b[2], b[3]);
    ctx.fillStyle = INK;
    font(22, 600);
    ctx.fillText(o.text || "Section", b[0], b[1] - Math.max(12, 30 * scale));
  }
  for (const o of objects.filter((o) => o.kind !== "frame")) {
    const b = at(boxes.get(o.id)!);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#b8b8b4";
    ctx.fillStyle = "#f6f6f4";
    if (o.kind === "shape" && (o.shape === "ellipse" || o.shape === "diamond" || o.shape === "triangle")) {
      ctx.beginPath();
      if (o.shape === "ellipse") ctx.ellipse(b[0] + b[2] / 2, b[1] + b[3] / 2, b[2] / 2, b[3] / 2, 0, 0, Math.PI * 2);
      else if (o.shape === "diamond") {
        ctx.moveTo(b[0] + b[2] / 2, b[1]);
        ctx.lineTo(b[0] + b[2], b[1] + b[3] / 2);
        ctx.lineTo(b[0] + b[2] / 2, b[1] + b[3]);
        ctx.lineTo(b[0], b[1] + b[3] / 2);
      } else {
        ctx.moveTo(b[0] + b[2] / 2, b[1]);
        ctx.lineTo(b[0] + b[2], b[1] + b[3]);
        ctx.lineTo(b[0], b[1] + b[3]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (o.kind === "text") {
      // Free text has no box.
    } else {
      if (o.kind === "mindmap") ctx.setLineDash([8, 5]);
      ctx.fillRect(b[0], b[1], b[2], b[3]);
      ctx.strokeRect(b[0], b[1], b[2], b[3]);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = INK;
    const text =
      o.kind === "mindmap"
        ? `Mind map: ${o.nodes[0]?.text ?? ""} (${o.nodes.length} nodes)`
        : o.text || (o.content[0]?.text ?? "");
    title(text, b, o.kind === "text" ? 24 : 18, o.kind === "card" ? 3 : 4, o.kind === "shape" ? "center" : "left");
  }
  // Arrows: the path the editor draws between the sides that face each other.
  const endBox = (ref: string) => boxes.get(ref) ?? boxes.get(ref.split("#")[0]);
  const point = (p: [number, number]): [number, number] => [(p[0] - x0) * scale, (p[1] - y0) * scale];
  for (const c of scene.connectors) {
    const a = endBox(c.from);
    const z = endBox(c.to);
    if (!a || !z) continue;
    const world = arrowRoute(a, z, shape).points;
    const path = world.map(point);
    const s = path[0];
    const e = path[path.length - 1];
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(c.style === "dashed" ? [7, 5] : []);
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]);
    for (const p of path.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    const head = (tip: [number, number], tail: [number, number]) => {
      const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
      const size = 10;
      ctx.beginPath();
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(tip[0] - size * Math.cos(angle - 0.4), tip[1] - size * Math.sin(angle - 0.4));
      ctx.lineTo(tip[0] - size * Math.cos(angle + 0.4), tip[1] - size * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = LINE;
      ctx.fill();
    };
    if (c.heads === "to" || c.heads === "both") head(e, path[path.length - 2]);
    if (c.heads === "from" || c.heads === "both") head(s, path[1]);
    if (c.label) {
      // Its real size, so a label that covers a card shows covering it.
      const b = at(labelBox(c.label, world));
      font(16);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(b[0], b[1], b[2], b[3]);
      ctx.fillStyle = "#3d5a91";
      wrap(ctx, c.label, b[2], 3).forEach((row, i, rows) => {
        const tw = ctx.measureText(row).width;
        const lh = b[3] / rows.length;
        ctx.fillText(row, b[0] + b[2] / 2 - tw / 2, b[1] + lh * i + lh * 0.7);
      });
    }
  }
  return canvas.toDataURL("image/png");
}
