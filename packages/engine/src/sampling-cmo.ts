import { UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE, type Project, type SamplingPlan } from "@gap/process-model";
import { agencyCoverage, CMO_INTRO, placementText, renderSubsection, reportingInstructions, requestLine, stepOf, tokenContext, typeText } from "@gap/sampling";
import type { ContentBundle } from "./content";
import { effectiveContent } from "./custom";
import type { Block, DocModel, DocSection } from "./document";
import { documentFingerprint } from "./review";
import { buildSamplingPlanDocument, samplingOpenItems, SAMPLING_BANNER, type SamplingDocumentOptions } from "./sampling-document";
import type { SamplingSuggestions } from "./sampling-seed";
import { buildTrdSeed } from "./trd-seed";

/**
 * The CMO reporting instructions: the "Reporting instructions" block of every sampling point, in plan order, plus the custom
 * subsections marked for the CMO and the agency requests the points answer. It is a separate output from the plan because the CMO
 * gets the instructions, not the statistics.
 *
 * Each block is the same text the plan prints (reportingInstructions), so the two documents cannot disagree. The plan's fingerprint
 * and date are in the header: the CMO can see which version of the plan the instructions belong to. A point that is still incomplete
 * keeps its block with the gaps written as "not given yet", and the header counts the open items, so a draft is never mistaken for final.
 */

export const CMO_INSTRUCTIONS_TITLE = "CMO reporting instructions — draft";

export function buildCmoInstructionsDocument(content: ContentBundle, project: Project, plan: SamplingPlan, library: SamplingSuggestions, opts: SamplingDocumentOptions = {}): DocModel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const planDoc = buildSamplingPlanDocument(content, project, plan, library, opts);
  const planFingerprint = documentFingerprint(planDoc);
  const seed = buildTrdSeed(content, project, { exportedAt: generatedAt, ...(opts.appVersion ? { appVersion: opts.appVersion } : {}) });
  const eff = effectiveContent(content, project);
  const labels = new Map(eff.catalog.unitOperations.map((u) => [u.key, u.label]));
  labels.set(UNIT_OP_FINISHED_PRODUCT, "Finished product");
  labels.set(UNIT_OP_NONE, "Supporting work (no single step)");
  const unitOpLabel = (k: string) => labels.get(k) ?? k;
  const open = samplingOpenItems(content, project, plan);
  const program = seed.meta.product.program.display ?? "Not established";
  const ctx = tokenContext(plan, {
    ...(seed.meta.product.program.display ? { productName: seed.meta.product.program.display } : {}),
    ...(seed.meta.receivingSite.name.display ? { ruSite: seed.meta.receivingSite.name.display } : {}),
  });

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.length + 1), title, blocks });

  add("cmo-intro", "About these instructions", [
    { type: "paragraph", text: CMO_INTRO },
    { type: "paragraph", text: `Plan ${plan.id}: ${plan.title}. ${plan.points.length} sampling point${plan.points.length === 1 ? "" : "s"}, ${plan.batches.length} batch${plan.batches.length === 1 ? "" : "es"}.` },
    ...(open.length
      ? ([{ type: "note", text: `The plan still has ${open.length} open item${open.length === 1 ? "" : "s"}. Entries not yet decided read "not given yet" in the blocks below. Do not treat this as final.` }] as Block[])
      : []),
  ]);

  const blocks: Block[] = plan.points.length ? [] : [{ type: "paragraph", text: "There are no sampling points yet, so there are no reporting instructions." }];
  for (const p of plan.points) {
    const ri = reportingInstructions(plan, p, { unitOpLabel });
    blocks.push({ type: "heading", text: `${ri.heading}: ${p.attribute.trim() || "(no test)"} (${typeText(p)}${stepOf(plan, p) ? `; ${placementText(plan, p)}` : ""})` });
    for (const text of ri.paragraphs) blocks.push({ type: "paragraph", text });
    if (ri.missing.length) blocks.push({ type: "note", text: `${p.id} is incomplete in the plan. Still missing in this block: ${ri.missing.join(", ")}.` });
  }
  add("cmo-blocks", "Reporting instructions per sampling point", blocks);

  const marked = plan.subsections.filter((s) => s.includeInCmo);
  if (marked.length) {
    const subBlocks: Block[] = [];
    for (const sub of marked) {
      const pointId = /^in_point:(.+)$/.exec(sub.placement)?.[1];
      const point = pointId ? plan.points.find((p) => p.id === pointId) : undefined;
      const r = renderSubsection(sub, ctx, point ? { id: point.id, attribute: point.attribute } : undefined);
      subBlocks.push({ type: "heading", text: `${r.title} (${sub.id})` });
      for (const b of r.blocks) subBlocks.push(b.type === "paragraph" ? { type: "paragraph", text: b.text } : b.type === "list" ? { type: "list", items: b.items } : { type: "table", columns: b.columns, rows: b.rows });
      for (const pr of r.problems) subBlocks.push({ type: "note", text: `${sub.id}: ${pr}` });
    }
    add("cmo-subsections", "Additional instructions", subBlocks);
  }

  const linked = agencyCoverage(plan).filter((c) => c.points.length);
  if (linked.length) {
    add("cmo-agency", "Agency requests these samples answer", [
      { type: "paragraph", text: "Reference only. The questions are quoted as received; what a request means for a filing is not decided here." },
      {
        type: "table",
        columns: ["Request", "Question (as received)", "Reporting instructions"],
        rows: linked.map((c) => [requestLine(c.request), c.request.question, c.points.map((p) => `RI-${p.id}`).join(", ")]),
      },
    ]);
  }

  return {
    title: CMO_INSTRUCTIONS_TITLE,
    banner: SAMPLING_BANNER,
    status: "DRAFT",
    meta: [
      ["Project", project.meta.title],
      ["Plan", `${plan.id}: ${plan.title}`],
      ["Plan version", `${planFingerprint.slice(0, 12)} (plan changed ${plan.updatedAt.replace("T", " ").slice(0, 16)} UTC)`],
      ["Generated", generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["Open items in the plan", String(open.length)],
    ],
    cover: planDoc.cover,
    sections,
    tbdCount: open.length,
  };
}
