import {
  describeVerification,
  getEntry,
  isSelfVerification,
  planVerification,
  unverifyEntry,
  verificationProblem,
  verificationState,
  verifyEntries,
  verifyEntry,
  type Actor,
  type BulkVerifyResult,
  type Project,
  type VerifyOptions,
} from "@gap/process-model";
import type { ContentBundle } from "./content";
import { effectiveContent } from "./custom";
import { entryLabel, type EntryLabel } from "./labels";
import { instanceRefs, visibleInstances, type QuestionInstance } from "./sequencer";

/**
 * Verification views and bulk verification. The per-entry rules (what can be verified, four-eyes, withdrawal
 * on change) live in @gap/process-model; this module groups entries by question, section and side.
 */

// ------------------------------------------------------------------ one cell (one attribute on one side)

export type CellVerificationState = "verified" | "withdrawn" | "unverified" | "partial";

export interface CellVerification {
  state: CellVerificationState;
  /** Plain wording of the state; never relies on colour. */
  text: string;
  total: number;
  verified: number;
  withdrawn: number;
  /** References the Verify button would act on (verifiable and not currently verified). */
  verifiable: string[];
  /** References that hold a verification record, valid or withdrawn (the Withdraw button acts on these). */
  withdrawable: string[];
  /** True when any verified entry was self-verified. */
  selfVerified: boolean;
  /** Why Verify is unavailable (nothing to confirm yet), when it is. */
  hint?: string;
}

/** Combined verification state of the entries behind one attribute. */
export function cellVerification(project: Project, refs: string[]): CellVerification {
  // References that are not entry paths cannot hold a verification; they count as unverified and non-verifiable.
  const valid = (r: string) => {
    try {
      getEntry(project, r);
      return true;
    } catch {
      return false;
    }
  };
  if (!refs.every(valid)) {
    const inner = cellVerification(project, refs.filter(valid));
    return { ...inner, total: refs.length, state: inner.verified === refs.length && refs.length ? "verified" : inner.state };
  }
  const existing = refs.filter((r) => getEntry(project, r));
  const states = existing.map((r) => ({ ref: r, s: verificationState(project, r) }));
  const verified = states.filter((x) => x.s.state === "verified");
  const withdrawn = states.filter((x) => x.s.state === "withdrawn");
  const verifiable = refs.filter((r) => !verificationProblem(project, r) && verificationState(project, r).state !== "verified");
  const withdrawable = states.filter((x) => x.s.state !== "unverified").map((x) => x.ref);
  const total = refs.length;
  const self = verified.some((x) => x.s.state === "verified" && x.s.selfVerification);

  let state: CellVerificationState = "unverified";
  let text = "Unverified";
  if (withdrawn.length) {
    state = "withdrawn";
    text = describeVerification(withdrawn[0]!.s);
  } else if (total > 0 && verified.length === total) {
    state = "verified";
    const first = verified[0]!.s as { by: string; role?: string; at: string };
    const people = [...new Set(verified.map((x) => (x.s as { by: string }).by))];
    text = people.length === 1 ? describeVerification(verified[0]!.s) : `Verified by ${people.join(", ")} on ${first.at.slice(0, 10)}`;
    if (people.length > 1 && self) text += " (same person as recorder)";
  } else if (verified.length) {
    state = "partial";
    text = `Partly verified (${verified.length} of ${total})`;
  }
  const out: CellVerification = { state, text, total, verified: verified.length, withdrawn: withdrawn.length, verifiable, withdrawable, selfVerified: self };
  if (!verifiable.length && state !== "verified") {
    const why = refs.map((r) => verificationProblem(project, r)).find(Boolean);
    if (why) out.hint = why;
  }
  return out;
}

// ------------------------------------------------------------------ summary

export interface VerificationCounts {
  total: number;
  verified: number;
  withdrawn: number;
  unverified: number;
  /** Unknown or not established: there is no value to confirm yet. */
  notVerifiable: number;
}

export interface VerificationSummaryRow {
  sectionId: string;
  sectionTitle: string;
  side: "shared" | "source" | "target";
  counts: VerificationCounts;
}

export interface VerificationSummary {
  rows: VerificationSummaryRow[];
  bySide: Record<"shared" | "source" | "target", VerificationCounts>;
  all: VerificationCounts;
}

const zero = (): VerificationCounts => ({ total: 0, verified: 0, withdrawn: 0, unverified: 0, notVerifiable: 0 });

function addTo(c: VerificationCounts, d: VerificationCounts): void {
  c.total += d.total;
  c.verified += d.verified;
  c.withdrawn += d.withdrawn;
  c.unverified += d.unverified;
  c.notVerifiable += d.notVerifiable;
}

