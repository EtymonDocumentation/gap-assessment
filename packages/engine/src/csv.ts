import { activityLabel, categoryLabel, type ContentBundle } from "./content";
import type { Gap } from "./compare";

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
  "Rule",
  "Inputs",
] as const;

export function gapsToCsv(content: ContentBundle, gaps: Gap[]): string {
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
    `${g.ruleId} v${g.ruleVersion}`,
    g.inputRefs.join(" | "),
  ]);
  return [CSV_COLUMNS as readonly string[], ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
