import type { Actor, ExcipientAssessment, ExcipientLine, FailureModeSuggestion, FailureModeSuggestions, Project, RiskAssessment, TrdDocument } from "@gap/process-model";
import { excipientAssessments } from "@gap/process-model";
import { ExcipientError, excipientAssessmentOf, excipientLineOf, updateExcipientLine } from "./excipient";
import { addItem } from "./risk";
import { setBlankValue } from "./trd-writeup";

/**
 * What an excipient line is linked to in the other modules (spec section 7). Every link is stored on the excipient line only, so the TRD,
 * risk and batch record formats do not change. Nothing here decides anything: the person picks the TRD material, types the document
 * reference and chooses which risk suggestion to start. A risk item started from an excipient is a DRAFT with no score.
 */

// ------------------------------------------------------------------ technical requirements document (TRD)

/** The two typed blanks of the "Dilution buffer" write-up that the excipient assessment fills (content/trd-writeups/writeups.yaml). */
export const TRD_ASSESSMENT_DOCUMENT_KEY = "trd.dilutionBuffer.assessmentDocument";
export const TRD_ASSESSMENT_PROCEDURE_KEY = "trd.dilutionBuffer.assessmentProcedure";
/** The key of the TRD write-up that holds those blanks (library entry sec_dilution_buffer). */
export const TRD_DILUTION_WRITEUP_KEY = "dilution_buffer";

/** One buffer or diluent material of a TRD: the place a line can say it belongs to. */
export interface TrdMaterialChoice {
  /** The three parts joined for a menu value: trdId/stepKey/itemKey. */
  value: string;
  trdId: string;
  trdTitle: string;
  stepKey: string;
  stepLabel: string;
  itemKey: string;
  itemLabel: string;
}

/**
 * The materials of every TRD, step by step. Only materials are offered: the link says which buffer or diluent an excipient is part of.
 * A step typed in the TRD has no catalog key, so its id stands in for the key.
 */
export function trdMaterialChoices(project: Pick<Project, "trd">): TrdMaterialChoice[] {
  const out: TrdMaterialChoice[] = [];
  for (const d of project.trd.documents) {
    for (const s of d.steps) {
      const stepKey = s.key ?? s.id;
      for (const i of s.items) {
        if (i.collection !== "mat") continue;
        out.push({ value: `${d.id}/${stepKey}/${i.key}`, trdId: d.id, trdTitle: d.title, stepKey, stepLabel: s.label, itemKey: i.key, itemLabel: i.label });
      }
    }
  }
  return out;
}

export const trdItemValue = (l: { trdId: string; stepKey: string; itemKey: string }): string => `${l.trdId}/${l.stepKey}/${l.itemKey}`;

/** A TRD link in words, e.g. "Technical requirements document TRD-001, Buffer preparation, Diluent". Falls back to the ids when the TRD changed. */
export function trdLinkText(project: Pick<Project, "trd">, link: { trdId: string; stepKey: string; itemKey: string }): string {
  const hit = trdMaterialChoices(project).find((c) => c.value === trdItemValue(link));
  if (!hit) return `Technical requirements document ${link.trdId}, ${link.stepKey}, ${link.itemKey} (no longer in the document)`;
  return `Technical requirements document ${hit.trdId}, ${hit.stepLabel}, ${hit.itemLabel}`;
}

function dilutionWriteup(d: TrdDocument | undefined) {
  return d?.writeups?.find((w) => w.kind === "section" && w.key === TRD_DILUTION_WRITEUP_KEY);
}

/** What the TRD holds now for the two blanks, and whether it has the section at all. */
export interface TrdUseState {
  trdId: string;
  trdTitle: string;
  hasSection: boolean;
  writeupId?: string;
  document: string;
  procedure: string;
}

