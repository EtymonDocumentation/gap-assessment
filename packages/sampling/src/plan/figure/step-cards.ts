import { Canvas, COLORS, hoursText, nbUnit, textWidth, wrap } from "./draw.js";
import { holdBoxUnit, routineUnit, sampleCard, stepHeaderUnit, UNIT_GAP, type Unit } from "./layout.js";
import { cmpText, type Scope } from "./model.js";

/**
 * Style E, "overview strip + step cards": one row (or two) of numbered step boxes with HOLD pills between them and the time targets
 * as ribbons, then the steps as cards in two columns. A card holds the step's settings, a "hold after this step" box, the PPQ samples
 * in full and the routine samples as one line. A step with no samples is one line.
 */

const PAD_X = 12;
const BADGE_R = 7.5;
const PILL_W = 40;
const ARROW = 7;

interface StripItem {
  kind: "step" | "pill";
  no?: number;
  label: string;
  stepId?: string;
  holdId?: string;
}

function stripItems(scope: Scope): StripItem[] {
  const items: StripItem[] = [];
  scope.steps.forEach((s, i) => {
    items.push({ kind: "step", no: i + 1, label: s.label, stepId: s.id });
    for (const h of scope.holds.filter((x) => x.hold.afterStepId === s.id)) {
      const t = h.hold.durationText?.trim() || (h.given ? hoursText(h.end - h.start) : "");
      items.push({ kind: "pill", label: nbUnit(t), holdId: h.hold.id, stepId: s.id });
    }
  });
  return items;
}

/** Fills rows left to right; returns the rows (each a list of items) for a step width. */
function rowsFor(items: StripItem[], stepW: number, width: number): StripItem[][] {
  const rows: StripItem[][] = [[]];
  let x = 0;
  for (const it of items) {
    const w = (it.kind === "step" ? stepW : PILL_W) + ARROW;
    // A pill never starts a row: it belongs to the step before it.
    if (x + w > width && rows[rows.length - 1]!.length && it.kind === "step") {
      rows.push([]);
      x = 0;
    }
    rows[rows.length - 1]!.push(it);
    x += w;
  }
  return rows;
}

/** Draws the overview strip (and the ribbons when it is a single row). Returns the bottom y and where each step box sits. */
export function drawStrip(cv: Canvas, scope: Scope, top: number): { bottom: number; ribbons: boolean } {
  const width = cv.width - 2 * PAD_X;
  const items = stripItems(scope);
  const minRows = rowsFor(items, 62, width).length;
  let stepW = 62;
  for (let w = 92; w >= 62; w -= 2) {
    if (rowsFor(items, w, width).length === minRows) {
      stepW = w;
      break;
    }
  }
  const rows = rowsFor(items, stepW, width);
  // Height of every box in a row = the tallest name.
  const nameLines = (it: StripItem) => wrap(it.label, 8, stepW - 6);
  let y = top;
  const pos = new Map<string, { x: number; w: number }>();
  for (const row of rows) {
    const lines = Math.max(2, ...row.filter((i) => i.kind === "step").map((i) => nameLines(i).length));
    const h = 22 + lines * 9.5 + 3;
    let x = PAD_X;
    row.forEach((it, idx) => {
      const last = idx === row.length - 1;
      if (it.kind === "step") {
        cv.rect(x, y, stepW, h, { fill: COLORS.step.fill, stroke: COLORS.step.stroke, sw: 1.4, rx: 4 });
        cv.circle(x + stepW / 2, y + 4 + BADGE_R, BADGE_R, { fill: COLORS.ink });
        cv.text(x + stepW / 2, y + 4 + BADGE_R + 3, String(it.no), { size: 8, bold: true, anchor: "middle", fill: "#ffffff" });
        nameLines(it).forEach((l, i) => cv.text(x + stepW / 2, y + 27 + i * 9.5, l, { size: 8, anchor: "middle" }));
        pos.set(it.stepId!, { x, w: stepW });
        cv.box({ kind: "step", id: it.stepId!, x, y, w: stepW, h });
        x += stepW;
      } else {
        cv.rect(x, y, PILL_W, h, { fill: COLORS.hold.fill, stroke: COLORS.hold.stroke, sw: 1.4, dash: "4 3", rx: 4 });
        cv.text(x + PILL_W / 2, y + 12, "HOLD", { size: 8, bold: true, anchor: "middle" });
        wrap(it.label, 8, PILL_W - 4, true).slice(0, 5).forEach((l, i) => cv.text(x + PILL_W / 2, y + 22 + i * 9.5, l, { size: 8, bold: true, anchor: "middle" }));
        cv.box({ kind: "hold", id: it.holdId!, x, y, w: PILL_W, h });
        x += PILL_W;
      }
      if (!last || rows.length > 1) {
        cv.poly([[x + 1, y + h / 2 - 4], [x + ARROW - 1, y + h / 2], [x + 1, y + h / 2 + 4]], { fill: COLORS.muted });
      }
      x += ARROW;
    });
    y += h + 8;
  }
  const single = rows.length === 1;
  let ribbons = false;
  if (single && scope.targets.length) {
    ribbons = true;
    const edge = (stepId: string, e: "start" | "end") => {
      const p = pos.get(stepId);
      return p ? (e === "start" ? p.x : p.x + p.w) : undefined;
    };
    for (const t of scope.targets) {
      const a = edge(t.fromStepId, t.fromEdge);
      const b = edge(t.toStepId, t.toEdge);
      if (a === undefined || b === undefined) continue;
      const x0 = Math.min(a, b);
      const w = Math.max(10, Math.abs(b - a));
      const text = `${t.label} ${cmpText(t.comparator)}\u00a0${hoursText(t.hours)}`;
      const need = textWidth(text, 8, true) + 8;
      cv.rect(x0, y, w, 14, { fill: COLORS.target.fill, stroke: COLORS.target.stroke, sw: 1, rx: 3 });
      if (need <= w) {
        cv.text(x0 + 4, y + 10.5, text, { size: 8, bold: true });
        cv.box({ kind: "target", id: t.id, x: x0, y, w, h: 14 });
      } else {
        // Too short for its words: the words follow the bar (or lead it, at the right edge).
        const right = x0 + w + 4 + need <= cv.width - PAD_X;
        const tx = right ? x0 + w + 4 : x0 - 4;
        cv.rect(right ? tx - 2 : tx - need + 2, y, need - 2, 14, { fill: COLORS.paper });
        cv.text(tx, y + 10.5, text, { size: 8, bold: true, anchor: right ? "start" : "end" });
        cv.box({ kind: "target", id: t.id, x: right ? x0 : x0 - need, y, w: right ? w + 4 + need : w + need, h: 14 });
      }
      y += 17;
    }
  }
  return { bottom: y, ribbons };
}

