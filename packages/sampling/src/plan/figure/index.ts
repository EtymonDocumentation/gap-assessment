import type { SamplingPlan } from "@gap/process-model";
import { Canvas, COLORS, hoursText, MIN_FONT_PT, nbUnit, type DrawnBox } from "./draw.js";
import { drawLegend, headerUnit, legendHeight, noteUnit, paginate, routineUnit, sampleCard, type LegendItem, type PageFill, type Unit } from "./layout.js";
import { buildScopes, cmpText, samplesNotOnFigure, type Scope } from "./model.js";
import { drawStrip, stepCardUnits } from "./step-cards.js";
import { drawTimeScale } from "./time-scale.js";

export { MIN_FONT_PT } from "./draw.js";
export { PIN_CLUSTER_HOURS, clusterPins } from "./time-scale.js";
export { isRoutinePoint } from "./model.js";
export type { DrawnBox } from "./draw.js";

/**
 * PPQ flow figures: the plan's process, holds, time targets and samples drawn as SVG, with the page split worked out. A PURE function
 * of the plan (no DOM, no canvas, no clock), so the same drawing is used on screen, in the HTML export and, rendered to a picture,
 * in the Word export, and a test can check the layout.
 *
 * It lives in @gap/sampling because it reads only the plan data of @gap/process-model and the labels of this package; the engine
 * (documents) and the web app (the sampling page) both depend on this package, and neither is needed to draw.
 */

export const FIGURE_STYLES = ["time_scale", "step_cards", "none"] as const;
export type FigureStyle = (typeof FIGURE_STYLES)[number];
export const FIGURE_STYLE_LABEL: Record<FigureStyle, string> = {
  time_scale: "Time scale (hours on a scale, samples as pins)",
  step_cards: "Overview strip and step cards",
  none: "No figure",
};

export interface FigureOptions {
  style?: FigureStyle;
  /** Page width in points at printed size. Default 640 (8.9 in), which fits a US Letter landscape page with 1 inch margins without scaling, so the 8 pt text stays 8 pt in Word. */
  widthPt?: number;
  /** The tallest a picture may be, in points. Default 410, which leaves room for the caption on A4 and Letter landscape. */
  maxHeightPt?: number;
  /** Add focus and hover hooks (data-sp) for the sampling page. Off in exports. */
  interactive?: boolean;
  /** Number of the first figure. Default 1. */
  startNumber?: number;
}

export interface FigurePage {
  svg: string;
  width: number;
  height: number;
  /** Boxes of everything labelled on the page (for tests of the layout). */
  boxes: DrawnBox[];
  /** Smallest font size used on the page, in points at printed size. */
  minFontPt: number;
  /** Sample ids drawn on this page. */
  samples: string[];
  /** The page is taller than `maxHeightPt` (a very crowded timeline); the text is never shrunk to fit. */
  overflow: boolean;
}

export interface Figure {
  number: number;
  style: Exclude<FigureStyle, "none">;
  /** "main", or the id of the sub-process. */
  scopeId: string;
  /** Caption words after "Figure N: ". */
  caption: string;
  pages: FigurePage[];
  /** Steps and holds that have no hours (listed under the figure; not an open item). */
  hoursNotGiven: string[];
  /** Plain-text alternative: what the figure shows, for people who cannot see it. */
  alt: string;
  /** A sub-process figure says which step of which figure it feeds. */
  feeds?: { stepLabel: string; figureNumber: number };
}

/** "Figure 2: caption" or, on a figure of several pages, "Figure 2 (page 1 of 3): caption". */
export function figureCaption(f: Figure, pageIndex: number): string {
  return f.pages.length > 1 ? `Figure ${f.number} (page ${pageIndex + 1} of ${f.pages.length}): ${f.caption}` : `Figure ${f.number}: ${f.caption}`;
}

const MARGIN = 12;
const FOOTER_H = 22;
const TOP_NEXT = 28;

export function buildFigures(plan: SamplingPlan, opts: FigureOptions = {}): Figure[] {
  const style = opts.style ?? "time_scale";
  if (style === "none") return [];
  const scopes = buildScopes(plan);
  if (!scopes.length) return [];
  const start = opts.startNumber ?? 1;
  const mainIndex = scopes.findIndex((s) => !s.isSub);
  const mainNumber = start + (mainIndex < 0 ? scopes.length : mainIndex);
  const notOn = samplesNotOnFigure(plan);
  return scopes.map((scope, i) => {
    const number = start + i;
    return renderScope(plan, scope, style, {
      number,
      width: opts.widthPt ?? 640,
      maxH: opts.maxHeightPt ?? 410,
      interactive: !!opts.interactive,
      mainNumber,
      notOn: scope.isSub ? [] : notOn,
    });
  });
}

interface Ctx {
  number: number;
  width: number;
  maxH: number;
  interactive: boolean;
  mainNumber: number;
  notOn: string[];
}

