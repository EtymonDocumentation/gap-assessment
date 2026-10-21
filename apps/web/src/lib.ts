import type { Category } from "@gap/engine";
import { fullRef, getEntry, type Project, type Severity } from "@gap/process-model";

export function download(filename: string, data: string | Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export const SEVERITY_TEXT: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low", none: "None" };

/** Side badges. The source text follows the stage wording (StageWording.sourceSideText). */
export function sideText(w: { sourceSideText: string }): Record<"source" | "target" | "shared", string> {
  return { source: w.sourceSideText, target: "RU — planned state", shared: "Scoping (shared)" };
}

export type UnitSide = "source" | "target";

/** "Sending unit (SU)" / "Receiving unit (RU)". */
export const SIDE_FULL: Record<UnitSide, string> = { source: "Sending unit (SU)", target: "Receiving unit (RU)" };
/** "SU" / "RU". */
export const SIDE_SHORT: Record<UnitSide, string> = { source: "SU", target: "RU" };

/** The site and line recorded in scoping for a side ("Site North (fictional), Line 2"), or "" when neither is established yet. */
export function siteLine(project: Project, side: UnitSide): string {
  const text = (field: string): string => {
    const e = getEntry(project, fullRef(side, `site.${field}`));
    return e && e.status === "established" && typeof e.value === "string" ? e.value.trim() : "";
  };
  return [text("name"), text("line")].filter(Boolean).join(", ");
}

/**
 * Full description of one side: the side name, the site and line from scoping when known, and the stage-aware state wording.
 * "Sending unit (SU) — Site North (fictional), Line 2 · validated state".
 */
export function sideDescription(project: Project, side: UnitSide, w: { sourceValidated: boolean }): string {
  const state = side === "target" ? "planned state" : w.sourceValidated ? "validated state" : "current state";
  const site = siteLine(project, side);
  return `${SIDE_FULL[side]}${site ? ` — ${site}` : ""} · ${state}`;
}

/** Short category labels. The keys never change; only the two range labels follow the source stage. */
export function categoryShort(validated: boolean): Record<Category, string> {
  const word = validated ? "validated" : "SU";
  return {
    equivalent: "Equivalent",
    within_validated_range: `Within ${word} range`,
    outside_validated_range: `Outside ${word} range`,
    different_principle: "Different principle",
    scale_change: "Scale change",
    new_requirement: "New requirement",
    removed_element: "Removed element",
    information_required: "Information required",
  };
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The four kinds of Word document, as the user sees them. */
export const MODE_LABEL = {
  builtin: "Built-in default",
  their_look: "Their look",
  mapped: "Map to their headings",
  tags: "Placeholder tags",
} as const;

export const MODE_HELP = {
  builtin: "The tool's own clean layout. No template needed.",
  their_look: "Our sections, written in the fonts, styles, header, footer and page setup of a template.",
  mapped: "Our content placed under the headings of a template, as you assigned it in the mapping editor.",
  tags: "A template with placeholder tags such as {program}. The tool fills them in.",
} as const;

export const FORMAT_LABEL = { markdown: "Markdown", html: "HTML", docx: "Word" } as const;

/** First 12 characters of a SHA-256 value, for tables. The full value goes in a title or an expandable. */
export function shortHash(h: string): string {
  return h.slice(0, 12);
}

/** "2026-10-20 14:05" (local time) from an ISO timestamp. */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
