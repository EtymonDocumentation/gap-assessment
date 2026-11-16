import type { Project, SamplingPlan } from "@gap/process-model";
import { SAMPLING_BOM_INTRO, samplingBom, type BomGroup, type BomLine, type SamplingBom } from "@gap/sampling";
import type { ContentBundle } from "./content";
import type { Block, DocModel, DocSection } from "./document";
import { documentFingerprint } from "./review";
import { buildSamplingPlanDocument, SAMPLING_BANNER, type SamplingDocumentOptions } from "./sampling-document";
import type { SamplingSuggestions } from "./sampling-seed";

/**
 * The sampling bill of materials as a document of its own (page, Word and HTML): what may be used to take the PPQ samples, per batch and in
 * total. The page, the Word file and the HTML file are all drawn from this one model, so the words cannot differ.
 *
 * Everything comes from the sampling plan (see samplingBom in @gap/sampling); nothing is typed here, there is no spares field, and the
 * "Still to be stated" section is always printed so the list never looks complete while a point cannot be counted.
 */

export const SAMPLING_BOM_TITLE = "Sampling bill of materials — draft";

const NOTHING_OPEN = "No sampling point is waiting for a container, a quantity or a worked-out number of samples.";

/** One cell of a quantity: a count, or millilitres for flushed liquid. */
const quantityText = (line: BomLine, n: number) => (line.unit === "mL" ? `${n} mL` : String(n));

/** The table of one group: the columns depend on what the group lists, so a phone is not shown empty columns. */
function groupTable(plan: SamplingPlan, g: BomGroup): Block[] {
  const hasClosure = g.lines.some((l) => l.closure);
  const hasVolume = g.lines.some((l) => l.volumes.length);
  const volumeHead = g.kind === "flush" ? "Volume per flush" : "Volume per container";
  const columns = ["Line", "Item", ...(hasClosure ? ["Closure"] : []), ...(hasVolume ? [volumeHead] : []), "Sampling points", ...plan.batches.map((b) => b.label), "Total"];
  const rows = g.lines.map((l) => [
    l.id,
    l.item,
    ...(hasClosure ? [l.closure ?? ""] : []),
    ...(hasVolume ? [l.volumes.join(", ")] : []),
    l.pointIds.join(", "),
    ...l.perBatch.map((b) => quantityText(l, b.quantity)),
    quantityText(l, l.total),
  ]);
  const blocks: Block[] = [{ type: "paragraph", text: g.intro }, { type: "table", columns, rows, caption: `${g.title} (${g.quantityLabel.toLowerCase()} per batch and in total)` }];
  for (const l of g.lines) if (l.note) blocks.push({ type: "note", text: `${l.id}: ${l.note}` });
  return blocks;
}

export function buildSamplingBomDocument(content: ContentBundle, project: Project, plan: SamplingPlan, library: SamplingSuggestions, opts: SamplingDocumentOptions = {}): DocModel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const planDoc = buildSamplingPlanDocument(content, project, plan, library, opts);
  const planFingerprint = documentFingerprint(planDoc);
  const bom: SamplingBom = samplingBom(plan);
  const open = bom.stillToState;

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.length + 1), title, blocks });

  add("bom-intro", "About this list", [
    { type: "paragraph", text: SAMPLING_BOM_INTRO },
    { type: "paragraph", text: `Plan ${plan.id}: ${plan.title}. ${plan.points.length} sampling point${plan.points.length === 1 ? "" : "s"}, ${plan.batches.length} batch${plan.batches.length === 1 ? "" : "es"}${plan.batches.length ? ` (${plan.batches.map((b) => b.label).join(", ")})` : ""}.` },
    ...(open.length ? ([{ type: "note", text: `${open.length} ${open.length === 1 ? "item is" : "items are"} still to be stated in the plan, so this list is not complete. Do not treat it as final.` }] as Block[]) : []),
  ]);

  if (plan.points.length === 0) add("bom-empty", "Nothing to list yet", [{ type: "paragraph", text: "There are no sampling points yet, so there is nothing to list." }]);
  for (const g of bom.groups) add(`bom-${g.key}`, g.title, groupTable(plan, g));
  if (bom.equipment) {
    add("bom-equipment", "Equipment used only for sampling", [
      { type: "paragraph", text: "From the design review of the plan. The plan states no quantities for equipment, so none is given here." },
      { type: "table", columns: bom.equipment.columns, rows: bom.equipment.rows, caption: "Equipment used only to take samples" },
    ]);
  }

  const stateBlocks: Block[] = open.length ? [{ type: "paragraph", text: "These cannot be counted yet. Each one is also an open item of the plan." }, { type: "list", items: open.map((o) => o.text) }] : [{ type: "paragraph", text: NOTHING_OPEN }];
  add("bom-still", "Still to be stated", stateBlocks);

  if (bom.hundredPercent.length) add("bom-whole-lot", "Inspected at 100% of the lot", bom.hundredPercent.map((h): Block => ({ type: "note", text: h.text })));

  return {
    title: SAMPLING_BOM_TITLE,
    banner: SAMPLING_BANNER,
    status: "DRAFT",
    meta: [
      ["Project", project.meta.title],
      ["Plan", `${plan.id}: ${plan.title}`],
      ["Batches", plan.batches.map((b) => b.label).join(", ") || "None"],
      ["Plan version", `${planFingerprint.slice(0, 12)} (plan changed ${plan.updatedAt.replace("T", " ").slice(0, 16)} UTC)`],
      ["Generated", generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["Still to be stated", String(open.length)],
    ],
    cover: planDoc.cover,
    sections,
    tbdCount: open.length,
  };
}
