import { SAMPLE_ACCESS_LABEL, type SampleAccess, type SamplingPlan, type SamplingPoint } from "@gap/process-model";
import { sampleMethodView, studyEquipmentTable } from "./method.js";
import { isLiquidQuantityUnit, unitsKindOf, unitsPerBatch, type UnitsKind } from "./totals.js";
import { drawsOf } from "./volume.js";

/**
 * The sampling bill of materials (BOM): one list of everything that may be used to TAKE the PPQ samples, per batch and in total.
 *
 * WHY: the person who orders supplies for PPQ had to read every sampling point and the design review to find out how many containers,
 * connectors and manifolds to order. This function only gathers what the plan already states. It adds no number of its own: the
 * quantities come from `unitsPerBatch` (the same arithmetic as the plan's totals), and a point the plan cannot count yet is listed in
 * `stillToState`, so a BOM never looks complete while anything is missing. There is no "spares" field: the list says what MAY be used,
 * and the batch record tracks what is actually used.
 *
 * Built so a whole-process BOM can be added later: every group and line carries `source: "sampling"`, and a later source adds groups of its
 * own (for example "process") that the same document builder prints in the same way.
 */

export type BomSource = "sampling";

/** One line of a group: one item, the quantity per batch and in total, and the sampling points it comes from. */
export interface BomLine {
  source: BomSource;
  /** CT-01, PU-01, PT-01, FL-01: stable inside one BOM (the order of the plan's points). */
  id: string;
  /** The container, the part or the destination of the flushed liquid, in the plan's own words. */
  item: string;
  /** The closure typed on the point (containers of liquid only). */
  closure?: string;
  /** The volume or mass per container as typed on the points ("10 mL"); several when the merged points differ. */
  volumes: string[];
  pointIds: string[];
  /** One entry per batch of the plan, in plan order. A batch none of the points applies to has quantity 0. */
  perBatch: { batchId: string; batchLabel: string; quantity: number }[];
  total: number;
  /** "each": pieces. "mL": millilitres of flushed or discarded liquid. */
  unit: "each" | "mL";
  /** Said in words when the quantity is a lower bound or a part is not counted. */
  note?: string;
}

export type BomGroupKind = "containers" | "product_units" | "parts" | "flush";

export interface BomGroup {
  source: BomSource;
  key: string;
  kind: BomGroupKind;
  /** Containers and product units are split by what the samples are for. */
  usedFor?: UnitsKind;
  title: string;
  /** One or two plain sentences under the heading. */
  intro: string;
  /** The heading of the quantity columns ("Containers", "Product units", "Sampling points", "mL discarded"). */
  quantityLabel: string;
  lines: BomLine[];
}

export interface BomStillToState {
  /** Absent for a gap that belongs to the plan and not to one point. */
  pointId?: string;
  reasons: string[];
  /** A full sentence for a document or a page: "SP-004 (Bioburden): container not named." */
  text: string;
}

export interface SamplingBom {
  source: BomSource;
  planId: string;
  planTitle: string;
  batches: { id: string; label: string }[];
  groups: BomGroup[];
  /** Equipment used only for sampling (design review), as a table with the same words as the plan document; absent when none is listed. */
  equipment?: { columns: string[]; rows: string[][] };
  stillToState: BomStillToState[];
  /** Points inspected at 100% of the lot: said in a note, never counted. */
  hundredPercent: { pointId: string; text: string }[];
  /** Number of quantity lines over all groups (equipment rows are counted apart). */
  lineCount: number;
}

/** The one plain line at the top of the page and of both downloads. */
export const SAMPLING_BOM_INTRO = "Lists what may be used to take the PPQ samples. The batch record records what is actually used.";

/** The one-line pointer printed in the sampling plan document. */
export const SAMPLING_BOM_POINTER = "The sampling bill of materials lists the containers, parts and equipment that may be used to take these samples, per batch and in total. It is a separate document.";

/** Said once under the quantities: where a number comes from. */
export const SAMPLING_BOM_QUANTITY_NOTE = "Quantities come from the sampling plan: the number of samples worked out for each point, added over the points that apply to the batch. Nothing is typed here.";

const norm = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const clean = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

/** Accesses that are a part to order. A port counts only when the plan says it was added for the study. */
const ALWAYS_A_PART = new Set<SampleAccess>(["added_y_connector", "bag_sample_manifold", "aseptic_connector"]);
const PORT_ACCESS = new Set<SampleAccess>(["dedicated_port", "shared_port"]);

