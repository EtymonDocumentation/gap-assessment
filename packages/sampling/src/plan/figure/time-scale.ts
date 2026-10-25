import { Canvas, COLORS, hoursText, nbUnit, packRows, hasOverlongWord, textWidth, wrap, type PackItem } from "./draw.js";
import { cmpText, type Scope, type SampleView } from "./model.js";

/**
 * Style F, "time scale": the PPQ run drawn against hours. Steps on one lane, holds on the next, the time targets as dashed vertical
 * lines with a diamond label, and every sample as a pin at the hour it is taken. All positions come from the plan's own hours; a step
 * or hold without hours is drawn as a fixed narrow block (it adds no time) and listed under "Hours not given".
 *
 * The scale is in points: the page is `cv.width` wide and Word prints it at that width, so every font here is its printed size.
 */

const LABEL_W = 86;
const X0 = LABEL_W + 8;
const TICK = 24;
const MIN_BLOCK = 6;
const NARROW = 12;
const LANE_H = 38;
const HOLD_H = 46;
const ROW_H = 11;
const TARGET_ROW = 18;
const PIN_R = 8;
const PIN_STEP = 17;
const BOX_H = 22;
const BOX_ROW = 25;
/** Pins closer than this many hours share one box. */
export const PIN_CLUSTER_HOURS = 10;
const MAX_PINS_PER_BOX = 8;
/**
 * Clear space (figure units, about 1.5 mm at print size) between an outside label's patch edge and a dashed time-limit line.
 * Why: on a printed figure a text edge that touches or nearly touches a time-limit line reads as joined to it, and a reader could
 * take the label as belonging to the limit. A line is either clear of the label by this gap or well inside the label's patch.
 */
export const LABEL_LINE_GAP = 6;

export interface PinCluster {
  samples: SampleView[];
}

/** Groups samples taken within PIN_CLUSTER_HOURS of the first one in the group; a group is cut into boxes of at most 8 pins. */
export function clusterPins(samples: SampleView[]): PinCluster[] {
  const withHour = samples.filter((s) => s.hour !== undefined).sort((a, b) => a.hour! - b.hour! || a.id.localeCompare(b.id));
  const out: PinCluster[] = [];
  let group: SampleView[] = [];
  const flush = () => {
    for (let i = 0; i < group.length; i += MAX_PINS_PER_BOX) out.push({ samples: group.slice(i, i + MAX_PINS_PER_BOX) });
    group = [];
  };
  for (const s of withHour) {
    if (group.length && s.hour! - group[0]!.hour! > PIN_CLUSTER_HOURS) flush();
    group.push(s);
  }
  flush();
  return out;
}

interface Axis {
  min: number;
  max: number;
  x: (h: number) => number;
  scale: number;
  x1: number;
}

function axisFor(scope: Scope, width: number): Axis {
  const times: number[] = [0];
  for (const t of scope.steps_time.values()) times.push(t.start, t.end);
  for (const h of scope.holds) times.push(h.start, h.end);
  for (const t of scope.targets) times.push(t.fromHour, t.toHour);
  for (const s of scope.samples) if (s.hour !== undefined) times.push(s.hour);
  let min = Math.floor(Math.min(...times) / TICK) * TICK;
  let max = Math.ceil(Math.max(...times) / TICK) * TICK;
  if (max - min < TICK) max = min + TICK;
  const x1 = width - 18;
  const scale = (x1 - X0) / (max - min);
  void min;
  min = Math.min(min, 0);
  return { min, max, scale, x1, x: (h) => X0 + (h - min) * scale };
}

interface BlockLabel {
  lines: { text: string; bold?: boolean }[];
  inside: boolean;
}

/** Gap kept on each side of a block so neighbours read as separate boxes; blocks too narrow for it are drawn at full width. */
const BLOCK_GAP = 1.5;
const inner = (w: number): number => (w >= 3 * BLOCK_GAP + 8 ? w - 2 * BLOCK_GAP : w);

