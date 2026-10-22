import { HOLD_UNITS, UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE, type SamplingPlan, type SamplingPoint } from "@gap/process-model";
import { requestTitle } from "./agency.js";
import { appliedBatches } from "./calc.js";
import { retainDerivation, stabilityDerivation } from "./derive.js";
import { FILTER_TEST_LABEL, REPORT_PRESENTATION_LABEL, REPORT_WHAT_LABEL, RESPONSIBLE_LABEL, methodInputsText, resultText, timingText, typeText } from "./labels.js";
import { checkPoint } from "./completeness.js";
import { mixingDesign } from "./mixing.js";
import { SLOT_PHRASE, stepOf } from "./flow.js";

const stripEnd = (t: string | undefined): string => (t ?? "").replace(/[.!?]+$/, "");

/**
 * The "Reporting instructions" block of one point (id RI-<pointId>). The CMO copies the block, as it is, into its PPQ summary
 * report, so it must read correctly ON ITS OWN: every paragraph repeats what it refers to (the point, test, step, batches,
 * timing, number of samples, criterion) and none says "see above" or "as in the plan".
 *
 * The acceptance statement is generated from the point's own acceptance, so the block and the point cannot disagree. Anything
 * the person has not entered is written as "not given yet" in the block (it never disappears and is never filled in), and the
 * point is incomplete, which is an open item.
 */

export const REPORT_ONLY_SENTENCE = "Results are reported for information only; no acceptance criterion applies.";
export const CMO_INTRO = "Instructions for reporting PPQ sampling results. Each block can be copied into the PPQ summary report as is.";

export const riId = (pointId: string): string => `RI-${pointId}`;

export interface ReportingContext {
  /** Label of a process step key (catalog or custom). */
  unitOpLabel: (key: string) => string;
}

export interface ReportingInstructions {
  /** RI-SP-001 */
  id: string;
  /** "Reporting instructions RI-SP-001" */
  heading: string;
  /** Self-contained paragraphs, in reading order. */
  paragraphs: string[];
  /** The same entries as label / text pairs, for a table or a labelled list. */
  fields: { label: string; text: string }[];
  /** What is still missing (the same sentences the point's open items use for the reporting part). */
  missing: string[];
}

const NOT_GIVEN = "not given yet";
const given = (s: string | undefined): string => (s && s.trim() ? s.trim() : NOT_GIVEN);
const stop = (s: string): string => (/[.!?]$/.test(s.trimEnd()) ? s.trimEnd() : `${s.trimEnd()}.`);
const joinList = (xs: string[]): string => xs.join(", ");

export function stepText(point: SamplingPoint, ctx: ReportingContext, plan?: Pick<SamplingPlan, "steps">): string {
  // A point placed on the plan's process flow names that step (and where on it, when the person said), in the plan's own words.
  const step = plan ? stepOf(plan, point) : undefined;
  if (step) return point.flow?.at ? `${step.label}, ${SLOT_PHRASE[point.flow.at]}` : step.label;
  if (point.unitOp === UNIT_OP_FINISHED_PRODUCT) return "Finished product";
  if (point.unitOp === UNIT_OP_NONE) return "Supporting work (no single process step)";
  return ctx.unitOpLabel(point.unitOp);
}

/** "criterion: ..." text or the report-only sentence; "not given yet" when no acceptance has been chosen. */
export function acceptanceStatement(point: SamplingPoint): string {
  if (!point.acceptance) return `Acceptance criterion: ${NOT_GIVEN}.`;
  if (point.acceptance.kind === "report_only") return REPORT_ONLY_SENTENCE;
  return `Acceptance criterion: ${stop(given(point.acceptance.text))}`;
}

