import { buildTrdDocument, stampDocument, trdUnitModel, trdUnitsOf, type TrdUnitInfo } from "@gap/engine";
import type { TrdDocument } from "@gap/process-model";
import { useEffect, useMemo, useState } from "react";
import { APP_VERSION } from "./lib";
import { useContent, useStore } from "./store";
import { useTemplates, type StoredTemplate } from "./templates-store";
import { useVersionStamp } from "./version-ui";

/**
 * Whether the TRD interview follows the headings of the user's own Word template (M15, job 3A), and with which template. The interview follows
 * them only when the TRD's Word choice is "A template's headings", the template is in the library and it has a match for the TRD. Every other
 * case is named here, so the interview can say in plain words why it is in Cascade's own order and what to do (nothing is lost in any of them:
 * the order is only a way of asking, and the answers are stored on the TRD).
 */
export type HeadingFollow =
  /** The TRD does not use "A template's headings": the interview is in Cascade's own order, nothing to say. */
  | { status: "off" }
  /** The library is still loading. Cascade's own order for the moment, no notice (it would flash and go). */
  | { status: "loading" }
  /** The TRD names a template that is not in the library any more (the name as it was stored). */
  | { status: "missing"; templateName: string }
  /** The template is there but has no match for the TRD yet (or no headings to match). */
  | { status: "no_match"; template: StoredTemplate }
  /** The template is there and matched: the interview follows its headings. */
  | { status: "headings"; template: StoredTemplate };

/** Starts the library's load (it is a no-op when loaded) and says which of the cases above the TRD is in. */
export function useHeadingFollow(d: TrdDocument): HeadingFollow {
  const items = useTemplates((s) => s.items);
  const ready = useTemplates((s) => s.ready);
  useEffect(() => {
    void useTemplates.getState().load();
  }, []);
  const choice = d.templateChoice;
  if (choice?.kind !== "mapped" || !choice.templateId) return { status: "off" };
  if (!ready) return { status: "loading" };
  const template = items.find((t) => t.id === choice.templateId);
  if (!template) return { status: "missing", templateName: choice.templateName ?? "the template" };
  return !template.trdMapping || template.analysis.outline.length === 0 ? { status: "no_match", template } : { status: "headings", template };
}

/**
 * The pieces of this TRD that a template heading can hold: the same list the match screen offers, made from the same document, so an id placed
 * there is an id found here. Only worked out when `wanted` (the interview of a TRD that does not use a template's headings does no extra work).
 */
export function useTrdUnits(d: TrdDocument, wanted: boolean): TrdUnitInfo[] {
  const project = useStore((s) => s.project);
  const content = useContent();
  const versionStamp = useVersionStamp();
  const [generatedAt] = useState(() => new Date().toISOString());
  return useMemo(() => {
    if (!wanted || !project) return [];
    const doc = stampDocument(buildTrdDocument(project, d, { generatedAt, appVersion: APP_VERSION, catalogVersion: content.versions.catalog, omit: [], content }), versionStamp);
    return trdUnitsOf(trdUnitModel(doc, d));
  }, [wanted, project, d, content, generatedAt, versionStamp]);
}
