import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL(
  "../public/models/multilingual-e5-small/",
  import.meta.url,
);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", root), "utf8"),
);
if (
  manifest.revision !== "761b726dd34fb83930e26aab4e9ac3899aa1fa78" ||
  manifest.runtime !== "@huggingface/transformers@3.8.1"
)
  throw Error("Unpinned topic model");
let total = 0;
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = readFileSync(new URL(name, root));
  if (
    bytes.length !== expected.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== expected.sha256
  )
    throw Error(`Model asset verification failed: ${name}`);
  total += bytes.length;
}
console.log(`Verified pinned topic model: ${total} bytes.`);

for (const [name, expected] of Object.entries({
  "ort-wasm-simd-threaded.jsep.mjs":
    "08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9",
  "ort-wasm-simd-threaded.jsep.wasm":
    "c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39",
})) {
  const bytes = readFileSync(
    new URL(`../public/onnx/${name}`, import.meta.url),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw Error(`Runtime asset verification failed: ${name}`);
}