function legendFor(scope: Scope, style: "time_scale" | "step_cards"): LegendItem[] {
  const items: LegendItem[] = [{ kind: "step", text: "Process step" }];
  if (scope.holds.length) items.push({ kind: "hold", text: "Hold (dashed, word HOLD)" });
  if (scope.targets.length) items.push(style === "time_scale" ? { kind: "target-line", text: "Time target (dashed line or arrow)" } : { kind: "target-ribbon", text: "Time target (ribbon)" });
  items.push({ kind: "ppq", text: "PPQ sample (solid, round ID)" });
  if (scope.samples.some((s) => s.routine)) items.push({ kind: "routine", text: "Routine sample (dashed, square ID)" });
  if (scope.samples.some((s) => s.holdStep)) items.push({ kind: "holdstep", text: "HOLD STEP: sample taken during a hold" });
  if (style === "time_scale" && scope.hoursNotGiven.length) items.push({ kind: "narrow", text: "Narrow dotted block: hours not given" });
  return items;
}

function noteLines(scope: Scope, style: "time_scale" | "step_cards", notOn: string[]): { lead?: string; text: string }[] {
  const out: { lead?: string; text: string }[] = [];
  if (style === "time_scale") {
    out.push({ lead: "Pins: ", text: "a pin sits at the hour the sample is taken. Round = PPQ, square = routine. The number is the SP number. Pins less than 10 h apart share a box." });
  }
  for (const t of scope.targets) {
    out.push({ lead: `${t.label} ${cmpText(t.comparator)}\u00a0${hoursText(t.hours)}: `, text: `from the ${t.fromText} to the ${t.toText}.${t.note ? ` ${t.note}` : ""}` });
  }
  if (scope.targets.some((t) => t.comparator === ">=")) out.push({ text: "A target of ≥ N h means the PPQ run is deliberately made to take at least that long, to support the limit." });
  if (scope.targets.some((t) => t.comparator === "<=")) out.push({ text: "A target of ≤ N h means the PPQ run is planned to take no longer than that." });
  if (style === "time_scale") {
    for (const s of scope.steps) if (s.figureText?.length) out.push({ lead: `${s.label}: `, text: nbUnit(s.figureText.join("; ")) });
  }
  if (scope.hoursNotGiven.length && style === "time_scale") out.push({ lead: "Hours not given: ", text: `${scope.hoursNotGiven.join(", ")}. Each is drawn as a narrow block and adds no time to the scale.` });
  if (scope.noHourSamples.length && style === "time_scale") out.push({ lead: "Not pinned (hour not given): ", text: `${scope.noHourSamples.join(", ")}. They are in the key below.` });
  for (const n of scope.notDrawn) out.push({ lead: "Not drawn: ", text: n });
  if (notOn.length) out.push({ lead: "Not on the diagram: ", text: `${notOn.join(", ")} (see the sample table).` });
  out.push({ text: "Routine samples are one line per step here; their full detail is in the sample table." });
  return out;
}

function altText(scope: Scope, style: "time_scale" | "step_cards", number: number): string {
  const hold = scope.holds.length ? `, ${scope.holds.length} ${scope.holds.length === 1 ? "hold" : "holds"}` : "";
  const tg = scope.targets.length ? `, ${scope.targets.length} time ${scope.targets.length === 1 ? "target" : "targets"}` : "";
  const how = style === "time_scale" ? "on a time scale in hours" : "as an overview strip and step cards";
  const list = scope.steps.map((s) => s.label).join(", ");
  return `Figure ${number}: ${scope.label} flow ${how}: ${scope.steps.length} ${scope.steps.length === 1 ? "step" : "steps"}${hold}${tg}, ${scope.samples.length} ${scope.samples.length === 1 ? "sample" : "samples"}. Steps in order: ${list}.`;
}

