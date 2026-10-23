import { stableStringify, type Actor, type Project, type TrdDocument, type TrdField, type TrdItem, type TrdSeed, type TrdStep } from "@gap/process-model";
import { effectiveField, TrdError, seedToTrdParts } from "./trd";
import { seedValueText } from "./trd-outline";
import { trdSeedContentFingerprint } from "./trd-seed";

/**
 * "Update from project" and "Import a newer seed": compares what the TRD was last given (the `pulled` values) with a fresh seed
 * and lists every difference for review. Nothing is applied on its own.
 *
 * The rule behind it (GMP: a decision a person wrote down must not vanish because a source moved):
 *  - A field the user OVERRODE is never replaced silently. Its row says "project now says X", and it stays overridden until the
 *    user chooses: "Keep my override" (the project value is brought up to date next to it) or "Take the project value" (the
 *    override is removed, and the log keeps it).
 *  - Removing something from the TRD because the project no longer has it is also a choice. Where the TRD holds the user's own
 *    work on it (an override, a PAR/NOR, a description, an item the user typed), the row is protected and is left out of
 *    "accept all not overridden".
 *  - Every accepted row is its own change-log event with the old value kept.
 */

export type DiffKind = "step_added" | "step_removed" | "item_added" | "item_removed" | "field_added" | "field_removed" | "field_changed";

export interface TrdDiffRow {
  /** Stable: the same difference gets the same id on the next comparison. */
  id: string;
  kind: DiffKind;
  /** Step, item and field in words. */
  where: string;
  /** What the project (or the newer seed) says now. */
  projectNow: string;
  /** What the TRD says now (the override if there is one). */
  trdNow: string;
  /** The field is overridden: it is never replaced without the user's choice. */
  overridden: boolean;
  /** Needs an explicit choice and is left out of "accept all not overridden". */
  protectedRow: boolean;
  /** The status (established / TBD / not established ...) differs, not just the value. */
  statusChanged: boolean;
  /** Plain words for why the row is protected, or what accepting does. */
  note: string;
}

const sameJson = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);

function hasUserWork(step: TrdStep): boolean {
  return Boolean(step.description?.trim()) || step.fields.some((f) => f.override) || step.items.some((i) => i.entered || i.limits || i.fields.some((f) => f.override));
}
function itemHasUserWork(item: TrdItem): boolean {
  return Boolean(item.limits) || item.fields.some((f) => f.override);
}

const fieldNow = (f: TrdField | undefined) => (f ? effectiveField(f).text : "Not in the TRD");
const projectText = (f: TrdField | undefined) => (f?.pulled ? seedValueText(f.pulled) : "Not in the project");
const statusOf = (f: TrdField | undefined) => f?.pulled?.status;

interface Rows {
  rows: TrdDiffRow[];
  /** What to do for each row id. */
  apply: Map<string, (doc: TrdDocument, choice: "take" | "keep", nextStepId: () => string) => void>;
}

