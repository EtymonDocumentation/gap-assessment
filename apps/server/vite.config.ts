import { defineConfig } from "vite";

// Two self-contained Node bundles (server and admin CLI). Everything except Node's own modules is
// bundled in (zod and the workspace TypeScript packages), so dist/ runs without node_modules.
// One build per entry keeps each file standalone instead of sharing a chunk.
export default defineConfig(({ mode }) => ({
  ssr: { noExternal: true },
  build: {
    ssr: true,
    target: "node22",
    outDir: "dist",
    emptyOutDir: mode === "server",
    sourcemap: false,
    rollupOptions: {
      input: { [mode === "admin" ? "admin" : "server"]: mode === "admin" ? "src/admin.ts" : "src/server.ts" },
      output: { format: "es", entryFileNames: "[name].mjs" },
    },
  },
}));
