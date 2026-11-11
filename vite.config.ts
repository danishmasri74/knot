import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ort = path.dirname(require.resolve("onnxruntime-web", { paths: [path.dirname(require.resolve("@huggingface/transformers"))] }));
mkdirSync("public/onnx", { recursive: true });
for (const file of ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"])
  cpSync(path.join(ort, file), path.join("public/onnx", file));
export default defineConfig({
  plugins: [
    {
      name: "local-onnx-development-resources",
      configureServer(server) {
        server.middlewares.use("/onnx/", (req, res, next) => {
          const name = req.url?.split("?")[0].replace(/^\//, "");
          if (!name || !["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"].includes(name)) return next();
          res.setHeader("Content-Type", name.endsWith("wasm") ? "application/wasm" : "text/javascript");
          res.end(readFileSync(path.join("public/onnx", name)));
        });
      },
    },
    react(),
    tailwind(),
    {
      name: "local-pdf-resources",
      apply: "build",
      closeBundle() {
        mkdirSync("dist/pdfjs", { recursive: true });
        for (const folder of ["cmaps", "standard_fonts", "wasm"])
          cpSync(`node_modules/pdfjs-dist/${folder}`, `dist/pdfjs/${folder}`, {
            recursive: true,
          });
      },
    },
  ],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: { target: "es2022" },
  optimizeDeps: {
    include: [
      "@blocksuite/presets",
      "@blocksuite/blocks",
      "@blocksuite/presets/effects",
      "@blocksuite/blocks/effects",
    ],
  },
});
