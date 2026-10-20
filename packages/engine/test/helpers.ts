import {
  emptyProject,
  putEntry,
  type Actor,
  type DocRef,
  type Entry,
  type EntryValue,
  type Project,
  type Quantity,
  type Range,
  type Side,
} from "@gap/process-model";
import {
  applyAnswer,
  assess,
  buildContent,
  type AnswerInput,
  type Assessment,
  type ContentBundle,
  type FieldAnswer,
  type Gap,
  type ParameterField,
  type QuestionInstance,
  type RawContent,
} from "@gap/engine";
import { content as realContent, rawContent } from "../../../content/index";

/** Fixed clock and actor so every test is deterministic. All names are fictional. */
export const T0 = "2026-10-01T09:00:00.000Z";
export const T1 = "2026-10-02T10:30:00.000Z";
export const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: T0 };
export const OTHER_ACTOR: Actor = { name: "Sam Sample (fictional)", at: T1 };

export const DOC_A: DocRef = { identifier: "TEST-DOC-001", docType: "Study report", title: "Fictional study A", version: "1.0" };
export const DOC_B: DocRef = { identifier: "TEST-DOC-002", docType: "PPQ report", title: "Fictional study B", version: "2.0" };

export const q = (value: number, unit: string): Quantity => ({ value, unit });
export const rng = (min: number, max: number, unit: string): Range => ({ min: q(min, unit), max: q(max, unit) });

/** A parameter field spec: a value, or the shortcuts "unknown" / "same" (same as source). */
export type FieldSpec = EntryValue | "unknown" | "same";
export type FieldSpecs = Partial<Record<ParameterField, FieldSpec>>;

function fieldAnswer(v: FieldSpec): FieldAnswer {
  if (v === "unknown") return { kind: "unknown" };
  if (v === "same") return { kind: "same_as_source" };
  return { kind: "value", value: v };
}

export function composite(fields: FieldSpecs): AnswerInput {
  const out: Partial<Record<ParameterField, FieldAnswer>> = {};
  for (const [k, v] of Object.entries(fields)) out[k as ParameterField] = fieldAnswer(v as FieldSpec);
  return { kind: "composite", fields: out };
}

const PRESENCE_QUESTION: Record<string, string> = {
  compounding: "comp.presence",
  sterile_filtration: "filt.presence",
  aseptic_filling: "fill.presence",
  capping: "cap.presence",
};

