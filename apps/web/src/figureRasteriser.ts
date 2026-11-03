import type { FigureRasteriser } from "@gap/docx";

/**
 * Draws one SVG figure page as a PNG with the browser's own canvas, for the Word export.
 *
 * Why this and not an SVG library: the browser already has an SVG renderer and the system fonts, so the web bundle gains nothing. A
 * WASM renderer (resvg) would add about 2.5 MB and would need a font bundled with it, because it cannot see system fonts. The
 * picture is `dpi` / 72 times the printed size in points, so it prints at the dots per inch asked for (the figure text stays
 * 8 pt or more at printed size).
 */
export const browserRasteriser: FigureRasteriser = async (page, dpi) => {
  // The same page drawn again (a second download of an unchanged plan) is taken from the cache.
  const key = `${dpi}|${page.widthPt}x${page.heightPt}|${page.svg}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used goes last
    return hit;
  }
  const png = await draw(page, dpi);
  cache.set(key, png);
  cacheBytes += png.byteLength;
  for (const [oldKey, old] of cache) {
    if (cacheBytes <= CACHE_LIMIT_BYTES || cache.size <= 1) break;
    cache.delete(oldKey);
    cacheBytes -= old.byteLength;
  }
  return png;
};

/** Drawn pages by content, oldest first. Capped, so a long session cannot hold on to many megabytes of pictures. */
const cache = new Map<string, Uint8Array>();
let cacheBytes = 0;
const CACHE_LIMIT_BYTES = 24 * 1024 * 1024;

async function draw({ svg, widthPt, heightPt }: { svg: string; widthPt: number; heightPt: number }, dpi: number): Promise<Uint8Array> {
  const scale = dpi / 72;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const canvas = document.createElement("canvas");
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
    canvas.width = Math.round(widthPt * scale);
    canvas.height = Math.round(heightPt * scale);
    const g = canvas.getContext("2d");
    if (!g) throw new Error("the browser gave no drawing surface");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("the picture could not be made");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
    // Hand the large drawing surface back at once instead of waiting for garbage collection: eleven 2200 x 1700 pixel
    // canvases left behind made the next download of the same plan several times slower.
    img.src = "";
    canvas.width = 0;
    canvas.height = 0;
  }
}
