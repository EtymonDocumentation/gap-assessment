import type { Category } from "@gap/engine";
import type { Severity } from "@gap/process-model";

export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
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
