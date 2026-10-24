import { Canvas, COLORS, MIN_FONT_PT, nbUnit, textWidth, wrap, type Hook } from "./draw.js";
import { routineLine, type SampleView } from "./model.js";

/**
 * Units are the pieces a figure page is filled with (a sample card, a step header, a routine line, a note). A unit knows its height
 * for a given width and how to draw itself. `paginate` pours units into columns and pages; it is what lets a figure run on to a
 * second or third page ("Continued on next page") without ever shrinking the text.
 */
export interface Unit {
  h: number;
  /** Keep with the unit after it (a step header is never the last thing in a column). */
  keep?: boolean;
  /** Spans every column (notes); placed only at the top of a page. */
  full?: boolean;
  /** Words for "Continued on next page, starting with ...". */
  starts?: string;
  draw: (cv: Canvas, x: number, y: number, w: number) => void;
}

export interface Placed {
  unit: Unit;
  x: number;
  y: number;
  w: number;
}
export interface PageFill {
  placed: Placed[];
  /** Lowest y used by content on this page (before the footer). */
  bottom: number;
}

export const UNIT_GAP = 4;

export interface PaginateOpts {
  cols: number;
  /** Left edge of the first column and the total width available. */
  x0: number;
  width: number;
  colGap: number;
  /** Where content starts on the first page / on later pages. */
  firstTop: number;
  otherTop: number;
  /** The lowest y content may reach on every page (the footer and legend sit below it). */
  limit: number;
}

export function paginate(units: Unit[], o: PaginateOpts): PageFill[] {
  const colW = (o.width - o.colGap * (o.cols - 1)) / o.cols;
  const pages: PageFill[] = [];
  let colY: number[] = [];
  let col = 0;
  let cur: PageFill | undefined;
  const newPage = () => {
    const top = pages.length === 0 ? o.firstTop : o.otherTop;
    cur = { placed: [], bottom: top };
    pages.push(cur);
    colY = Array(o.cols).fill(top);
    col = 0;
  };
  newPage();
  const topOfPage = () => (pages.length === 1 ? o.firstTop : o.otherTop);
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.full) {
      const empty = colY.every((y) => y === topOfPage());
      if (!empty) newPage();
      cur!.placed.push({ unit: u, x: o.x0, y: colY[0]!, w: o.width });
      colY = colY.map((y) => y + u.h + UNIT_GAP);
      cur!.bottom = Math.max(cur!.bottom, colY[0]! - UNIT_GAP);
      continue;
    }
    const need = u.keep && units[i + 1] && !units[i + 1]!.full ? u.h + UNIT_GAP + units[i + 1]!.h : u.h;
    let guard = 0;
    while (colY[col]! + need > o.limit && colY[col]! > topOfPage() && guard++ < 1000) {
      col++;
      if (col >= o.cols) newPage();
    }
    const y = colY[col]!;
    cur!.placed.push({ unit: u, x: o.x0 + col * (colW + o.colGap), y, w: colW });
    colY[col] = y + u.h + UNIT_GAP;
    cur!.bottom = Math.max(cur!.bottom, y + u.h);
  }
  return pages;
}

// ------------------------------------------------------------------ units

const LINE = 10.5;
const PAD = 5;

/** A grey band with a step or hold name. Always travels with the unit after it. */
export function headerUnit(title: string, sub?: string, no?: number): Unit {
  void sub;
  return {
    h: 17 + 0,
    keep: true,
    starts: title,
    draw(cv, x, y, w) {
      cv.rect(x, y, w, 17, { fill: COLORS.band, stroke: COLORS.frame, sw: 0.8, rx: 2 });
      let tx = x + PAD;
      if (no !== undefined) {
        cv.circle(x + 11, y + 8.5, 6.5, { fill: COLORS.ink });
        cv.text(x + 11, y + 11.5, String(no), { size: 8, bold: true, anchor: "middle", fill: "#ffffff" });
        tx = x + 21;
      }
      const room = x + w - tx - PAD;
      let t = title;
      while (t.length > 3 && textWidth(t, 9, true) > room) t = t.slice(0, -2);
      cv.text(tx, y + 12, t === title ? t : `${t}...`, { size: 9, bold: true });
      cv.box({ kind: "card", id: `header:${title}`, x, y, w, h: 17 });
    },
  };
}

