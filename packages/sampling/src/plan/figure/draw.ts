/**
 * Drawing helpers of the PPQ flow figures: a tiny SVG canvas that remembers every text size it used (so a test can prove nothing is
 * below 8 pt at printed size), a text-width estimate, word wrap, and the row packer that keeps labels from overlapping.
 *
 * Units are POINTS at printed size: a page is `widthPt` wide and Word places the picture at that width, so a font size of 8.5 here
 * is 8.5 pt on paper. The functions are pure (no DOM, no canvas): text is measured with an estimate, which is deliberately a little
 * wide, because a label that is too roomy is harmless and a label that overruns its box is not.
 */

export const FONT_FAMILY = "Arial, Helvetica, sans-serif";
/** Nothing in a figure is drawn smaller than this at printed size. */
export const MIN_FONT_PT = 8;

export const COLORS = {
  ink: "#111827",
  muted: "#4b5563",
  paper: "#ffffff",
  step: { fill: "#dcd9f2", stroke: "#5b52a8" },
  hold: { fill: "#fde0b4", stroke: "#b45f06" },
  target: { fill: "#d7dbe0", stroke: "#374151" },
  ppq: { fill: "#e3eefb", stroke: "#1d5fa8" },
  routine: { fill: "#e6f5ea", stroke: "#2b7a43" },
  band: "#eef0f3",
  frame: "#9ca3af",
} as const;

export const xe = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Estimated width of a text in points. Arial's average glyph is about 0.5 em; 0.55 / 0.6 leave room for wide letters and digits. */
export function textWidth(s: string, size: number, bold = false): number {
  return s.length * size * (bold ? 0.6 : 0.55);
}

/** Plain whitespace only (not \s): a no-break space keeps a number and its unit on one line. */
const WORD_SPACE = new RegExp("[ " + String.fromCharCode(9, 13, 10) + "]+");

/**
 * True when `wrap` would have to cut a word of `s` to make it fit `maxW` (a word is anything between plain whitespace, so a hyphenated
 * word is one word: hyphens are not break opportunities). Lets a caller refuse to draw text in a box too narrow for a whole word,
 * without changing what `wrap` returns for any other caller.
 */
export function hasOverlongWord(s: string, size: number, maxW: number, bold = false): boolean {
  return s.split(WORD_SPACE).some((w) => w && textWidth(w, size, bold) > maxW);
}

/** Greedy word wrap to a width. A single word longer than the width is cut (it is shown, never dropped). */
export function wrap(s: string, size: number, maxW: number, bold = false): string[] {
  // Split on plain whitespace only (not \s): a no-break space keeps a number and its unit on one line.
  const words = s.split(WORD_SPACE).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const fits = (t: string) => textWidth(t, size, bold) <= maxW;
  for (let w of words) {
    while (!fits(w) && w.length > 1) {
      const per = Math.max(1, Math.floor(maxW / (size * (bold ? 0.6 : 0.55))));
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, per));
      w = w.slice(per);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (fits(next)) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export interface TextOpts {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  anchor?: "start" | "middle" | "end";
  fill?: string;
  /** Colour of a thin outline painted under the letters (a halo), so a line drawn later never runs through the text. */
  halo?: string;
}
export interface RectOpts {
  fill?: string;
  stroke?: string;
  sw?: number;
  dash?: string;
  rx?: number;
}

/** A box a test can check: where something was drawn, in page points. */
export interface DrawnBox {
  kind: "step" | "hold" | "target" | "pins" | "card" | "note" | "legend";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Attributes that make a drawn mark usable on screen (focus, hover and the link to the table row). Off in exports. */
export interface Hook {
  sp: string;
  label: string;
  focusable?: boolean;
}

export class Canvas {
  private parts: string[] = [];
  boxes: DrawnBox[] = [];
  minFont = Number.POSITIVE_INFINITY;
  samples = new Set<string>();
  /** Halo colour used by `text` / `textLead` when the call gives none (the time-scale style sets it: dashed lines cross its labels). */
  haloDefault: string | undefined;

  constructor(
    readonly width: number,
    public height: number,
    private interactive: boolean,
  ) {}

  raw(s: string): void {
    this.parts.push(s);
  }

  /**
   * Opens a group that carries the sample hook (when the figure is interactive). Close it with `end()`. A focusable mark is a
   * labelled group, not a button: its drawn text (the SP number) is not part of the label, and a button whose label lacks its
   * visible text fails WCAG 2.5.3 (label in name). Enter / Space are handled by the page.
   */
  group(hook?: Hook): void {
    if (hook) for (const id of hook.sp.split(" ")) this.samples.add(id);
    if (hook && this.interactive) {
      const focus = hook.focusable ? ` tabindex="0" role="group" aria-label="${xe(hook.label)}"` : "";
      this.parts.push(`<g class="fig-mark" data-sp="${xe(hook.sp)}"${focus}>`);
    } else this.parts.push("<g>");
  }
  end(): void {
    this.parts.push("</g>");
  }

  box(b: DrawnBox): void {
    this.boxes.push(b);
  }

  rect(x: number, y: number, w: number, h: number, o: RectOpts = {}): void {
    const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : "";
    this.parts.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${o.rx ?? 0}" fill="${o.fill ?? "none"}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ""}${dash}/>`,
    );
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke: string = COLORS.ink, sw = 1, dash?: string): void {
    this.parts.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
  }
  poly(points: [number, number][], o: RectOpts = {}): void {
    this.parts.push(`<polygon points="${points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}" fill="${o.fill ?? "none"}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ""}/>`);
  }
  circle(cx: number, cy: number, r: number, o: RectOpts = {}): void {
    this.parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${o.fill ?? "none"}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ""}/>`);
  }

  /** One line of text; `y` is the baseline. */
  text(x: number, y: number, s: string, o: TextOpts = {}): void {
    const size = o.size ?? 8.5;
    this.minFont = Math.min(this.minFont, size);
    const make = (paint: string) =>
      `<text x="${n(x)}" y="${n(y)}" font-size="${size}"${o.bold ? ' font-weight="700"' : ""}${o.italic ? ' font-style="italic"' : ""}${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""} ${paint}>${xe(s)}</text>`;
    this.halo(o, make);
    this.parts.push(make(`fill="${o.fill ?? COLORS.ink}"`));
  }
  /**
   * The halo is a second, hidden copy of the text drawn first with a thick outline in the background colour. (SVG's paint-order would
   * do it in one element, but the Node rasteriser used for the Word pictures ignores it and would paint the outline over the letters.)
   */
  private halo(o: TextOpts, make: (paint: string) => string): void {
    const h = o.halo ?? this.haloDefault;
    if (h) this.parts.push(make(`fill="${h}" stroke="${h}" stroke-width="3" stroke-linejoin="round" aria-hidden="true"`));
  }
  /** A line with a bold lead-in ("Routine:") followed by plain text, as one text element. */
  textLead(x: number, y: number, lead: string, rest: string, o: TextOpts = {}): void {
    const size = o.size ?? 8.5;
    this.minFont = Math.min(this.minFont, size);
    const make = (paint: string) => `<text x="${n(x)}" y="${n(y)}" font-size="${size}"${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""} ${paint}><tspan font-weight="700">${xe(lead)}</tspan>${xe(rest)}</text>`;
    this.halo(o, make);
    this.parts.push(make(`fill="${o.fill ?? COLORS.ink}"`));
  }
  /** Wrapped lines, one per `lh` points; returns the baseline of the line after the last. */
  lines(x: number, y: number, lines: string[], o: TextOpts & { lh?: number } = {}): number {
    const lh = o.lh ?? (o.size ?? 8.5) + 2;
    for (const l of lines) {
      this.text(x, y, l, o);
      y += lh;
    }
    return y;
  }

  svg(label: string, kind: "img" | "group"): string {
    const role = kind === "group" ? "group" : "img";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${n(this.height)}" viewBox="0 0 ${this.width} ${n(this.height)}" font-family="${FONT_FAMILY}" role="${role}" aria-label="${xe(label)}">` +
      `<rect x="0" y="0" width="${this.width}" height="${n(this.height)}" fill="${COLORS.paper}"/>` +
      this.parts.join("") +
      "</svg>"
    );
  }
}