export function trdUseState(project: Pick<Project, "trd">, trdId: string): TrdUseState | undefined {
  const d = project.trd.documents.find((x) => x.id === trdId);
  if (!d) return undefined;
  const w = dilutionWriteup(d);
  return {
    trdId,
    trdTitle: d.title,
    hasSection: !!w,
    ...(w ? { writeupId: w.id } : {}),
    document: w?.values?.[TRD_ASSESSMENT_DOCUMENT_KEY]?.value ?? "",
    procedure: w?.values?.[TRD_ASSESSMENT_PROCEDURE_KEY]?.value ?? "",
  };
}

/**
 * The approved assessment reference the TRD states for an excipient assessment, so the TRD and the document say the same thing.
 * Taken from the TRD blank of every TRD that one of the assessment's lines is linked to; empty when nothing was typed.
 */
export function assessmentTrdReferences(project: Project, assessment: ExcipientAssessment): { trdId: string; document: string; procedure: string }[] {
  const ids = [...new Set(assessment.lines.flatMap((l) => (l.links.trdItem ? [l.links.trdItem.trdId] : [])))];
  return ids.flatMap((id) => {
    const s = trdUseState(project, id);
    return s ? [{ trdId: id, document: s.document, procedure: s.procedure }] : [];
  });
}

export interface UseInTrdInput {
  /** The reference of the approved assessment in the company's document control. */
  document?: string;
  /** The procedure or agreement that governs the assessment. */
  procedure?: string;
}

/**
 * The explicit "Use in the TRD" action. It writes the typed blanks of the TRD's Dilution buffer section through the TRD's own edit
 * function (one change-log event for each value that changes). A box left empty writes nothing: it never clears what the TRD holds.
 * There is no silent fallback: a TRD without that section is told so and nothing is written. The excipient table of the section is not
 * written (see excipientTableText): its rows are the author's, and the quantities need the batch size, which this tool does not know.
 */
export function applyExcipientToTrd(project: Project, assessmentId: string, lineId: string, input: UseInTrdInput, actor: Actor): Project {
  const line = excipientLineOf(excipientAssessmentOf(project, assessmentId), lineId);
  const link = line.links.trdItem;
  if (!link) throw new ExcipientError("Choose the TRD material this excipient belongs to first.");
  const state = trdUseState(project, link.trdId);
  if (!state) throw new ExcipientError(`The technical requirements document ${link.trdId} is not in this project any more. Choose the material again.`);
  if (!state.hasSection || !state.writeupId) {
    throw new ExcipientError(`${link.trdId} has no "Dilution buffer" section yet. Add it from the library on the TRD page, then come back. Nothing was written.`);
  }
  const doc = (input.document ?? "").trim();
  const procedure = (input.procedure ?? "").trim();
  if (!doc && !procedure) throw new ExcipientError("Type the document reference or the procedure first. Nothing was written.");
  let next = project;
  if (doc) next = setBlankValue(next, link.trdId, state.writeupId, TRD_ASSESSMENT_DOCUMENT_KEY, doc, actor);
  if (procedure) next = setBlankValue(next, link.trdId, state.writeupId, TRD_ASSESSMENT_PROCEDURE_KEY, procedure, actor);
  return next;
}

const cellText = (s: string): string => s.replace(/[\t\r\n]+/g, " ").trim();

/**
 * The excipients of one TRD as text to copy into the "Excipient solution" table of its Dilution buffer section: one row for each line
 * linked to that TRD, columns Component, Material name, Composition. The composition is the concentration the person entered, or
 * "Not established". The fourth column of the table (calculated quantity) is left for the author.
 */
export function excipientTableRows(project: Project, assessmentId: string, trdId: string, labels: { role: (line: ExcipientLine) => string; composition: (line: ExcipientLine) => string }): string[][] {
  const a = excipientAssessmentOf(project, assessmentId);
  return a.lines.filter((l) => l.links.trdItem?.trdId === trdId).map((l) => [cellText(labels.role(l)), cellText(l.name), cellText(labels.composition(l))]);
}

export const excipientTableText = (rows: readonly (readonly string[])[]): string => rows.map((r) => r.join("\t")).join("\n");