/** Wrapped title of a step header when the name is long: used by the step-card style, which has room for it. */
export function stepHeaderUnit(no: number, title: string, lines: string[], width: number): Unit {
  const heightFor = (w: number) => {
    const t = wrap(title, 10, w - 30, true);
    return 7 + t.length * 12 + lines.reduce((a, l) => a + wrap(l, 8.5, w - 30).length, 0) * LINE + 5;
  };
  // Columns of one figure are equal, so the width the caller passes is the width the unit is drawn at.
  return {
    h: heightFor(width),
    keep: true,
    starts: title,
    draw(cv, x, y, w) {
      const t = wrap(title, 10, w - 30, true);
      const body = lines.flatMap((l) => wrap(l, 8.5, w - 30));
      const h = 7 + t.length * 12 + body.length * LINE + 5;
      cv.rect(x, y, w, h, { fill: COLORS.step.fill, stroke: COLORS.step.stroke, sw: 1.2, rx: 4 });
      cv.circle(x + 13, y + 13, 7.5, { fill: COLORS.ink });
      cv.text(x + 13, y + 16, String(no), { size: 8, bold: true, anchor: "middle", fill: "#ffffff" });
      let ty = y + 15;
      for (const l of t) {
        cv.text(x + 26, ty, l, { size: 10, bold: true });
        ty += 12;
      }
      for (const l of body) {
        cv.text(x + 26, ty, l, { size: 8.5 });
        ty += LINE;
      }
      cv.box({ kind: "card", id: `step:${no}`, x, y, w, h });
    },
  };
}
/** "HOLD AFTER THIS STEP" box of the step-card style, also used for a hold with no step block of its own. */
export function holdBoxUnit(title: string, text: string, width: number): Unit {
  const lines = (w: number) => wrap(text, 8.5, w - 2 * PAD - 2);
  return {
    h: 6 + 10 + lines(width).length * LINE + 4,
    draw(cv, x, y, w) {
      const l = lines(w);
      const h = 6 + 10 + l.length * LINE + 4;
      cv.rect(x, y, w, h, { fill: COLORS.hold.fill, stroke: COLORS.hold.stroke, sw: 1.2, dash: "4 3", rx: 3 });
      cv.text(x + PAD, y + 12, title, { size: 8, bold: true });
      cv.lines(x + PAD, y + 22.5, l, { size: 8.5, lh: LINE });
      cv.box({ kind: "card", id: `hold:${title}`, x, y, w, h });
    },
  };
}

export interface CardOpts {
  /** Width used to measure the height (the real width is the column width and is the same for every card of a figure). */
  width: number;
  focusable: boolean;
  interactive: boolean;
}

/** A PPQ sample in full: number, id, study type, flags, what is tested, quantity, when. Same words as the sample table. */
export function sampleCard(s: SampleView, o: CardOpts): Unit {
  const measure = (w: number) => {
    const head = wrap(s.head, 8.5, w - 2 * PAD - 22 - (s.holdStep ? 56 : 0), true);
    const body = [`Test: ${s.test}`, ...(s.quantity ? [`Quantity: ${s.quantity}`] : []), `When: ${s.when}`].flatMap((l) => wrap(nbUnit(l), 8.5, w - 2 * PAD));
    return { head, body, h: 5 + Math.max(head.length, 1) * 11 + body.length * LINE + 7 };
  };
  const hook: Hook = { sp: s.id, label: `${s.id}: ${s.test}`, focusable: o.focusable };
  return {
    h: measure(o.width).h,
    draw(cv, x, y, w) {
      const m = measure(w);
      cv.group(hook);
      cv.rect(x, y, w, m.h, { fill: COLORS.ppq.fill, stroke: COLORS.ppq.stroke, sw: 1.1, rx: 3 });
      cv.circle(x + 13, y + 11, 8, { fill: COLORS.paper, stroke: COLORS.ppq.stroke, sw: 1.2 });
      cv.text(x + 13, y + 14, s.num, { size: 8, bold: true, anchor: "middle" });
      let ty = y + 13;
      for (const l of m.head) {
        cv.text(x + 26, ty, l, { size: 8.5, bold: true });
        ty += 11;
      }
      if (s.holdStep) {
        cv.rect(x + w - 58, y + 4, 53, 12, { fill: COLORS.hold.fill, stroke: COLORS.hold.stroke, sw: 1, rx: 2 });
        cv.text(x + w - 31.5, y + 13, "HOLD STEP", { size: 8, bold: true, anchor: "middle" });
      }
      ty = y + 5 + Math.max(m.head.length, 1) * 11 + 11.5;
      for (const l of m.body) {
        cv.text(x + PAD, ty, l, { size: 8.5 });
        ty += LINE;
      }
      cv.end();
      cv.box({ kind: "card", id: s.id, x, y, w, h: m.h });
    },
  };
}

/** Routine samples of a step as one short line. The full routine detail stays in the sample table. */
export function routineUnit(samples: SampleView[], width: number): Unit | undefined {
  const r = routineLine(samples);
  if (!r) return undefined;
  const linesFor = (w: number) => wrap(`${r.lead}${r.rest}`, 8.5, w - 2 * PAD);
  const ids = samples.filter((s) => s.routine).map((s) => s.id);
  const hook: Hook = { sp: ids.join(" "), label: `Routine samples ${ids.join(", ")}` };
  return {
    h: linesFor(width).length * LINE + 7,
    draw(cv, x, y, w) {
      const l = linesFor(w);
      const h = l.length * LINE + 7;
      cv.group(hook);
      cv.rect(x, y, w, h, { fill: COLORS.routine.fill, stroke: COLORS.routine.stroke, sw: 1, dash: "3 2", rx: 3 });
      l.forEach((line, i) => {
        if (i === 0) cv.textLead(x + PAD, y + 12, r.lead, line.slice(r.lead.length));
        else cv.text(x + PAD, y + 12 + i * LINE, line);
      });
      cv.end();
      cv.box({ kind: "card", id: `routine:${ids.join(",")}`, x, y, w, h });
    },
  };
}

