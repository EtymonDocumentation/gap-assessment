import { EXCIPIENT_REGULATORY_SENTENCE, excipientAssessments, type Project } from "@gap/process-model";
import type { Block } from "./document";
import { excipientMarkers, excipientOpenItems, excipientRegulatory } from "./excipient-analysis";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The blocks of the optional "Excipient assessment" section of the gap document, or nothing when the project has no excipient line.
 * One row for each excipient of every assessment: where the sites differ, how many items are open, the gaps it is linked to and, when a
 * marker calls for it, the one fixed regulatory sentence. Nothing here says anything about a filing category.
 */
export function excipientGapBlocks(project: Project): Block[] | undefined {
  const assessments = excipientAssessments(project).filter((a) => a.lines.length);
  if (!assessments.length) return undefined;
  const rows: string[][] = [];
  let openTotal = 0;
  for (const a of assessments) {
    const open = excipientOpenItems(project, a);
    openTotal += open.length;
    for (const l of a.lines) {
      const markers = excipientMarkers(project, a.id, l);
      const reg = excipientRegulatory(project, a.id, l);
      rows.push([
        `${l.name} (${a.id})`,
        markers.length ? markers.map((m) => m.label).join("; ") : "None so far",
        String(open.filter((o) => o.lineId === l.id).length),
        l.links.gapIds.length ? l.links.gapIds.join(", ") : "-",
        reg.required ? EXCIPIENT_REGULATORY_SENTENCE : "-",
      ]);
    }
  }
  return [
    {
      type: "paragraph",
      text: `The excipient assessment of this project lists ${plural(rows.length, "excipient", "excipients")} and ${plural(openTotal, "open item", "open items")}. The full assessment is a separate document.`,
    },
    { type: "table", columns: ["Excipient", "What differs", "Open items", "Linked gaps", "Regulatory"], rows },
  ];
}