function compare(d: TrdDocument, seed: TrdSeed): Rows {
  const fresh = seedToTrdParts(seed);
  const rows: TrdDiffRow[] = [];
  const apply: Rows["apply"] = new Map();
  const push = (r: TrdDiffRow, fn: (doc: TrdDocument, choice: "take" | "keep", nextStepId: () => string) => void) => {
    rows.push(r);
    apply.set(r.id, fn);
  };

  // A field list of the TRD against the fresh one (details, step fields, item fields).
  const fields = (kind: string, where: string, mine: (doc: TrdDocument) => TrdField[], theirs: TrdField[], mineNow: TrdField[], idBase: string) => {
    for (const nf of theirs) {
      const cur = mineNow.find((f) => f.key === nf.key);
      const id = `${idBase}|${nf.key}`;
      const label = `${where}, ${nf.label}`;
      if (!cur) {
        push({ id, kind: "field_added", where: label, projectNow: projectText(nf), trdNow: "Not in the TRD", overridden: false, protectedRow: false, statusChanged: false, note: "The project has a new field." }, (doc) => {
          mine(doc).push(structuredClone(nf));
        });
        continue;
      }
      // An override with no project value behind it is the user's own entry; the project now having a value is a difference to show.
      if (sameJson(cur.pulled, nf.pulled)) continue;
      const overridden = Boolean(cur.override);
      push(
        {
          id,
          kind: "field_changed",
          where: label,
          projectNow: projectText(nf),
          trdNow: fieldNow(cur),
          overridden,
          protectedRow: overridden,
          statusChanged: statusOf(cur) !== statusOf(nf),
          note: overridden ? "Overridden: the TRD keeps your value until you choose." : "Accepting brings in the project value.",
        },
        (doc, choice) => {
          const f = mine(doc).find((x) => x.key === nf.key)!;
          if (nf.pulled) f.pulled = structuredClone(nf.pulled);
          else delete f.pulled;
          if (choice === "take") delete f.override;
        },
      );
    }
    for (const cur of mineNow) {
      if (!cur.pulled || theirs.some((f) => f.key === cur.key)) continue;
      const overridden = Boolean(cur.override);
      push(
        { id: `${idBase}|${cur.key}`, kind: "field_removed", where: `${where}, ${cur.label}`, projectNow: "No longer in the project", trdNow: fieldNow(cur), overridden, protectedRow: overridden, statusChanged: false, note: overridden ? "Overridden: removing it also removes your value." : "Accepting removes the field from the TRD." },
        (doc) => {
          const list = mine(doc);
          list.splice(list.findIndex((x) => x.key === cur.key), 1);
        },
      );
    }
    void kind;
  };

  fields("details", "Details", (doc) => doc.details, fresh.details, d.details, "details");

  const mineSteps = d.steps.filter((s) => !s.entered && s.key);
  for (const ns of fresh.steps) {
    const cur = mineSteps.find((s) => s.key === ns.key);
    const sid = `step:${ns.key}`;
    if (!cur) {
      push({ id: sid, kind: "step_added", where: ns.label, projectNow: `New step with ${ns.items.length} items`, trdNow: "Not in the TRD", overridden: false, protectedRow: false, statusChanged: false, note: "Accepting adds the step in process order." }, (doc, _c, nextStepId) => {
        const step = structuredClone(ns);
        step.id = nextStepId();
        const at = doc.steps.findIndex((s) => s.sequence !== undefined && s.sequence > (ns.sequence ?? 0));
        if (at < 0) doc.steps.push(step);
        else doc.steps.splice(at, 0, step);
      });
      continue;
    }
    const stepOfDoc = (doc: TrdDocument) => doc.steps.find((s) => s.id === cur.id)!;
    fields("stepfields", cur.label, (doc) => stepOfDoc(doc).fields, ns.fields, cur.fields, `${sid}|-`);
    for (const ni of ns.items) {
      const ci = cur.items.find((i) => i.collection === ni.collection && i.key === ni.key);
      const iid = `item:${ns.key}:${ni.collection}.${ni.key}`;
      const where = `${cur.label}, ${ni.label}`;
      if (!ci) {
        push({ id: iid, kind: "item_added", where, projectNow: `New ${ni.collection} item`, trdNow: "Not in the TRD", overridden: false, protectedRow: false, statusChanged: false, note: "Accepting adds the item." }, (doc) => {
          stepOfDoc(doc).items.push(structuredClone(ni));
        });
        continue;
      }
      fields("itemfields", where, (doc) => stepOfDoc(doc).items.find((i) => i.collection === ni.collection && i.key === ni.key)!.fields, ni.fields, ci.fields, `${iid}`);
    }
    for (const ci of cur.items) {
      if (ci.entered || ns.items.some((i) => i.collection === ci.collection && i.key === ci.key)) continue;
      const mineWork = itemHasUserWork(ci);
      push(
        { id: `item:${ns.key}:${ci.collection}.${ci.key}`, kind: "item_removed", where: `${cur.label}, ${ci.label}`, projectNow: "No longer in the project", trdNow: ci.fields.map((f) => effectiveField(f).text).filter(Boolean).join("; ") || "In the TRD", overridden: ci.fields.some((f) => f.override), protectedRow: mineWork, statusChanged: false, note: mineWork ? "Holds your override or PAR/NOR: it is removed only if you choose." : "Accepting removes the item from the TRD." },
        (doc) => {
          const s = stepOfDoc(doc);
          s.items = s.items.filter((i) => !(i.collection === ci.collection && i.key === ci.key));
        },
      );
    }
  }
  for (const cur of mineSteps) {
    if (fresh.steps.some((s) => s.key === cur.key)) continue;
    const work = hasUserWork(cur);
    push(
      { id: `step:${cur.key}`, kind: "step_removed", where: cur.label, projectNow: "No longer in the project scope", trdNow: `Step with ${cur.items.length} items`, overridden: cur.fields.some((f) => f.override) || cur.items.some((i) => i.fields.some((f) => f.override)), protectedRow: work, statusChanged: false, note: work ? "Holds your description, overrides or PAR/NOR: it is removed only if you choose." : "Accepting removes the step from the TRD." },
      (doc) => {
        doc.steps = doc.steps.filter((s) => s.id !== cur.id);
      },
    );
  }
  return { rows, apply };
}

/** The differences between the TRD and a seed (the project now, or a newer file), for the review list. Empty when nothing differs. */
export function diffTrdAgainstSeed(d: TrdDocument, seed: TrdSeed): TrdDiffRow[] {
  return compare(d, seed).rows;
}

export interface TrdPick {
  rowId: string;
  /** "take": bring in the project value (an overridden field loses its override, which the log keeps). "keep": the override stays. */
  choice: "take" | "keep";
}

