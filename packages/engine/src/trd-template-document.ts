import type { TrdDocument } from "@gap/process-model";
import type { Block, DocModel, DocSection } from "./document";
import { headingTitle } from "./trd-heading-interview";
import { TRD_ADDITIONAL_HEADING, TRD_KEPT_TEXT_NOTE, TRD_TO_COMPLETE_TEXT, trdHeadingPlan } from "./trd-heading-plan";
import type { TrdTemplateSource } from "./trd-document";
import { TRD_FRONT_TITLE, TRD_FRONT_UNIT, trdUnitModel, trdUnitsOf } from "./trd-units";

/*
 * The TRD in the order of a person's own Word template, as a document model (M15, job 3B): what the preview, the HTML download and any
 * Markdown made from it show. The Word file is written by the Word render from the same plan (trd-heading-plan.ts), so what goes under which
 * heading is decided in one place. The words differ only where Word can do more: the template's own text stays in the Word file, here a line
 * says so.
 *
 *  - Each heading of the template is a section: its number and words exactly as in the file (`exactTitle`, no Cascade number in front).
 *  - Under it, in the stored order: what the person wrote, then the placed pieces. One piece: the heading replaces Cascade's own title.
 *    Several: each keeps its title one level below, and its own sub-headings move one level further down.
 *  - A heading with nothing says "[To be completed.]" (an open item); a heading that keeps the template's own text says so.
 *  - Pieces added back go under "Additional content" at the end, in the document's order; pieces with no heading are left out.
 *  - Cascade's section and sub-section numbers are taken out (trdUnitModel) and pictures are numbered again in the order they are written,
 *    as the Word file does.
 */

/** Said under a heading that holds the title block (the document's title, status and details are at the head of the document). */
export const TRD_FRONT_PLACED_NOTE = "The title, status and document details are at the top of this document.";

export const TRD_FOLLOWS_HEADINGS = (templateName: string): string => `The document follows the headings of ${templateName}.`;

const FRONT_NOTE: Block = { type: "note", text: TRD_FRONT_PLACED_NOTE };

/** Text a person wrote, one paragraph per line, as in the Word file. */
function writtenBlocks(text: string): Block[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l): Block => ({ type: "paragraph", text: l }));
}

export function trdTemplateDocument(doc: DocModel, d: TrdDocument, source: TrdTemplateSource): DocModel {
  const unitDoc = trdUnitModel(doc, d);
  const bySection = new Map(unitDoc.sections.map((s) => [s.id, s] as const));
  const plan = trdHeadingPlan({ headings: source.headings, mapping: source.mapping, unitIds: trdUnitsOf(unitDoc).map((u) => u.id), headingTexts: d.headingTexts, addedBack: d.addedBack });
  let picture = 0;
  /** A unit's blocks, pictures numbered again; `shift` moves its inner headings down one level (several pieces under one heading). */
  const unitBlocks = (id: string, shift: boolean): Block[] => {
    if (id === TRD_FRONT_UNIT) return [FRONT_NOTE];
    return bySection.get(id)!.blocks.map((b): Block => {
      if (b.type === "picture") return { ...b, number: ++picture };
      if (shift && b.type === "heading") return { ...b, level: b.level === 2 ? 3 : 2 };
      return b;
    });
  };
  const titleOf = (id: string): string => (id === TRD_FRONT_UNIT ? TRD_FRONT_TITLE : bySection.get(id)!.title);
  const several = (ids: readonly string[]): Block[] => ids.flatMap((id): Block[] => [{ type: "heading", text: titleOf(id) }, ...unitBlocks(id, true)]);

  const sections: DocSection[] = plan.slots.map((slot) => {
    const blocks: Block[] = [];
    if (slot.state === "content") {
      // The template's own text stays only where the person picked "keep"; the line says so for the formats that cannot carry it.
      if (slot.existing === "keep" && slot.keptText) blocks.push({ type: "note", text: TRD_KEPT_TEXT_NOTE });
      blocks.push(...writtenBlocks(slot.text));
      blocks.push(...(slot.ids.length === 1 ? unitBlocks(slot.ids[0]!, false) : several(slot.ids)));
    } else if (slot.state === "written") blocks.push(...writtenBlocks(slot.text));
    else if (slot.state === "kept") blocks.push({ type: "note", text: TRD_KEPT_TEXT_NOTE });
    else blocks.push({ type: "rich", style: "paragraph", runs: [{ text: TRD_TO_COMPLETE_TEXT, bold: true, open: true }] });
    return { id: `heading-${slot.heading.index}`, number: "", exactTitle: true, title: headingTitle(slot.heading), blocks };
  });
  if (plan.back.length) sections.push({ id: "additional", number: "", exactTitle: true, title: TRD_ADDITIONAL_HEADING, blocks: several(plan.back) });
  return { ...doc, sections };
}