/** Plain note lines in a light box that spans the page. */
export function noteUnit(lines: { lead?: string; text: string }[], width: number): Unit {
  const prepared = (w: number) => lines.flatMap((l) => wrap(nbUnit(`${l.lead ?? ""}${l.text}`), 8.5, w - 2 * PAD).map((t, i) => ({ t, lead: i === 0 ? l.lead : undefined })));
  return {
    h: prepared(width).length * LINE + 8,
    full: true,
    draw(cv, x, y, w) {
      const p = prepared(w);
      const h = p.length * LINE + 8;
      cv.rect(x, y, w, h, { fill: "#f7f8fa", stroke: COLORS.frame, sw: 0.8, dash: "4 3", rx: 2 });
      p.forEach((l, i) => {
        if (l.lead) cv.textLead(x + PAD, y + 12 + i * LINE, l.lead, l.t.slice(l.lead.length));
        else cv.text(x + PAD, y + 12 + i * LINE, l.t);
      });
      cv.box({ kind: "note", id: "notes", x, y, w, h });
    },
  };
}

// ------------------------------------------------------------------ legend and page chrome

export interface LegendItem {
  kind: "step" | "hold" | "target-line" | "target-ribbon" | "ppq" | "routine" | "narrow" | "holdstep";
  text: string;
}

/** The legend: one swatch and a few words per kind of mark that this figure uses. Drawn on every page. Returns its height. */
export function drawLegend(cv: Canvas, y: number, items: LegendItem[]): number {
  const W = cv.width;
  const rows: LegendItem[][] = [[]];
  let rowW = 0;
  for (const it of items) {
    const w = 26 + textWidth(it.text, 8) + 12;
    if (rowW + w > W - 24 && rows[rows.length - 1]!.length) {
      rows.push([]);
      rowW = 0;
    }
    rows[rows.length - 1]!.push(it);
    rowW += w;
  }
  cv.line(0, y, W, y, COLORS.frame, 0.8);
  let ry = y + 6;
  for (const row of rows) {
    let x = 12;
    for (const it of row) {
      swatch(cv, it.kind, x, ry);
      cv.text(x + 22, ry + 8, it.text, { size: MIN_FONT_PT });
      x += 26 + textWidth(it.text, 8) + 12;
    }
    ry += 14;
  }
  cv.box({ kind: "legend", id: "legend", x: 0, y, w: W, h: ry - y });
  return ry - y;
}

function swatch(cv: Canvas, kind: LegendItem["kind"], x: number, y: number): void {
  switch (kind) {
    case "step":
      cv.rect(x, y, 18, 10, { fill: COLORS.step.fill, stroke: COLORS.step.stroke, sw: 1.2, rx: 1 });
      break;
    case "narrow":
      cv.rect(x + 6, y, 6, 10, { fill: COLORS.step.fill, stroke: COLORS.step.stroke, sw: 1.2, dash: "2 1" });
      break;
    case "hold":
      cv.rect(x, y, 18, 10, { fill: COLORS.hold.fill, stroke: COLORS.hold.stroke, sw: 1.2, dash: "3 2" });
      break;
    case "holdstep":
      cv.rect(x, y + 1, 18, 8, { fill: COLORS.hold.fill, stroke: COLORS.hold.stroke, sw: 1, rx: 2 });
      break;
    case "target-line":
      cv.line(x + 9, y - 1, x + 9, y + 11, COLORS.target.stroke, 1.4, "3 2");
      cv.poly([[x + 9, y + 0], [x + 14, y + 5], [x + 9, y + 10], [x + 4, y + 5]], { fill: COLORS.target.fill, stroke: COLORS.target.stroke, sw: 1 });
      break;
    case "target-ribbon":
      cv.rect(x, y + 2, 18, 7, { fill: COLORS.target.fill, stroke: COLORS.target.stroke, sw: 1, rx: 2 });
      break;
    case "ppq":
      cv.rect(x, y, 18, 10, { fill: COLORS.ppq.fill, stroke: COLORS.ppq.stroke, sw: 1.2, rx: 5 });
      break;
    case "routine":
      cv.rect(x + 3, y, 12, 10, { fill: COLORS.routine.fill, stroke: COLORS.routine.stroke, sw: 1.2, dash: "2 1.5" });
      break;
  }
}

/** Height the legend will take for these items at this width (the page height must be known before it is drawn). */
export function legendHeight(width: number, items: LegendItem[]): number {
  let rows = 1;
  let rowW = 0;
  let inRow = 0;
  for (const it of items) {
    const w = 26 + textWidth(it.text, 8) + 12;
    if (rowW + w > width - 24 && inRow) {
      rows++;
      rowW = 0;
      inRow = 0;
    }
    rowW += w;
    inRow++;
  }
  return rows * 14 + 6;
}
