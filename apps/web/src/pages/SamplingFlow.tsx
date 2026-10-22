import { setPointFlow } from "@gap/engine";
import type { FlowPosition, PointFlow, SamplingPlan, SamplingPoint, SamplingType } from "@gap/process-model";
import {
  NOT_ON_DIAGRAM,
  SLOT_LABEL,
  SLOT_ORDER,
  TYPE_CODE,
  TYPE_LABEL,
  markerShape,
  placementText,
  pointsAt,
  stepOf,
  trayPoints,
  typeCode,
  type MarkerShape,
  type SlotKey,
} from "@gap/sampling";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "../store";

/*
 * The process flow diagram of a sampling plan.
 *
 * Design notes (the why):
 *  - ONE STORE. The diagram never keeps its own copy of where a sample is. It draws plan.steps and point.flow from the project in the
 *    store, and every move goes through the engine function setPointFlow, which change-logs it. The points table reads the same
 *    data, so the two cannot disagree and an edit in either one shows in the other at once. Only throw-away interaction state (a
 *    drag in progress, the place a keyboard user is hovering) lives here.
 *  - POINTER EVENTS. Dragging uses pointer events (mouse, touch and pen with one code path), not the HTML5 drag-and-drop API, which
 *    does not work on touch screens. Markers set touch-action: none so a finger drags the marker instead of scrolling the page.
 *    Drop targets are found by geometry (the layout already knows every slot rectangle), so the ghost marker under the pointer
 *    never hides the target.
 *  - KEYBOARD MODEL (the same moves without a pointer): Enter or Space on a marker picks it up; the arrow keys step through the
 *    places in diagram order (each step: before, during, after, position not set; the tray last); Enter drops; Escape cancels.
 *    Every change is announced in a polite live region ("Picked up SP-007", "Sterile filtration, after").
 *  - NOTHING IS ONLY COLOUR. A marker is a shape plus its id plus a type code; the legend explains them. A selected marker has a
 *    thicker double outline and aria-current. A drop target is outlined with a dashed line AND says "drop here" in words.
 *  - "Position not set" and "Not on the diagram" are normal places, not problems. Nothing is highlighted as missing.
 *  - LAYOUT. On a wide screen the boxes snake (left to right, then right to left on the next row) so the whole flow stays in view;
 *    on a phone it is one vertical column. The column count follows the container width, so there is never a sideways page scroll.
 */

// ------------------------------------------------------------------ places a sample can go

export type FlowTarget = { kind: "slot"; stepId: string; slot: SlotKey } | { kind: "tray" };

/** The flow stored for a target. "Position not set" keeps the step and drops the position; the tray removes the flow. */
export function flowForTarget(t: FlowTarget): PointFlow | null {
  if (t.kind === "tray") return null;
  return t.slot === "unset" ? { stepId: t.stepId } : { stepId: t.stepId, at: t.slot as FlowPosition };
}

/** Where a point is now, as a target (a flow naming a step the plan no longer has counts as the tray). */
export function targetOf(plan: SamplingPlan, p: SamplingPoint): FlowTarget {
  const step = stepOf(plan, p);
  return step ? { kind: "slot", stepId: step.id, slot: p.flow!.at ?? "unset" } : { kind: "tray" };
}

export const sameTarget = (a: FlowTarget, b: FlowTarget): boolean => (a.kind === "tray" ? b.kind === "tray" : b.kind === "slot" && a.stepId === b.stepId && a.slot === b.slot);

export type Run = (fn: Parameters<ReturnType<typeof useStore.getState>["update"]>[0], status: string) => boolean;

/** Moves one point to a target. The one place the diagram, the table and the keyboard all call. Returns false when the engine refused. */
export function movePoint(run: Run, plan: SamplingPlan, pointId: string, target: FlowTarget): boolean {
  return run((p, actor) => setPointFlow(p, plan.id, pointId, flowForTarget(target), actor), `Point ${pointId} moved`);
}

/**
 * The hook behind every "add" control ("+" on a box, "Add a sample" under the table, the add buttons of the interview). The page
 * decides what it opens: the short form or the step-by-step wizard (SamplingAdd.tsx). Every field of the target is only a starting
 * value for the form; `unitOp` is the catalog step an interview section stands for, used when the sample is not put on the diagram.
 */