function samplingSentence(plan: SamplingPlan, point: SamplingPoint): string {
  switch (point.type) {
    case "stability": {
      const d = stabilityDerivation(point);
      const s = point.detail?.stability;
      const conds = (s?.conditions ?? []).map((c) => (c.detail.trim() ? `${c.label} (${c.detail.trim()})` : c.label));
      const tps = (s?.timePoints ?? []).map((t) => t.label);
      return `Stability protocol ${stop(given(s?.protocolRef))} Storage conditions: ${conds.length ? joinList(conds) : NOT_GIVEN}. Time points: ${tps.length ? joinList(tps) : NOT_GIVEN}. ${d.pulls !== undefined ? `${d.pulls} pulls per batch` : "Pulls per batch: not worked out yet"}, ${d.unitsPerPull !== undefined ? `${d.unitsPerPull} units per pull` : "units per pull: not given yet"}${d.units !== undefined ? `, ${d.units} units per batch` : ""}.`;
    }
    case "retain_reserve": {
      const r = point.detail?.retain;
      const u = retainDerivation(point).units;
      return `${u !== undefined ? `${u} units per batch` : "Units per batch: not given yet"}; retention period ${given(r?.retentionPeriod).replace(/[.!?]$/, "")}; storage ${stop(given(r?.storage))}`;
    }
    default: {
      const t = timingText(point);
      const r = checkPoint(plan, point).perBatch;
      const sizes = [...new Set(r.map((x) => resultText(x)))];
      return `Timing and location: ${t || NOT_GIVEN}. Locations or time points per batch: ${point.locationsCount ?? NOT_GIVEN}. Sample size per location: ${sizes.length ? sizes.map((x) => x.replace(/[.!?]$/, "")).join(" / ") : NOT_GIVEN}${point.sampleSize.method ? ` (${methodInputsText(point).replace(/[.!?]$/, "")})` : ""}.`;
    }
  }
}

/** Type-specific facts the CMO needs in the block (positions, hold durations, filter test ...), one sentence or none. */
function typeSentence(point: SamplingPoint): string {
  const d = point.detail;
  switch (point.type) {
    case "mixing_homogeneity": {
      const m = d?.mixing;
      const pos = (m?.positions ?? []).map((p) => (p === "other" ? m?.positionsOther?.trim() || "other" : p));
      const tps = (m?.timePoints ?? []).map((t) => `${t.label} (${t.time})`);
      const design = mixingDesign(point);
      // The design is printed only when the team entered one; no wording is imposed on how results are reported.
      const approach = design.approach ? ` Study design: ${stop(design.approach)}` : "";
      const runs = design.matrix ? ` Runs: ${design.matrix.rows.map((row) => `${row[0]} (batch size ${row[1]}, speed ${row[2]}, mix time ${row[3]}; challenges ${stripEnd(row[4])}; attributes ${stripEnd(row[5])})`).join("; ")}.` : "";
      const ranges = design.rangeLines.length ? ` ${design.rangeLines.map(stop).join(" ")}` : "";
      return `Vessel ${given(m?.vesselRef).replace(/[.!?]$/, "")}; mixing parameters ${given(m?.parameters).replace(/[.!?]$/, "")}; positions ${pos.length ? joinList(pos) : NOT_GIVEN}; time points ${tps.length ? joinList(tps) : NOT_GIVEN}.${approach}${runs}${ranges}`;
    }
    case "hold_time": {
      const h = d?.hold;
      const dur = (h?.durations ?? []).map((x) => `${x.value} ${HOLD_UNITS.includes(x.unit) ? x.unit : x.unit}`);
      return `Hold starts: ${stop(given(h?.start))} Hold ends: ${stop(given(h?.end))} Durations tested: ${dur.length ? joinList(dur) : NOT_GIVEN}. Condition: ${stop(given(h?.condition))}${h?.container?.trim() ? ` Container: ${stop(h.container.trim())}` : ""}${h?.timePointsSampled?.trim() ? ` Time points sampled: ${stop(h.timePointsSampled.trim())}` : ""}`;
    }
    case "filter_study": {
      const f = d?.filter;
      return `Filter ${given(f?.filterRef)}; test ${f?.test ? (f.test === "other" ? given(f.testOther) : FILTER_TEST_LABEL[f.test].toLowerCase()) : NOT_GIVEN}.`;
    }
    case "ppq_enhanced": {
      const e = d?.enhanced;
      return `Interventions or stoppages covered: ${stop(given(e?.interventions))}${e?.intervalDefinition?.trim() ? ` Interval: ${stop(e.intervalDefinition.trim())}` : ""}${e?.perNeedleShelf?.trim() ? ` Per needle or shelf: ${stop(e.perNeedleShelf.trim())}` : ""}`;
    }
    case "characterization":
    case "supporting_study": {
      const a = d?.analyses;
      const list = (a?.analyses ?? []).map((x) => (x.methodRef.trim() ? `${x.name} (method ${x.methodRef.trim()})` : x.name));
      return `Analyses: ${list.length ? joinList(list) : NOT_GIVEN}.`;
    }
    default:
      return "";
  }
}

