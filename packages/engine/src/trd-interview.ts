import { blanksOf, optionSchema, unitsForDimension, type Actor, type Option, type Project, type SeedCollection, type TrdControl, type TrdDocument, type TrdField, type TrdItem, type TrdLibraryWriteup, type TrdLimits, type TrdPulled, type TrdStep } from "@gap/process-model";
import { z } from "zod";
import type { ContentBundle } from "./content";
import { optionsFor } from "./content";
import type { Question } from "./content-schema";
import { evaluate } from "./conditions";
import { adaptText, projectStage, resolveStageMarkers, sourceValidated, type ProgramStage } from "./stage";
import { TrdError, addCatalogTrdItem, addEmptyTrdField, addTrdStep, effectiveField, setControl, setLimits, setOverride, updateTrd, type FieldHome, type ItemRef } from "./trd";
import { rangeText, setPointText } from "./trd-check";
import { TrdWriteupError, activeParts, addWriteupFromLibrary, resolveBlank, setBlankValue, writeupsAvailable, type BlankContext } from "./trd-writeup";
import { writeupsInOrder } from "./trd-writeup-order";

/*
 * The TRD interview: plain questions that fill the SAME TRD the form and the write-ups fill. Nothing here is stored. The question list is
 * derived from the TRD, the write-up blanks, the catalog and the project stage every time it is asked for, so it can never disagree with
 * the document; an answer is written through the existing edit functions (one change-log event each), so the record, the export and the
 * checks see it exactly as if it had been typed into the form. No question carries a default, and nothing here blocks saving.
 */

// ------------------------------------------------------------------ wording

const wordingEntrySchema = z
  .object({
    prompt: z.string().min(1),
    why: z.string().min(1),
    hint: z.string().optional(),
    /** Glossary term ids (the hint links to #/glossary?term=<id>). */
    glossary: z.array(z.string()).optional(),
    /** Overrides of what the gap-assessment question with the same path would give. */
    input: z.enum(["text", "long_text", "number", "quantity", "yes_no", "choice", "multi_choice", "date", "range", "limits"]).optional(),
    units: z.array(z.string()).optional(),
    choices: z.array(optionSchema).optional(),
  })
  .strict();
export type TrdInterviewWordingEntry = z.infer<typeof wordingEntrySchema>;

export const trdInterviewWordingSchema = z.object({ version: z.string().min(1), changelog: z.array(z.object({ version: z.string(), note: z.string() }).passthrough()).optional(), questions: z.record(z.string(), wordingEntrySchema) }).strict();
export type TrdInterviewWording = z.infer<typeof trdInterviewWordingSchema>;