export type OpenAdd = (target: { stepId?: string; at?: FlowPosition; unitOp?: string; type?: SamplingType }) => void;

// ------------------------------------------------------------------ layout (pure)

const BOX_W = 252;
const GAP_X = 44;
const GAP_Y = 44;
const PAD = 10;
const MARK_W = 96;
const MARK_H = 30;
const MARK_GAP = 6;
const LINE_H = 16;
const SLOT_LABEL_H = 18;

interface LaidMarker {
  point: SamplingPoint;
  x: number;
  y: number;
}
interface LaidSlot {
  key: string;
  target: FlowTarget;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  markers: LaidMarker[];
}
interface LaidBox {
  stepId: string;
  index: number;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  slots: LaidSlot[];
}
interface Layout {
  width: number;
  height: number;
  boxes: LaidBox[];
  tray: LaidSlot;
  arrows: string[];
  /** Every drop place in keyboard order. */
  targets: LaidSlot[];
  markers: LaidMarker[];
}

function wrapLabel(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.slice(0, 3).map((l, i, all) => (i === all.length - 1 && out.length > 3 ? `${l}...` : l));
}

/** Places markers in rows inside a rectangle that starts at (x, y) and is `w` wide. Returns the height the markers need. */
function flowMarkers(points: SamplingPoint[], x: number, y: number, w: number): { markers: LaidMarker[]; h: number } {
  const per = Math.max(1, Math.floor((w + MARK_GAP) / (MARK_W + MARK_GAP)));
  const markers = points.map((point, i) => ({ point, x: x + (i % per) * (MARK_W + MARK_GAP), y: y + Math.floor(i / per) * (MARK_H + MARK_GAP) }));
  return { markers, h: points.length ? Math.ceil(points.length / per) * (MARK_H + MARK_GAP) - MARK_GAP : 0 };
}

export function placeLabel(plan: SamplingPlan, t: FlowTarget): string {
  if (t.kind === "tray") return NOT_ON_DIAGRAM;
  const step = plan.steps.find((s) => s.id === t.stepId);
  return `${step?.label ?? t.stepId}, ${t.slot === "unset" ? "position not set" : t.slot}`;
}

