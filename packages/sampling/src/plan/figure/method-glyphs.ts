import type { SampleAccess } from "@gap/process-model";
import type { SampleMethodView } from "../method.js";
import { Canvas, COLORS } from "./draw.js";

/**
 * How a sample is taken, drawn in the PPQ flow figures. The shapes are the same as the Process view of the batch record, so the two
 * views read alike: decoration beside the words (the sample card and the sample table say the same in text). A DASHED line means the
 * part was added only for the study; only the line style differs, so the cue does not depend on colour.
 *
 * Every shape is a few open lines and a ring in a 30 x 16 box, drawn with plain SVG lines so any renderer (browser, Word picture
 * maker) draws them the same. Nothing here is drawn for a sample whose method is not stated.
 */

export const GLYPH_W = 30;
export const GLYPH_H = 16;
export const FLUSH_W = 34;

type Pts = [number, number][];
interface Shape {
  lines: Pts[];
  ring?: [number, number, number];
}

const SHAPES: Record<SampleAccess, Shape> = {
  // pipe with one stub and a cap
  dedicated_port: { lines: [[[0, 14], [30, 14]], [[15, 14], [15, 4]], [[11, 4], [19, 4]]] },
  // the same stub with a ring: more than one sample leaves here
  shared_port: { lines: [[[0, 14], [30, 14]], [[15, 14], [15, 7]]], ring: [15, 4, 3] },
  // trunk with two arms
  added_y_connector: { lines: [[[0, 8], [11, 8]], [[11, 8], [24, 1]], [[11, 8], [24, 15]]] },
  // a comb: spine with teeth
  bag_sample_manifold: { lines: [[[0, 14], [30, 14]], [[5, 14], [5, 3]], [[12, 14], [12, 3]], [[19, 14], [19, 3]], [[26, 14], [26, 3]]] },
  // two halves with a gap
  aseptic_connector: { lines: [[[0, 8], [10, 8]], [[14, 2], [10, 2], [10, 14], [14, 14]], [[16, 2], [20, 2], [20, 14], [16, 14]], [[20, 8], [30, 8]]] },
  // an open cup, always dashed: nothing closed about it
  grab_open: { lines: [[[5, 2], [8, 14], [22, 14], [25, 2]]] },
  other: { lines: [], ring: [15, 8, 5] },
};

const DASH = "3 2";
const SW = 1.3;

/** Draws the access glyph with its top-left corner at (x, y); `scale` shrinks it for the legend. `added` = dashed. */
export function drawAccessGlyph(cv: Canvas, access: SampleAccess, added: boolean, x: number, y: number, scale = 1): void {
  const sh = SHAPES[access];
  const dash = added || access === "grab_open" ? DASH : undefined;
  const at = (p: [number, number]): [number, number] => [x + p[0] * scale, y + p[1] * scale];
  for (const l of sh.lines) cv.polyline(l.map(at), COLORS.ink, SW, dash);
  if (sh.ring) {
    const [cx, cy, r] = sh.ring;
    const [px, py] = at([cx, cy]);
    cv.ring(px, py, r * scale, COLORS.ink, SW, dash);
  }
}

/** An arrow to a waste mark (an open container): liquid flushed or discarded before the sample. */
export function drawFlushGlyph(cv: Canvas, x: number, y: number, scale = 1): void {
  const at = (p: [number, number]): [number, number] => [x + p[0] * scale, y + p[1] * scale];
  cv.polyline([[0, 8], [15, 8]].map((p) => at(p as [number, number])), COLORS.ink, SW);
  cv.polyline([[11, 4], [16, 8], [11, 12]].map((p) => at(p as [number, number])), COLORS.ink, SW);
  cv.polyline([[20, 2], [20, 14], [34, 14], [34, 2]].map((p) => at(p as [number, number])), COLORS.ink, SW);
}

/** The words that go with the drawing: the "N mL to waste" label, exactly as the Process view writes it. */
export const flushLabel = (m: SampleMethodView): string | undefined => (m.flush?.volumeText ? `${m.flush.volumeText} to waste` : undefined);

/** Does the card need a drawn row for this method? (A glyph or a study tag, then a flush row, each only when stated.) */
export const hasGlyphRow = (m: SampleMethodView | undefined): boolean => !!m && (!!m.access || !!m.addedForStudy);
export const hasFlushRow = (m: SampleMethodView | undefined): boolean => !!m && !!flushLabel(m);

export const GLYPH_ROW_H = 20;
export const FLUSH_ROW_H = 18;

/**
 * Thin lines joining the samples that use one port. A card's neighbours are reached through the gutters between the columns, so a line
 * never crosses a card's text: samples in one column are joined down the gutter on its left; samples in neighbouring columns across
 * the gutter between them. Samples farther apart (another column or another page) get no line; the card words still name the other sample.
 */
export function drawShareLinks(cv: Canvas, shares: { id: string; with: string[] }[], colGap: number): string[] {
  const drawn = new Set<string>();
  for (const s of shares) {
    for (const other of s.with) {
      const key = [s.id, other].sort().join("+");
      if (drawn.has(key)) continue;
      const p = cv.anchors.get(s.id);
      const q = cv.anchors.get(other);
      if (!p || !q) continue;
      const [a, b] = p.x <= q.x ? [p, q] : [q, p];
      let route: Pts | undefined;
      if (Math.abs(a.x - b.x) < 1) {
        const xl = a.x - 6;
        route = [[a.x, a.y], [xl, a.y], [xl, b.y], [b.x, b.y]];
      } else if (Math.abs(b.x - (a.x + a.w + colGap)) < 1) {
        const xm = a.x + a.w + colGap / 2;
        route = [[a.x + a.w, a.y], [xm, a.y], [xm, b.y], [b.x, b.y]];
      }
      if (!route) continue;
      drawn.add(key);
      cv.used.add("share");
      cv.raw(`<g data-share="${key}">`);
      cv.polyline(route, COLORS.muted, 1);
      for (const e of [route[0]!, route[route.length - 1]!]) cv.ring(e[0], e[1], 1.8, COLORS.muted, 1, undefined, COLORS.muted);
      cv.end();
    }
  }
  return [...drawn];
}
