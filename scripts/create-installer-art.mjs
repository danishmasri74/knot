// Renders the installer bitmaps from Knot's identity artwork.
//   node scripts/create-installer-art.mjs
// Writes src-tauri/installer/sidebar.bmp (Welcome/Finish pages) and header.bmp
// (inner pages). NSIS only reads uncompressed BMP, so pixels are rendered in a
// headless browser and written as 24-bit BMP. Images are 2x the nominal size;
// NSIS scales them to the control, which keeps them sharp at 100-200% display
// scaling. Rules: docs/IDENTITY.md (flat ink on paper, crossing gaps intact).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "installer");
const SCALE = 2;
const PAPER = "#FAF9F6";
const INK = "#242423";
const EDGE = "#ECEBE6";

// The three shapes of the Linked K, taken from the canonical mark.
const markSvg = readFileSync(join(root, "assets", "knot-mark.svg"), "utf8");
const markPaths = [...markSvg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
if (markPaths.length !== 3) throw new Error("assets/knot-mark.svg: expected 3 paths");

function mark(x, y, size) {
  const s = size / 256;
  const paths = markPaths.map((d) => `<path d="${d}"/>`).join("");
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${INK}">${paths}</g>`;
}

const art = {
  // 164x314: mark and wordmark in the upper third, hairline where it meets the page.
  "sidebar.bmp": {
    w: 164,
    h: 314,
    svg: `<rect width="164" height="314" fill="${PAPER}"/>
      <rect x="163" width="1" height="314" fill="${EDGE}"/>
      ${mark(50, 72, 64)}
      <text x="82" y="166" text-anchor="middle" font-family="Segoe UI, Inter, sans-serif"
        font-weight="600" font-size="20" letter-spacing="-0.5" fill="${INK}">Knot</text>`,
  },
  // 150x57: small mark on the right with one stroke width of clear space.
  "header.bmp": {
    w: 150,
    h: 57,
    svg: `<rect width="150" height="57" fill="${PAPER}"/>${mark(102, 13.5, 30)}`,
  },
};

function bmp24(width, height, rgba) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const buf = Buffer.alloc(54 + pixelBytes);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(54 + pixelBytes, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive: rows stored bottom-up
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelBytes, 34);
  buf.writeInt32LE(2835, 38); // 72 dpi
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      buf[row + x * 3] = rgba[i + 2];
      buf[row + x * 3 + 1] = rgba[i + 1];
      buf[row + x * 3 + 2] = rgba[i];
    }
  }
  return buf;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  mkdirSync(outDir, { recursive: true });
  for (const [name, { w, h, svg }] of Object.entries(art)) {
    const W = w * SCALE;
    const H = h * SCALE;
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}">${svg}</svg>`;
    const pixels = await page.evaluate(
      async ({ source, W, H, paper }) => {
        const img = new Image();
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        return Array.from(ctx.getImageData(0, 0, W, H).data);
      },
      { source, W, H, paper: PAPER },
    );
    writeFileSync(join(outDir, name), bmp24(W, H, pixels));
    console.log(`${name}\t${W}x${H}`);
  }
} finally {
  await browser.close();
}
