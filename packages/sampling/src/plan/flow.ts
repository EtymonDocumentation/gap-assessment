import { UNIT_OP_CUSTOM_STEP, type FlowPosition, type PlanStep, type SamplingPlan, type SamplingPoint, type SamplingType } from "@gap/process-model";

/**
 * The plan's process flow as pure functions: which step and slot a point sits on, the order of the points table, the marker
 * vocabulary of the diagram. The diagram, the table and the Word / HTML output all read these, so the three cannot disagree.
 *
 * Standing rule: where a sample sits is a POSSIBILITY the person describes, never a requirement. "Position not set" and "Not on the
 * diagram" are normal states. Nothing here counts them as a problem, and nothing here fills a position in.
 */

export const NOT_ON_DIAGRAM = "Not on the diagram";
export const POSITION_NOT_SET = "Position not set";

/** The slots of a step box. "unset" is the area for a point that is on the step but has no position. */
export type SlotKey = FlowPosition | "unset";
export const SLOT_ORDER: readonly SlotKey[] = ["before", "during", "after", "unset"];
export const SLOT_LABEL: Record<SlotKey, string> = { before: "Before", during: "During", after: "After", unset: POSITION_NOT_SET };
/** Words for a sentence ("taken before the step"). */
export const SLOT_PHRASE: Record<SlotKey, string> = { before: "before the step", during: "during the step", after: "after the step", unset: "position not set" };

/** Where a point is: a slot of a step, or the tray. */
export type Placement = { kind: "slot"; step: PlanStep; slot: SlotKey } | { kind: "tray" };

/** The step a point sits on, or undefined when it is not on the diagram. */
export function stepOf(plan: Pick<SamplingPlan, "steps">, point: Pick<SamplingPoint, "flow">): PlanStep | undefined {
  return point.flow ? plan.steps.find((s) => s.id === point.flow!.stepId) : undefined;
}

export function placementOf(plan: Pick<SamplingPlan, "steps">, point: Pick<SamplingPoint, "flow">): Placement {
  const step = stepOf(plan, point);
  return step ? { kind: "slot", step, slot: point.flow!.at ?? "unset" } : { kind: "tray" };
}

/** "Sterile filtration, after the step", "Sterile filtration, position not set" or "Not on the diagram". */
export function placementText(plan: Pick<SamplingPlan, "steps">, point: Pick<SamplingPoint, "flow">): string {
  const p = placementOf(plan, point);
  return p.kind === "tray" ? NOT_ON_DIAGRAM : `${p.step.label}, ${SLOT_PHRASE[p.slot]}`;
}

/** The `unitOp` value a point carries while it sits on a step, so code that reads `unitOp` keeps working. */
export const unitOpForStep = (step: Pick<PlanStep, "unitOp">): string => step.unitOp ?? UNIT_OP_CUSTOM_STEP;

/** Points on one slot of one step, in plan order. */
export function pointsAt(plan: SamplingPlan, stepId: string, slot: SlotKey): SamplingPoint[] {
  return plan.points.filter((p) => p.flow?.stepId === stepId && (p.flow.at ?? "unset") === slot);
}

/** Points that are not on the diagram (no flow, or a flow naming a step the plan no longer has), in plan order. */
export function trayPoints(plan: SamplingPlan): SamplingPoint[] {
  return plan.points.filter((p) => !stepOf(plan, p));
}

/** Points of a step in every slot, in slot order and then plan order. */
export function pointsOnStep(plan: SamplingPlan, stepId: string): SamplingPoint[] {
  return SLOT_ORDER.flatMap((slot) => pointsAt(plan, stepId, slot));
}

/**
 * The order of the points table: diagram points by step order, then slot (before, during, after, position not set), then plan order;
 * then the points that are not on the diagram in plan order.
 */
export function tableOrder(plan: SamplingPlan): SamplingPoint[] {
  return [...plan.steps.flatMap((s) => pointsOnStep(plan, s.id)), ...trayPoints(plan)];
}

// ------------------------------------------------------------------ marker vocabulary

/**
 * A short code per study type, printed inside the marker next to the point id and explained in the legend. A point with no type
 * shows "TYPE?" in words (never a guessed type).
 */
export const TYPE_CODE: Record<SamplingType, string> = {
  ipc: "IPC",
  release: "REL",
  ppq_enhanced: "PPQ",
  mixing_homogeneity: "MIX",
  hold_time: "HT",
  filter_study: "FIL",
  stability: "STB",
  retain_reserve: "RET",
  characterization: "CHR",
  supporting_study: "SUP",
  regulatory_commitment: "REG",
  other: "OTH",
};
export const NO_TYPE_CODE = "TYPE?";
export const typeCode = (type: SamplingType | undefined): string => (type ? TYPE_CODE[type] : NO_TYPE_CODE);

/** Marker shapes. The shape groups the types; the code and the id are always printed too, so a shape is never the only cue. */
export type MarkerShape = "circle" | "square" | "diamond" | "triangle";
export const SHAPE_LABEL: Record<MarkerShape, string> = {
  circle: "Circle: taken during processing",
  square: "Square: finished product, release and retained units",
  diamond: "Diamond: studies and commitments",
  triangle: "Triangle: other, or study type not chosen yet",
};
const SHAPE_OF: Record<SamplingType, MarkerShape> = {
  ipc: "circle",
  ppq_enhanced: "circle",
  mixing_homogeneity: "circle",
  hold_time: "circle",
  filter_study: "circle",
  release: "square",
  retain_reserve: "square",
  stability: "diamond",
  characterization: "diamond",
  supporting_study: "diamond",
  regulatory_commitment: "diamond",
  other: "triangle",
};
export const markerShape = (type: SamplingType | undefined): MarkerShape => (type ? SHAPE_OF[type] : "triangle");