/**
 * Counts of the entries behind the questions that are currently asked (active, in scope), per section and side.
 * Every entry falls in exactly one of: verified, withdrawn (a verification exists but no longer applies),
 * unverified (could be verified, is not), not verifiable (Unknown or not established, no verification held).
 */
export function verificationSummary(content: ContentBundle, project: Project): VerificationSummary {
  const eff = effectiveContent(content, project);
  const rows = new Map<string, VerificationSummaryRow>();
  const seen = new Set<string>();
  const order: string[] = [];
  for (const inst of visibleInstances(eff, project, "paired")) {
    const key = `${inst.section.id}@${inst.side}`;
    let row = rows.get(key);
    if (!row) {
      row = { sectionId: inst.section.id, sectionTitle: inst.section.title, side: inst.side, counts: zero() };
      rows.set(key, row);
      order.push(key);
    }
    for (const ref of instanceRefs(inst)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const st = verificationState(project, ref).state;
      row.counts.total++;
      if (st === "verified") row.counts.verified++;
      else if (st === "withdrawn") row.counts.withdrawn++;
      else if (verificationProblem(project, ref)) row.counts.notVerifiable++;
      else row.counts.unverified++;
    }
  }
  const list = order.map((k) => rows.get(k)!);
  const bySide = { shared: zero(), source: zero(), target: zero() };
  const all = zero();
  for (const r of list) {
    addTo(bySide[r.side], r.counts);
    addTo(all, r.counts);
  }
  return { rows: list, bySide, all };
}

// ------------------------------------------------------------------ bulk verification of a section

export type SectionSide = "source" | "target" | "shared" | "all";

export interface SectionVerificationPlan {
  sectionId: string;
  sectionTitle: string;
  side: SectionSide;
  verify: EntryLabel[];
  skip: (EntryLabel & { reason: string })[];
}

function sectionRefs(eff: ContentBundle, project: Project, sectionId: string, side: SectionSide): { refs: string[]; title: string } {
  const insts: QuestionInstance[] = visibleInstances(eff, project, "paired").filter(
    (i) => i.section.id === sectionId && (side === "all" || i.side === side),
  );
  return { refs: [...new Set(insts.flatMap(instanceRefs))], title: eff.sectionById.get(sectionId)?.title ?? sectionId };
}

/** What "Verify all in this section" would do for the named verifier: which entries are verified and which are skipped, with reasons. */
export function planSectionVerification(
  content: ContentBundle,
  project: Project,
  sectionId: string,
  side: SectionSide,
  verifier: string,
  opts: VerifyOptions = {},
): SectionVerificationPlan {
  const eff = effectiveContent(content, project);
  const { refs, title } = sectionRefs(eff, project, sectionId, side);
  const plan = planVerification(project, refs, verifier, opts);
  return {
    sectionId,
    sectionTitle: title,
    side,
    verify: plan.verify.map((r) => entryLabel(eff, project, r)),
    skip: plan.skip.map((s) => ({ ...entryLabel(eff, project, s.ref), reason: s.reason })),
  };
}

/** Verifies every verifiable entry in a section (optionally one side). Each is logged; the rest are skipped and reported. */
export function verifySection(
  content: ContentBundle,
  project: Project,
  sectionId: string,
  side: SectionSide,
  actor: Actor,
  opts: VerifyOptions = {},
): BulkVerifyResult {
  const eff = effectiveContent(content, project);
  const { refs, title } = sectionRefs(eff, project, sectionId, side);
  return verifyEntries(project, refs, actor, opts, `${title}${side === "all" ? "" : ` (${side})`}`);
}

// ------------------------------------------------------------------ one cell: verify and withdraw

/** Verifies the entries behind one attribute that can be verified now. Already verified entries are left as they are. */
export function verifyCell(project: Project, refs: string[], actor: Actor, opts: VerifyOptions = {}): Project {
  const ready = refs.filter((r) => !verificationProblem(project, r) && verificationState(project, r).state !== "verified");
  if (!ready.length) throw new Error("There is nothing to verify here");
  return ready.reduce((p, r) => verifyEntry(p, r, actor, opts), project);
}

/** Withdraws the verification held by the entries behind one attribute (verified or already withdrawn). The reason is required. */
export function unverifyCell(project: Project, refs: string[], actor: Actor, reason: string): Project {
  const held = refs.filter((r) => verificationState(project, r).state !== "unverified");
  if (!held.length) throw new Error("There is no verification to withdraw here");
  return held.reduce((p, r) => unverifyEntry(p, r, actor, reason), project);
}

/** True when the named person recorded at least one of the entries that would be verified (so self-verification must be confirmed). */
export function needsSelfVerification(project: Project, refs: string[], verifier: string): boolean {
  return refs.some((r) => !verificationProblem(project, r) && isSelfVerification(project, r, verifier));
}