/** Decides whether a block's text fits inside it (at most 3 short lines); otherwise it is written outside with a leader. */
function blockText(name: string, detail: string | undefined, w: number, maxLines: number): BlockLabel {
  const room = w - 3; // w is the drawn (inset) width
  const nameLines = wrap(name, 8.5, room, true);
  const rest = detail ? wrap(detail, 8.5, room) : [];
  const lines = [...nameLines.map((text) => ({ text, bold: true })), ...rest.map((text) => ({ text }))];
  // wrap() never drops text: a word wider than the block is chopped into pieces that each fit ("Post-filtratio" / "n hold"). A split
  // word misreads on a printed GMP figure, so such a block gets its label outside with a leader instead. Hyphens are not break
  // opportunities (a hyphenated name is one word), so "Post-filtration" moves outside rather than wrapping after the hyphen.
  const cutWord = hasOverlongWord(name, 8.5, room, true) || (detail !== undefined && hasOverlongWord(detail, 8.5, room));
  // Kept from before: a line whose bold width exceeds the room also sends the label outside (a strict, harmless extra margin for the
  // regular-weight detail lines), so this fix only adds outside labels and never moves one back inside.
  const wideLine = [...nameLines, ...rest].some((l) => textWidth(l, 8.5, true) > room);
  const brokenWord = cutWord || wideLine;
  return { lines, inside: room >= 28 && !brokenWord && lines.length <= maxLines };
}

/**
 * Draws the timeline into `cv` from `top`. Returns the y of the bottom of what it drew. Label boxes are recorded with `cv.box` so a
 * test can check that nothing overlaps.
 */
