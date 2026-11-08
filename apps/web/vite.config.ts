import yaml from "@rollup/plugin-yaml";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base + hash routing: the build works from any sub-path (GitHub Pages
// project sites, Netlify, or a local folder) without server rewrites.
//
// Text files that compress well; pictures and fonts are already compressed.
const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".map", ".svg", ".json", ".html", ".txt"]);

/**
 * Server build only: next to every text file in the output folder, write "<file>.br" (Brotli) and "<file>.gz" (gzip).
 * The laptop server sends the matching copy with Content-Encoding when the browser accepts it (apps/server/src/static.ts),
 * so a first visit downloads about a quarter of the 2.7 MB script. A copy is kept only when it is really smaller.
 */
function precompress(outDir: string) {
  return {
    name: "gap-precompress",
    apply: "build" as const,
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory() ? walk(path) : [path];
        });
      for (const file of walk(resolve(outDir))) {
        if (!COMPRESSIBLE.has(extname(file).toLowerCase())) continue;
        const raw = readFileSync(file);
        if (raw.length < 1024) continue;
        const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
        const gz = gzipSync(raw, { level: 9 });
        if (br.length < raw.length) writeFileSync(file + ".br", br);
        if (gz.length < raw.length) writeFileSync(file + ".gz", gz);
      }
    },
  };
}

/**
 * The content policy of the built page, written into index.html as a meta tag (GitHub Pages cannot send headers). It is a
 * second barrier: nothing in the app builds markup from untrusted text without escaping it, but if that ever slipped, scripts
 * from anywhere but this site's own files would still not run. What the app really needs is listed here:
 *  - script and worker files come from the site itself (the demo and the PDF reader run in module workers built as files);
 *  - styles: the site's stylesheet plus inline style attributes (React sets some, the figures use them);
 *  - pictures: the site, data: (pasted pictures, exported figures) and blob: (a figure drawn to a canvas before download);
 *  - fonts: the bundled files (small ones are inlined as data:);
 *  - no plug-ins, no <base>, forms only to the site itself.
 * The laptop server sends the same rules as a header (apps/server/src/http.ts) and adds frame-ancestors, which a meta tag cannot carry.
 * Keep the two in step. Not applied to `vite dev` (its hot-reload code is an inline script).
 */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function contentPolicy() {
  return {
    name: "gap-content-policy",
    apply: "build" as const,
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: PAGE_CSP }, injectTo: "head-prepend" as const }];
    },
  };
}

// Two builds:
//  - `vite build` is the static demo (Pages): no server code, no network calls. Output: dist.
//  - `vite build --mode server` (npm run build:server) is the server-mode build for the laptop server. It sets
//    VITE_SERVER_MODE=1 (the flag the code checks) and writes to dist-server.
export default defineConfig(({ mode }) => {
  const serverMode = mode === "server" || process.env.VITE_SERVER_MODE === "1";
  return {
    base: "./",
    plugins: [react(), yaml(), contentPolicy(), ...(serverMode ? [precompress("dist-server")] : [])],
    // The demo is built in a module Web Worker (src/demo-worker.ts), which imports the YAML content too, so it needs the same plugin.
    worker: { format: "es" as const, plugins: () => [yaml()] },
    // A literal replacement, so the static build folds every `import.meta.env.VITE_SERVER_MODE` check away
    // and the server code is removed from it.
    define: { "import.meta.env.VITE_SERVER_MODE": JSON.stringify(serverMode ? "1" : "") },
    build: { outDir: serverMode ? "dist-server" : "dist", sourcemap: true, chunkSizeWarningLimit: 1500 },
    // `vite --mode server` for development: the API is on the server started with `npm run serve`.
    server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  };
});