/** Reads the shipped wording file (content/trd-interview/wording.yaml). Throws with the first problem named. */
export function parseTrdInterviewWording(raw: unknown): TrdInterviewWording {
  const r = trdInterviewWordingSchema.safeParse(raw);
  if (!r.success) throw new Error(`trd-interview/wording.yaml: ${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

// ------------------------------------------------------------------ the question model

export type InterviewInput = "text" | "long_text" | "number" | "quantity" | "yes_no" | "choice" | "multi_choice" | "date" | "range" | "limits";
export type InterviewState = "answered" | "open" | "tbd" | "not_applicable" | "from_project";
export type DocField = "title" | "docRef" | "version" | "purpose" | "scopeNote";
export type LimitPart = "setPoint" | "nor" | "par";

export type InterviewTarget =
  | { kind: "document"; field: DocField }
  | { kind: "detail"; field: string }
  | { kind: "presence"; unitOp: string }
  | { kind: "field"; unitOp: string; collection: SeedCollection; itemKey: string; field: string }
  | { kind: "limits"; unitOp: string; collection: "param" | "ipc"; itemKey: string; parts: LimitPart[] }
  | { kind: "control"; unitOp: string; itemKey: string }
  | { kind: "blank"; blankKey: string };

export interface InterviewSource {
  kind: "gap assessment" | "uploaded file" | "seed";
  name?: string;
  section?: string;
  page?: string;
}

export interface InterviewQuestion {
  /** doc:<field> | detail:<key> | step:<op>.presence | limits:<op>.<coll>.<item> | field:<op>.<coll>.<item>.<field> | control:<op>.param.<item> | blank:<key> */
  key: string;
  target: InterviewTarget;
  /** The unit operation, or "document" for the first group (document fields, details and TRD-level prose). */
  stepKey: string;
  stepLabel: string;
  /** Key of the first write-up that holds the question (the section the answer ends up in). */
  sectionKey?: string;
  order: number;
  /** True: the TRD text reads it. False: "More detail" (catalog fields the text does not read). */
  essential: boolean;
  prompt: string;
  why: string;
  hint?: string;
  glossary: string[];
  input: InterviewInput;
  units: string[];
  choices: Option[];
  /** Stages for which the question exists, when every part that holds it is an optional part with stages. */
  stages?: ProgramStage[];
  /** The label the blank has in the write-up text. */
  blankLabel?: string;
  usedIn: { writeupId: string; title: string }[];
  state: InterviewState;
  /** The value the TRD shows now (an unknown one stays visible as "TBD"). */
  current?: string;
  source?: InterviewSource;
  reason?: string;
  canTbd: boolean;
  canNotApplicable: boolean;
  /** False: the sentence was generated from the labels (no wording written yet). */
  wordingWritten: boolean;
}

export interface InterviewOptions {
  content: ContentBundle;
  wording: TrdInterviewWording;
}

export const INTERVIEW_DOCUMENT_GROUP = "document";
export const INTERVIEW_DOCUMENT_LABEL = "Document and details";

const DOC_FIELDS: DocField[] = ["title", "docRef", "purpose", "version", "scopeNote"];
const DETAIL_KEYS = ["program", "modality", "dosageForm", "presentation", "site", "line"];
/** Write-up blanks that the details already hold (the TRD owns them). The stage is not asked here: it is the project stage. */
const DETAIL_OF_BLANK: Record<string, string> = { "scope.program": "program", "scope.modality": "modality", "scope.dosage_form": "dosageForm", "scope.presentation": "presentation", "site.name": "site", "site.line": "line" };
const DETAIL_BIND: Record<string, string> = { program: "scope.program", modality: "scope.modality", dosageForm: "scope.dosage_form", presentation: "scope.presentation", site: "site.name", line: "site.line" };
const NOT_ASKED = new Set(["site.programStage"]);
const UO_KEY = /^uo\.([a-z0-9_]+)\.(param|equip|mat|ipc|doc|study)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/;
const LIMIT_PARTS: readonly string[] = ["setPoint", "nor", "par"];
const DOC_LABEL: Record<DocField, string> = { title: "title", docRef: "document reference", purpose: "purpose", version: "version", scopeNote: "scope note" };
const NOT_APPLICABLE_TEXT = "Not applicable";

const text = (v: string | undefined) => (v ?? "").trim();
const cleanLabel = (l: string) => l.replace(/\s+~.*$/, "").trim();

/** The gap-assessment questions by the path they bind, and by catalog item, built once per content bundle. */
interface GapIndex {
  byBind: Map<string, Question>;
  byItem: Map<string, Question[]>;
}
const gapIndexes = new WeakMap<ContentBundle, GapIndex>();
function gapIndex(content: ContentBundle): GapIndex {
  const hit = gapIndexes.get(content);
  if (hit) return hit;
  const byBind = new Map<string, Question>();
  const byItem = new Map<string, Question[]>();
  // A follow-up question (with a parent) still gives the choices and units of its path when no main question binds it.
  for (const q of [...content.questions.filter((x) => !x.parent), ...content.questions.filter((x) => x.parent)]) {
    if (byBind.has(q.binds)) continue;
    byBind.set(q.binds, q);
    const m = UO_KEY.exec(q.binds);
    if (m) {
      const k = `uo.${m[1]}.${m[2]}.${m[3]}`;
      byItem.set(k, [...(byItem.get(k) ?? []), q]);
    }
  }
  const idx = { byBind, byItem };
  gapIndexes.set(content, idx);
  return idx;
}

function inputFromGap(content: ContentBundle, q: Question | undefined): { input?: InterviewInput; units: string[]; choices: Option[] } {
  if (!q) return { units: [], choices: [] };
  const t = q.input.type;
  const units = q.input.units ?? (q.input.dimension ? unitsForDimension(q.input.dimension).map((u) => u.symbol) : []);
  if (t === "choice" || t === "multi_choice" || t === "yes_no") return { input: t, units: [], choices: optionsFor(content, q).map((o) => ({ ...o })) };
  if (t === "quantity") return { input: "quantity", units, choices: [] };
  if (t === "range") return { input: "range", units, choices: [] };
  if (t === "parameter") return { input: "limits", units, choices: [] };
  return { input: "text", units: [], choices: [] };
}

// ------------------------------------------------------------------ state of one value

/** Where a project value came from: the TRD's own origin tells which kind of source brought it in. */
function pulledSource(d: TrdDocument, p: TrdPulled): InterviewSource {
  const kind = d.origin.kind === "project" ? "gap assessment" : d.origin.kind === "seed-import" ? "seed" : "uploaded file";
  const loc = p.locations ? Object.values(p.locations)[0] : undefined;
  return { kind, ...(loc?.section ? { section: loc.section } : {}), ...(loc?.page ? { page: loc.page } : {}) };
}

interface ValueState {
  state: InterviewState;
  current?: string;
  source?: InterviewSource;
  reason?: string;
}

function fieldState(d: TrdDocument, f: TrdField | undefined): ValueState {
  if (!f) return { state: "open" };
  const v = effectiveField(f);
  if (f.override) {
    const o = f.override;
    const imported = /^Imported from /.exec(o.reason ?? "");
    const source: InterviewSource | undefined = imported ? { kind: "uploaded file", name: (o.reason ?? "").slice("Imported from ".length).trim() } : undefined;
    if (o.status === "established") return { state: "answered", current: v.text, ...(source ? { source } : {}) };
    if (o.status === "not_applicable") return { state: "not_applicable", current: v.text, ...(o.reason ? { reason: o.reason } : {}) };
    if (o.status === "tbd") return { state: "tbd", current: v.text, ...(o.reason ? { reason: o.reason } : {}) };
    return { state: "open" };
  }
  if (f.pulled) {
    if (f.pulled.status === "established" || f.pulled.status === "not_applicable") return { state: "from_project", current: v.text, source: pulledSource(d, f.pulled) };
    if (f.pulled.status === "tbd") return { state: "tbd", current: v.text };
  }
  return { state: "open" };
}

function limitSource(lim: { note?: string } | undefined): InterviewSource | undefined {
  const m = /^Taken from (.+) on upload$/.exec(lim?.note ?? "");
  return m ? { kind: "uploaded file", name: m[1]! } : undefined;
}

function limitsState(d: TrdDocument, item: TrdItem | undefined, parts: readonly LimitPart[]): ValueState {
  const per = parts.map((part) => {
    const lim = item?.limits?.[part];
    if (lim) return { v: { state: "answered" } as ValueState, lim };
    return { v: fieldState(d, item?.fields.find((f) => f.key === part)), lim: undefined };
  });
  const states = per.map((p) => p.v.state);
  const state: InterviewState = states.includes("open") ? "open" : states.includes("tbd") ? "tbd" : states.includes("from_project") ? "from_project" : states.every((s) => s === "not_applicable") ? "not_applicable" : "answered";
  const bits: string[] = [];
  const l: TrdLimits = item?.limits ?? {};
  if (l.setPoint) bits.push(`set point ${setPointText(l.setPoint)}`);
  if (l.nor) bits.push(`NOR ${rangeText(l.nor)}`);
  if (l.par) bits.push(`PAR ${rangeText(l.par)}`);
  for (const p of per) if (!p.lim && p.v.current && p.v.state !== "open") bits.push(p.v.current);
  const source = per.map((p) => limitSource(p.lim as { note?: string } | undefined) ?? p.v.source).find(Boolean);
  return { state, ...(bits.length ? { current: bits.join("; ") } : {}), ...(source ? { source } : {}) };
}

function blankState(ctx: BlankContext, w: { id: string } & Parameters<typeof resolveBlank>[1], key: string, label: string): ValueState {
  const r = resolveBlank(ctx, w, key, label);
  if (!r.filled) return { state: r.note ? "tbd" : "open" };
  if (r.origin === "project") return { state: "from_project", current: r.value, source: { kind: "gap assessment" } };
  if (r.origin === "entered" && r.value === NOT_APPLICABLE_TEXT) return { state: "not_applicable", current: r.value };
  return { state: "answered", current: r.value };
}

// ------------------------------------------------------------------ deriving the questions

interface Draft {
  key: string;
  target: InterviewTarget;
  stepKey: string;
  sectionKey?: string;
  essential: boolean;
  label: string;
  itemLabel?: string;
  gapBind?: string;
  blankLabel?: string;
  usedIn: { writeupId: string; title: string }[];
  stages?: ProgramStage[];
  allOptional: boolean;
  state: ValueState;
  canTbd: boolean;
  canNotApplicable: boolean;
}

const partBlankLabels = (p: { text: string; kind: string; rows?: string[][] }) => [...blanksOf(p.text), ...(p.kind === "table" ? (p.rows ?? []).flatMap((r) => r.flatMap((c) => blanksOf(c))) : [])];

/**
 * The ordered questions of one TRD. The first group is "Document and details"; then every unit operation of the catalog in chain order,
 * each opening with the presence question. A step marked not performed shows only that question. A step the TRD does not hold yet shows
 * only the presence question too: saying "yes" adds the step and its description, and the rest of its questions appear then.
 */
export function deriveTrdQuestions(project: Project, trdId: string, opts: InterviewOptions): InterviewQuestion[] {
  const { content, wording } = opts;
  const d = project.trd.documents.find((x) => x.id === trdId);
  if (!d) throw new TrdError(`TRD ${trdId} does not exist`);
  const stage = projectStage(project);
  const bctx: BlankContext = { project, doc: d, content };
  const gap = gapIndex(content);
  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();
  const add = (x: Draft) => {
    if (byKey.has(x.key)) return byKey.get(x.key)!;
    byKey.set(x.key, x);
    drafts.push(x);
    return x;
  };
  const fieldLabel = (f: string, q?: Question) => content.catalog.fieldLabels[f] ?? q?.label ?? f;
  const blank = (o: Partial<Draft> & Pick<Draft, "key" | "target" | "stepKey" | "label">): Draft => ({ essential: true, usedIn: [], allOptional: true, state: { state: "open" }, canTbd: true, canNotApplicable: true, ...o });

  // The first group: the document's own fields, then the six details.
  const docGroup: Draft[] = [];
  for (const f of DOC_FIELDS) {
    const v = text(d[f]);
    docGroup.push(blank({ key: `doc:${f}`, target: { kind: "document", field: f }, stepKey: INTERVIEW_DOCUMENT_GROUP, label: DOC_LABEL[f], allOptional: false, state: v ? { state: "answered", current: v } : { state: "open" }, canTbd: false, canNotApplicable: false }));
  }
  for (const k of DETAIL_KEYS) {
    const f = d.details.find((x) => x.key === k);
    docGroup.push(blank({ key: `detail:${k}`, target: { kind: "detail", field: k }, stepKey: INTERVIEW_DOCUMENT_GROUP, label: f?.label ?? k, gapBind: DETAIL_BIND[k]!, allOptional: false, state: fieldState(d, f) }));
  }
  const detailDraft = new Map(docGroup.map((x) => [x.key, x]));

  // Essentials: the blanks of the write-ups, in document order. A blank belongs to the FIRST write-up that holds it; the others read the
  // same value through the cross-write-up lookup, so the question is asked once and lists every place it is used.
  const essentials: Draft[] = [];
  const stepOfKey = (key: string) => d.steps.find((s) => s.key === key);
  for (const w of writeupsInOrder(d)) {
    const refs = w.notApplicable?.on ? blanksOf(w.notApplicable.text).map((b) => ({ ...b, optional: undefined as { stages?: readonly ProgramStage[] } | undefined })) : activeParts(w, stage).flatMap((p) => partBlankLabels(p).map((b) => ({ ...b, optional: p.optional })));
    const home = w.kind === "unitOp" ? (w.key as string) : w.placement?.unitOp ?? INTERVIEW_DOCUMENT_GROUP;
    for (const b of refs) {
      const detailKey = DETAIL_OF_BLANK[b.key];
      let draft: Draft | undefined;
      if (detailKey) draft = detailDraft.get(`detail:${detailKey}`);
      else if (NOT_ASKED.has(b.key)) continue;
      else {
        const m = UO_KEY.exec(b.key);
        const label = cleanLabel(b.label);
        if (m && (m[2] === "param" || m[2] === "ipc") && LIMIT_PARTS.includes(m[4]!)) {
          const key = `limits:${m[1]}.${m[2]}.${m[3]}`;
          const have = byKey.get(key);
          const part = m[4] as LimitPart;
          if (have) {
            const t = have.target as Extract<InterviewTarget, { kind: "limits" }>;
            if (!t.parts.includes(part)) t.parts.push(part);
            draft = have;
          } else {
            draft = add(blank({ key, target: { kind: "limits", unitOp: m[1]!, collection: m[2], itemKey: m[3]!, parts: [part] }, stepKey: m[1]!, label, gapBind: `uo.${m[1]}.${m[2]}.${m[3]}`, blankLabel: label }));
            essentials.push(draft);
          }
        } else if (m) {
          const key = `field:${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
          draft = byKey.get(key) ?? add(blank({ key, target: { kind: "field", unitOp: m[1]!, collection: m[2] as SeedCollection, itemKey: m[3]!, field: m[4]! }, stepKey: m[1]!, label, gapBind: b.key, blankLabel: label }));
          if (!essentials.includes(draft)) essentials.push(draft);
        } else {
          const key = `blank:${b.key}`;
          if (!byKey.has(key)) {
            draft = add(blank({ key, target: { kind: "blank", blankKey: b.key }, stepKey: home, label, gapBind: b.key, blankLabel: label, canTbd: false, state: blankState(bctx, w, b.key, label) }));
            essentials.push(draft);
          } else draft = byKey.get(key);
        }
      }
      if (!draft) continue;
      if (!draft.usedIn.some((u) => u.writeupId === w.id)) draft.usedIn.push({ writeupId: w.id, title: w.title });
      draft.sectionKey ??= w.key;
      if (!b.optional) draft.allOptional = false;
      else if (draft.allOptional) draft.stages = [...new Set([...(draft.stages ?? []), ...(b.optional.stages ?? [])])] as ProgramStage[];
    }
  }

  // The state of the TRD-backed questions is read from the record, not from the write-up, so a typed blank and a form entry agree.
  const itemOf = (op: string, coll: string, key: string): TrdItem | undefined => stepOfKey(op)?.items.find((i) => i.collection === coll && i.key === key);
  for (const e of essentials) {
    const t = e.target;
    if (t.kind === "field") {
      const it = itemOf(t.unitOp, t.collection, t.itemKey);
      e.itemLabel = it?.label ?? catalogItemLabel(content, t.unitOp, t.collection, t.itemKey);
      e.state = fieldState(d, it?.fields.find((f) => f.key === t.field));
    } else if (t.kind === "limits") {
      const it = itemOf(t.unitOp, t.collection, t.itemKey);
      e.itemLabel = it?.label ?? catalogItemLabel(content, t.unitOp, t.collection, t.itemKey);
      e.state = limitsState(d, it, t.parts);
    }
  }

  // Assemble: the document group, its prose, then each step.
  const out: Draft[] = [...docGroup, ...essentials.filter((e) => e.stepKey === INTERVIEW_DOCUMENT_GROUP)];
  const ops = [...content.catalog.unitOperations].sort((a, b) => a.sequence - b.sequence);
  for (const uo of ops) {
    const step = stepOfKey(uo.key);
    const presenceField = step?.fields.find((f) => f.key === "presence");
    const presence: ValueState = !step ? { state: "open" } : presenceField ? fieldState(d, presenceField) : { state: "answered", current: "In the TRD" };
    out.push(blank({ key: `step:${uo.key}.presence`, target: { kind: "presence", unitOp: uo.key }, stepKey: uo.key, label: uo.label, gapBind: `uo.${uo.key}.presence`, allOptional: false, state: presence, canNotApplicable: false, canTbd: false }));
    if (!step || presence.state === "not_applicable") continue;
    const mine = essentials.filter((e) => e.stepKey === uo.key);
    out.push(...mine);
    const seen = new Set(out.map((x) => x.key));
    const more = (x: Draft) => {
      if (seen.has(x.key)) return;
      seen.add(x.key);
      out.push(x);
    };
    for (const it of uo.items) {
      const base = `uo.${uo.key}.${it.coll}.${it.key}`;
      const tItem = step.items.find((i) => i.collection === it.coll && i.key === it.key);
      const qs = gap.byItem.get(base) ?? [];
      const hasLimits = it.coll === "param" || qs.some((q) => LIMIT_PARTS.includes(UO_KEY.exec(q.binds)?.[4] ?? ""));
      if (hasLimits && (it.coll === "param" || it.coll === "ipc")) {
        more(blank({ key: `limits:${uo.key}.${it.coll}.${it.key}`, target: { kind: "limits", unitOp: uo.key, collection: it.coll, itemKey: it.key, parts: ["setPoint", "nor", "par"] }, stepKey: uo.key, label: it.label, itemLabel: it.label, gapBind: base, essential: false, allOptional: false, state: limitsState(d, tItem, ["setPoint", "nor", "par"]) }));
      }
      for (const q of qs) {
        const field = UO_KEY.exec(q.binds)![4]!;
        if (LIMIT_PARTS.includes(field) && hasLimits) continue;
        more(blank({ key: `field:${uo.key}.${it.coll}.${it.key}.${field}`, target: { kind: "field", unitOp: uo.key, collection: it.coll as SeedCollection, itemKey: it.key, field }, stepKey: uo.key, label: fieldLabel(field, q), itemLabel: it.label, gapBind: q.binds, essential: false, allOptional: false, state: fieldState(d, tItem?.fields.find((f) => f.key === field)) }));
      }
      if (it.coll === "param") {
        more(blank({ key: `field:${uo.key}.${it.coll}.${it.key}.classification`, target: { kind: "field", unitOp: uo.key, collection: "param", itemKey: it.key, field: "classification" }, stepKey: uo.key, label: fieldLabel("classification"), itemLabel: it.label, essential: false, allOptional: false, state: fieldState(d, tItem?.fields.find((f) => f.key === "classification")) }));
        const c = tItem?.control;
        more(blank({ key: `control:${uo.key}.param.${it.key}`, target: { kind: "control", unitOp: uo.key, itemKey: it.key }, stepKey: uo.key, label: "how it is controlled", itemLabel: it.label, essential: false, allOptional: false, canTbd: false, canNotApplicable: false, state: c && Object.values(c).some(Boolean) ? { state: "answered" } : { state: "open" } }));
      }
    }
    // Anything the TRD holds that no question above covers (a field on an item the user added, a field another path wrote): the list is
    // derived from the TRD, so a value that exists can always be reached from here.
    for (const it of step.items) {
      for (const f of it.fields) {
        const k = `field:${uo.key}.${it.collection}.${it.key}.${f.key}`;
        if (seen.has(k) || (LIMIT_PARTS.includes(f.key) && seen.has(`limits:${uo.key}.${it.collection}.${it.key}`))) continue;
        more(blank({ key: k, target: { kind: "field", unitOp: uo.key, collection: it.collection, itemKey: it.key, field: f.key }, stepKey: uo.key, label: f.label, itemLabel: it.label, essential: false, allOptional: false, state: fieldState(d, f) }));
      }
    }
  }

  // Wording: the written sentence, resolved for the stage, or the generated one.
  const validated = sourceValidated(project);
  const staged = (s: string) => adaptText(resolveStageMarkers(s, stage), validated);
  const stepLabel = (k: string) => (k === INTERVIEW_DOCUMENT_GROUP ? INTERVIEW_DOCUMENT_LABEL : ops.find((u) => u.key === k)?.label ?? k);
  return out.map((x, i) => {
    const w = wording.questions[x.key];
    const gq = x.gapBind ? gap.byBind.get(x.gapBind) : undefined;
    const g = inputFromGap(content, gq);
    const sectionName = x.stepKey === INTERVIEW_DOCUMENT_GROUP ? "the document" : stepLabel(x.stepKey);
    const fallbackPrompt = x.target.kind === "presence" ? `Is ${x.label.toLowerCase()} performed in this process?` : x.target.kind === "control" ? `How is ${x.itemLabel ?? "this parameter"} controlled and where is it recorded?` : `What is the ${x.label.toLowerCase()}${x.itemLabel && x.itemLabel.toLowerCase() !== x.label.toLowerCase() ? ` for ${x.itemLabel.toLowerCase()}` : ""}?`;
    const defaultInput: InterviewInput = x.target.kind === "presence" ? "yes_no" : x.target.kind === "limits" ? "limits" : x.target.kind === "document" && (x.target.field === "purpose" || x.target.field === "scopeNote") ? "long_text" : x.target.kind === "control" ? "long_text" : "text";
    const input = w?.input ?? g.input ?? defaultInput;
    const choices = w?.choices ?? (input === "yes_no" && !g.choices.length ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : g.choices);
    const units = w?.units ?? g.units;
    const q: InterviewQuestion = {
      key: x.key,
      target: x.target,
      stepKey: x.stepKey,
      stepLabel: stepLabel(x.stepKey),
      ...(x.sectionKey ? { sectionKey: x.sectionKey } : {}),
      order: i,
      essential: x.essential,
      prompt: staged(w?.prompt ?? fallbackPrompt),
      why: staged(w?.why ?? `Needed for the TRD section ${x.usedIn[0]?.title ?? sectionName}.`),
      ...(w?.hint ? { hint: staged(w.hint) } : {}),
      glossary: w?.glossary ?? [],
      input,
      units,
      choices,
      ...(x.stages?.length ? { stages: x.stages } : {}),
      ...(x.blankLabel ? { blankLabel: x.blankLabel } : {}),
      usedIn: x.usedIn,
      state: x.state.state,
      ...(x.state.current !== undefined ? { current: x.state.current } : {}),
      ...(x.state.source ? { source: x.state.source } : {}),
      ...(x.state.reason ? { reason: x.state.reason } : {}),
      canTbd: x.canTbd,
      canNotApplicable: x.canNotApplicable,
      wordingWritten: Boolean(w),
    };
    return q;
  });
}