const KIND_ORDER: UnitsKind[] = ["process", "stability", "retain"];
const KIND_WORDS: Record<UnitsKind, string> = { process: "process samples", stability: "stability samples", retain: "retain and reserve samples" };

interface Acc {
  item: string;
  closure: string;
  volumes: string[];
  pointIds: string[];
  perBatch: Map<string, number>;
  partial: Set<string>;
}

export function samplingBom(plan: SamplingPlan): SamplingBom {
  const batches = plan.batches.map((b) => ({ id: b.id, label: b.label }));
  const stillToState: BomStillToState[] = [];
  const hundredPercent: { pointId: string; text: string }[] = [];
  const named = (p: SamplingPoint) => `${p.id} (${clean(p.attribute) || "no test named"})`;

  // groupKey -> lineKey -> accumulator, both in first-seen order (the order of the plan's points).
  const buckets = new Map<string, Map<string, Acc>>();
  const add = (groupKey: string, lineKey: string, p: SamplingPoint, item: string, closure: string, volume: string | undefined, perBatch: [string, number][], partial: boolean) => {
    const group = buckets.get(groupKey) ?? new Map<string, Acc>();
    buckets.set(groupKey, group);
    const acc = group.get(lineKey) ?? { item, closure, volumes: [], pointIds: [], perBatch: new Map<string, number>(), partial: new Set<string>() };
    group.set(lineKey, acc);
    if (volume && !acc.volumes.some((v) => norm(v) === norm(volume))) acc.volumes.push(volume);
    if (!acc.pointIds.includes(p.id)) acc.pointIds.push(p.id);
    for (const [batchId, q] of perBatch) acc.perBatch.set(batchId, (acc.perBatch.get(batchId) ?? 0) + q);
    if (partial) acc.partial.add(p.id);
  };

  for (const p of plan.points) {
    const kind = unitsKindOf(p);
    const units = unitsPerBatch(plan, p).filter((u) => u.applies);
    if (units.length === 0) continue;

    // A 100% inspection is the whole lot, not something pulled from it: a note, never a quantity.
    const whole = units.filter((u) => u.hundredPercent);
    if (whole.length) {
      const where = whole.length === units.length ? "every batch it applies to" : whole.map((u) => u.batchLabel).join(", ");
      hundredPercent.push({ pointId: p.id, text: `${named(p)}: 100% of the lot is inspected in ${where}. No quantity is counted for it.` });
    }
    const counted = units.filter((u) => !u.hundredPercent);

    // Why this point cannot be listed yet. Every reason is a gap in the plan that is already an open item.
    const reasons: string[] = [];
    const container = clean(p.container);
    const liquid = p.quantity !== undefined && isLiquidQuantityUnit(p.quantity.unit);
    if (counted.length) {
      if (p.quantity === undefined) reasons.push("quantity per container not stated");
      else if (liquid && !container) reasons.push("container not named");
    }
    const notWorked = counted.filter((u) => u.units === undefined);
    if (notWorked.length) reasons.push(`number of samples not worked out${notWorked.length === counted.length ? "" : ` for ${notWorked.map((u) => u.batchLabel).join(", ")}`}`);
    if (reasons.length) stillToState.push({ pointId: p.id, reasons, text: `${named(p)}: ${reasons.join("; ")}.` });

    // The point is listed when what to order is known; a point with only "not worked out" still adds the batches that are worked out
    // (the same rule as the plan's totals) and its line says it is a lower bound.
    const knownWhat = counted.length > 0 && p.quantity !== undefined && !(liquid && !container);
    if (knownWhat) {
      const placed = counted.filter((u) => u.units !== undefined).map((u): [string, number] => [u.batchId, u.units!]);
      const itemText = container || clean(p.quantity!.unit);
      const closure = liquid ? clean(p.closure) : "";
      const groupKey = `${liquid ? "containers" : "product_units"}:${kind}`;
      add(groupKey, `${norm(itemText)}|${norm(closure)}`, p, itemText, closure, liquid ? `${p.quantity!.value} ${clean(p.quantity!.unit)}` : undefined, placed, notWorked.length > 0);
    }

    // Sampling parts (plan format 1.6.0 method): one count of the sampling points that use the part, per batch they apply to.
    const access = p.method?.access;
    if (access && access !== "other" && (ALWAYS_A_PART.has(access) || (PORT_ACCESS.has(access) && p.method?.added?.forStudyOnly === true))) {
      const studyOnly = PORT_ACCESS.has(access);
      const item = `${SAMPLE_ACCESS_LABEL[access]}${studyOnly ? ", added for the study" : ""}`;
      add("parts", norm(item), p, item, "", undefined, units.map((u): [string, number] => [u.batchId, 1]), false);
    }

    // Flush or first-draw liquid that is thrown away. Counted only when the plan states it in mL or L.
    const flush = sampleMethodView(p)?.flush;
    if (flush) {
      const where = clean(flush.discardTo);
      const item = where ? `Flush or first draw, discarded to ${where}` : "Flush or first draw, where it goes is not stated";
      const per: [string, number][] = [];
      if (flush.volumeMl !== undefined) {
        for (const u of units) {
          const draws = drawsOf(plan, p, u.batchId);
          if (draws !== undefined) per.push([u.batchId, flush.volumeMl * draws]);
        }
      }
      add("flush", norm(item), p, item, "", flush.volumeText, per, flush.volumeMl === undefined || per.length < units.length);
    }
  }

  // Equipment used only for sampling: from the design review, never typed here.
  const table = studyEquipmentTable(plan);
  const se = plan.designReview?.studyEquipment;
  if (se?.used === true && se.items.length === 0) {
    stillToState.push({ reasons: ["equipment used only for sampling is answered yes, but no item is listed"], text: "Equipment used only for sampling: answered yes, but no item is listed." });
  }

  const groups: BomGroup[] = [];
  const counters: Record<string, number> = { CT: 0, PU: 0, PT: 0, FL: 0 };
  const lines = (groupKey: string, prefix: string, unit: BomLine["unit"], partialNote: (a: Acc) => string | undefined): BomLine[] =>
    [...(buckets.get(groupKey)?.values() ?? [])].map((a) => {
      const perBatch = batches.map((b) => ({ batchId: b.id, batchLabel: b.label, quantity: a.perBatch.get(b.id) ?? 0 }));
      const note = a.partial.size ? partialNote(a) : undefined;
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      return {
        source: "sampling" as const,
        id: `${prefix}-${String(counters[prefix]).padStart(2, "0")}`,
        item: a.item,
        ...(a.closure ? { closure: a.closure } : {}),
        volumes: a.volumes,
        pointIds: a.pointIds,
        perBatch,
        total: perBatch.reduce((s, x) => s + x.quantity, 0),
        unit,
        ...(note ? { note } : {}),
      };
    });
  const lower = (a: Acc) => `A lower bound: ${[...a.partial].join(", ")} not worked out yet for every batch. See "Still to be stated".`;

  for (const kind of KIND_ORDER) {
    const l = lines(`containers:${kind}`, "CT", "each", lower);
    if (l.length) groups.push({ source: "sampling", key: `containers-${kind}`, kind: "containers", usedFor: kind, title: `Sample containers to order: ${KIND_WORDS[kind]}`, intro: `Containers of liquid (a volume or a mass per container). Containers with the same name and closure are one line. ${SAMPLING_BOM_QUANTITY_NOTE}`, quantityLabel: "Containers", lines: l });
  }
  for (const kind of KIND_ORDER) {
    const l = lines(`product_units:${kind}`, "PU", "each", lower);
    if (l.length) groups.push({ source: "sampling", key: `product-units-${kind}`, kind: "product_units", usedFor: kind, title: `Product units taken from the batch, not ordered: ${KIND_WORDS[kind]}`, intro: `Counted units, such as syringes or vials, taken from the batch itself. They are not ordered. ${SAMPLING_BOM_QUANTITY_NOTE}`, quantityLabel: "Product units", lines: l });
  }
  const parts = lines("parts", "PT", "each", lower);
  if (parts.length) groups.push({ source: "sampling", key: "parts", kind: "parts", title: "Sampling parts", intro: "How each sample is taken, as stated on the sampling points. The number is how many sampling points use the part in the batch. The plan does not say how many parts one point needs.", quantityLabel: "Sampling points", lines: parts });
  const flushLines = lines("flush", "FL", "mL", (a) => `Not added up: ${[...a.partial].join(", ")} state the volume in a unit other than mL or L, or the number of locations is not stated.`);
  if (flushLines.length) groups.push({ source: "sampling", key: "flush", kind: "flush", title: "Flush and first-draw liquid thrown away", intro: "Liquid discarded before a sample is taken, as stated on the sampling points. Counted in mL once for each sample location.", quantityLabel: "mL discarded", lines: flushLines });

  return {
    source: "sampling",
    planId: plan.id,
    planTitle: plan.title,
    batches,
    groups,
    ...(table ? { equipment: { columns: table.columns, rows: table.rows } } : {}),
    stillToState,
    hundredPercent,
    lineCount: groups.reduce((s, g) => s + g.lines.length, 0),
  };
}
