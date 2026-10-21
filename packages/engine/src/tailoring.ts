import { allEntries, COLLECTION_KINDS, COLLECTION_LABELS, fullRef, type Actor, type Project, type TailoredTopic } from "@gap/process-model";
import { boundPaths, type ContentBundle } from "./content";
import type { Question } from "./content-schema";

// Not imported from sequencer.ts: the sequencer reads topicOf from here, and a cycle between the two is avoided.
const sidesOf = (q: Question): ("shared" | "source" | "target")[] => (q.sides === "shared" ? ["shared"] : q.sides === "paired" ? ["source", "target"] : [q.sides]);

/**
 * Tailoring: a project can switch off topics of a unit-operation section (for example "Hold and temperature" of bulk
 * packaging) when the process does not have them. GMP reasoning: leaving something out of a gap assessment is a scope
 * decision that a reviewer must be able to see and challenge, so every exclusion needs a reason, is change-logged and is
 * listed in the document's scope. Nothing is deleted: values already recorded for an excluded topic stay in the project as
 * inactive entries (exactly like values of removed custom items) and come back when the topic is switched on again.
 * The default is that every topic is included, the most conservative choice.
 */

export class TailoringError extends Error {}

export interface TopicInfo {
  key: string;
  label: string;
  description?: string;
  /** Ids of the questions that belong to the topic (follow-ups follow their parent and are not listed). */
  questionIds: string[];
}

const COLL_KEYS: readonly string[] = COLLECTION_KINDS;

/**
 * The topic a question belongs to, or undefined when it cannot be switched off. The presence question never has a topic:
 * whether a step exists is a scoping fact, not a tailoring choice. Follow-up questions carry no topic of their own; they
 * disappear with their parent through the normal parent-visibility rule.
 */
export function topicOf(content: ContentBundle, q: Question): string | undefined {
  const sec = content.sectionById.get(q.section);
  if (!sec || sec.kind !== "uo" || !sec.uo) return undefined;
  if (q.binds === `uo.${sec.uo}.presence`) return undefined;
  if (q.topic) return q.topic;
  const def = content.catalog.unitOperations.find((u) => u.key === sec.uo);
  if (def?.topics?.length) return undefined; // explicit topics are declared per question
  const m = /^uo\.[^.]+\.([a-z]+)\./.exec(q.binds);
  return m && COLL_KEYS.includes(m[1]!) ? m[1] : undefined;
}

/** The tailoring topics of a unit operation, in display order. Empty when the unit operation has no questions to tailor. */
export function topicsOfUo(content: ContentBundle, uo: string): TopicInfo[] {
  const def = content.catalog.unitOperations.find((u) => u.key === uo);
  const sectionIds = new Set(content.sections.filter((s) => s.kind === "uo" && s.uo === uo).map((s) => s.id));
  const mine = content.questions.filter((q) => sectionIds.has(q.section) && !q.parent);
  const byTopic = new Map<string, string[]>();
  for (const q of mine) {
    const t = topicOf(content, q);
    if (t) byTopic.set(t, [...(byTopic.get(t) ?? []), q.id]);
  }
  if (def?.topics?.length) {
    return def.topics.map((t) => ({ key: t.key, label: t.label, ...(t.description ? { description: t.description } : {}), questionIds: byTopic.get(t.key) ?? [] }));
  }
  return COLLECTION_KINDS.filter((k) => byTopic.has(k)).map((k) => ({ key: k, label: COLLECTION_LABELS[k], questionIds: byTopic.get(k)! }));
}

export function topicLabel(content: ContentBundle, uo: string, topic: string): string {
  return topicsOfUo(content, uo).find((t) => t.key === topic)?.label ?? topic;
}

export function excludedSet(project: Project): Set<string> {
  return new Set((project.tailoring?.excluded ?? []).map((e) => `${e.uo}/${e.topic}`));
}

export function isTopicExcluded(project: Project, uo: string, topic: string): boolean {
  return (project.tailoring?.excluded ?? []).some((e) => e.uo === uo && e.topic === topic);
}