export function layoutFlow(plan: SamplingPlan, cols: number): Layout {
  const width = cols * BOX_W + (cols - 1) * GAP_X;
  // First measure every box (its height depends on the markers it holds), then place the rows.
  const measured = plan.steps.map((step, index) => {
    const lines = wrapLabel(step.label, 24);
    const head = 12 + lines.length * LINE_H + 10;
    const slotHeights = SLOT_ORDER.map((slot) => {
      const n = pointsAt(plan, step.id, slot).length;
      const inner = flowMarkers(new Array(n).fill(null), 0, 0, BOX_W - 2 * PAD).h;
      return SLOT_LABEL_H + (n ? inner + 6 : 10);
    });
    return { step, index, lines, head, slotHeights, h: head + slotHeights.reduce((a, b) => a + b, 0) + PAD };
  });
  const rows = Math.ceil(measured.length / cols);
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(...measured.slice(r * cols, r * cols + cols).map((m) => m.h)));
  const rowTop: number[] = [];
  rowH.reduce((top, h, r) => ((rowTop[r] = top), top + h + GAP_Y), 0);

  const boxes: LaidBox[] = measured.map((m) => {
    const r = Math.floor(m.index / cols);
    const c0 = m.index % cols;
    // Snake: odd rows run right to left, so the arrow after the last box of a row drops straight down.
    const c = cols === 1 || r % 2 === 0 ? c0 : cols - 1 - c0;
    const x = c * (BOX_W + GAP_X);
    const y = rowTop[r]!;
    let sy = y + m.head;
    const slots = SLOT_ORDER.map((slot, si): LaidSlot => {
      const h = m.slotHeights[si]!;
      const target: FlowTarget = { kind: "slot", stepId: m.step.id, slot };
      const laid = flowMarkers(pointsAt(plan, m.step.id, slot), x + PAD, sy + SLOT_LABEL_H, BOX_W - 2 * PAD);
      const s: LaidSlot = { key: `${m.step.id}:${slot}`, target, label: placeLabel(plan, target), x: x + 4, y: sy, w: BOX_W - 8, h, markers: laid.markers };
      sy += h;
      return s;
    });
    return { stepId: m.step.id, index: m.index, lines: m.lines, x, y, w: BOX_W, h: rowH[r]!, slots };
  });

  const arrows: string[] = [];
  for (let i = 0; i + 1 < boxes.length; i++) {
    const a = boxes[i]!;
    const b = boxes[i + 1]!;
    if (Math.abs(a.y - b.y) < 1) {
      const y = a.y + 24;
      arrows.push(b.x > a.x ? `M ${a.x + a.w} ${y} L ${b.x - 2} ${y}` : `M ${a.x} ${y} L ${b.x + b.w + 2} ${y}`);
    } else {
      arrows.push(`M ${a.x + a.w / 2} ${a.y + a.h} L ${b.x + b.w / 2} ${b.y - 2}`);
    }
  }

  // The tray spans the whole width under the last row.
  const trayTop = (rows ? rowTop[rows - 1]! + rowH[rows - 1]! + GAP_Y : 0) + 0;
  const trayPts = trayPoints(plan);
  const trayInner = flowMarkers(trayPts, PAD, trayTop + 30, width - 2 * PAD);
  const trayH = Math.max(66, 30 + trayInner.h + PAD + 6);
  const tray: LaidSlot = { key: "tray", target: { kind: "tray" }, label: NOT_ON_DIAGRAM, x: 0, y: trayTop, w: width, h: trayH, markers: trayInner.markers };

  const targets = [...boxes.flatMap((b) => b.slots), tray];
  const markers = targets.flatMap((t) => t.markers);
  return { width, height: trayTop + trayH + 4, boxes, tray, arrows, targets, markers };
}

// ------------------------------------------------------------------ shapes

function Glyph({ shape, cx, cy }: { shape: MarkerShape; cx: number; cy: number }) {
  const r = 8;
  switch (shape) {
    case "circle":
      return <circle className="flow-glyph" cx={cx} cy={cy} r={r} />;
    case "square":
      return <rect className="flow-glyph" x={cx - r + 1} y={cy - r + 1} width={2 * r - 2} height={2 * r - 2} />;
    case "diamond":
      return <polygon className="flow-glyph" points={`${cx},${cy - r - 1} ${cx + r + 1},${cy} ${cx},${cy + r + 1} ${cx - r - 1},${cy}`} />;
    case "triangle":
      return <polygon className="flow-glyph" points={`${cx},${cy - r} ${cx + r + 1},${cy + r - 1} ${cx - r - 1},${cy + r - 1}`} />;
  }
}

// ------------------------------------------------------------------ the diagram