export function drawTimeScale(cv: Canvas, scope: Scope, top: number): number {
  const W = cv.width;
  // Dashed target lines are drawn over the lanes; every label gets a thin white halo so no line runs through a letter.
  cv.haloDefault = COLORS.paper;
  const ax = axisFor(scope, W);
  let y = top;

  // ---- time targets (top band): dashed line to the axis, diamond and label, span arrow when it does not start at zero
  const targets = scope.targets.map((t) => {
    const xTo = ax.x(t.toHour);
    const xFrom = ax.x(t.fromHour);
    const arrow = Math.abs(t.fromHour) > 0.5;
    const text = `${t.label} ${cmpText(t.comparator)}\u00a0${hoursText(t.hours)}`;
    const w = textWidth(text, 8.5, true);
    const left = xTo - w - 16 >= 4;
    const x0 = left ? xTo - w - 16 : xTo - 6;
    const x1 = left ? xTo + 8 : xTo + 16 + w;
    return { t, xTo, xFrom, arrow, text, w, left, x0: arrow ? Math.min(x0, xFrom - 2) : x0, x1: arrow ? Math.max(x1, xFrom + 2) : x1 };
  });
  targets.sort((a, b) => a.xTo - b.xTo);
  // Labels run to the left of their line, so the rightmost goes in first (top row) and the next ones sit below it.
  const byX = (items: { x: number }[], desc: boolean) => items.map((_, i) => i).sort((a, b) => (desc ? items[b]!.x - items[a]!.x : items[a]!.x - items[b]!.x));
  const tRows = packRows(
    targets.map((t) => ({ x0: t.x0, x1: t.x1, leaders: t.arrow ? [t.xTo, t.xFrom] : [t.xTo] })),
    "higher",
    4,
    byX(targets.map((t) => ({ x: t.xTo })), true),
  );
  const tRowCount = targets.length ? Math.max(...tRows) + 1 : 0;
  const targetsTop = y;
  y += tRowCount * TARGET_ROW + (tRowCount ? 4 : 0);

  // ---- step labels that do not fit inside their block
  const blockers = scope.targets.flatMap((t) => (Math.abs(t.fromHour) > 0.5 ? [ax.x(t.toHour), ax.x(t.fromHour)] : [ax.x(t.toHour)]));
  interface Mark {
    id: string;
    x: number;
    w: number;
    name: string;
    detail?: string;
    given: boolean;
    kind: "step" | "hold";
    lab: BlockLabel;
  }
  const stepMarks: Mark[] = scope.steps.map((s) => {
    const t = scope.steps_time.get(s.id)!;
    const x = ax.x(t.start);
    const w = t.given ? Math.max(MIN_BLOCK, (t.end - t.start) * ax.scale) : NARROW;
    const detail = t.given ? hoursText(t.end - t.start) : undefined;
    return { id: s.id, x, w, name: s.label, detail, given: t.given, kind: "step" as const, lab: blockText(s.label, detail, inner(w), 3) };
  });
  const holdMarks: Mark[] = scope.holds.map((h) => {
    const x = ax.x(h.start);
    const w = h.given ? Math.max(MIN_BLOCK, (h.end - h.start) * ax.scale) : NARROW;
    const detail = nbUnit([h.hold.durationText?.trim() || (h.given ? hoursText(h.end - h.start) : ""), h.hold.condition?.trim() ? `at ${h.hold.condition.trim()}` : ""].filter(Boolean).join(" "));
    return { id: h.hold.id, x, w, name: h.hold.label, detail: detail || undefined, given: h.given, kind: "hold" as const, lab: blockText(h.hold.label, detail || undefined, inner(w), 4) };
  });

  const outside = (marks: Mark[]) => marks.filter((m) => !m.lab.inside);
  /** Outside label geometry: text starts at the leader, or ends at it when it would run off the page; tries both sides around target lines. */
  const placeLabel = (m: Mark) => {
    // The leader may attach anywhere along the top of its block (the drawn rectangle, not the gap between neighbours). It sits at the
    // centre unless a target line is within LABEL_LINE_GAP of it; then it moves to the spot in the block farthest from every line, so
    // a leader and a dashed line never read as one double line.
    const g = (m.w - inner(m.w)) / 2;
    const near = (x: number) => Math.min(LABEL_LINE_GAP, ...blockers.map((bx) => Math.abs(bx - x)));
    const mid = m.x + m.w / 2;
    let cx = mid;
    if (near(mid) < LABEL_LINE_GAP) {
      let best = near(mid);
      for (let x = m.x + g; x <= m.x + m.w - g + 0.001; x += 0.5) {
        const sc = near(x);
        if (sc > best + 0.001 || (sc > near(mid) && Math.abs(sc - best) <= 0.001 && Math.abs(x - mid) < Math.abs(cx - mid))) { best = sc; cx = x; }
      }
    }
    const text = m.detail ? `${m.name} ${m.detail}` : m.name;
    const w = textWidth(text, 8.5, true) * 0.95 + 4;
    const startExt: [number, number] = [cx - 2, cx + w];
    const endExt: [number, number] = [cx - w, cx + 2];
    const fitsRight = startExt[1] <= W - 4;
    const fitsLeft = endExt[0] >= 4;
    const others = blockers.filter((bx) => Math.abs(bx - cx) > 1.5);
    // A label may cross a target line (the paper patch breaks the line behind it) but its text must never begin or end next to one:
    // an edge within LABEL_LINE_GAP of a line is pushed out past the line, so the line sits well inside the patch.
    const clear = (e: [number, number]) => {
      let [a, b] = e;
      for (let n = 0; n < others.length + 2; n++) {
        let moved = false;
        for (const bx of others) {
          if (bx > a - LABEL_LINE_GAP && bx < a + LABEL_LINE_GAP) { a = bx - LABEL_LINE_GAP; moved = true; }
          if (bx > b - LABEL_LINE_GAP && bx < b + LABEL_LINE_GAP) { b = bx + LABEL_LINE_GAP; moved = true; }
        }
        if (!moved) break;
      }
      return { ext: [a, b] as [number, number], crosses: others.some((bx) => bx >= a && bx <= b) };
    };
    const right = clear(startExt);
    const left = clear(endExt);
    // Cost: off the page is worst; a side that crosses no line beats one that crosses some (as before). Widening the patch to keep
    // the gap costs nothing visible (the text does not move), so it does not make a side worse: the label stays to the right of its
    // leader unless the left is genuinely clear, and the usual layout and row count only change when they have to.
    const cost = (c: ReturnType<typeof clear>) => (c.ext[0] < 4 || c.ext[1] > W - 4 ? 1e6 : 0) + (c.crosses ? 1000 : 0);
    let useStart = fitsRight;
    if (fitsRight && fitsLeft && cost(left) < cost(right)) useStart = false;
    if (!fitsRight) useStart = false;
    const pick = useStart ? right : left;
    // The text stays flush with its leader whatever the patch width: it starts at the leader, or (end-anchored, because the width here
    // is a generous estimate) ends exactly at it. Widening only ever grows the background patch.
    return { m, cx, text, w, start: useStart, ext: pick.ext, tx: cx };
  };
  const stepOut = outside(stepMarks).map(placeLabel);
  const labelOrder = (ls: ReturnType<typeof placeLabel>[]) => [...ls.keys()].sort((a, b) => (ls[a]!.start === ls[b]!.start ? (ls[a]!.start ? ls[b]!.cx - ls[a]!.cx : ls[a]!.cx - ls[b]!.cx) : ls[a]!.start ? 1 : -1));
  const stepRows = packRows(stepOut.map((l) => ({ x0: l.ext[0], x1: l.ext[1], leaders: [l.cx] })), "lower", 4, labelOrder(stepOut), 2);
  const stepRowCount = stepOut.length ? Math.max(...stepRows) + 1 : 0;
  y += stepRowCount * ROW_H + (stepRowCount ? 4 : 0);

  // ---- lanes
  const lanesTop = y;
  const stepsY = y;
  const holdsY = stepsY + LANE_H + 6;
  cv.rect(X0 - 4, stepsY, ax.x1 - X0 + 8, LANE_H, { fill: COLORS.band });
  cv.rect(X0 - 4, holdsY, ax.x1 - X0 + 8, HOLD_H, { fill: COLORS.band });
  cv.text(8, stepsY + LANE_H / 2 + 3, "Steps", { size: 9, bold: true });
  cv.text(8, holdsY + HOLD_H / 2 + 3, "Holds", { size: 9, bold: true });

  // Text is drawn after the dashed target lines (see `late`), each line on a background patch, so a line breaks behind a label instead of running through it.
  const late: (() => void)[] = [];
  const drawBlock = (m: Mark, yy: number, h: number) => {
    const isHold = m.kind === "hold";
    const c = isHold ? COLORS.hold : COLORS.step;
    // Neighbouring blocks touch in time, so each is drawn a little inside its span: a clear gap shows where one ends and the next begins.
    const g = (m.w - inner(m.w)) / 2;
    cv.rect(m.x + g, yy, m.w - 2 * g, h, { fill: c.fill, stroke: c.stroke, sw: 1.3, dash: isHold ? "4 3" : m.given ? undefined : "2 1.5", rx: 1 });
    if (m.lab.inside) {
      const total = m.lab.lines.length * 10;
      const top = yy + (h - total) / 2 + 8;
      late.push(() => {
        let ty = top;
        for (const l of m.lab.lines) {
          const tw = textWidth(l.text, 8.5, l.bold) + 2;
          cv.rect(m.x + m.w / 2 - tw / 2, ty - 8, tw, 10, { fill: c.fill });
          cv.text(m.x + m.w / 2, ty, l.text, { size: 8.5, bold: l.bold, anchor: "middle", halo: c.fill });
          ty += 10;
        }
      });
      cv.box({ kind: m.kind, id: m.id, x: m.x + g + 2, y: yy + (h - total) / 2, w: m.w - 2 * g - 4, h: total });
    } else {
      cv.box({ kind: m.kind, id: m.id, x: m.x, y: yy, w: m.w, h });
    }
  };
  for (const m of stepMarks) drawBlock(m, stepsY, LANE_H);
  for (const m of holdMarks) drawBlock(m, holdsY, HOLD_H);

  // outside step labels, above the lane (row 0 nearest)
  const drawOutside = (labels: ReturnType<typeof placeLabel>[], rows: number[], baseY: number, dir: 1 | -1, laneEdge: number) => {
    labels.forEach((l, i) => late.push(() => {
      const r = rows[i]!;
      const ty = dir === -1 ? baseY - r * ROW_H - 3 : baseY + r * ROW_H + 9;
      cv.rect(l.ext[0], ty - 8.5, l.ext[1] - l.ext[0], 11, { fill: COLORS.paper });
      cv.line(l.cx, laneEdge, l.cx, dir === -1 ? ty + 2 : ty - 9, COLORS.ink, 0.8);
      const full = l.m.detail ? ([l.m.name, ` ${l.m.detail}`] as const) : ([l.m.name, ""] as const);
      cv.textLead(l.tx, ty, full[0], full[1], { size: 8.5, anchor: l.start ? "start" : "end" });
      cv.box({ kind: l.m.kind, id: l.m.id, x: l.ext[0], y: ty - 8.5, w: l.ext[1] - l.ext[0], h: 11 });
    }));
  };
  drawOutside(stepOut, stepRows, stepsY, -1, stepsY);

  // hold labels below the hold lane
  const holdOut = outside(holdMarks).map(placeLabel);
  const holdRows = packRows(holdOut.map((l) => ({ x0: l.ext[0], x1: l.ext[1], leaders: [l.cx] })), "lower", 4, labelOrder(holdOut), 2);
  const holdRowCount = holdOut.length ? Math.max(...holdRows) + 1 : 0;
  drawOutside(holdOut, holdRows, holdsY + HOLD_H, 1, holdsY + HOLD_H);
  y = holdsY + HOLD_H + holdRowCount * ROW_H + (holdRowCount ? 8 : 4);

  // ---- axis, ticks, pin triangles
  const axisY = y + 10;
  cv.line(X0 - 4, axisY, ax.x1 + 4, axisY, COLORS.ink, 1.5);
  const zeroLines = wrap(scope.zeroText, 8.5, LABEL_W - 4, true);
  cv.lines(8, axisY - 3 - (zeroLines.length - 1) * 0, zeroLines, { size: 8.5, bold: true, lh: 10 });
  for (let h = ax.min; h <= ax.max + 0.001; h += TICK) {
    const x = ax.x(h);
    cv.line(x, axisY, x, axisY + 4, COLORS.ink, 1);
    cv.text(x, axisY + 14, String(h), { size: 8.5, anchor: "middle" });
  }
  const pinned = scope.samples.filter((s) => s.hour !== undefined);
  for (const s of pinned) {
    const x = ax.x(s.hour!);
    cv.poly([[x - 3.5, axisY - 1], [x + 3.5, axisY - 1], [x, axisY - 8]], { fill: COLORS.ink });
  }

  // ---- target lines drawn last among the background marks so they run over lanes and under the labels
  targets.forEach((t, i) => {
    const rowY = targetsTop + tRows[i]! * TARGET_ROW;
    cv.line(t.xTo, rowY + 11, t.xTo, axisY, COLORS.target.stroke, 1.2, "4 3");
    if (t.arrow) {
      cv.line(t.xFrom, rowY + 11, t.xFrom, axisY, COLORS.target.stroke, 1.2, "4 3");
      const ay = rowY + 4;
      cv.line(t.xFrom, ay, t.xTo, ay, COLORS.target.stroke, 1.3);
      cv.poly([[t.xFrom, ay], [t.xFrom + 5, ay - 3], [t.xFrom + 5, ay + 3]], { fill: COLORS.target.stroke });
      cv.poly([[t.xTo, ay], [t.xTo - 5, ay - 3], [t.xTo - 5, ay + 3]], { fill: COLORS.target.stroke });
    }
    cv.poly([[t.xTo, rowY + 5.5], [t.xTo + 6, rowY + 11], [t.xTo, rowY + 16.5], [t.xTo - 6, rowY + 11]], { fill: COLORS.target.fill, stroke: COLORS.target.stroke, sw: 1.2 });
    const lx = t.left ? t.xTo - 10 : t.xTo + 10;
    cv.rect(t.left ? lx - t.w - 2 : lx - 2, rowY + 5, t.w + 4, 12, { fill: COLORS.paper });
    cv.text(lx, rowY + 15, t.text, { size: 8.5, bold: true, anchor: t.left ? "end" : "start" });
    cv.box({ kind: "target", id: t.t.id, x: t.x0, y: rowY + 1, w: t.x1 - t.x0, h: 17 });
  });
  for (const f of late) f();

  // ---- sample boxes below the axis
  const clusters = clusterPins(scope.samples);
  const boxes = clusters.map((c) => {
    const w = c.samples.length * PIN_STEP + 6;
    const xs = c.samples.map((s) => ax.x(s.hour!));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const bx = Math.max(4, Math.min(W - 4 - w, mean - w / 2));
    return { c, w, bx, xs };
  });
  const bRows = packRows(boxes.map((b) => ({ x0: b.bx, x1: b.bx + b.w, leaders: b.xs })), "lower", 3, undefined, 1);
  const bRowCount = boxes.length ? Math.max(...bRows) + 1 : 0;
  const boxTop = axisY + 22;
  // The long "Hours since ..." label runs several lines down the left margin; keep the Samples label clear of its last line.
  const samplesY = Math.max(boxTop + 11, axisY + 7 + (zeroLines.length - 1) * 10 + 13);
  if (boxes.length) {
    cv.text(8, samplesY, "Samples", { size: 9, bold: true });
    cv.text(8, samplesY + 10, "(number = SP no.)", { size: 8.5 });
  }
  boxes.forEach((b, i) => {
    const by = boxTop + bRows[i]! * BOX_ROW;
    b.c.samples.forEach((s, k) => {
      const cx = b.bx + 3 + PIN_STEP / 2 + k * PIN_STEP;
      // Straight down from the pin, then a short slant into the box, so leaders cross as little as possible.
      const bend = by - 5;
      cv.raw(`<polyline points="${b.xs[k]},${axisY} ${b.xs[k]},${bend} ${cx},${by}" fill="none" stroke="${COLORS.muted}" stroke-width="0.7"/>`);
    });
    cv.rect(b.bx, by, b.w, BOX_H, { fill: COLORS.paper, stroke: COLORS.muted, sw: 1, rx: 4 });
    b.c.samples.forEach((s, k) => {
      const cx = b.bx + 3 + PIN_STEP / 2 + k * PIN_STEP;
      const cy = by + BOX_H / 2;
      cv.group({ sp: s.id, label: `${s.id}: ${s.test}, hour ${Math.round(s.hour! * 100) / 100}`, focusable: true });
      if (s.routine) {
        cv.rect(cx - 7, cy - 7, 14, 14, { fill: COLORS.routine.fill, stroke: COLORS.routine.stroke, sw: 1.3, dash: "2.5 1.5" });
      } else {
        cv.circle(cx, cy, PIN_R, { fill: COLORS.ppq.fill, stroke: COLORS.ppq.stroke, sw: 1.4 });
      }
      cv.text(cx, cy + 3, s.num, { size: 8, bold: true, anchor: "middle", halo: s.routine ? COLORS.routine.fill : COLORS.ppq.fill });
      cv.end();
    });
    cv.box({ kind: "pins", id: b.c.samples.map((s) => s.id).join(","), x: b.bx, y: by, w: b.w, h: BOX_H });
  });
  void lanesTop;
  cv.haloDefault = undefined;
  return Math.max(boxTop + (bRowCount ? (bRowCount - 1) * BOX_ROW + BOX_H : 22), boxes.length ? samplesY + 12 : 0) + 6;
}