export function reportingInstructions(plan: SamplingPlan, point: SamplingPoint, ctx: ReportingContext): ReportingInstructions {
  const id = riId(point.id);
  const rep = point.reporting;
  const batches = appliedBatches(plan, point);
  const batchText = batches.length ? `${batches.length} batch${batches.length === 1 ? "" : "es"}: ${batches.map((b) => `${b.id} ${b.label}`).join(", ")}` : "no batch yet";
  const test = point.attribute.trim() || NOT_GIVEN;
  const who = point.responsible ? `${RESPONSIBLE_LABEL[point.responsible.party]}${point.responsible.name?.trim() ? ` (${point.responsible.name.trim()})` : ""}` : NOT_GIVEN;

  const what = (rep?.what ?? []).map((w) => (w === "other" ? given(rep?.whatOther) : REPORT_WHAT_LABEL[w].charAt(0).toLowerCase() + REPORT_WHAT_LABEL[w].slice(1)));
  const pres = (rep?.presentation ?? []).map((p) => REPORT_PRESENTATION_LABEL[p].charAt(0).toLowerCase() + REPORT_PRESENTATION_LABEL[p].slice(1));
  const linked = (point.agencyRequestIds ?? []).map((rid) => plan.agencyRequests.find((r) => r.id === rid)).filter((r): r is NonNullable<typeof r> => !!r);

  const fields: { label: string; text: string }[] = [
    { label: "Reporting instructions", text: `${id} for sampling point ${point.id} of PPQ sampling plan ${plan.id} (${plan.title}).` },
    { label: "Sample", text: `${test}; study type: ${typeText(point)}; process step: ${stepText(point, ctx, plan)}${point.testMethodRef?.trim() ? `; test method ${point.testMethodRef.trim()}` : ""}${point.materialType?.trim() ? `; material ${point.materialType.trim()}` : ""}. Responsible: ${who}.` },
    { label: "Batches", text: `Applies to ${batchText}.` },
    { label: "Sampling", text: samplingSentence(plan, point) },
  ];
  const ts = typeSentence(point);
  if (ts) fields.push({ label: "Study details", text: ts });
  fields.push(
    { label: "Report", text: `For ${test} (${point.id}), report ${what.length ? joinList(what) : NOT_GIVEN}${pres.length ? `, presented as ${joinList(pres)}` : ""}.` },
    { label: "Acceptance", text: `${acceptanceStatement(point)}${rep?.acceptanceExtra?.trim() ? ` ${stop(rep.acceptanceExtra.trim())}` : ""}` },
    { label: "Deviations", text: `For ${point.id}, handle deviations, out-of-specification and out-of-trend results according to: ${given(rep?.deviationRef)}.` },
  );
  if (linked.length) fields.push({ label: "Agency requests", text: `${point.id} is linked to: ${linked.map((r) => requestTitle(r)).join("; ")}.` });
  if (rep?.additional?.trim()) fields.push({ label: "Additional instructions", text: stop(rep.additional.trim()) });

  const missing: string[] = [];
  if (!rep?.what?.length) missing.push("what to report");
  if (!rep?.deviationRef?.trim()) missing.push("deviation handling reference");
  if (!point.attribute.trim()) missing.push("test");
  return { id, heading: `Reporting instructions ${id}`, paragraphs: fields.map((f) => (f.label === "Reporting instructions" ? f.text : `${f.label}: ${f.text}`)), fields, missing };
}
