import type { Category } from "@gap/engine";
import type { Severity } from "@gap/process-model";

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

export const SIDE_TEXT = { source: "Source — validated state", target: "Target — planned state", shared: "Scoping (shared)" } as const;

export const CATEGORY_SHORT: Record<Category, string> = {
  equivalent: "Equivalent",
  within_validated_range: "Within validated range",
  outside_validated_range: "Outside validated range",
  different_principle: "Different principle",
  scale_change: "Scale change",
  new_requirement: "New requirement",
  removed_element: "Removed element",
  information_required: "Information required",
};

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
