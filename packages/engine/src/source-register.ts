import {
  allEntries,
  attachSource,
  detachSource,
  getEntry,
  removeSource,
  sourceUsage,
  verificationState,
  type Actor,
  type Project,
  type Source,
  type SourceType,
} from "@gap/process-model";
import { assess, type Gap } from "./compare";
import { categoryLabel, type ContentBundle } from "./content";
import { effectiveStaged } from "./custom";
import { sourceLabel, sourceShort } from "./labels";
import { entryDisplay, entryLabel, locationText, type EntryLabel } from "./labels";
import { activeRefs, visibleInstances } from "./sequencer";

/**
 * View models for the Sources page and the "what happens if I remove this source" preview.
 * Pure: the preview runs removeSource on a copy and compares the derived gaps, so it always matches
 * what the real removal does.
 */

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  interview_answer: "Interview answer",
  user_entry: "Note",
  imported_file: "Imported file",
  catalog_rule: "Catalog rule",
  document_reference: "Document reference",
  ai_extraction: "AI extraction",
  ai_suggestion: "AI suggestion",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ------------------------------------------------------------------ register rows

export interface CitingEntry extends EntryLabel {
  /** False when the entry belongs to a question that is no longer applicable (kept, but not compared). */
  active: boolean;
  display: string;
  /** Where in the source this entry cites it, "§4.2 p.12"; empty when no location was recorded. */
  location: string;
}

export interface SourceRow {
  source: Source;
  typeLabel: string;
  /** Identifier, title and version for a document reference; otherwise the label. */
  title: string;
  detail: string;
  responder: string;
  date: string;
  citing: CitingEntry[];
  state: "in_use" | "unused" | "superseded";
  stateText: string;
}

export function docDetail(s: Source): string {
  const d = s.docRef;
  if (!d) return s.file ? `File ${s.file.name}` : "";
  return [d.docType, d.title, d.version ? `version ${d.version}` : ""].filter(Boolean).join("; ");
}

/** One row per source, with the entries citing it. */
export function sourceRegisterRows(content: ContentBundle, project: Project): SourceRow[] {
  const eff = effectiveStaged(content, project);
  const active = activeRefs(visibleInstances(eff, project, "paired"));
  return sourceUsage(project).map(({ source, refs, unused }) => {
    const state = source.supersededBy && unused ? "superseded" : unused ? "unused" : "in_use";
    return {
      source,
      typeLabel: SOURCE_TYPE_LABELS[source.type],
      title: source.docRef ? source.docRef.identifier : sourceLabel(source),
      detail: docDetail(source),
      responder: source.responder ? `${source.responder.name}${source.responder.role ? ` (${source.responder.role})` : ""}` : "—",
      date: source.date.slice(0, 10),
      citing: refs.map((ref) => ({ ...entryLabel(eff, project, ref), active: active.has(ref), display: entryDisplay(eff, project, ref), location: locationText(getEntry(project, ref)?.sourceLocations?.[source.id]) })),
      state,
      stateText: state === "in_use" ? "In use" : state === "superseded" ? "Superseded, no longer cited" : "Unused",
    };
  });
}

export interface SourceFilter {
  type?: SourceType | "all";
  text?: string;
  onlyUnused?: boolean;
}

export function filterSourceRows(rows: SourceRow[], f: SourceFilter): SourceRow[] {
  const text = (f.text ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.type && f.type !== "all" && r.source.type !== f.type) return false;
    if (f.onlyUnused && r.state === "in_use") return false;
    if (!text) return true;
    return [r.source.label, sourceLabel(r.source), r.title, r.detail, r.responder, r.typeLabel, r.date, r.source.docRef?.identifier, r.source.docRef?.docType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(text);
  });
}

// ------------------------------------------------------------------ removal preview

export interface EntryImpact {
  ref: string;
  label: EntryLabel;
  /** The value that is recorded now. */
  display: string;
  verified: boolean;
  active: boolean;
  /** Short names of the sources that remain (empty when the entry reverts). */
  remaining: string[];
}

