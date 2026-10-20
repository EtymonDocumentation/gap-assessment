import {
  getEntry,
  isCustomKey,
  parseRef,
  resolveEntry,
  type CustomItemKind,
  type EntryStatus,
  type Project,
} from "@gap/process-model";
import type { Assessment, Gap } from "./compare";
import { fieldLabel, type ContentBundle } from "./content";
import type { Question, Section } from "./content-schema";
import { stagedFor } from "./stage";
import { CUSTOM_KIND_LABELS, isCustomQuestion, isCustomSection, recordedEntries } from "./custom";
import { sourceShort } from "./labels";
import { cellVerification, type CellVerification } from "./verification";
import { formatQuestionSide, formatResolved, questionLabel } from "./format";
import { instanceRefs, type QuestionInstance } from "./sequencer";

/**
 * View model for the Builder page: every visible attribute of the process model with its source and
 * target values, status, sources, verification and revision, plus the values that are no longer active
 * and the custom definitions. Pure; the UI only renders it.
 */

export type AggregateStatus = EntryStatus | "partial";

export interface AttributeSide {
  inst: QuestionInstance;
  refs: string[];
  display: string;
  status: AggregateStatus;
  statusText: string;
  sameAsSource: boolean;
  /** Unknown or not yet established: an open information item. */
  open: boolean;
  /** Entries that hold a value here, with the source cited by each (for attaching and detaching). */
  sourceLinks: { id: string; label: string; refs: string[] }[];
  verification: CellVerification;
  sources: string[];
  revision: number;
}

export interface BuilderAttribute {
  id: string;
  question: Question;
  label: string;
  custom: boolean;
  depth: number;
  shared?: AttributeSide;
  source?: AttributeSide;
  target?: AttributeSide;
  gaps: Gap[];
  /** At least one comparison result that is not "equivalent". */
  differs: boolean;
  open: boolean;
}

export interface BuilderSection {
  section: Section;
  custom: boolean;
  attributes: BuilderAttribute[];
}

export interface InactiveRow {
  ref: string;
  side: "source" | "target" | "shared";
  where: string;
  name: string;
  display: string;
  reason: string;
  sources: string[];
  verification: string;
  revision: number;
}

export interface CustomDefinitionRow {
  kind: "uo" | "item";
  id: string;
  uo: string;
  uoLabel: string;
  coll?: CustomItemKind;
  key: string;
  label: string;
  typeText: string;
  dimension?: string;
  why?: string;
  createdBy: string;
  createdAt: string;
  /** Recorded values that would become inactive if the definition were removed. */
  recorded: number;
}

export interface ModelView {
  sections: BuilderSection[];
  inactive: InactiveRow[];
  definitions: CustomDefinitionRow[];
}

const STATUS_TEXT: Record<AggregateStatus, string> = {
  established: "Established",
  unknown: "Unknown",
  not_applicable: "Not applicable",
  not_established: "Not established",
  partial: "Partly recorded",
};

const FIELD_OPTION_SET: Record<string, string> = { classification: "classification", rangeBasis: "rangeBasis" };

function sideOf(content: ContentBundle, project: Project, inst: QuestionInstance): AttributeSide {
  const refs = instanceRefs(inst);
  const resolved = refs.map((r) => resolveEntry(project, r));
  const statuses = new Set(resolved.map((r) => r.status));
  const status: AggregateStatus = statuses.size === 1 ? [...statuses][0]! : "partial";
  const entries = refs.map((r) => getEntry(project, r)).filter((e) => !!e);
  const ids = new Set(entries.flatMap((e) => e!.sourceIds));
  const same = resolved.length > 0 && resolved.every((r) => r.sameAsSource);
  return {
    inst,
    refs,
    display: formatQuestionSide(content, project, inst.question, inst.side),
    status,
    statusText: same && status === "established" ? "Same as source" : STATUS_TEXT[status],
    sameAsSource: same,
    open: resolved.some((r) => r.status === "unknown" || r.status === "not_established"),
    sources: [...new Set(project.sources.filter((s) => ids.has(s.id)).map(sourceShort))],
    sourceLinks: project.sources
      .filter((s) => ids.has(s.id))
      .map((s) => ({ id: s.id, label: sourceShort(s), refs: refs.filter((r) => getEntry(project, r)?.sourceIds.includes(s.id)) })),
    verification: cellVerification(project, refs),
    revision: entries.reduce((m, e) => Math.max(m, e!.revision), 0),
  };
}

function inactiveRows(content: ContentBundle, project: Project, a: Assessment): InactiveRow[] {
  const customUos = new Set(project.custom.unitOperations.map((u) => u.key));
  const customItems = new Set(project.custom.items.map((i) => `${i.uo}.${i.coll}.${i.key}`));
  const rows: InactiveRow[] = [];
  for (const e of a.inactive) {
    const p = parseRef(e.path);
    const r = resolveEntry(project, e.path);
    const field = p.side === "shared" ? p.key : p.field;
    let where = "Scoping";
    let name = field;
    let reason = "A later answer closed this question, so the value no longer applies. It is kept.";
    if (p.side !== "shared") {
      if (p.kind === "site") {
        where = "Site and facility";
        name = fieldLabel(content, p.field);
      } else {
        const uo = project.processes[p.side].unitOperations[p.uo];
        where = uo?.label ?? p.uo;
        if (p.kind === "uo") name = fieldLabel(content, p.field);
        else {
          const item = uo?.collections[p.coll][p.item];
          name = `${item?.label ?? p.item}: ${fieldLabel(content, p.field)}`;
        }
        if (isCustomKey(p.uo) && !customUos.has(p.uo)) reason = "The custom unit operation was removed. The value is kept.";
        else if (p.kind === "item" && isCustomKey(p.item) && !customItems.has(`${p.uo}.${p.coll}.${p.item}`)) {
          reason = "The custom item was removed. The value is kept.";
        }
      }
    }
    const ids = new Set(e.sourceIds);
    rows.push({
      ref: e.path,
      side: p.side,
      where,
      name,
      display: formatResolved(content, undefined, r, FIELD_OPTION_SET[field]),
      reason,
      sources: [...new Set(project.sources.filter((s) => ids.has(s.id)).map(sourceShort))],
      verification: cellVerification(project, [e.path]).text,
      revision: e.revision,
    });
  }
  return rows;
}

