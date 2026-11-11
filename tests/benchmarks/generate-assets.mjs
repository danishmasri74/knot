// Synthetic, public benchmark material only. No workspace data is read.
import { chromium } from "playwright";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
const root = new URL("./assets/", import.meta.url);
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.setContent(
    `<body style="margin:0;background:white"><svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="white"/><text x="30" y="40" font-family="Arial" font-size="24">Synthetic delivery diagram</text><rect x="40" y="100" width="140" height="100" fill="#2463db"/><text x="65" y="155" fill="white" font-family="Arial" font-size="22">Intake</text><path d="M190 150H350M335 135L350 150L335 165" stroke="black" fill="none" stroke-width="4"/><circle cx="440" cy="150" r="70" fill="#e74646"/><text x="404" y="157" fill="white" font-family="Arial" font-size="22">Review</text><text x="40" y="300" font-family="Arial" font-size="24">Blue: 4 items</text><text x="40" y="340" font-family="Arial" font-size="24">Red: 2 items</text><text x="40" y="410" font-family="Arial" font-size="18">Counts are labels, not counts of shapes.</text></svg></body>`,
  );
  const png = await page.screenshot();
  await writeFile(new URL("diagram.png", root), png);
  await writeFile(
    new URL("diagram.data", root),
    `data:image/png;base64,${png.toString("base64")}`,
  );
} finally {
  await browser.close();
}
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const lines of [
  [
    "Quarterly report - synthetic fixture",
    "North revenue: USD 12 million",
    "South revenue: USD 8 million",
    "Revenue excludes tax.",
    "Page 1",
  ],
  [
    "Delivery plan",
    "Phase 1: Intake",
    "Phase 2: Review, after Intake",
    "Review owner: Mira",
    "No release date has been approved.",
    "Page 2",
  ],
]) {
  const page = pdf.addPage([600, 700]);
  lines.forEach((line, i) =>
    page.drawText(line, {
      x: 40,
      y: 640 - i * 65,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    }),
  );
}
const bytes = Buffer.from(await pdf.save());
await writeFile(new URL("report.pdf", root), bytes);
await writeFile(
  new URL("report.data", root),
  `data:application/pdf;base64,${bytes.toString("base64")}`,
);
