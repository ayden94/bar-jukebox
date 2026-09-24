import { fluoDecoratorsPlugin } from "@fluojs/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist/server",
    rollupOptions: {
      output: {
        entryFileNames: "main.js",
      },
    },
    ssr: "src/main.ts",
    target: "node24",
  },
  plugins: [fluoDecoratorsPlugin()],
});