export function FlowDiagram({
  plan,
  selectedId,
  onSelect,
  run,
  openAdd,
}: {
  plan: SamplingPlan;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  run: Run;
  openAdd: OpenAdd;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [wrapWidth, setWrapWidth] = useState(1000);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWrapWidth(Math.round(el.clientWidth) || 1000);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWrapWidth(Math.round(el.clientWidth) || 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.min(Math.max(plan.steps.length, 1), Math.floor((wrapWidth + GAP_X) / (BOX_W + GAP_X))));
  const layout = useMemo(() => layoutFlow(plan, cols), [plan, cols]);
  const byId = useMemo(() => new Map(plan.points.map((p) => [p.id, p])), [plan.points]);

  // Interaction state only: a pointer drag in progress, and a keyboard "carry".
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const [carry, setCarry] = useState<{ id: string; at: number } | null>(null);
  const [said, setSaid] = useState("");
  const suppressClick = useRef(false);
  // After a keyboard drop the marker may be re-created in its new place; put focus back on it so the user keeps their place.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!refocus.current) return;
    svgRef.current?.querySelector<SVGElement>(`[data-testid="marker-${refocus.current}"]`)?.focus();
    refocus.current = null;
  });

  const toSvg = (cx: number, cy: number): { x: number; y: number } => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const r = pt.matrixTransform(m.inverse());
    return { x: r.x, y: r.y };
  };
  const hit = (pt: { x: number; y: number }): LaidSlot | undefined => layout.targets.find((t) => pt.x >= t.x && pt.x <= t.x + t.w && pt.y >= t.y && pt.y <= t.y + t.h);

  function commit(id: string, slot: LaidSlot) {
    const p = byId.get(id);
    if (!p) return;
    if (sameTarget(targetOf(plan, p), slot.target)) {
      setSaid(`${id} stays at ${slot.label}.`);
      return;
    }
    const ok = movePoint(run, plan, id, slot.target);
    setSaid(ok ? `Dropped ${id} on ${slot.label}.` : `${id} could not be moved. See the message on the page.`);
    if (ok) onSelect(id);
  }

  // ---- pointer drag
  function onPointerDown(e: ReactPointerEvent, p: SamplingPoint) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY, moved: false };
    const move = (ev: PointerEvent) => {
      if (!start.moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      start.moved = true;
      const pt = toSvg(ev.clientX, ev.clientY);
      setDrag({ id: p.id, x: pt.x, y: pt.y, over: hit(pt)?.key ?? null });
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc, true);
      setDrag(null);
      if (!start.moved) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      if (cancelled) return setSaid(`Move of ${p.id} cancelled.`);
      const target = hit(toSvg(ev.clientX, ev.clientY));
      if (target) commit(p.id, target);
      else setSaid(`${p.id} was dropped outside the places and stays where it was.`);
    };
    const up = (ev: PointerEvent) => finish(ev, false);
    const cancel = (ev: PointerEvent) => finish(ev, true);
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(new PointerEvent("pointercancel"), true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc, true);
  }

  // ---- keyboard
  function onMarkerKey(e: ReactKeyboardEvent, p: SamplingPoint) {
    const n = layout.targets.length;
    if (!carry || carry.id !== p.id) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const here = targetOf(plan, p);
        const at = Math.max(0, layout.targets.findIndex((t) => sameTarget(t.target, here)));
        setCarry({ id: p.id, at });
        setSaid(`Picked up ${p.id}. Use the arrow keys to choose a place, Enter to drop, Escape to cancel. Now at ${layout.targets[at]!.label}.`);
      }
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const at = (carry.at + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : n - 1)) % n;
      setCarry({ id: p.id, at });
      setSaid(layout.targets[at]!.label);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const slot = layout.targets[carry.at]!;
      setCarry(null);
      refocus.current = p.id;
      commit(p.id, slot);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setCarry(null);
      setSaid(`Move of ${p.id} cancelled. It stays where it was.`);
    }
  }

  const dragging = drag !== null || carry !== null;
  const hotKey = drag ? drag.over : carry ? layout.targets[carry.at]?.key ?? null : null;
  const movingId = drag?.id ?? carry?.id ?? null;
  const ghost = drag ? byId.get(drag.id) : undefined;

  // A plain function (not a nested component): a nested component is a new type on every render, which would remount the marker and drop keyboard focus mid-move.
  const renderMarker = (m: LaidMarker) => {
    const p = m.point;
    const sel = selectedId === p.id;
    const here = placementText(plan, p);
    const kind = p.type ? TYPE_LABEL[p.type] : "study type not chosen";
    return (
      <g
        key={p.id}
        className={`flow-marker${sel ? " selected" : ""}${movingId === p.id ? " moving" : ""}`}
        transform={`translate(${m.x} ${m.y})`}
        role="button"
        tabIndex={0}
        aria-current={sel ? "true" : undefined}
        aria-label={`${p.id} ${typeCode(p.type)}, ${kind}, ${p.attribute.trim() || "test not named"}, ${here}. Press Enter to pick up and move. Click to select.`}
        data-testid={`marker-${p.id}`}
        data-place={here}
        onPointerDown={(e) => onPointerDown(e, p)}
        onClick={() => {
          if (suppressClick.current) return;
          onSelect(sel ? null : p.id);
        }}
        onKeyDown={(e) => onMarkerKey(e, p)}
        onBlur={() => {
          if (carry?.id === p.id) {
            setCarry(null);
            setSaid(`Move of ${p.id} cancelled. It stays where it was.`);
          }
        }}
      >
        {sel && <rect className="flow-sel" x={-3} y={-3} width={MARK_W + 6} height={MARK_H + 6} rx={9} />}
        <rect className="flow-ring" x={-3} y={-3} width={MARK_W + 6} height={MARK_H + 6} rx={9} />
        <rect className="flow-marker-bg" width={MARK_W} height={MARK_H} rx={6} />
        <Glyph shape={markerShape(p.type)} cx={15} cy={MARK_H / 2} />
        {/* One text element with a real space between the id and the code, so the visible text ("SP-007 IPC") is what the accessible name starts with. */}
        <text x={30} y={13}>
          <tspan className="flow-marker-id">{p.id}</tspan>{" "}
          <tspan className="flow-marker-code" x={30} y={25}>
            {typeCode(p.type)}
          </tspan>
        </text>
      </g>
    );
  };

  const empty = plan.steps.length === 0;
  return (
    <section className="card stack" aria-labelledby="sp-flow" data-testid="flow-card">
      <h2 id="sp-flow">Process flow</h2>
      <p className="muted small">
        The steps of this plan in process order, with each sampling point where it is taken: before, during or after a step. A point can also stay off the diagram, and a point on a step does not need a position yet. Drag a marker to move it, or press Enter on it, use the arrow keys and press Enter again. The points table below lists the same thing as text.
      </p>
      {empty && (
        <p className="notice" data-testid="flow-empty">
          No process steps yet. Choose them in the <a href="#sp-steps">Process steps</a> card above; the diagram draws one box for each step, in order.
        </p>
      )}
      <div ref={wrapRef} className="flow-wrap" data-testid="flow-diagram">
        <svg
          ref={svgRef}
          className="flow-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ width: "100%", maxWidth: Math.round(layout.width * 1.25) }}
          role="group"
          aria-label={`Process flow diagram of ${plan.steps.length} steps`}
          data-cols={cols}
        >
          <defs>
            <marker id="flow-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrowhead" />
            </marker>
          </defs>

          <g aria-hidden="true">
            {layout.arrows.map((d, i) => (
              <path key={i} d={d} className="flow-arrow" markerEnd="url(#flow-arrowhead)" />
            ))}
          </g>

          {layout.boxes.map((b) => {
            const step = plan.steps[b.index]!;
            return (
              <g key={step.id} role="group" aria-label={`Step ${b.index + 1}: ${step.label}`} data-testid={`flow-box-${step.id}`} data-step-label={step.label}>
                <rect className="flow-box" x={b.x} y={b.y} width={b.w} height={b.h} rx={10} />
                <text className="flow-head" x={b.x + PAD} y={b.y + 18} aria-hidden="true">
                  {b.lines.map((l, i) => (
                    <tspan key={i} x={b.x + PAD} dy={i === 0 ? 0 : LINE_H}>
                      {i === 0 ? `${b.index + 1}. ${l}` : l}
                    </tspan>
                  ))}
                </text>
                {b.slots.map((s) => {
                  const hot = hotKey === s.key;
                  const slot = (s.target as { slot: SlotKey }).slot;
                  return (
                    <g key={s.key} data-testid={`slot-${s.key}`} data-drop={s.key}>
                      <rect className={`flow-slot${dragging ? " droppable" : ""}${hot ? " hot" : ""}`} x={s.x} y={s.y} width={s.w} height={s.h} rx={6} />
                      <text className="flow-slot-label" x={s.x + 6} y={s.y + 13} aria-hidden="true">
                        {SLOT_LABEL[slot]}
                        {dragging ? (hot ? " - drop here" : " - drop target") : ""}
                      </text>
                    </g>
                  );
                })}
                <g
                  className="flow-plus"
                  transform={`translate(${b.x + b.w - 24} ${b.y + 6})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Add a sample to ${step.label}`}
                  data-testid={`flow-add-${step.id}`}
                  onClick={() => openAdd({ stepId: step.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openAdd({ stepId: step.id });
                    }
                  }}
                >
                  <rect className="flow-ring" x={-3} y={-3} width={24} height={24} rx={7} />
                  <rect className="flow-plus-bg" width={18} height={18} rx={5} />
                  <path d="M 9 4 V 14 M 4 9 H 14" className="flow-plus-sign" />
                </g>
              </g>
            );
          })}

          <g data-testid="slot-tray" data-drop="tray">
            <rect className={`flow-tray${dragging ? " droppable" : ""}${hotKey === "tray" ? " hot" : ""}`} x={layout.tray.x} y={layout.tray.y} width={layout.tray.w} height={layout.tray.h} rx={10} />
            <text className="flow-head" x={PAD} y={layout.tray.y + 20} aria-hidden="true">
              {NOT_ON_DIAGRAM} ({layout.tray.markers.length})
              {dragging ? (hotKey === "tray" ? " - drop here to take the sample off the diagram" : " - drop target") : ""}
            </text>
            {layout.tray.markers.length === 0 && (
              <text className="flow-slot-label" x={PAD} y={layout.tray.y + 44} aria-hidden="true">
                Samples that belong to no step, or that you have not placed yet, wait here.
              </text>
            )}
          </g>

          {layout.markers.map((m) => (
            renderMarker(m)
          ))}

          {ghost && drag && (
            <g className="flow-ghost" transform={`translate(${drag.x - MARK_W / 2} ${drag.y - MARK_H / 2})`} pointerEvents="none" aria-hidden="true" data-testid="flow-ghost">
              <rect className="flow-marker-bg" width={MARK_W} height={MARK_H} rx={6} />
              <Glyph shape={markerShape(ghost.type)} cx={15} cy={MARK_H / 2} />
              <text className="flow-marker-id" x={30} y={13}>
                {ghost.id}
              </text>
              <text className="flow-marker-code" x={30} y={25}>
                {typeCode(ghost.type)}
              </text>
            </g>
          )}
        </svg>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="flow-live">
        {said}
      </p>
      <FlowLegend />
    </section>
  );
}

