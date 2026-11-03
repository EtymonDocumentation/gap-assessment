/// <reference types="node" />
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Maps a URL path to a file inside `root`, or null. The path is decoded first and then checked, so
 * "..%2f" tricks, backslashes, null bytes, dot-files and symbolic links out of the folder all end up as null.
 */
export async function resolveStatic(root: string, urlPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const parts = decoded.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === ".." || p.startsWith("."))) return null;

  const base = resolve(root);
  const target = resolve(join(base, ...(parts.length ? parts : ["index.html"])));
  if (target !== base && !target.startsWith(base + sep)) return null;
  try {
    // realpath catches a symbolic link that points out of the web folder.
    const [realTarget, realBase] = await Promise.all([realpath(target), realpath(base)]);
    if (!realTarget.startsWith(realBase + sep)) return null;
    return (await stat(realTarget)).isFile() ? realTarget : null;
  } catch {
    return null;
  }
}

/** Text types the build precompresses (apps/web/vite.config.ts); only these get Vary and a .br / .gz sibling lookup. */
const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".map", ".svg", ".json", ".html", ".txt"]);

/** Encodings the request accepts, best first (Brotli, then gzip). "br;q=0" means refused. */
function acceptedEncodings(header: string | string[] | undefined): ("br" | "gzip")[] {
  const text = Array.isArray(header) ? header.join(",") : (header ?? "");
  const accepted = new Set<string>();
  for (const part of text.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (name && (q === undefined || Number(q.slice(2)) > 0)) accepted.add(name.trim());
  }
  const out: ("br" | "gzip")[] = [];
  if (accepted.has("br")) out.push("br");
  if (accepted.has("gzip") || accepted.has("x-gzip")) out.push("gzip");
  return out;
}

/** Serves one static file; resolves false when there is nothing to serve (the caller answers 404). */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const file = await resolveStatic(root, pathname);
  if (!file) return false;
  let info = await stat(file);
  const ext = extname(file).toLowerCase();
  const type = TYPES[ext] ?? "application/octet-stream";
  // Use the precompressed copy written by the build when the browser accepts it. The original goes out otherwise.
  let serveFrom = file;
  const headers: Record<string, string | number> = {};
  if (COMPRESSIBLE.has(ext)) {
    headers["Vary"] = "Accept-Encoding";
    for (const encoding of acceptedEncodings(req.headers["accept-encoding"])) {
      const copy = file + (encoding === "br" ? ".br" : ".gz");
      const copyInfo = await stat(copy).catch(() => null);
      if (copyInfo?.isFile()) {
        serveFrom = copy;
        info = copyInfo;
        headers["Content-Encoding"] = encoding;
        break;
      }
    }
  }
  // Built asset names carry a content hash, so they may be cached for good; the page itself must stay fresh.
  // The pictures in /art/ keep fixed names (no hash), so they get a day: long enough not to download 2 MB again on every visit,
  // short enough that a replaced picture shows up the next day.
  const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : pathname.startsWith("/art/") ? "public, max-age=86400" : "no-cache";
  res.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": info.size, "Cache-Control": cache });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  const stream = createReadStream(serveFrom);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
  return true;
}
