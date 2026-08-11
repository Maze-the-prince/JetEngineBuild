import { defineConfig } from "vite";

// GitHub Pages project site: https://maze-the-prince.github.io/JetEngineBuild/
export default defineConfig({
  base: "/JetEngineBuild/",
  publicDir: "public",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    exclude: ["@needle-tools/engine"],
  },
});