export interface GapChange {
  key: string;
  kind: "changed" | "disappears" | "appears";
  attribute: string;
  sectionTitle: string;
  before?: { displayId: string; category: string; categoryLabel: string };
  after?: { displayId: string; category: string; categoryLabel: string };
  /** One plain-language line, e.g. "G-014 Mixing speed: Outside validated range → Information required". */
  text: string;
}

export interface SourceRemovalPreview {
  source: Source;
  /** Entries that cite the source. */
  citing: number;
  /** Entries whose only source this is: they become "Not established" and the value is kept only in the change log. */
  reverting: EntryImpact[];
  /** Entries that keep another source and stay as they are. */
  staying: EntryImpact[];
  gapChanges: GapChange[];
  /** Verified entries (anywhere in the model) that stop being verified once the source is gone. */
  verificationsWithdrawn: number;
  openItemsBefore: number;
  openItemsAfter: number;
  /** The impact in plain language, one sentence per line. */
  lines: string[];
}

const PREVIEW_ACTOR = { name: "Preview", at: "1970-01-01T00:00:00.000Z" };

function describeGap(content: ContentBundle, g: Gap) {
  return { displayId: g.displayId, category: g.category, categoryLabel: categoryLabel(content, g.category) };
}

/**
 * What removing a source would do. Runs the real removeSource on a copy and compares the gaps derived
 * before and after, using the project's custom definitions. Inactive values are listed but do not drive gaps.
 */
export function previewSourceRemoval(content: ContentBundle, project: Project, sourceId: string): SourceRemovalPreview {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error(`Unknown source ${sourceId}`);
  const eff = effectiveStaged(content, project);
  const { project: after } = removeSource(project, sourceId, PREVIEW_ACTOR);
  const a0 = assess(eff, project);
  const a1 = assess(eff, after);
  const active = activeRefs(a0.instances);

  const reverting: EntryImpact[] = [];
  const staying: EntryImpact[] = [];
  for (const e of allEntries(project)) {
    if (!e.sourceIds.includes(sourceId)) continue;
    const remaining = e.sourceIds.filter((id) => id !== sourceId);
    const impact: EntryImpact = {
      ref: e.path,
      label: entryLabel(eff, project, e.path),
      display: entryDisplay(eff, project, e.path),
      verified: verificationState(project, e.path).state === "verified",
      active: active.has(e.path),
      remaining: remaining.map((id) => project.sources.find((s) => s.id === id)).filter((s): s is Source => !!s).map(sourceShort),
    };
    // An entry already "not established" cannot lose anything more.
    if (remaining.length === 0 && e.status !== "not_established") reverting.push(impact);
    else staying.push(impact);
  }

  const before = new Map(a0.gaps.map((g) => [g.key, g]));
  const afterMap = new Map(a1.gaps.map((g) => [g.key, g]));
  const gapChanges: GapChange[] = [];
  for (const [key, g0] of before) {
    const g1 = afterMap.get(key);
    if (!g1) {
      gapChanges.push({
        key,
        kind: "disappears",
        attribute: g0.attribute,
        sectionTitle: g0.sectionTitle,
        before: describeGap(eff, g0),
        text: `${g0.displayId} ${g0.attribute}: ${categoryLabel(eff, g0.category)} → no longer assessed`,
      });
    } else if (g1.category !== g0.category) {
      gapChanges.push({
        key,
        kind: "changed",
        attribute: g0.attribute,
        sectionTitle: g0.sectionTitle,
        before: describeGap(eff, g0),
        after: describeGap(eff, g1),
        text: `${g0.displayId} ${g0.attribute}: ${categoryLabel(eff, g0.category)} → ${categoryLabel(eff, g1.category)}`,
      });
    }
  }
  for (const [key, g1] of afterMap) {
    if (before.has(key)) continue;
    gapChanges.push({
      key,
      kind: "appears",
      attribute: g1.attribute,
      sectionTitle: g1.sectionTitle,
      after: describeGap(eff, g1),
      text: `${g1.displayId} ${g1.attribute}: new, ${categoryLabel(eff, g1.category)}`,
    });
  }

  let verificationsWithdrawn = 0;
  for (const e of allEntries(project)) {
    if (verificationState(project, e.path).state === "verified" && verificationState(after, e.path).state !== "verified") verificationsWithdrawn++;
  }

  const lines: string[] = [];
  if (reverting.length === 0 && staying.length === 0) lines.push("No entry cites this source. Removing it changes no value.");
  if (reverting.length) {
    lines.push(
      `${plural(reverting.length, "value will lose its only source and become “Not established”", "values will lose their only source and become “Not established”")}. The value is then kept only in the change log.`,
    );
  }
  if (staying.length) lines.push(`${plural(staying.length, "value keeps", "values keep")} another source and stays as it is.`);
  if (verificationsWithdrawn) lines.push(`${plural(verificationsWithdrawn, "verification will be withdrawn", "verifications will be withdrawn")}.`);
  if (gapChanges.length) lines.push(`${plural(gapChanges.length, "gap will change", "gaps will change")}: ${gapChanges.map((c) => c.text).join("; ")}.`);
  else if (reverting.length) lines.push("No gap changes.");
  const openItemsBefore = a0.openItems.length;
  const openItemsAfter = a1.openItems.length;
  if (openItemsAfter > openItemsBefore) {
    lines.push(`${plural(openItemsAfter - openItemsBefore, "more open information item", "more open information items")} will appear.`);
  }
  const hidden = reverting.filter((r) => !r.active).length;
  if (hidden) lines.push(`${plural(hidden, "of the values is", "of the values are")} not currently asked about (inactive), so no gap is affected by ${hidden === 1 ? "it" : "them"}.`);

  return { source, citing: reverting.length + staying.length, reverting, staying, gapChanges, verificationsWithdrawn, openItemsBefore, openItemsAfter, lines };
}

