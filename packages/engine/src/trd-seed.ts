import {
  PROCESS_MODEL_VERSION,
  SCHEMA_VERSION,
  SEED_CLASSIFICATIONS,
  TRD_SEED_FORMAT,
  TRD_SEED_VERSION,
  fnv1a,
  getEntry,
  isCustomKey,
  parseRef,
  resolveEntry,
  stableStringify,
  verificationState,
  type EntryValue,
  type Project,
  type Resolved,
  type SeedAnswer,
  type SeedClassification,
  type SeedField,
  type SeedItem,
  type SeedSource,
  type SeedUnitOperation,
  type SeedValue,
  type TrdSeed,
} from "@gap/process-model";
import { assess, type Assessment } from "./compare";
import { fieldLabel, type ContentBundle } from "./content";
import type { Question } from "./content-schema";
import { effectiveContent } from "./custom";
import { buildDocument, documentSourceRefs } from "./document";
import { formatValue, questionLabel } from "./format";
import { documentFingerprint } from "./review";
import { stepGroups } from "./scope";
import { instanceRefs } from "./sequencer";
import { stagedFor } from "./stage";
import { scopeExclusions } from "./tailoring";
import { isQuantity, isRange } from "./values";

/**
 * Builds the TRD seed (see the format in @gap/process-model, trd-seed.ts) from the project. Pure: the same project, content and
 * options give the same seed. GMP reasons behind the choices:
 *  - Only ACTIVE receiving-unit (RU) answers are exported. Units left out, tailored-out topics and removed custom items are
 *    absent, exactly as they are absent from the gap assessment document.
 *  - An unanswered but active question is exported as "not_established" with no value, so a TRD author sees the hole. The
 *    builder never fills one with a catalog suggestion (no defaults).
 *  - The SU value sits only under `reference.su`, for traceability. A "same as SU" assertion by the RU is the one case where
 *    the RU field carries the SU value; it says so with `sameAsSu: true`.
 *  - A TBD best guess is exported as a value with `provisional: true`, never as an established fact.
 */

export interface TrdSeedOptions {
  /** Export time (ISO). Defaults to now. */
  exportedAt?: string;
  generatorName?: string;
  /** Version of the app that produced the seed. */
  appVersion?: string;
}

const NO_REASON = "No reason recorded";
const PARAM_OPTION_SETS: Record<string, string> = { classification: "classification", rangeBasis: "rangeBasis" };

function unitOf(v: EntryValue): string | undefined {
  if (isQuantity(v)) return v.unit;
  if (isRange(v)) return v.min?.unit ?? v.max?.unit;
  return undefined;
}

/** One answer from a resolved entry. A TBD with a best guess becomes status "tbd" + value + provisional (never "established"). */
function answerOf(content: ContentBundle, q: Question | undefined, r: Resolved, optionSet?: string): SeedAnswer {
  const show = (v: EntryValue) => ({
    value: v as SeedValue,
    display: optionSet ? (content.catalog.optionSets[optionSet]?.find((o) => o.value === v)?.label ?? formatValue(content, q, v, optionSet)) : formatValue(content, q, v),
    ...(unitOf(v) ? { unit: unitOf(v)! } : {}),
  });
  const tbd = r.tbd ? { ...(r.tbd.owner ? { owner: r.tbd.owner } : {}), ...(r.tbd.due ? { due: r.tbd.due } : {}), ...(r.tbd.note ? { note: r.tbd.note } : {}) } : undefined;
  if (r.tbd) {
    return { status: "tbd", ...(r.provisional && r.value !== undefined ? { ...show(r.value), provisional: true as const } : {}), tbd: tbd! };
  }
  if (r.status === "established" && r.value !== undefined) return { status: "established", ...show(r.value) };
  if (r.status === "not_applicable") return { status: "not_applicable", ...(r.justification ? { justification: r.justification } : {}) };
  return { status: "not_established" };
}

const asClassification = (a: SeedAnswer): SeedClassification | undefined =>
  a.status === "established" && typeof a.value === "string" && (SEED_CLASSIFICATIONS as readonly string[]).includes(a.value) ? (a.value as SeedClassification) : undefined;

