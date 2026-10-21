import yaml from "@rollup/plugin-yaml";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base + hash routing: the build works from any sub-path (GitHub Pages
// project sites, Netlify, or a local folder) without server rewrites.
//
// Two builds:
//  - `vite build` is the static demo (Pages): no server code, no network calls. Output: dist.
//  - `vite build --mode server` (npm run build:server) is the server-mode build for the laptop server. It sets
//    VITE_SERVER_MODE=1 (the flag the code checks) and writes to dist-server.
export default defineConfig(({ mode }) => {
  const serverMode = mode === "server" || process.env.VITE_SERVER_MODE === "1";
  return {
    base: "./",
    plugins: [react(), yaml()],
    // A literal replacement, so the static build folds every `import.meta.env.VITE_SERVER_MODE` check away
    // and the server code is removed from it.
    define: { "import.meta.env.VITE_SERVER_MODE": JSON.stringify(serverMode ? "1" : "") },
    build: { outDir: serverMode ? "dist-server" : "dist", sourcemap: true, chunkSizeWarningLimit: 1500 },
    // `vite --mode server` for development: the API is on the server started with `npm run serve`.
    server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  };
});