// ------------------------------------------------------------------ attach and detach on one attribute

/** Sources that could be attached to the entries behind an attribute: not superseded, and not already cited by every one of them. */
export function attachableSources(project: Project, refs: string[]): Source[] {
  const entries = refs.map((r) => getEntry(project, r)).filter((e) => !!e && e.status !== "not_established");
  if (!entries.length) return [];
  return project.sources.filter((s) => !s.supersededBy && entries.some((e) => !e!.sourceIds.includes(s.id)));
}

/** Attaches a source to every recorded entry of an attribute that does not cite it yet. */
export function attachToCell(project: Project, refs: string[], sourceId: string, actor: Actor): Project {
  const todo = refs.filter((r) => {
    const e = getEntry(project, r);
    return !!e && e.status !== "not_established" && !e.sourceIds.includes(sourceId);
  });
  if (!todo.length) throw new Error("Nothing to attach: every recorded entry here already cites that source");
  return todo.reduce((p, r) => attachSource(p, r, sourceId, actor), project);
}

export interface DetachPreview {
  /** Entries whose only source this is: they would become "Not established". */
  reverting: string[];
  staying: string[];
  /** Plain-language warning shown before detaching; empty when nothing is lost. */
  warning: string;
}

export function previewDetach(project: Project, refs: string[], sourceId: string): DetachPreview {
  const reverting: string[] = [];
  const staying: string[] = [];
  for (const r of refs) {
    const e = getEntry(project, r);
    if (!e || !e.sourceIds.includes(sourceId)) continue;
    if (e.sourceIds.length === 1 && e.status !== "not_established") reverting.push(r);
    else staying.push(r);
  }
  const warning = reverting.length
    ? `This is the only source for ${reverting.length === 1 ? "this value" : `${reverting.length} values`}. Detaching it makes ${reverting.length === 1 ? "it" : "them"} “Not established” and keeps the value only in the change log.`
    : "";
  return { reverting, staying, warning };
}

/** Detaches a source from every entry of an attribute that cites it. */
export function detachFromCell(project: Project, refs: string[], sourceId: string, actor: Actor): { project: Project; reverted: number } {
  let cur = project;
  let reverted = 0;
  for (const r of refs) {
    const e = getEntry(cur, r);
    if (!e || !e.sourceIds.includes(sourceId)) continue;
    const res = detachSource(cur, r, sourceId, actor);
    cur = res.project;
    if (res.reverted) reverted++;
  }
  return { project: cur, reverted };
}