function catalogItemLabel(content: ContentBundle, op: string, coll: string, key: string): string | undefined {
  return content.catalog.unitOperations.find((u) => u.key === op)?.items.find((i) => i.coll === coll && i.key === key)?.label;
}

// ------------------------------------------------------------------ filters and progress

export interface InterviewFilter {
  /** all (default) | open: nothing entered yet or marked TBD | confirm: a project value waiting to be kept. */
  show?: "all" | "open" | "confirm";
  /** all (default) | essentials | more detail. */
  level?: "all" | "essentials" | "more";
  search?: string;
  /** The Keep marks (see trdInterviewProgress). */
  kept?: ReadonlySet<string>;
}

/** Everything, only open, only the project values to confirm, Essentials / More detail, and a text search. A pure function over the list. */
export function filterInterviewQuestions(qs: readonly InterviewQuestion[], f: InterviewFilter = {}): InterviewQuestion[] {
  const needle = (f.search ?? "").trim().toLowerCase();
  return qs.filter((q) => {
    if (f.level === "essentials" && !q.essential) return false;
    if (f.level === "more" && q.essential) return false;
    const toConfirm = q.state === "from_project" && !f.kept?.has(q.key);
    if (f.show === "confirm" && !toConfirm) return false;
    if (f.show === "open" && q.state !== "open" && q.state !== "tbd") return false;
    if (needle && ![q.prompt, q.why, q.stepLabel, q.current ?? "", q.blankLabel ?? "", ...q.usedIn.map((u) => u.title)].some((s) => s.toLowerCase().includes(needle))) return false;
    return true;
  });
}