export function buildTrdSeed(rawContent: ContentBundle, project: Project, opts: TrdSeedOptions = {}): TrdSeed {
  const exportedAt = opts.exportedAt ?? new Date().toISOString();
  const eff = effectiveContent(rawContent, project);
  const a: Assessment = assess(eff, project);
  const content = stagedFor(eff, project);
  const fingerprint = documentFingerprint(buildDocument(eff, project, a, exportedAt));

  // Active references per side. An item or field that no visible question binds is inactive and is not exported.
  const targetInstances = a.instances.filter((i) => i.side === "target");
  const sourceRefs = new Set(a.instances.filter((i) => i.side === "source").flatMap(instanceRefs));
  const gapsByRef = new Map<string, Set<string>>();
  for (const g of a.gaps) for (const ref of g.inputRefs) gapsByRef.set(ref, (gapsByRef.get(ref) ?? gapsByRef.set(ref, new Set()).get(ref)!).add(g.displayId));
  const usedSources = new Set<string>();

  const fieldOf = (ref: string, q: Question, label: string, optionSet?: string): SeedField => {
    const p = parseRef(ref);
    const r = resolveEntry(project, ref);
    const entry = getEntry(project, ref);
    const answer = answerOf(content, q, r, optionSet);
    const vs = verificationState(project, ref);
    const verification = vs.state === "verified" ? (vs.selfVerification ? "self_verified" : "verified") : vs.state === "withdrawn" ? "withdrawn" : "unverified";
    const sourceIds = (entry?.sourceIds ?? []).filter((id) => project.sources.some((s) => s.id === id));
    for (const id of sourceIds) usedSources.add(id);
    const locations = Object.fromEntries(Object.entries(entry?.sourceLocations ?? {}).filter(([id]) => sourceIds.includes(id)));
    const srcRef = `source${ref.slice("target".length)}`;
    const gapIds = [...(gapsByRef.get(ref) ?? [])];
    const su = sourceRefs.has(srcRef) ? answerOf(content, q, resolveEntry(project, srcRef), optionSet) : undefined;
    const reference = su || gapIds.length ? { ...(su ? { su: { status: su.status, ...(su.value !== undefined ? { value: su.value } : {}), ...(su.display ? { display: su.display } : {}), ...(su.unit ? { unit: su.unit } : {}), ...(su.provisional ? { provisional: true as const } : {}) } } : {}), gapIds } : undefined;
    return {
      path: p.side === "shared" ? ref : ref.slice(p.side.length + 1),
      field: p.side === "shared" ? p.key : p.field,
      label,
      ...answer,
      ...(r.sameAsSource ? { sameAsSu: true as const } : {}),
      sourceIds,
      ...(Object.keys(locations).length ? { locations } : {}),
      verification,
      ...(reference ? { reference } : {}),
    };
  };

  const answerAt = (ref: string, key: string): SeedAnswer => answerOf(content, content.questions.find((x) => x.binds === key), resolveEntry(project, ref));
  const used = (ref: string) => {
    for (const id of getEntry(project, ref)?.sourceIds ?? []) usedSources.add(id);
  };

  // Target fields grouped by unit operation / item / site, in question order.
  const siteFields: SeedField[] = [];
  const uoFields = new Map<string, SeedField[]>();
  const uoItems = new Map<string, Map<string, SeedItem>>();
  const seen = new Set<string>();
  for (const inst of targetInstances) {
    for (const ref of instanceRefs(inst)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const p = parseRef(ref);
      if (p.side === "shared") continue;
      const q = inst.question;
      const label = ref.endsWith(q.binds) ? questionLabel(q) : fieldLabel(content, p.field);
      const optionSet = p.kind === "item" ? PARAM_OPTION_SETS[p.field] : undefined;
      if (p.kind === "site") {
        siteFields.push(fieldOf(ref, q, label));
      } else if (p.kind === "uo") {
        uoFields.set(p.uo, [...(uoFields.get(p.uo) ?? []), fieldOf(ref, q, label)]);
      } else {
        const items = uoItems.get(p.uo) ?? new Map<string, SeedItem>();
        uoItems.set(p.uo, items);
        const id = `${p.coll}.${p.item}`;
        let item = items.get(id);
        if (!item) {
          const model = project.processes.target.unitOperations[p.uo]?.collections[p.coll][p.item];
          const catalogItem = content.catalog.unitOperations.find((u) => u.key === p.uo)?.items.find((i) => i.coll === p.coll && i.key === p.item);
          item = { collection: p.coll, key: p.item, label: model?.label ?? catalogItem?.label ?? p.item, custom: isCustomKey(p.item), fields: [] };
          items.set(id, item);
        }
        item.fields.push(fieldOf(ref, q, label, optionSet));
      }
    }
  }
  for (const items of uoItems.values()) {
    for (const item of items.values()) {
      if (item.collection !== "param") continue;
      const cls = item.fields.find((f) => f.field === "classification");
      const ru = cls && asClassification(cls);
      if (ru) item.classification = ru;
      const su = cls?.reference?.su && cls.reference.su.status === "established" && typeof cls.reference.su.value === "string" ? cls.reference.su.value : undefined;
      if (su && (SEED_CLASSIFICATIONS as readonly string[]).includes(su)) item.reference = { suClassification: su as SeedClassification };
    }
  }

  // Scope: what is in, what the project left out, what the answers put out.
  const groupOf = new Map<string, { key: string; label: string }>();
  for (const g of content.catalog.stageGroups) for (const u of g.unitOperations) groupOf.set(u, { key: g.key, label: g.label });
  const stepStates = new Map(stepGroups(content, project).flatMap((g) => g.steps).map((s) => [s.uo, s]));
  const scope: TrdSeed["scope"] = { included: [], excluded: [], notApplicable: [], topicsLeftOut: [] };
  const unitOperations: SeedUnitOperation[] = [];
  const catalogUos = [...content.catalog.unitOperations].sort((x, y) => x.sequence - y.sequence);
  for (const def of catalogUos) {
    const sg = groupOf.get(def.key);
    const base = { key: def.key, label: def.label, ...(sg ? { stageGroup: sg } : {}) };
    const step = stepStates.get(def.key);
    // Custom unit operations are in no stage group, so stepGroups does not list them; they can still be left out in the Scope step.
    const customExcluded = !step ? (project.stepScope?.excluded ?? []).find((e) => e.uo === def.key) : undefined;
    if (step?.state === "excluded" || customExcluded) {
      const ex = step?.exclusion ?? customExcluded!;
      scope.excluded.push({ ...base, reason: ex.reason ?? NO_REASON, by: ex.by, at: ex.at });
      continue;
    }
    if (step?.state === "not_applicable") {
      scope.notApplicable.push({ ...base, reason: step.notApplicable!.text });
      continue;
    }
    const fields = uoFields.get(def.key) ?? [];
    const items = [...(uoItems.get(def.key)?.values() ?? [])];
    const waiting = step?.dependsOn;
    scope.included.push({ ...base, sequence: def.sequence, custom: isCustomKey(def.key), ...(waiting ? { note: waiting.text } : {}) });
    if (fields.length || items.length) {
      unitOperations.push({ ...base, sequence: def.sequence, custom: isCustomKey(def.key), fields, items });
    }
  }
  for (const t of scopeExclusions(content, project)) {
    scope.topicsLeftOut.push({ uo: t.uo, uoLabel: t.uoLabel, topic: t.topic, topicLabel: t.topicLabel, reason: t.reason ?? NO_REASON, by: t.by, at: t.at });
  }

  // Product and receiving-site answers (the RU side of a scoping answer is the answer itself: scoping is shared).
  const scopeAnswer = (key: string) => {
    used(`scope.${key}`);
    return answerAt(`scope.${key}`, `scope.${key}`);
  };
  const siteAnswer = (field: string) => {
    used(`target.site.${field}`);
    return answerAt(`target.site.${field}`, `site.${field}`);
  };
  const meta: TrdSeed["meta"] = {
    format: TRD_SEED_FORMAT,
    formatVersion: TRD_SEED_VERSION,
    exportedAt,
    generator: { name: opts.generatorName ?? "Gap Assessment Generator (proof of concept)", version: opts.appVersion ?? "unversioned" },
    processModelVersion: PROCESS_MODEL_VERSION,
    contentVersions: { ...content.versions, overlay: content.overlayVersion },
    projectSchemaVersion: project.schemaVersion ?? SCHEMA_VERSION,
    project: { id: project.meta.id, name: project.meta.title },
    product: { program: scopeAnswer("program"), modality: scopeAnswer("modality"), dosageForm: scopeAnswer("dosage_form"), presentation: scopeAnswer("presentation") },
    receivingSite: { name: siteAnswer("name"), line: siteAnswer("line"), programStage: siteAnswer("programStage") },
    gapAssessment: { documentFingerprint: fingerprint },
  };

  const gapRefs = documentSourceRefs(content, project);
  const sources: SeedSource[] = project.sources
    .filter((s) => usedSources.has(s.id))
    .map((s) => ({
      id: s.id,
      ...(gapRefs.has(s.id) ? { gapRegisterRef: gapRefs.get(s.id)! } : {}),
      type: s.type,
      label: s.label,
      date: s.date,
      ...(s.docRef ? { document: { docType: s.docRef.docType, identifier: s.docRef.identifier, ...(s.docRef.title ? { title: s.docRef.title } : {}), ...(s.docRef.version ? { version: s.docRef.version } : {}) } } : {}),
      ...(s.file ? { file: s.file } : {}),
      ...(s.responder ? { responder: s.responder } : {}),
    }));

  return { meta, scope, site: { fields: siteFields }, unitOperations, sources };
}

/**
 * Fingerprint of a seed's content. The export time is left out so building the same project twice gives the same value; it is what
 * the export history records for all three TRD outputs, so a changed file can be told from an unchanged one.
 */
export function trdSeedFingerprint(seed: TrdSeed): string {
  return fnv1a(stableStringify({ ...seed, meta: { ...seed.meta, exportedAt: undefined } }));
}

/**
 * Fingerprint of what the seed says about the process, for "has the project changed since this TRD was last updated". Unlike
 * trdSeedFingerprint it also leaves out the gap assessment document fingerprint: that one moves with anything in the project
 * (the change log, the export history, the TRD itself), so creating a TRD would already make the TRD look out of date.
 */
export function trdSeedContentFingerprint(seed: TrdSeed): string {
  return fnv1a(stableStringify({ ...seed, meta: { ...seed.meta, exportedAt: undefined, gapAssessment: undefined } }));
}