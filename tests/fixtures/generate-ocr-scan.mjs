// Builds tests/fixtures/ocr-scan.pdf: page 1 has a text layer, page 2 is only
// an image (like a scan) of tests/fixtures/ocr-page.png.
// Run: node tests/fixtures/generate-ocr-scan.mjs
import fs from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const typed = pdf.addPage([612, 792]);
typed.drawText("Typed page about mitochondria", { x: 72, y: 700, size: 20, font });
const png = await pdf.embedPng(fs.readFileSync("tests/fixtures/ocr-page.png"));
const scanned = pdf.addPage([612, 792]);
const width = 540;
const height = (png.height / png.width) * width;
scanned.drawImage(png, { x: 36, y: 792 - 72 - height, width, height });
fs.writeFileSync(
  "tests/fixtures/ocr-scan.pdf",
  await pdf.save({ useObjectStreams: false }),
);
