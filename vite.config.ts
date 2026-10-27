import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
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