export interface InterviewCounts {
  total: number;
  answered: number;
  open: number;
  /** Of the open ones: project values waiting to be kept. */
  toConfirm: number;
  /** Of the open ones: marked "to be decided". */
  tbd: number;
}
export interface StepProgress {
  stepKey: string;
  stepLabel: string;
  essentials: InterviewCounts;
  /** The More detail questions; the page says "plus N more in More detail" with `moreDetail.open`. */
  moreDetail: InterviewCounts;
}
export interface InterviewProgress {
  overall: Omit<StepProgress, "stepKey" | "stepLabel">;
  steps: StepProgress[];
}

const none = (): InterviewCounts => ({ total: 0, answered: 0, open: 0, toConfirm: 0, tbd: 0 });

/**
 * Answered / open / total, per step and overall. A value that came from the project counts as answered only after the user has kept it
 * (or typed over it), because the interview asks the person to look at it once; an unseen project value is not a confirmed answer.
 * `kept` is a parameter and not read from the project because the Keep marks live in the browser's own storage: the record has no field for
 * them (no schema change), so the page passes the set in. "Not applicable here" counts as answered, "To be decided" does not.
 */
export function trdInterviewProgress(qs: readonly InterviewQuestion[], kept: ReadonlySet<string> = new Set()): InterviewProgress {
  const steps = new Map<string, StepProgress>();
  const overall = { essentials: none(), moreDetail: none() };
  const count = (c: InterviewCounts, q: InterviewQuestion) => {
    c.total += 1;
    const done = q.state === "answered" || q.state === "not_applicable" || (q.state === "from_project" && kept.has(q.key));
    if (done) c.answered += 1;
    else {
      c.open += 1;
      if (q.state === "from_project") c.toConfirm += 1;
      if (q.state === "tbd") c.tbd += 1;
    }
  };
  for (const q of qs) {
    let s = steps.get(q.stepKey);
    if (!s) steps.set(q.stepKey, (s = { stepKey: q.stepKey, stepLabel: q.stepLabel, essentials: none(), moreDetail: none() }));
    count(q.essential ? s.essentials : s.moreDetail, q);
    count(q.essential ? overall.essentials : overall.moreDetail, q);
  }
  return { overall, steps: [...steps.values()] };
}