function definitionRows(content: ContentBundle, project: Project): CustomDefinitionRow[] {
  const uoLabel = (key: string) => content.catalog.unitOperations.find((u) => u.key === key)?.label ?? key;
  const rows: CustomDefinitionRow[] = [];
  for (const u of project.custom.unitOperations) {
    rows.push({
      kind: "uo",
      id: `uo:${u.key}`,
      uo: u.key,
      uoLabel: u.label,
      key: u.key,
      label: u.label,
      typeText: "Unit operation",
      ...(u.description ? { why: u.description } : {}),
      createdBy: u.createdBy,
      createdAt: u.createdAt,
      recorded: recordedEntries(project, { uo: u.key }).length,
    });
  }
  for (const i of project.custom.items) {
    rows.push({
      kind: "item",
      id: `item:${i.uo}.${i.coll}.${i.key}`,
      uo: i.uo,
      uoLabel: uoLabel(i.uo),
      coll: i.coll,
      key: i.key,
      label: i.label,
      typeText: CUSTOM_KIND_LABELS[i.coll],
      ...(i.dimension ? { dimension: i.dimension } : {}),
      ...(i.why ? { why: i.why } : {}),
      createdBy: i.createdBy,
      createdAt: i.createdAt,
      recorded: recordedEntries(project, { uo: i.uo, coll: i.coll, key: i.key }).length,
    });
  }
  return rows;
}

export function buildModelView(rawContent: ContentBundle, project: Project, a: Assessment): ModelView {
  const content = stagedFor(rawContent, project);
  const gapsByQ = new Map<string, Gap[]>();
  for (const g of a.gaps) gapsByQ.set(g.questionId, [...(gapsByQ.get(g.questionId) ?? []), g]);

  const bySection = new Map<string, Map<string, BuilderAttribute>>();
  for (const inst of a.instances) {
    const attrs = bySection.get(inst.section.id) ?? new Map<string, BuilderAttribute>();
    bySection.set(inst.section.id, attrs);
    const q = inst.question;
    let attr = attrs.get(q.id);
    if (!attr) {
      const gaps = gapsByQ.get(q.id) ?? [];
      attr = {
        id: q.id,
        question: q,
        label: questionLabel(q),
        custom: isCustomQuestion(q),
        depth: inst.depth,
        gaps,
        differs: gaps.some((g) => g.category !== "equivalent"),
        open: false,
      };
      attrs.set(q.id, attr);
    }
    const side = sideOf(content, project, inst);
    attr[inst.side] = side;
    if (side.open) attr.open = true;
  }

  const sections: BuilderSection[] = content.sections
    .filter((s) => bySection.has(s.id))
    .map((section) => ({ section, custom: isCustomSection(section), attributes: [...bySection.get(section.id)!.values()] }));

  return { sections, inactive: inactiveRows(content, project, a), definitions: definitionRows(content, project) };
}

export interface ModelFilter {
  text?: string;
  onlyDifferences?: boolean;
  onlyOpen?: boolean;
  /** Attributes with a withdrawn or partial verification, or a value that could be verified and is not. */
  onlyUnverified?: boolean;
}

function needsVerification(a: BuilderAttribute): boolean {
  return [a.shared, a.source, a.target].some((s) => {
    if (!s) return false;
    const v = s.verification;
    return v.state === "withdrawn" || v.state === "partial" || (v.state === "unverified" && v.verifiable.length > 0);
  });
}

/** Applies the Builder filters. A section whose title matches the text keeps all its attributes that pass the toggles. */
export function filterModelView(view: ModelView, f: ModelFilter): ModelView {
  const text = (f.text ?? "").trim().toLowerCase();
  const sections = view.sections
    .map((s) => {
      const titleHit = !!text && s.section.title.toLowerCase().includes(text);
      const attributes = s.attributes.filter((a) => {
        if (f.onlyDifferences && !a.differs) return false;
        if (f.onlyOpen && !a.open) return false;
        if (f.onlyUnverified && !needsVerification(a)) return false;
        if (!text || titleHit) return true;
        const hay = [a.label, a.question.prompt, a.question.binds, a.source?.display, a.target?.display, a.shared?.display].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(text);
      });
      return { ...s, attributes };
    })
    .filter((s) => s.attributes.length > 0);
  const inactive = text
    ? view.inactive.filter((r) => [r.where, r.name, r.ref, r.display].join(" ").toLowerCase().includes(text))
    : view.inactive;
  return { sections, inactive: f.onlyDifferences || f.onlyOpen || f.onlyUnverified ? [] : inactive, definitions: view.definitions };
}