/** How many excipients of the project are linked to a TRD, for "N excipients assessed" on the TRD page. */
export function excipientsAssessedInTrd(project: Project, trdId: string): number {
  return excipientAssessments(project).reduce((n, a) => n + a.lines.filter((l) => l.links.trdItem?.trdId === trdId).length, 0);
}

export const excipientsAssessedText = (n: number): string => `${n} ${n === 1 ? "excipient" : "excipients"} assessed`;

// ------------------------------------------------------------------ risk assessment

/** The catalog suggestions that are about an excipient (key "excipient_..."), in catalog order. */
export function excipientRiskSuggestions(library: FailureModeSuggestions): FailureModeSuggestion[] {
  return library.suggestions.filter((s) => s.key.startsWith("excipient_"));
}

export interface ExcipientRiskOffer extends FailureModeSuggestion {
  /** The step of the risk assessment the failure mode would sit on: the one with the same unit operation. Absent when the assessment has none. */
  stepId?: string;
  stepLabel?: string;
  /** A draft item for this suggestion was already started from THIS excipient. */
  added: boolean;
  /** The id of that item. */
  itemId?: string;
}

/** The offers for one excipient in one risk assessment. Another excipient may start the same suggestion again: the check is per excipient. */
export function excipientRiskOffers(library: FailureModeSuggestions, risk: RiskAssessment, line: ExcipientLine): ExcipientRiskOffer[] {
  const mine = line.links.riskItems.filter((r) => r.assessmentId === risk.id).map((r) => risk.items.find((i) => i.id === r.itemId)).filter((i) => !!i);
  return excipientRiskSuggestions(library).map((s) => {
    const step = risk.steps.find((x) => x.unitOp === s.unitOp);
    const done = mine.find((i) => i?.origin?.kind === "catalog" && i.origin.suggestionKey === s.key);
    return { ...s, ...(step ? { stepId: step.id, stepLabel: step.label } : {}), added: !!done, ...(done ? { itemId: done.id } : {}) };
  });
}

/**
 * "Start a risk item from this excipient". Adds a DRAFT item with the risk module's own add function: the catalog's wording for the team
 * to edit, no score. The notes name the excipient so the item can be traced back. The pair {risk assessment, item} is stored on the line.
 */
export function startRiskItemFromExcipient(
  project: Project,
  excipientAssessmentId: string,
  lineId: string,
  riskAssessmentId: string,
  suggestionKey: string,
  library: FailureModeSuggestions,
  actor: Actor,
): { project: Project; itemId: string } {
  const a = excipientAssessmentOf(project, excipientAssessmentId);
  const line = excipientLineOf(a, lineId);
  const risk = project.risk.assessments.find((r) => r.id === riskAssessmentId);
  if (!risk) throw new ExcipientError(`Risk assessment ${riskAssessmentId} does not exist`);
  const offer = excipientRiskOffers(library, risk, line).find((o) => o.key === suggestionKey);
  if (!offer) throw new ExcipientError("That suggestion is not one of the excipient suggestions.");
  if (offer.added) throw new ExcipientError(`Risk item ${offer.itemId} was already started from this excipient with this suggestion.`);
  const made = addItem(
    project,
    riskAssessmentId,
    {
      ...(offer.stepId ? { stepId: offer.stepId } : {}),
      failureMode: offer.failureMode,
      effect: offer.effect,
      causes: offer.causes,
      ...(offer.controlsPrevention ? { controlsPrevention: offer.controlsPrevention } : {}),
      ...(offer.controlsDetection ? { controlsDetection: offer.controlsDetection } : {}),
      notes: `Started from excipient ${line.id} (${line.name}) of ${a.id}. The score is the team's to give.`,
      origin: { kind: "catalog", suggestionKey: offer.key, catalogVersion: library.catalog.version },
    },
    actor,
  );
  const linked = updateExcipientLine(made.project, excipientAssessmentId, lineId, { riskItems: [...line.links.riskItems, { assessmentId: riskAssessmentId, itemId: made.itemId }] }, actor);
  return { project: linked, itemId: made.itemId };
}
