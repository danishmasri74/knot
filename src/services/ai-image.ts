import { attachments } from "./workspace";

// Sample a regular grid without blending neighboring colors at shape boundaries.
function samplePalette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const { data } = ctx.getImageData(0, 0, width, height);
  const bins = new Map<
    number,
    { count: number; red: number; green: number; blue: number }
  >();
  let samples = 0,
    transparent = 0;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 192));
  for (let y = Math.floor(Math.min(step, height) / 2); y < height; y += step) {
    for (let x = Math.floor(Math.min(step, width) / 2); x < width; x += step) {
      const offset = 4 * (y * width + x);
      samples++;
      const alpha = data[offset + 3] / 255;
      transparent += 1 - alpha;
      if (!alpha) continue;
      const [r, g, b] = data.subarray(offset, offset + 3);
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      const bin = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
      bin.count += alpha;
      bin.red += r * alpha;
      bin.green += g * alpha;
      bin.blue += b * alpha;
      bins.set(key, bin);
    }
  }
  return {
    estimatedTransparentPercent: Math.round((100 * transparent) / samples),
    dominantSampledColors: [...bins.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((bin) => ({
        hex:
          "#" +
          [bin.red, bin.green, bin.blue]
            .map((sum) =>
              Math.round(sum / bin.count)
                .toString(16)
                .padStart(2, "0"),
            )
            .join(""),
        percentOfVisibleArea: Math.round(
          (100 * bin.count) / (samples - transparent),
        ),
      })),
  };
}

/** Render through the browser so notebook SVGs and screenshots share one wire format. */
export async function prepareAiImage(key: string) {
  const bytes = new Uint8Array(await attachments.get(key));
  const header = new TextDecoder().decode(bytes.subarray(0, 4096));
  const blob = new Blob([bytes], {
    type: /<svg[\s>]/i.test(header) ? "image/svg+xml" : "",
  });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(
      1,
      3200 / Math.max(image.naturalWidth, image.naturalHeight),
      Math.sqrt(6000000 / (image.naturalWidth * image.naturalHeight)),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error();
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const measurements = {
      width: image.naturalWidth,
      height: image.naturalHeight,
      ...samplePalette(ctx, canvas.width, canvas.height),
    };
    let pixels = canvas.toDataURL("image/png");
    if (pixels.length > 8000000) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      pixels = canvas.toDataURL("image/jpeg", 0.9);
    }
    return { pixels, measurements };
  } catch {
    throw new Error("This image could not be read. Choose another image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
