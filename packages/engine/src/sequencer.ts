import { allEntries, fullRef, getEntry, type Entry, type Project, type Side } from "@gap/process-model";
import { evaluate } from "./conditions";
import { boundPaths, type ContentBundle } from "./content";
import type { Question, Section } from "./content-schema";
import { excludedSet, topicOf } from "./tailoring";

export type InstanceSide = Side | "shared";

export interface QuestionInstance {
  /** Stable key "questionId@side". */
  key: string;
  question: Question;
  side: InstanceSide;
  section: Section;
  /** Nesting depth (0 for top-level questions, 1+ for follow-ups). */
  depth: number;
}

export type EntrySequence = "paired" | "sequential";

export function sidesOf(q: Question): InstanceSide[] {
  if (q.sides === "shared") return ["shared"];
  if (q.sides === "paired") return ["source", "target"];
  return [q.sides];
}

export function uoApplicable(content: ContentBundle, project: Project, uo: string): boolean {
  const def = content.catalog.unitOperations.find((u) => u.key === uo);
  if (!def) return false;
  if (def.applicableWhen && !evaluate(def.applicableWhen, { project, side: "shared" })) return false;
  // Out of scope on BOTH sides (e.g. labelling is done at another site for SU and RU): the section is not shown at all.
  if (def.hiddenWhen && (["source", "target"] as const).every((side) => evaluate(def.hiddenWhen!, { project, side }))) return false;
  return true;
}

export function isPresenceQuestion(q: Question, section: Section): boolean {
  return section.kind === "uo" && q.binds === `uo.${section.uo}.presence`;
}

/** Question order within a section: bank order, with each follow-up placed after its parent. */
export function treeOrder(content: ContentBundle, sectionId: string): { q: Question; depth: number }[] {
  const inSection = content.questions.filter((q) => q.section === sectionId);
  const children = new Map<string, Question[]>();
  for (const q of inSection) {
    if (q.parent) children.set(q.parent, [...(children.get(q.parent) ?? []), q]);
  }
  const out: { q: Question; depth: number }[] = [];
  const walk = (q: Question, depth: number) => {
    out.push({ q, depth });
    for (const c of children.get(q.id) ?? []) walk(c, depth + 1);
  };
  inSection.filter((q) => !q.parent).forEach((q) => walk(q, 0));
  return out;
}

/** Evaluates visibility for every (question, side) pair, memoized for one project state. */
export class Visibility {
  private cache = new Map<string, boolean>();
  private applicable = new Map<string, boolean>();
  private excluded: Set<string>;

  constructor(
    private content: ContentBundle,
    private project: Project,
  ) {
    this.excluded = excludedSet(project);
  }

  uoApplicable(uo: string): boolean {
    let v = this.applicable.get(uo);
    if (v === undefined) {
      v = uoApplicable(this.content, this.project, uo);
      this.applicable.set(uo, v);
    }
    return v;
  }

  sectionApplicable(section: Section): boolean {
    return section.kind !== "uo" || this.uoApplicable(section.uo!);
  }