const n = (v: number): string => String(Math.round(v * 100) / 100);

// ------------------------------------------------------------------ row packing

export interface PackItem {
  /** Horizontal extent of the label (and of anything drawn with it in the same row). */
  x0: number;
  x1: number;
  /** x positions of the lines that run from this item to the thing it points at; they cross the rows between. */
  leaders: number[];
}

/**
 * Puts labels in rows so that none overlaps another and no leader line runs through another label.
 *  - Items in one row must have disjoint extents (with `gap`).
 *  - A leader of an item passes through the rows between that item's row and the anchor: the rows BELOW its own (towards row 0) when
 *    `towards` is "lower", the rows ABOVE (towards the last row) when it is "higher". It must not lie inside any label of a row it passes.
 * Items are placed in the order given; each takes the lowest row that works. Returns the row of every item.
 */
const MAX_ROWS = 14;

/**
 * `order` is the order items are placed in (indices into `items`; default: as given). It matters: a label that runs to the right of
 * its leader must be placed AFTER the labels to its right (so it ends up above them and never sits on their leaders); a label that
 * runs to the left, after the ones to its left. The caller sorts accordingly.
 */
export function packRows(items: PackItem[], towards: "lower" | "higher", gap = 4, order?: number[], leaderRows = MAX_ROWS): number[] {
  const rows: number[] = new Array(items.length).fill(-1);
  const inside = (x: number, it: PackItem) => x >= it.x0 - 1 && x <= it.x1 + 1;
  const done: number[] = [];
  for (const i of order ?? items.map((_, k) => k)) {
    const it = items[i]!;
    // A leader can be boxed in by labels in every row it must cross; after MAX_ROWS the item goes in the first row where only the
    // label extents (not the leaders) are free, so the packer always ends.
    for (let r = 0; ; r++) {
      const relaxed = r >= leaderRows;
      let ok = true;
      for (const j of done) {
        if (!ok) break;
        const pj = items[j]!;
        const rj = rows[j]!;
        if (rj === r) {
          if (it.x0 < pj.x1 + gap && pj.x0 < it.x1 + gap) ok = false;
          continue;
        }
        if (relaxed) continue;
        const passesNew = towards === "lower" ? rj < r : rj > r;
        const passesOld = towards === "lower" ? r < rj : r > rj;
        if (passesNew && it.leaders.some((x) => inside(x, pj))) ok = false;
        if (passesOld && pj.leaders.some((x) => inside(x, it))) ok = false;
      }
      if (ok) {
        rows[i] = r;
        done.push(i);
        break;
      }
    }
  }
  return rows;
}


/** Hours as written on a figure: "48 h", "1.5 h"; no trailing zeros. The space is a no-break space so "h" never wraps alone. */
export const hoursText = (h: number): string => `${Math.round(h * 100) / 100}\u00a0h`;

/** Joins a number to its unit with a no-break space ("4 to 8 h", "20 to 25 °C") so a lone unit never wraps onto its own line. */
export const nbUnit = (s: string): string => s.replace(/(\d) +(h|hours?|min|days?|°C)(?![A-Za-z])/g, "$1\u00a0$2");
