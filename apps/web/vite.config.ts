import yaml from "@rollup/plugin-yaml";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base + hash routing: the build works from any sub-path (GitHub Pages
// project sites, Netlify, or a local folder) without server rewrites.
export default defineConfig({
  base: "./",
  plugins: [react(), yaml()],
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 1500 },
});
