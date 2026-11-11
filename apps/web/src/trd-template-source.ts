import type { TrdDocument } from "@gap/process-model";
import type { TrdTemplateFor, TrdTemplateSource } from "@gap/engine";
import { useEffect, useMemo } from "react";
import { useTemplates, type StoredTemplate } from "./templates-store";

/**
 * The ONE place that says which template a TRD follows (M15, job 3B). The TRD's Word choice is "A template's headings", the template is in the
 * library, it has headings and a match is stored for it. Anything else (no choice, template deleted, no match, library still loading) is
 * "no template": the TRD is then Cascade-shaped and counts no heading items. Every caller that shows or records the TRD's open-item number
 * goes through here, so the number is the same on every page, in the document and in the export history.
 */
export function followedTemplate(d: TrdDocument, items: readonly StoredTemplate[], ready: boolean): StoredTemplate | undefined {
  const choice = d.templateChoice;
  if (!ready || choice?.kind !== "mapped" || !choice.templateId) return undefined;
  const t = items.find((x) => x.id === choice.templateId);
  return t && t.trdMapping && t.analysis.outline.length > 0 ? t : undefined;
}

/** The template source of a TRD, for the engine's open items and its template-ordered document. */
export function trdTemplateSourceOf(d: TrdDocument, items: readonly StoredTemplate[], ready: boolean): TrdTemplateSource | undefined {
  const t = followedTemplate(d, items, ready);
  return t ? { name: t.name, headings: t.analysis.outline, mapping: t.trdMapping! } : undefined;
}

/** For code that is not a component (the chain strip): the lookup made from the template store as it is now. */
export function trdTemplateForNow(): TrdTemplateFor {
  const { items, ready } = useTemplates.getState();
  return (d) => trdTemplateSourceOf(d, items, ready);
}

/**
 * Starts the library's load and gives the lookup. The lookup changes when the library loads or a template or its match changes, so a count
 * made with it as a dependency is worked out again then (and only then).
 */
export function useTrdTemplateFor(): TrdTemplateFor {
  const items = useTemplates((s) => s.items);
  const ready = useTemplates((s) => s.ready);
  useEffect(() => {
    void useTemplates.getState().load();
  }, []);
  return useMemo(() => (d: TrdDocument) => trdTemplateSourceOf(d, items, ready), [items, ready]);
}
