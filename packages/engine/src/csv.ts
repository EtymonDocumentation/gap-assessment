import { activityLabel, categoryLabel, type ContentBundle } from "./content";
import type { Project } from "@gap/process-model";
import type { Gap } from "./compare";
import { cellVerification } from "./verification";

export function cell(v: string): string {
  // Neutralize spreadsheet formula injection and quote every cell.
  // Neutralise spreadsheet formulas; a bare negative number such as "-20" stays a number.
  const safe = /^[=+\-@\t\r]/.test(v) && !/^-\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const CSV_COLUMNS = [
  "ID",
  "Section",
  "Attribute",
  "Source value",
  "Target value",
  "Category",
  "Detail",
  "Why it matters",
  "Activities implied",
  "Rule severity",
  "Severity",
  "Severity justification",
  "Regulatory",
  "Owner",
  "Status",
  "Source verification",
  "Target verification",
  "Rule",
  "Inputs",
] as const;

function sideVerification(project: Project, refs: string[], side: "source" | "target"): string {
  const mine = refs.filter((r) => r.startsWith(`${side}.`));
  return mine.length ? cellVerification(project, mine).text : "";
}

export function gapsToCsv(content: ContentBundle, gaps: Gap[], project: Project): string {
  const rows = gaps.map((g) => [
    g.displayId,
    g.sectionTitle,
    g.attribute,
    g.sourceDisplay,
    g.targetDisplay,
    categoryLabel(content, g.category),
    g.detail,
    g.rationale,
    g.activities.map((a) => activityLabel(content, a)).join("; "),
    g.ruleSeverity,
    g.severity,
    g.severityOverride?.justification ?? "",
    g.regulatoryNote ?? "",
    g.owner ?? "",
    g.status,
    sideVerification(project, g.inputRefs, "source"),
    sideVerification(project, g.inputRefs, "target"),
    `${g.ruleId} v${g.ruleVersion}`,
    g.inputRefs.join(" | "),
  ]);
  return [CSV_COLUMNS as readonly string[], ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