/** Recorded values (any status except not established) that belong to a topic, on both sides. */
export function topicEntryCount(content: ContentBundle, project: Project, uo: string, topic: string): number {
  const refs = new Set<string>();
  const sectionIds = new Set(content.sections.filter((s) => s.kind === "uo" && s.uo === uo).map((s) => s.id));
  for (const q of content.questions) {
    if (!sectionIds.has(q.section)) continue;
    if (topicOf(content, q) !== topic) continue;
    for (const side of sidesOf(q)) for (const p of boundPaths(q, side)) refs.add(fullRef(side, p));
  }
  let n = 0;
  for (const e of allEntries(project)) if (refs.has(e.path) && e.status !== "not_established") n++;
  return n;
}

function logged(project: Project, actor: Actor, action: string, uo: string, detail: string, extra: { before?: unknown; after?: unknown }): void {
  project.changeLog.push({ at: actor.at, by: actor.name, action, path: `uo.${uo}`, detail, ...extra });
}

/** Switches a topic off for the project. The reason is required; recorded values are kept as inactive entries. */
export function excludeTopic(content: ContentBundle, project: Project, uo: string, topic: string, reason: string, actor: Actor): Project {
  const text = reason.trim().replace(/\s+/g, " ");
  if (!text) throw new TailoringError("Give a short reason: a topic left out of the assessment must be justified.");
  const info = topicsOfUo(content, uo).find((t) => t.key === topic);
  if (!info) throw new TailoringError(`Unknown topic "${topic}" for ${uo}.`);
  if (isTopicExcluded(project, uo, topic)) throw new TailoringError(`“${info.label}” is already switched off.`);
  const kept = topicEntryCount(content, project, uo, topic);
  const next = structuredClone(project);
  next.tailoring ??= { excluded: [] };
  const record: TailoredTopic = { uo, topic, reason: text, by: actor.name, at: actor.at };
  next.tailoring.excluded.push(record);
  const uoLabel = content.catalog.unitOperations.find((u) => u.key === uo)?.label ?? uo;
  logged(next, actor, "tailor_exclude", uo, `Switched off “${info.label}” in ${uoLabel}: ${text}; ${kept} recorded value(s) kept as inactive`, { after: record });
  return next;
}

/** Switches a topic back on. Values kept while it was off become active again. */
export function includeTopic(content: ContentBundle, project: Project, uo: string, topic: string, actor: Actor): Project {
  const existing = (project.tailoring?.excluded ?? []).find((e) => e.uo === uo && e.topic === topic);
  if (!existing) throw new TailoringError("That topic is not switched off.");
  const next = structuredClone(project);
  next.tailoring.excluded = next.tailoring.excluded.filter((e) => !(e.uo === uo && e.topic === topic));
  const label = topicLabel(content, uo, topic);
  const uoLabel = content.catalog.unitOperations.find((u) => u.key === uo)?.label ?? uo;
  logged(next, actor, "tailor_include", uo, `Switched on “${label}” in ${uoLabel}`, { before: existing });
  return next;
}

export interface ScopeExclusion {
  uo: string;
  uoLabel: string;
  topic: string;
  topicLabel: string;
  reason: string;
  by: string;
  at: string;
  /** Values still held for the topic (inactive). */
  keptValues: number;
}

/** Every excluded topic in unit-operation order, for the document scope and the tailor dialog. */
export function scopeExclusions(content: ContentBundle, project: Project): ScopeExclusion[] {
  const seq = (uo: string) => content.catalog.unitOperations.find((u) => u.key === uo)?.sequence ?? 999;
  return [...(project.tailoring?.excluded ?? [])]
    .sort((a, b) => seq(a.uo) - seq(b.uo) || a.at.localeCompare(b.at))
    .map((e) => ({
      uo: e.uo,
      uoLabel: content.catalog.unitOperations.find((u) => u.key === e.uo)?.label ?? e.uo,
      topic: e.topic,
      topicLabel: topicLabel(content, e.uo, e.topic),
      reason: e.reason,
      by: e.by,
      at: e.at,
      keptValues: topicEntryCount(content, project, e.uo, e.topic),
    }));
}