/** What the markers mean. Shapes group the study types; the code and the id are printed on every marker too. */
function FlowLegend() {
  const groups: { shape: MarkerShape; text: string; codes: string }[] = [
    { shape: "circle", text: "Taken during processing", codes: ["ipc", "ppq_enhanced", "mixing_homogeneity", "hold_time", "filter_study"].map((t) => `${TYPE_CODE[t as keyof typeof TYPE_CODE]} ${TYPE_LABEL[t as keyof typeof TYPE_LABEL]}`).join("; ") },
    { shape: "square", text: "Finished product, release and retained units", codes: ["release", "retain_reserve"].map((t) => `${TYPE_CODE[t as keyof typeof TYPE_CODE]} ${TYPE_LABEL[t as keyof typeof TYPE_LABEL]}`).join("; ") },
    { shape: "diamond", text: "Studies and commitments", codes: ["stability", "characterization", "supporting_study", "regulatory_commitment"].map((t) => `${TYPE_CODE[t as keyof typeof TYPE_CODE]} ${TYPE_LABEL[t as keyof typeof TYPE_LABEL]}`).join("; ") },
    { shape: "triangle", text: "Other, or study type not chosen yet", codes: `${TYPE_CODE.other} ${TYPE_LABEL.other}; ${typeCode(undefined)} no study type yet` },
  ];
  return (
    <div className="flow-legend" data-testid="flow-legend">
      <h3>Legend</h3>
      <ul className="plain-list small">
        {groups.map((g) => (
          <li key={g.shape}>
            <svg viewBox="0 0 30 30" width="22" height="22" className="flow-legend-glyph" aria-hidden="true" focusable="false">
              <Glyph shape={g.shape} cx={15} cy={15} />
            </svg>{" "}
            <strong>{g.shape[0]!.toUpperCase() + g.shape.slice(1)}</strong>: {g.text} ({g.codes}).
          </li>
        ))}
      </ul>
      <p className="small muted">
        Each marker shows the point id and the type code. A thick double outline means selected. Each box has Before, During, After and Position not set; the area under the boxes is Not on the diagram.
      </p>
    </div>
  );
}