/** Builds the answering helpers against one content bundle (the real one, or a modified clone). */
export function makeKit(content: ContentBundle) {
  const inst = (questionId: string, side: Side | "shared"): QuestionInstance => {
    const question = content.questionById.get(questionId);
    if (!question) throw new Error(`Test setup: unknown question ${questionId}`);
    return { key: `${question.id}@${side}`, question, side, section: content.sectionById.get(question.section)!, depth: 0 };
  };

  const newProject = (entrySequence?: "paired" | "sequential"): Project =>
    emptyProject({
      title: "Test project (fictional)",
      actor: ACTOR,
      contentRefs: content.versions,
      ...(entrySequence ? { entrySequence } : {}),
    });

  /** Generic answer with an explicit AnswerInput. */
  const ask = (p: Project, questionId: string, side: Side | "shared", input: AnswerInput, actor: Actor = ACTOR, docRefs?: DocRef[]): Project =>
    applyAnswer(p, content, inst(questionId, side), input, actor, docRefs ? { docRefs } : {});

  const v = (p: Project, questionId: string, side: Side | "shared", value: EntryValue, actor: Actor = ACTOR, docRefs?: DocRef[]): Project =>
    ask(p, questionId, side, { kind: "value", value }, actor, docRefs);

  const par = (p: Project, questionId: string, side: Side, fields: FieldSpecs, actor: Actor = ACTOR, docRefs?: DocRef[]): Project =>
    ask(p, questionId, side, composite(fields), actor, docRefs);

  const unk = (p: Project, questionId: string, side: Side | "shared", actor: Actor = ACTOR): Project =>
    ask(p, questionId, side, { kind: "unknown" }, actor);

  const same = (p: Project, questionId: string, actor: Actor = ACTOR): Project => ask(p, questionId, "target", { kind: "same_as_source" }, actor);

  const na = (p: Project, questionId: string, side: Side, justification: string, actor: Actor = ACTOR): Project =>
    ask(p, questionId, side, { kind: "not_applicable", justification }, actor);

  /** Same value on both sides (explicit values, not "same as source"). */
  const both = (p: Project, questionId: string, value: EntryValue): Project => v(v(p, questionId, "source", value), questionId, "target", value);

  /** Source value then a different (or equal) target value. */
  const pair = (p: Project, questionId: string, source: EntryValue, target: EntryValue): Project =>
    v(v(p, questionId, "source", source), questionId, "target", target);

  /** Scoping answers for a liquid vial site-to-site transfer, plus unit-operation presence on both sides. */
  const base = (
    opts: { uos?: string[]; presentation?: string; transfer?: string; containment?: string; entrySequence?: "paired" | "sequential" } = {},
  ): Project => {
    let p = newProject(opts.entrySequence);
    p = v(p, "scope.program", "shared", "TST-001");
    p = v(p, "scope.modality", "shared", "mab");
    p = v(p, "scope.dosage_form", "shared", "liquid");
    p = v(p, "scope.presentation", "shared", opts.presentation ?? "vial");
    p = v(p, "scope.ds_state", "shared", "liquid");
    p = v(p, "scope.containment", "shared", opts.containment ?? "standard");
    p = v(p, "scope.markets", "shared", ["us"]);
    p = v(p, "scope.transfer_type", "shared", opts.transfer ?? "site_to_site");
    for (const uo of opts.uos ?? ["compounding", "sterile_filtration", "aseptic_filling"]) p = both(p, PRESENCE_QUESTION[uo]!, "yes");
    return p;
  };

  const run = (p: Project): Assessment => assess(content, p);

  /** The gap with the given key; fails the test setup if it does not exist. */
  const gap = (a: Assessment, key: string): Gap => {
    const g = a.gaps.find((x) => x.key === key);
    if (!g) throw new Error(`No gap ${key}. Present: ${a.gaps.map((x) => x.key).join(", ")}`);
    return g;
  };

  return { content, inst, newProject, ask, v, par, unk, same, na, both, pair, base, run, gap };
}

export type Kit = ReturnType<typeof makeKit>;

/** Kit for the real content. */
export const kit = makeKit(realContent);
export { realContent as content, rawContent };

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Deep clone of the raw YAML content, ready to be broken or tweaked. */
export function cloneRaw(): RawContent & Mutable {
  return structuredClone(rawContent) as RawContent & Mutable;
}

/** Finds a raw question object by id inside a cloned raw bundle. */
export function rawQuestion(raw: RawContent, id: string): Mutable {
  for (const file of Object.values(raw.questionFiles) as Mutable[]) {
    const hit = (file.questions as Mutable[] | undefined)?.find((x) => x.id === id);
    if (hit) return hit;
  }
  throw new Error(`Test setup: raw question ${id} not found`);
}

export function rawRule(raw: RawContent, id: string): Mutable {
  for (const file of Object.values(raw.ruleFiles) as Mutable[]) {
    const hit = (file.rules as Mutable[]).find((x) => x.id === id);
    if (hit) return hit;
  }
  throw new Error(`Test setup: raw rule ${id} not found`);
}

/** Builds a modified copy of the real content (and a kit bound to it). */
export function customKit(mutate: (raw: RawContent & Mutable) => void): Kit {
  const raw = cloneRaw();
  mutate(raw);
  return makeKit(buildContent(raw));
}

/** Writes an entry directly into a copy of the project (bypasses the interview; for condition tests). */
export function withEntry(project: Project, ref: string, value: EntryValue | undefined, status: Entry["status"] = "established"): Project {
  const next = structuredClone(project);
  const entry: Entry = {
    id: `ent-test-${ref}`,
    path: ref,
    status,
    sourceIds: ["src-test"],
    recordedBy: ACTOR.name,
    recordedAt: ACTOR.at,
    revision: 1,
  };
  if (value !== undefined) entry.value = value;
  putEntry(next, entry);
  return next;
}