// ------------------------------------------------------------------ answers

/** Where one limit is from: source register ids and the section / page of each. A part that names none keeps the citation it has. */
export interface LimitCitation {
  sourceIds?: string[];
  locations?: Record<string, { section?: string; page?: string }>;
}

/** The citation a limit is written with: its own when the answer names sources (the person changed them), else the one it already has. */
function citationOf(own: LimitCitation, have: { sourceIds: string[]; locations?: LimitCitation["locations"] } | undefined, fallback: string[]): { sourceIds: string[]; locations?: NonNullable<LimitCitation["locations"]> } {
  if (own.sourceIds) return { sourceIds: own.sourceIds, ...(own.locations ? { locations: own.locations } : {}) };
  return { sourceIds: have?.sourceIds ?? fallback, ...(have?.locations ? { locations: have.locations } : {}) };
}

export type InterviewAnswer =
  /** A typed or chosen value. `values` for a multi-choice question. */
  | { kind: "value"; value?: string; values?: string[]; unit?: string; reason?: string }
  | { kind: "range"; min?: number; max?: number; unit?: string; reason?: string }
  | { kind: "presence"; performed: boolean; reason?: string }
  /** `null` removes a part; leaving a part out keeps it. */
  | { kind: "limits"; setPoint?: ({ value: number; unit?: string } & LimitCitation) | null; nor?: ({ min?: number; max?: number; unit?: string; basis?: string; note?: string } & LimitCitation) | null; par?: ({ min?: number; max?: number; unit?: string; basis?: string; note?: string } & LimitCitation) | null; sourceIds?: string[] }
  | { kind: "control"; control: TrdControl }
  /** Writes nothing at all. The question stays open. */
  | { kind: "dont_know" }
  | { kind: "tbd"; bestGuess?: string; unit?: string; owner?: string; due?: string; note?: string; part?: LimitPart }
  | { kind: "not_applicable"; reason?: string; part?: LimitPart }
  /** Marks a project value as looked at. Writes nothing to the record: the mark lives in the browser (see trdInterviewProgress). */
  | { kind: "keep" };

