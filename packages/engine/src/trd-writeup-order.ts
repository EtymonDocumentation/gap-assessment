import type { TrdDocument, TrdPlacement, TrdWriteup } from "@gap/process-model";

/*
 * The order the write-ups have in the document, in one place so the export, the Descriptions tab and "move up / down" agree.
 *
 * The document has two groups:
 *  - TOP-LEVEL SECTIONS (introduction, scope ... with no placement): each its own numbered section, in the order they sit in the TRD.
 *  - THE MANUFACTURING PROCESS OVERVIEW: its introduction first, then, per process step in the TRD's step order, the sections placed
 *    "before" the step, the step's own process descriptions, and the sections placed "after" it. Sections placed "last" close the
 *    overview.
 * Sections placed by a step the TRD does not have, and process descriptions whose step is gone, still appear (never dropped silently).
 */

/** The key of the section that introduces the manufacturing process overview. */
export const OVERVIEW_SECTION_KEY = "manufacturing_process_overview";

export interface WriteupOrder {
  /** Top-level sections, in document order. */
  prose: TrdWriteup[];
  /** The overview's own introduction (not movable: it heads the overview). */
  intro?: TrdWriteup;
  /** Everything inside the overview after the introduction, in document order. */
  overview: TrdWriteup[];
}

const sameAnchor = (a: TrdPlacement | undefined, b: TrdPlacement | undefined) => (a?.where ?? "") === (b?.where ?? "") && (a?.unitOp ?? "") === (b?.unitOp ?? "");

export function writeupOrder(d: TrdDocument): WriteupOrder {
  const all = d.writeups ?? [];
  const intro = all.find((w) => w.kind === "section" && w.key === OVERVIEW_SECTION_KEY);
  const prose = all.filter((w) => w.kind === "section" && w.key !== OVERVIEW_SECTION_KEY && !w.placement);
  const placed = all.filter((w) => w.kind === "section" && w.key !== OVERVIEW_SECTION_KEY && w.placement);
  const unitOps = all.filter((w) => w.kind === "unitOp");
  const overview: TrdWriteup[] = [];
  const used = new Set<string>();
  const take = (w: TrdWriteup) => {
    used.add(w.id);
    overview.push(w);
  };
  const placedAt = (where: "before" | "after", unitOp: string | undefined) => placed.filter((w) => w.placement?.where === where && w.placement.unitOp === unitOp && !used.has(w.id));
  for (const s of d.steps) {
    if (s.key) placedAt("before", s.key).forEach(take);
    unitOps.filter((w) => w.stepId === s.id && !used.has(w.id)).forEach(take);
    if (s.key) placedAt("after", s.key).forEach(take);
  }
  placed.filter((w) => w.placement?.where !== "last" && !used.has(w.id)).forEach(take);
  unitOps.filter((w) => !used.has(w.id)).forEach(take);
  placed.filter((w) => w.placement?.where === "last" && !used.has(w.id)).forEach(take);
  return { prose, ...(intro ? { intro } : {}), overview };
}

/** All write-ups in document order: top-level sections, the overview introduction, then the overview. */
export function writeupsInOrder(d: TrdDocument): TrdWriteup[] {
  const o = writeupOrder(d);
  return [...o.prose, ...(o.intro ? [o.intro] : []), ...o.overview];
}

export interface MovePlan {
  /** Why it cannot move that way (shown as the reason beside the disabled button). */
  blocked?: string;
  /** Swap the array positions of the write-up and this neighbour. */
  swapWith?: string;
  /** Put the write-up in the neighbour's place by changing its placement, and place it right next to the neighbour in the list. */
  placeBy?: { placement: TrdPlacement; nextTo: string; side: "before" | "after" };
}

/** What moving one write-up up (-1) or down (+1) would do. The same plan drives the buttons and the change. */
export function planMove(d: TrdDocument, id: string, dir: -1 | 1): MovePlan {
  const order = writeupOrder(d);
  const w = (d.writeups ?? []).find((x) => x.id === id);
  if (!w) return { blocked: "This description is not in the TRD." };
  const edge = dir === -1 ? "first" : "last";
  const proseAt = order.prose.indexOf(w);
  if (proseAt >= 0) {
    const n = order.prose[proseAt + dir];
    return n ? { swapWith: n.id } : { blocked: `It is already the ${edge} of the sections before the process overview.` };
  }
  if (order.intro === w) return { blocked: "The introduction of the process overview heads the overview and stays where it is." };
  const at = order.overview.indexOf(w);
  const x = order.overview[at + dir];
  if (!x) return { blocked: `It is already the ${edge} in the process overview.` };
  const stepKey = (u: TrdWriteup) => d.steps.find((s) => s.id === u.stepId)?.key;
  if (w.kind === "unitOp") {
    // A process description belongs to its step; the step order (Steps tab) sets where it sits.
    return x.kind === "unitOp" && x.stepId === w.stepId ? { swapWith: x.id } : { blocked: "A process description sits with its step. Change the order of the steps in the Steps tab to move it." };
  }
  if (x.kind === "section" && sameAnchor(x.placement, w.placement)) return { swapWith: x.id };
  if (x.kind === "unitOp") {
    const k = stepKey(x);
    if (!k) return { blocked: "The neighbouring process description has no catalog step, so there is no place to anchor this section to." };
    // Past a step's description: before the step (going up) or after it (going down), which also clears the step's other descriptions.
    return { placeBy: { placement: { where: dir === -1 ? "before" : "after", unitOp: k }, nextTo: x.id, side: dir === -1 ? "before" : "after" } };
  }
  // A neighbouring section with another place: take its place and sit next to it.
  return { placeBy: { placement: { ...(x.placement as TrdPlacement) }, nextTo: x.id, side: dir === -1 ? "before" : "after" } };
}
