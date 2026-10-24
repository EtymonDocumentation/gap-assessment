import { createCanvas, Image } from "@napi-rs/canvas";
import type { FigureRasteriser } from "../src/index";

/**
 * The Node rasteriser used by tests and by the sample generators: @napi-rs/canvas draws the SVG page at the asked resolution.
 * (The web app uses the browser's own canvas; see apps/web/src/figureRasteriser.ts.)
 */
export const nodeRasteriser: FigureRasteriser = async ({ svg, widthPt, heightPt }, dpi) => {
  const scale = dpi / 72;
  const img = new Image();
  img.src = Buffer.from(svg);
  const canvas = createCanvas(Math.round(widthPt * scale), Math.round(heightPt * scale));
  const g = canvas.getContext("2d");
  g.scale(scale, scale);
  g.drawImage(img, 0, 0, widthPt, heightPt);
  return new Uint8Array(canvas.toBuffer("image/png"));
};