function renderScope(plan: SamplingPlan, scope: Scope, style: "time_scale" | "step_cards", ctx: Ctx): Figure {
  const W = ctx.width;
  const contentW = W - 2 * MARGIN;
  const legend = legendFor(scope, style);
  const legendH = legendHeight(W, legend);
  const limit = ctx.maxH - legendH - FOOTER_H - 8;
  const feeds = scope.isSub && scope.feeds ? { stepLabel: scope.feeds.label, figureNumber: ctx.mainNumber } : undefined;
  const sub = scope.isSub;
  const word = style === "time_scale" ? "time scale" : "step cards";
  const caption = sub ? `${plan.title}: ${scope.label} sub-process flow and sampling plan, ${word}` : `${plan.title}: process flow and sampling plan, ${word}`;
  const canvases: Canvas[] = [];
  const fresh = () => {
    const cv = new Canvas(W, ctx.maxH, ctx.interactive);
    canvases.push(cv);
    return cv;
  };

  // ---- first page: header line, then the timeline (F) or the strip (E)
  const first = fresh();
  let y = 8;
  if (sub) {
    const text = feeds ? `Feeds ${feeds.stepLabel} in Figure ${feeds.figureNumber}` : "Feeds no step of the main process yet";
    first.text(MARGIN, y + 10, text, { size: 10, bold: true });
    y += 20;
  }
  const noteU = noteUnit(noteLines(scope, style, ctx.notOn), contentW);
  let units: Unit[];
  let firstTop: number;
  let cols: number;
  let colGap = 12;
  if (style === "time_scale") {
    const bottom = drawTimeScale(first, scope, y);
    firstTop = TOP_NEXT;
    cols = 3;
    // Group the sample key by step; a hold's own samples follow the step they sit after.
    units = [];
    for (const s of scope.steps) {
      const colW = (contentW - colGap * (cols - 1)) / cols;
      const groups: { title: string; list: typeof scope.samples }[] = [{ title: s.label, list: scope.samples.filter((x) => x.stepId === s.id && !x.holdId) }];
      for (const h of scope.holds.filter((x) => x.hold.afterStepId === s.id)) groups.push({ title: h.hold.label, list: scope.samples.filter((x) => x.holdId === h.hold.id) });
      for (const g of groups) {
        if (!g.list.length) continue;
        units.push(headerUnit(g.title));
        for (const sm of g.list.filter((x) => !x.routine)) units.push(sampleCard(sm, { width: colW, focusable: false, interactive: ctx.interactive }));
        const r = routineUnit(g.list, colW);
        if (r) units.push(r);
      }
    }
    // Notes go under the timeline when they fit on that page; otherwise they open the key.
    const room = ctx.maxH - legendH - (units.length ? FOOTER_H : 4) - bottom - 6;
    if (noteU.h <= room) {
      noteU.draw(first, MARGIN, bottom + 4, contentW);
      first.height = bottom + 4 + noteU.h + 4;
    } else {
      first.height = bottom + 4;
      units.unshift(noteU);
    }
  } else {
    const strip = drawStrip(first, scope, y);
    cols = 2;
    const colW = (contentW - colGap) / 2;
    units = [noteU, ...stepCardUnits(scope, colW, ctx.interactive)];
    firstTop = strip.bottom + 2;
    first.height = firstTop;
  }

  // ---- pour the units into pages
  const colWidthFor = contentW;
  const fills: PageFill[] =
    style === "time_scale"
      ? units.length
        ? paginate(units, { cols, x0: MARGIN, width: colWidthFor, colGap, firstTop, otherTop: TOP_NEXT, limit })
        : []
      : paginate(units, { cols, x0: MARGIN, width: colWidthFor, colGap, firstTop, otherTop: TOP_NEXT, limit });

  // For style F the first canvas is the timeline page and the key starts on the next one; for E the first fill belongs to it.
  const pageFills: (PageFill | undefined)[] = style === "time_scale" ? [undefined, ...fills] : fills;
  while (canvases.length < pageFills.length) fresh();

  const total = pageFills.length || 1;
  const pages: FigurePage[] = [];
  for (let p = 0; p < total; p++) {
    const cv = canvases[p]!;
    const fill = pageFills[p];
    for (const pl of fill?.placed ?? []) pl.unit.draw(cv, pl.x, pl.y, pl.w);
    let bottom = p === 0 ? Math.max(first.height, fill?.bottom ?? 0) : (fill?.bottom ?? TOP_NEXT);
    if (p > 0) {
      cv.text(W / 2, 15, style === "time_scale" ? `Key to the pins, continued from page ${p}` : `Continued from page ${p}`, { size: 8.5, italic: true, anchor: "middle", fill: COLORS.muted });
      cv.line(MARGIN, 21, W - MARGIN, 21, COLORS.frame, 0.8, "4 3");
    }
    const more = p < total - 1;
    if (more) {
      bottom += 8;
      cv.line(MARGIN, bottom, W - MARGIN, bottom, COLORS.frame, 0.8, "4 3");
      const nextStarts = pageFills[p + 1]?.placed.find((x) => x.unit.starts)?.unit.starts;
      cv.text(W / 2, bottom + 14, `Continued on next page${nextStarts ? `, starting with ${nextStarts}` : ""}`, { size: 8.5, italic: true, anchor: "middle", fill: COLORS.muted });
      bottom += FOOTER_H;
    } else bottom += 4;
    drawLegend(cv, bottom, legend);
    cv.height = bottom + legendH;
    cv.raw(`<rect x="0.5" y="0.5" width="${W - 1}" height="${Math.round((cv.height - 1) * 100) / 100}" fill="none" stroke="${COLORS.frame}" stroke-width="1"/>`);
    const label = `${figureCaption({ number: ctx.number, caption, pages: new Array(total) } as Figure, p)}`;
    pages.push({
      svg: cv.svg(label, ctx.interactive ? "group" : "img"),
      width: W,
      height: Math.round(cv.height * 100) / 100,
      boxes: cv.boxes,
      minFontPt: cv.minFont === Number.POSITIVE_INFINITY ? MIN_FONT_PT : cv.minFont,
      samples: [...cv.samples].sort(),
      overflow: cv.height > ctx.maxH + 0.5,
    });
  }
  return {
    number: ctx.number,
    style,
    scopeId: scope.id,
    caption,
    pages,
    hoursNotGiven: style === "time_scale" ? scope.hoursNotGiven : [],
    alt: altText(scope, style, ctx.number),
    ...(feeds ? { feeds } : {}),
  };
}