/** A step that carries no samples: its number and name, its settings, then "No samples at this step." each on a line of its own. */
function compactStep(no: number, name: string, settings: string[], width: number): Unit {
  const NONE = "No samples at this step.";
  const parts = (w: number) => ({ title: wrap(name, 8.5, w - 30, true), body: settings.flatMap((l) => wrap(nbUnit(l), 8.5, w - 30)) });
  const heightOf = (w: number) => {
    const p = parts(w);
    return Math.max(20, (p.title.length + p.body.length + 1) * 10.5 + 8);
  };
  return {
    h: heightOf(width),
    starts: name,
    draw(cv, x, y, w) {
      const p = parts(w);
      const h = heightOf(w);
      cv.rect(x, y, w, h, { fill: "#f4f3fb", stroke: COLORS.step.stroke, sw: 1, rx: 8 });
      cv.circle(x + 13, y + h / 2, BADGE_R, { fill: COLORS.ink });
      cv.text(x + 13, y + h / 2 + 3, String(no), { size: 8, bold: true, anchor: "middle", fill: "#ffffff" });
      let ty = y + 12.5;
      for (const l of p.title) {
        cv.text(x + 26, ty, l, { bold: true });
        ty += 10.5;
      }
      for (const l of p.body) {
        cv.text(x + 26, ty, l);
        ty += 10.5;
      }
      cv.text(x + 26, ty, NONE, { fill: COLORS.muted });
      cv.box({ kind: "card", id: `step:${no}`, x, y, w, h });
    },
  };
}

/** The step cards as units, in process order. `colW` is the width of one column. */
export function stepCardUnits(scope: Scope, colW: number, interactive: boolean): Unit[] {
  const units: Unit[] = [];
  scope.steps.forEach((step, i) => {
    const no = i + 1;
    const mine = scope.samples.filter((s) => s.stepId === step.id && !s.holdId);
    const lines = (step.figureText ?? []).map(nbUnit);
    const cards = (list: typeof mine) => list.filter((s) => !s.routine).map((s) => sampleCard(s, { width: colW, focusable: interactive, interactive }));
    if (!mine.length) units.push(compactStep(no, step.label, lines, colW));
    else {
      units.push(stepHeaderUnit(no, step.label, lines, colW));
      units.push(...cards(mine));
      const r = routineUnit(mine, colW);
      if (r) units.push(r);
    }
    for (const h of scope.holds.filter((x) => x.hold.afterStepId === step.id)) {
      const dur = h.hold.durationText?.trim() || (h.given ? hoursText(h.end - h.start) : "");
      const text = [`${h.hold.label}:`, dur, h.hold.condition?.trim() ? `at ${h.hold.condition.trim()}` : ""].filter(Boolean).join(" ");
      units.push(holdBoxUnit("HOLD AFTER THIS STEP", nbUnit(text), colW));
      const onHold = scope.samples.filter((s) => s.holdId === h.hold.id);
      units.push(...cards(onHold));
      const r = routineUnit(onHold, colW);
      if (r) units.push(r);
    }
  });
  void UNIT_GAP;
  return units;
}
