import type { Project, TrdDocument } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { buildTrdDocument } from "./trd-document";
import type { InterviewQuestion } from "./trd-interview";
import { trdWriteupUnitIds } from "./trd-units";

/**
 * Where an interview answer lands in the TRD document (M15): the number and heading of the section, as the Document tab shows them, and the
 * id of the section there, so a link can open the Document tab at it. Worked out from the document itself, never stored, so the number
 * is the one the reader will see even when optional sections are added or taken out.
 */
export interface AnswerPlace {
  /** "6" for a section, "6.2" for a process description inside the manufacturing process overview. */
  number: string;
  heading: string;
  /** The id of the section in the document (the anchor is `doc-<sectionId>` in the HTML). */
  sectionId: string;
}

/** Where one answer lands: the section as the Document tab shows it, and the placeable unit (see trd-units.ts) a template heading can hold. */
export interface AnswerLanding {
  place?: AnswerPlace;
  /** The unit of the TRD the answer is read in. Absent for document fields and details, which sit on the cover page. */
  unitId?: string;
}

const FIXED_TIME = "2000-01-01T00:00:00.000Z";

type PlaceQuestion = Pick<InterviewQuestion, "key" | "usedIn" | "target" | "stepKey" | "stepLabel">;

/**
 * The first place each question's answer is read, by question key, as a section of the document and as a unit. A question the process
 * descriptions read lands in that description (its own unit, "overview:<step>", so a template with a heading per process step gets that
 * step's questions under it); a value of a process step with no description lands in the parameters section of the document. Details and
 * document fields sit on the cover page (no numbered section, no unit), so they have no entry and the card says nothing instead of guessing.
 * The document is built once for all of them.
 */
export function trdAnswerLandings(project: Project, d: TrdDocument, questions: readonly PlaceQuestion[], content: ContentBundle): Map<string, AnswerLanding> {
  const out = new Map<string, AnswerLanding>();
  const doc = buildTrdDocument(project, d, { generatedAt: FIXED_TIME, content });
  const unitIds = trdWriteupUnitIds(d);
  const subHeading = (sectionId: string, title: string): AnswerPlace | undefined => {
    const sec = doc.sections.find((s) => s.id === sectionId);
    if (!sec) return undefined;
    for (const b of sec.blocks) {
      if (b.type !== "heading") continue;
      const m = /^(\d+\.\d+)\s+(.*)$/.exec(b.text);
      if (m && m[2] === title) return { number: m[1]!, heading: m[2]!, sectionId };
    }
    return { number: sec.number, heading: sec.title, sectionId };
  };
  const params = doc.sections.find((s) => s.id === "writeup-process_parameters") ?? doc.sections.find((s) => s.id === "process-parameters");
  for (const q of questions) {
    if (q.target.kind === "document" || q.target.kind === "detail") continue;
    const first = q.usedIn[0];
    const w = first ? (d.writeups ?? []).find((x) => x.id === first.writeupId) : undefined;
    let place: AnswerPlace | undefined;
    let unitId: string | undefined;
    if (w?.kind === "unitOp") place = subHeading("manufacturing-overview", w.title);
    else if (w) {
      const sec = doc.sections.find((s) => s.id === `writeup-${w.key}`);
      if (sec) place = { number: sec.number, heading: sec.title, sectionId: sec.id };
    } else if (params) place = subHeading(params.id, q.stepLabel);
    if (w) unitId = unitIds.get(w.id);
    else if (params) unitId = params.id;
    if (place || unitId) out.set(q.key, { ...(place ? { place } : {}), ...(unitId ? { unitId } : {}) });
  }
  return out;
}

/** The section each answer lands in, by question key (the card's "Lands in section N" line). */
export function trdAnswerPlaces(project: Project, d: TrdDocument, questions: readonly PlaceQuestion[], content: ContentBundle): Map<string, AnswerPlace> {
  const out = new Map<string, AnswerPlace>();
  for (const [key, l] of trdAnswerLandings(project, d, questions, content)) if (l.place) out.set(key, l.place);
  return out;
}
