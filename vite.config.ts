import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { cpSync, mkdirSync } from "node:fs";
export default defineConfig({
  plugins: [
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
