import type { DocModel } from "@gap/engine";
import type { HeadingMapping, OutlineHeading, TemplateAnalysis, TemplateMapping, ToolBlock } from "./types";
import { sectionHeadingText } from "./writer";

export const FRONT_BLOCK_ID = "front";
export const FRONT_BLOCK_TITLE = "Title, status and document details";

/** "front" (banner, title, status, details) followed by one block per document section, in document order. */
export function toolBlocks(doc: DocModel): ToolBlock[] {
  return [{ id: FRONT_BLOCK_ID, title: FRONT_BLOCK_TITLE }, ...doc.sections.map((s) => ({ id: s.id, title: sectionHeadingText(s, true) }))];
}

// ------------------------------------------------------------------ suggested mapping

/** Words a customer template may use for each tool block. A suggestion only: the user always reviews it. */
const SYNONYMS: Record<string, string[]> = {
  front: ["document details", "document information", "general information"],
  purpose: ["purpose", "objective", "objectives", "aim", "aims", "introduction"],
  scope: ["scope", "applicability", "applicable scope"],
  "source-summary": ["source process", "source program", "source summary", "process description", "current process", "validated state", "current state", "sending site", "sending unit", "su process", "su summary"],
  "target-summary": ["target process", "target summary", "receiving process", "process description", "planned state", "receiving site", "receiving unit", "ru process", "ru summary"],
  differences: ["differences", "identified differences", "summary of differences", "differences by unit operation"],
  "gap-table": ["gap table", "detailed gap table", "gap analysis", "identified differences", "differences"],
  "gap-details": ["gap details", "gap detail", "gap table details", "detailed gap information"],
  "validation-plan": ["validation plan", "validation activities", "required actions", "actions required", "action plan", "activities"],
  "equipment-qualification": ["equipment qualification", "equipment", "qualification"],
  "open-items": ["open items", "open information", "outstanding information", "outstanding items", "missing information", "information gaps"],
  risk: ["risk", "risk ranking", "risk assessment"],
  "verification-status": ["verification", "verification status", "data verification"],
  references: ["references", "reference documents", "referenced documents", "source documents"],
  approval: ["approval", "approvals", "sign off", "signoff", "signatures", "document sign off", "authorisation", "authorization"],
  "source-register": ["source register"],
  "change-log-summary": ["change log", "change history"],
};

function normalise(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/^[\s\d.()]+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function matches(heading: string, phrase: string): boolean {
  const h = normalise(heading);
  const p = normalise(phrase);
  return p.trim() !== "" && h.includes(p);
}

/**
 * A starting point from simple title matching. Headings that match get their tool blocks and "replace";
 * headings with text of their own and no match are flagged; everything else is kept. Each block is suggested once.
 */
export function suggestMapping(analysis: TemplateAnalysis, doc: DocModel): TemplateMapping {
  const blocks = toolBlocks(doc);
  const taken = new Set<string>();
  const headings: HeadingMapping[] = analysis.outline.map((h) => {
    const mine = blocks.filter((b) => {
      if (taken.has(b.id)) return false;
      if ((SYNONYMS[b.id] ?? []).some((p) => matches(h.text, p))) return true;
      return b.id !== FRONT_BLOCK_ID && matches(h.text, b.title.replace(/^(Appendix )?[A-Z0-9]+\.\s*/, ""));
    });
    // The first heading, in document order, that matches a block gets it.
    mine.forEach((b) => taken.add(b.id));
    if (mine.length) return { headingIndex: h.index, blocks: mine.map((b) => b.id), existing: "replace" };
    return { headingIndex: h.index, blocks: [], existing: h.hasBody ? "flag" : "keep" };
  });
  return { headings, unmappedBlocks: "append" };
}

// ------------------------------------------------------------------ report

export interface MappingReport {
  unmappedBlocks: ToolBlock[];
  flaggedHeadings: OutlineHeading[];
  keptHeadings: OutlineHeading[];
  errors: string[];
}

/** What a mapping will do, and what is wrong with it. A mapping with errors cannot be used. */
export function mappingReport(analysis: TemplateAnalysis, mapping: TemplateMapping, doc: DocModel): MappingReport {
  const blocks = toolBlocks(doc);
  const known = new Set(blocks.map((b) => b.id));
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const used = new Set<string>();
  const entries = new Map<number, HeadingMapping>();
  const pdf = analysis.sourceFormat === "pdf";

  for (const hm of mapping.headings) {
    const heading = analysis.outline.find((h) => h.index === hm.headingIndex);
    if (!heading) {
      errors.push(`The mapping refers to heading number ${hm.headingIndex + 1}, which the template does not have.`);
      continue;
    }
    if (entries.has(hm.headingIndex)) errors.push(`The heading "${heading.text}" appears twice in the mapping.`);
    entries.set(hm.headingIndex, hm);
    for (const id of hm.blocks) {
      if (!known.has(id)) {
        errors.push(`The heading "${heading.text}" is mapped to content ("${id}") that does not exist in this document.`);
        continue;
      }
      const title = blocks.find((b) => b.id === id)!.title;
      if (seen.has(id)) errors.push(`"${title}" is mapped to more than one heading ("${analysis.outline.find((h) => h.index === seen.get(id))?.text ?? ""}" and "${heading.text}"). Map each piece of content once.`);
      else seen.set(id, hm.headingIndex);
      used.add(id);
    }
    if (hm.blocks.length && hm.existing === "flag") errors.push(`The heading "${heading.text}" has content mapped to it, so it cannot also be flagged as to be completed. Choose "replace" or "keep".`);
    if (!hm.blocks.length && hm.existing === "replace") errors.push(`The heading "${heading.text}" is set to replace its text, but no content is mapped to it. Choose "keep" or "flag".`);
  }

  const flaggedHeadings: OutlineHeading[] = [];
  const keptHeadings: OutlineHeading[] = [];
  for (const h of analysis.outline) {
    const hm = entries.get(h.index);
    const existing = hm?.existing ?? "keep";
    const hasBlocks = (hm?.blocks.length ?? 0) > 0;
    if (!hasBlocks && (existing === "flag" || (pdf && existing === "keep"))) flaggedHeadings.push(h);
    else if (existing === "keep" && h.hasBody) keptHeadings.push(h);
  }
  return { unmappedBlocks: blocks.filter((b) => !used.has(b.id)), flaggedHeadings, keptHeadings, errors };
}