export interface InterviewContext {
  content: ContentBundle;
  /** The write-up library; with it, saying a step is performed also adds the step's process description. */
  library?: readonly TrdLibraryWriteup[];
}

export interface AnswerResult {
  /** The new project, or the original one when nothing was written. */
  project: Project;
  changed: boolean;
  /** The engine's own message when it refused; the person's input is still on screen and nothing was lost. */
  error?: string;
  kept?: boolean;
}

class AnswerProblem extends Error {}

const num = (v: unknown, what: string): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || String(v ?? "").trim() === "") throw new AnswerProblem(`Please enter ${what} as a number, for example 12.5.`);
  return n;
};

/** The text a typed or chosen answer is shown as in the TRD (a chosen option is stored as its label). */
function displayOf(q: InterviewQuestion, a: Extract<InterviewAnswer, { kind: "value" }>): { display: string; unit?: string } {
  const label = (v: string) => q.choices.find((o) => o.value === v)?.label;
  if (q.input === "multi_choice") {
    const picked = (a.values ?? (a.value ? [a.value] : [])).map((v) => label(v) ?? v);
    if (!picked.length) throw new AnswerProblem("Choose at least one option, or choose Don't know yet.");
    return { display: picked.join("; ") };
  }
  const raw = text(a.value);
  if (!raw) throw new AnswerProblem("Please type an answer, or choose Don't know yet.");
  if (q.input === "choice" || q.input === "yes_no") {
    const l = label(raw);
    if (!l) throw new AnswerProblem("Please choose one of the options.");
    return { display: l };
  }
  if (q.input === "number" || q.input === "quantity") {
    const n = num(raw, "the value");
    const unit = text(a.unit);
    if (q.units.length && unit && !q.units.includes(unit)) throw new AnswerProblem(`Please choose a unit from the list (${q.units.join(", ")}).`);
    return { display: String(n), ...(unit ? { unit } : {}) };
  }
  if (q.input === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new AnswerProblem("Please enter the date as year-month-day, for example 2026-11-30.");
  return { display: raw, ...(text(a.unit) ? { unit: text(a.unit) } : {}) };
}

const tbdReason = (a: Extract<InterviewAnswer, { kind: "tbd" }>) => [text(a.note), text(a.owner) && `Owner: ${text(a.owner)}`, text(a.due) && `Due: ${text(a.due)}`].filter(Boolean).join("; ");

/**
 * Ensures the unit operation is a step of the TRD (added in catalog order). Used by every write on a step; the step starts with no
 * process description and no values.
 */
function ensureStep(p: Project, trdId: string, unitOp: string, ctx: InterviewContext, by: Actor): { project: Project; step: TrdStep } {
  const find = (x: Project) => x.trd.documents.find((d) => d.id === trdId)!.steps.find((s) => s.key === unitOp);
  const have = find(p);
  if (have) return { project: p, step: have };
  const ops = ctx.content.catalog.unitOperations;
  const uo = ops.find((u) => u.key === unitOp);
  if (!uo) throw new TrdError(`${unitOp} is not a process step of the catalog`);
  const seq = (k: string | undefined) => ops.find((u) => u.key === k)?.sequence;
  const index = p.trd.documents.find((d) => d.id === trdId)!.steps.filter((s) => (seq(s.key) ?? Infinity) < uo.sequence).length;
  const r = addTrdStep(p, trdId, { unitOp: uo.key, label: uo.label }, by, index);
  return { project: r.project, step: find(r.project)! };
}

/**
 * Adds a catalog item to a step under its catalog key (custom: false, entered: true). Idempotent: an item that is already there is
 * left alone and `added` is false. Called only when something is written, so reading the questions never changes the TRD.
 */
export function ensureCatalogItem(project: Project, content: ContentBundle, trdId: string, stepId: string, coll: SeedCollection, key: string, by: Actor): { project: Project; ref: ItemRef; added: boolean } {
  const d = project.trd.documents.find((x) => x.id === trdId);
  const step = d?.steps.find((s) => s.id === stepId);
  if (!d || !step) throw new TrdError(`Step ${stepId} is not in ${trdId}`);
  const ref: ItemRef = { stepId, collection: coll, key };
  if (step.items.some((i) => i.collection === coll && i.key === key)) return { project, ref, added: false };
  const label = step.key ? catalogItemLabel(content, step.key, coll, key) : undefined;
  if (!label) throw new TrdError(`${coll}.${key} is not in the catalog for this step`);
  const r = addCatalogTrdItem(project, trdId, stepId, { collection: coll, key, label }, by);
  return { project: r.project, ref, added: true };
}

/** The label a new field gets: the catalog's field label. */
const labelOfField = (content: ContentBundle, field: string) => content.catalog.fieldLabels[field] ?? field;

function ensureField(p: Project, trdId: string, home: FieldHome, field: string, label: string, exists: (d: TrdDocument) => boolean): Project {
  const d = p.trd.documents.find((x) => x.id === trdId)!;
  return exists(d) ? p : addEmptyTrdField(p, trdId, home, { key: field, label });
}

type Override = { status: "established" | "tbd" | "not_applicable"; display?: string; unit?: string; reason?: string };

/** The override a value / TBD / not-applicable answer stands for. */
function overrideFor(q: InterviewQuestion, a: InterviewAnswer): Override {
  if (a.kind === "tbd") return { status: "tbd", ...(text(a.bestGuess) ? { display: text(a.bestGuess) } : {}), ...(text(a.unit) ? { unit: text(a.unit) } : {}), ...(tbdReason(a) ? { reason: tbdReason(a) } : {}) };
  if (a.kind === "not_applicable") return { status: "not_applicable", ...(text(a.reason) ? { reason: text(a.reason) } : {}) };
  if (a.kind === "range") {
    if (a.min === undefined && a.max === undefined) throw new AnswerProblem("Please enter a lowest value, a highest value, or both.");
    const lo = a.min === undefined ? undefined : num(a.min, "the lowest value");
    const hi = a.max === undefined ? undefined : num(a.max, "the highest value");
    const shown = lo !== undefined && hi !== undefined ? `${lo} to ${hi}` : lo !== undefined ? `at least ${lo}` : `at most ${hi}`;
    return { status: "established", display: shown, ...(text(a.unit) ? { unit: text(a.unit) } : {}), ...(text(a.reason) ? { reason: text(a.reason) } : {}) };
  }
  if (a.kind === "value") {
    const v = displayOf(q, a);
    return { status: "established", display: v.display, ...(v.unit ? { unit: v.unit } : {}), ...(text(a.reason) ? { reason: text(a.reason) } : {}) };
  }
  throw new AnswerProblem("That answer does not fit this question.");
}

/**
 * Writes one answer through the existing TRD edit functions, so the answer is one change-log event and shows in the form, the write-ups
 * and the export exactly as a typed entry. The first answer on something the TRD does not hold yet adds the step or the catalog item
 * first (its own recorded event). Rules:
 *  - "Don't know yet" and "Keep" write nothing: an unknown must stay visible, and a Keep mark is the browser's, not the record's.
 *  - The same answer twice changes nothing (the edit functions return the same project).
 *  - A change over a project value keeps the project value next to it (`pulled`); the entry is the `override`.
 *  - When the engine refuses, the original project and the engine's own message come back; nothing is thrown away.
 */
export function applyTrdAnswer(project: Project, trdId: string, question: InterviewQuestion, answer: InterviewAnswer, by: Actor, ctx: InterviewContext): AnswerResult {
  if (answer.kind === "dont_know") return { project, changed: false };
  if (answer.kind === "keep") return { project, changed: false, kept: true };
  try {
    const next = write(project, trdId, question, answer, by, ctx);
    return { project: next, changed: next !== project };
  } catch (e) {
    if (e instanceof TrdError || e instanceof TrdWriteupError || e instanceof AnswerProblem || (e instanceof Error && e.name === "ZodError")) return { project, changed: false, error: e.message };
    throw e;
  }
}

function write(project: Project, trdId: string, q: InterviewQuestion, a: InterviewAnswer, by: Actor, ctx: InterviewContext): Project {
  const t = q.target;
  const { content } = ctx;
  switch (t.kind) {
    case "document": {
      if (a.kind !== "value") throw new AnswerProblem("This one has no TBD or not-applicable; leave it open if you do not know yet.");
      return updateTrd(project, trdId, { [t.field]: text(a.value) }, by);
    }
    case "detail": {
      const o = overrideFor(q, a);
      const p = ensureField(project, trdId, { part: "details" }, t.field, q.stepLabel === INTERVIEW_DOCUMENT_LABEL ? labelOfDetail(t.field) : t.field, (d) => d.details.some((f) => f.key === t.field));
      return setOverride(p, trdId, { part: "details", field: t.field }, o, by);
    }
    case "presence":
      return writePresence(project, trdId, t.unitOp, a, by, ctx);
    case "blank": {
      const d = project.trd.documents.find((x) => x.id === trdId)!;
      // The value is written on the first write-up (in document order) that holds it; the others read it through the lookup.
      const holder = writeupsInOrder(d).find((w) => q.usedIn.some((u) => u.writeupId === w.id));
      if (!holder) throw new TrdWriteupError("This sentence is not in the document any more.");
      if (a.kind === "not_applicable") return setBlankValue(project, trdId, holder.id, t.blankKey, NOT_APPLICABLE_TEXT, by);
      if (a.kind === "tbd") throw new AnswerProblem("A typed answer cannot be marked TBD; leave it open or choose Don't know yet.");
      if (a.kind !== "value") throw new AnswerProblem("That answer does not fit this question.");
      // A sentence-word choice ("is" / "is not") is written as the word the sentence needs; a catalog choice is written as its label, as the form does.
      let shown = displayOf(q, a).display;
      if ((q.input === "choice" || q.input === "yes_no") && !gapIndex(content).byBind.has(t.blankKey)) shown = q.choices.find((o) => o.value === text(a.value))?.value ?? shown;
      return setBlankValue(project, trdId, holder.id, t.blankKey, shown, by);
    }
    case "field": {
      const o = overrideFor(q, a);
      let { project: p, step } = ensureStep(project, trdId, t.unitOp, ctx, by);
      p = ensureCatalogItem(p, content, trdId, step.id, t.collection, t.itemKey, by).project;
      const home: FieldHome = { part: "item", stepId: step.id, collection: t.collection, key: t.itemKey };
      p = ensureField(p, trdId, home, t.field, labelOfField(content, t.field), (d) => Boolean(d.steps.find((s) => s.id === step.id)?.items.find((i) => i.collection === t.collection && i.key === t.itemKey)?.fields.some((f) => f.key === t.field)));
      return setOverride(p, trdId, { ...home, field: t.field }, o, by);
    }
    case "limits":
      return writeLimits(project, trdId, q, t, a, by, ctx);
    case "control": {
      if (a.kind !== "control") throw new AnswerProblem("That answer does not fit this question.");
      const { project: p0, step } = ensureStep(project, trdId, t.unitOp, ctx, by);
      const p = ensureCatalogItem(p0, content, trdId, step.id, "param", t.itemKey, by).project;
      return setControl(p, trdId, { stepId: step.id, collection: "param", key: t.itemKey }, a.control, by);
    }
  }
}

const DETAIL_LABEL: Record<string, string> = { program: "Program", modality: "Modality", dosageForm: "Dosage form", presentation: "Presentation", site: "Receiving site", line: "Filling line" };
const labelOfDetail = (k: string) => DETAIL_LABEL[k] ?? k;

/** Presence: "yes" adds the step (and its process description when the library is given); "no" records the step as not performed. */
function writePresence(project: Project, trdId: string, unitOp: string, a: InterviewAnswer, by: Actor, ctx: InterviewContext): Project {
  if (a.kind !== "presence") throw new AnswerProblem("Please answer yes or no.");
  let { project: p, step } = ensureStep(project, trdId, unitOp, ctx, by);
  const home: FieldHome = { part: "step", stepId: step.id };
  p = ensureField(p, trdId, home, "presence", labelOfField(ctx.content, "presence"), (d) => Boolean(d.steps.find((s) => s.id === step.id)?.fields.some((f) => f.key === "presence")));
  p = setOverride(p, trdId, { ...home, field: "presence" }, a.performed ? { status: "established", display: "Yes", ...(text(a.reason) ? { reason: text(a.reason) } : {}) } : { status: "not_applicable", ...(text(a.reason) ? { reason: text(a.reason) } : {}) }, by);
  if (a.performed && ctx.library) {
    const d = p.trd.documents.find((x) => x.id === trdId)!;
    // The library is a set of offers: the description is added only when its own condition (dilution, container) is established, as a new TRD does.
    const offer = writeupsAvailable(d, ctx.library).find((o) => o.lib.kind === "unitOp" && o.lib.key === unitOp && o.step?.id === step.id && o.lib.autoAdd !== false && (!o.lib.onlyWhen || evaluate(o.lib.onlyWhen, { project: p, side: "shared" })));
    if (offer) p = addWriteupFromLibrary(p, trdId, offer.lib, step.id, by).project;
  }
  return p;
}

/** Limits: the parts in the answer are merged with the ones already in the TRD (setLimits replaces the whole set). */
function writeLimits(project: Project, trdId: string, q: InterviewQuestion, t: Extract<InterviewTarget, { kind: "limits" }>, a: InterviewAnswer, by: Actor, ctx: InterviewContext): Project {
  if (a.kind === "tbd" || a.kind === "not_applicable") {
    // TBD and not applicable are about one part (the set point by default); they are entered as that part's field so the TRD reports them.
    const part = a.part ?? "setPoint";
    const o = overrideFor(q, a);
    const { project: p0, step } = ensureStep(project, trdId, t.unitOp, ctx, by);
    let p = ensureCatalogItem(p0, ctx.content, trdId, step.id, t.collection, t.itemKey, by).project;
    const home: FieldHome = { part: "item", stepId: step.id, collection: t.collection, key: t.itemKey };
    p = ensureField(p, trdId, home, part, labelOfField(ctx.content, part), (d) => Boolean(d.steps.find((s) => s.id === step.id)?.items.find((i) => i.collection === t.collection && i.key === t.itemKey)?.fields.some((f) => f.key === part)));
    return setOverride(p, trdId, { ...home, field: part }, o, by);
  }
  // A plain number on a single-part question is that part's set point.
  const ans: Extract<InterviewAnswer, { kind: "limits" }> | undefined =
    a.kind === "limits" ? a : a.kind === "value" ? { kind: "limits", setPoint: { value: num(a.value, "the value"), ...(text(a.unit) ? { unit: text(a.unit) } : {}) } } : a.kind === "range" ? { kind: "limits", nor: { ...(a.min !== undefined ? { min: num(a.min, "the lowest value") } : {}), ...(a.max !== undefined ? { max: num(a.max, "the highest value") } : {}), ...(text(a.unit) ? { unit: text(a.unit) } : {}) } } : undefined;
  if (!ans) throw new AnswerProblem("That answer does not fit this question.");
  if (ans.setPoint === undefined && ans.nor === undefined && ans.par === undefined) throw new AnswerProblem("Please enter a value, or choose Don't know yet.");
  const { project: p0, step } = ensureStep(project, trdId, t.unitOp, ctx, by);
  const p = ensureCatalogItem(p0, ctx.content, trdId, step.id, t.collection, t.itemKey, by).project;
  const item = p.trd.documents.find((x) => x.id === trdId)!.steps.find((s) => s.id === step.id)!.items.find((i) => i.collection === t.collection && i.key === t.itemKey)!;
  const next: TrdLimits = { ...(item.limits ? structuredClone(item.limits) : {}) };
  const sources = ans.sourceIds ?? [];
  if (ans.setPoint === null) delete next.setPoint;
  else if (ans.setPoint) next.setPoint = { value: num(ans.setPoint.value, "the set point"), ...(text(ans.setPoint.unit) ? { unit: text(ans.setPoint.unit) } : {}), ...citationOf(ans.setPoint, item.limits?.setPoint, sources) };
  for (const part of ["nor", "par"] as const) {
    const r = ans[part];
    if (r === null) delete next[part];
    else if (r) {
      if (r.min === undefined && r.max === undefined) throw new AnswerProblem(`Please enter a lowest value, a highest value, or both for the ${part === "nor" ? "normal" : "proven acceptable"} range.`);
      next[part] = {
        ...(r.min !== undefined ? { min: num(r.min, "the lowest value") } : {}),
        ...(r.max !== undefined ? { max: num(r.max, "the highest value") } : {}),
        ...(text(r.unit) ? { unit: text(r.unit) } : {}),
        ...citationOf(r, item.limits?.[part], sources),
        ...(text(r.basis) ? { basis: text(r.basis) } : {}),
        ...(text(r.note) ? { note: text(r.note) } : {}),
      };
    }
  }
  return setLimits(p, trdId, { stepId: step.id, collection: t.collection, key: t.itemKey }, next, by);
}