  visible(q: Question, side: InstanceSide): boolean {
    const key = `${q.id}@${side}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const v = this.compute(q, side);
    this.cache.set(key, v);
    return v;
  }

  /** Visible on at least one of its sides. */
  visibleAnywhere(q: Question): boolean {
    return sidesOf(q).some((s) => this.visible(q, s));
  }

  private compute(q: Question, side: InstanceSide): boolean {
    if (!sidesOf(q).includes(side)) return false;
    const section = this.content.sectionById.get(q.section);
    if (!section || !this.sectionApplicable(section)) return false;
    const ctx = { project: this.project, side };
    if (section.kind === "uo") {
      // Scope of one side only (the step is done at another site for that side): nothing of it is asked, compared or planned.
      const hidden = this.content.catalog.unitOperations.find((u) => u.key === section.uo)?.hiddenWhen;
      if (hidden && (side === "source" || side === "target") && evaluate(hidden, ctx)) return false;
      // Tailoring: a topic the project switched off. Values stay in the project as inactive entries.
      if (this.excluded.size) {
        const topic = topicOf(this.content, q);
        if (topic && this.excluded.has(`${section.uo}/${topic}`)) return false;
      }
    }
    if (section.kind === "uo" && !isPresenceQuestion(q, section)) {
      if (!evaluate({ uoPresent: section.uo! }, ctx)) return false;
    }
    if (q.parent) {
      const parent = this.content.questionById.get(q.parent);
      if (!parent || !this.visibleAnywhere(parent)) return false;
    }
    return q.showWhen ? evaluate(q.showWhen, ctx) : true;
  }
}

function instance(q: Question, side: InstanceSide, section: Section, depth: number): QuestionInstance {
  return { key: `${q.id}@${side}`, question: q, side, section, depth };
}

/**
 * The ordered list of visible question instances.
 *  - paired: for each question, the source instance then the target instance.
 *  - sequential: scoping, then the whole source pass, then the whole target pass.
 * Hidden (inapplicable) questions are never returned.
 */
export function visibleInstances(content: ContentBundle, project: Project, mode: EntrySequence): QuestionInstance[] {
  const vis = new Visibility(content, project);
  const sections = content.sections.filter((s) => vis.sectionApplicable(s));
  const out: QuestionInstance[] = [];
  if (mode === "paired") {
    for (const sec of sections) {
      for (const { q, depth } of treeOrder(content, sec.id)) {
        for (const side of sidesOf(q)) if (vis.visible(q, side)) out.push(instance(q, side, sec, depth));
      }
    }
    return out;
  }
  const passes: InstanceSide[] = ["shared", "source", "target"];
  for (const pass of passes) {
    for (const sec of sections) {
      for (const { q, depth } of treeOrder(content, sec.id)) {
        if (sidesOf(q).includes(pass) && vis.visible(q, pass)) out.push(instance(q, pass, sec, depth));
      }
    }
  }
  return out;
}

/** Full entry references written by an instance. */
export function instanceRefs(inst: QuestionInstance): string[] {
  return boundPaths(inst.question, inst.side).map((p) => fullRef(inst.side, p));
}

/** Answered means every bound entry has been recorded (a value, TBD, not applicable or same as source). */
export function isAnswered(project: Project, inst: QuestionInstance): boolean {
  return instanceRefs(inst).every((ref) => {
    const e = getEntry(project, ref);
    return !!e && e.status !== "not_established";
  });
}

/**
 * Next question to ask: the first unanswered instance at or after the given
 * position; otherwise the first unanswered instance anywhere (e.g., a source
 * follow-up triggered by a target answer in sequential mode).
 */
export function nextInstance(
  instances: QuestionInstance[],
  project: Project,
  fromKey?: string,
): QuestionInstance | undefined {
  const start = fromKey ? Math.max(0, instances.findIndex((i) => i.key === fromKey)) : 0;
  for (let i = start; i < instances.length; i++) if (!isAnswered(project, instances[i]!)) return instances[i];
  for (let i = 0; i < start; i++) if (!isAnswered(project, instances[i]!)) return instances[i];
  return undefined;
}

export interface SectionProgress {
  section: Section;
  total: number;
  answered: number;
  bySide: Record<InstanceSide, { total: number; answered: number }>;
  confirmed: boolean;
}

export function progress(content: ContentBundle, project: Project, instances: QuestionInstance[]): SectionProgress[] {
  const vis = new Visibility(content, project);
  return content.sections
    .filter((s) => vis.sectionApplicable(s))
    .map((section) => {
      const mine = instances.filter((i) => i.section.id === section.id);
      const bySide = {
        shared: { total: 0, answered: 0 },
        source: { total: 0, answered: 0 },
        target: { total: 0, answered: 0 },
      };
      let answered = 0;
      for (const i of mine) {
        const a = isAnswered(project, i);
        bySide[i.side].total++;
        if (a) {
          bySide[i.side].answered++;
          answered++;
        }
      }
      return {
        section,
        total: mine.length,
        answered,
        bySide,
        confirmed: project.interview.confirmations.some((c) => c.sectionId === section.id),
      };
    });
}

/** References written by currently visible questions. Only these are compared and reported. */
export function activeRefs(instances: QuestionInstance[]): Set<string> {
  return new Set(instances.flatMap(instanceRefs));
}

/**
 * Answers held for questions that are no longer applicable (a branch closed or
 * scope changed). They are retained, excluded from comparison and the document,
 * and listed so the user can see them.
 */
export function inactiveEntries(project: Project, instances: QuestionInstance[]): Entry[] {
  const active = activeRefs(instances);
  return [...allEntries(project)].filter((e) => e.status !== "not_established" && !active.has(e.path));
}