function refreshSeedInfo(d: TrdDocument, seed: TrdSeed, actor: Actor, complete: boolean): void {
  const byId = new Map((d.origin.seedSources ?? []).map((s) => [s.id, s]));
  for (const s of seed.sources) byId.set(s.id, s);
  d.origin.seedSources = [...byId.values()];
  if (!complete) return;
  d.origin.seed = {
    formatVersion: seed.meta.formatVersion,
    exportedAt: seed.meta.exportedAt,
    projectId: seed.meta.project.id,
    projectName: seed.meta.project.name,
    gapFingerprint: seed.meta.gapAssessment.documentFingerprint,
    fingerprint: trdSeedContentFingerprint(seed),
  };
  d.origin.updatedFromAt = actor.at;
}

/**
 * Applies the rows the user picked, one change-log event each. A row that is protected (overridden, or holding the user's own
 * work) is applied only when it is picked explicitly; "accept all not overridden" is `pickAllUnprotected`.
 */
export function applyTrdUpdate(project: Project, id: string, seed: TrdSeed, picks: TrdPick[], actor: Actor): Project {
  const next = structuredClone(project);
  const d = next.trd.documents.find((x) => x.id === id);
  if (!d) throw new TrdError(`TRD ${id} does not exist`);
  const { rows, apply } = compare(d, seed);
  const used: string[] = [];
  const taken: string[] = d.steps.map((s) => s.id);
  const nextStepId = () => {
    let max = 0;
    for (const t of taken) max = Math.max(max, Number(/^TS-(\d+)$/.exec(t)?.[1] ?? 0));
    for (const ev of next.changeLog) {
      const parts = (ev.path ?? "").split(".");
      if (parts[0] === "trd" && parts[1] === id) max = Math.max(max, Number(/^TS-(\d+)$/.exec(parts[2] ?? "")?.[1] ?? 0));
    }
    const sid = `TS-${String(max + 1).padStart(2, "0")}`;
    taken.push(sid);
    return sid;
  };
  for (const pick of picks) {
    const row = rows.find((r) => r.id === pick.rowId);
    const fn = apply.get(pick.rowId);
    if (!row || !fn) continue;
    const before = snapshot(d, row);
    fn(d, pick.choice, nextStepId);
    used.push(row.id);
    const kept = row.overridden && pick.choice === "keep";
    next.changeLog.push({
      at: actor.at,
      by: actor.name,
      action: kept ? "trd_update_keep_override" : "trd_update_accept",
      path: `trd.${id}.update.${row.id}`,
      detail: kept ? `${row.where}: your override kept; the project value is now ${row.projectNow}` : `${row.where}: ${row.kind.replace("_", " ")}. Project now says ${row.projectNow}; the TRD said ${row.trdNow}`,
      before,
      after: { projectNow: row.projectNow, choice: pick.choice },
    });
  }
  if (!used.length) return project;
  refreshSeedInfo(d, seed, actor, false);
  d.updatedAt = actor.at;
  // When nothing is left to review, the TRD is up to date with this seed.
  if (!compare(d, seed).rows.length) {
    refreshSeedInfo(d, seed, actor, true);
    next.changeLog.push({ at: actor.at, by: actor.name, action: "trd_origin_update", path: `trd.${id}`, detail: `TRD ${id} is up to date with the ${d.origin.kind === "project" ? "project" : "seed"} (${used.length} differences reviewed)` });
  }
  return next;
}

/** What the TRD held for a row before it was applied, kept in the log. */
function snapshot(d: TrdDocument, row: TrdDiffRow): unknown {
  return { trdNow: row.trdNow, kind: row.kind, ...(row.kind === "step_removed" ? { step: d.steps.find((s) => `step:${s.key}` === row.id) } : {}) };
}

/** "Accept all not overridden": every row that is not protected. Overridden fields and the user's own work are left for a choice. */
export function pickAllUnprotected(rows: readonly TrdDiffRow[]): TrdPick[] {
  return rows.filter((r) => !r.protectedRow).map((r) => ({ rowId: r.id, choice: "take" as const }));
}

/**
 * Closes the review while rows remain: the TRD is marked as reviewed against this seed (so the "project changed" notice goes), and
 * the rows left are logged as left as they are. Nothing in the TRD changes.
 */
export function finishTrdReview(project: Project, id: string, seed: TrdSeed, actor: Actor): Project {
  const next = structuredClone(project);
  const d = next.trd.documents.find((x) => x.id === id);
  if (!d) throw new TrdError(`TRD ${id} does not exist`);
  const left = compare(d, seed).rows;
  refreshSeedInfo(d, seed, actor, true);
  d.updatedAt = actor.at;
  next.changeLog.push({ at: actor.at, by: actor.name, action: "trd_origin_update", path: `trd.${id}`, detail: `TRD ${id} reviewed against the ${d.origin.kind === "project" ? "project" : "seed"}; ${left.length} differences left as they are`, after: left.map((r) => ({ where: r.where, projectNow: r.projectNow, trdNow: r.trdNow })) });
  return next;
}

/** Starts a seed-import TRD's comparison with a newer file: the file must be for the same program. Different projects are allowed but reported. */
export function seedIsFromOtherProject(d: TrdDocument, seed: TrdSeed): boolean {
  return Boolean(d.origin.seed && d.origin.seed.projectId !== seed.meta.project.id);
}
