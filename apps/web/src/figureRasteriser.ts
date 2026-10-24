import type { FigureRasteriser } from "@gap/docx";

/**
 * Draws one SVG figure page as a PNG with the browser's own canvas, for the Word export.
 *
 * Why this and not an SVG library: the browser already has an SVG renderer and the system fonts, so the web bundle gains nothing. A
 * WASM renderer (resvg) would add about 2.5 MB and would need a font bundled with it, because it cannot see system fonts. The
 * picture is `dpi` / 72 times the printed size in points, so it prints at the dots per inch asked for (the figure text stays
 * 8 pt or more at printed size).
 */
export const browserRasteriser: FigureRasteriser = async ({ svg, widthPt, heightPt }, dpi) => {
  const scale = dpi / 72;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
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
  }
};
