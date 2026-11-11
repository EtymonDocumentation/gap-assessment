import type { TrdDocument, TrdLibraryWriteup } from "@gap/process-model";
import type { ContentBundle } from "./content";
import type { Block, DocModel, DocSection } from "./document";
import { OVERVIEW_SECTION_KEY, writeupOrder } from "./trd-writeup-order";
import { OVERVIEW_TITLE } from "./trd-writeup-document";

/*
 * The pieces of the TRD a person can place under a heading of their own Word template (M15, job 2).
 *
 * A "unit" is one piece of TRD content with a STABLE id: the id of a section of the document ("purpose-scope", "writeup-batch_size",
 * "open-items") or, inside the manufacturing process overview, one process description ("overview:wu_buffer_prep"). Never a section
 * NUMBER: numbers change whenever an optional section is added or taken out, and a placement kept by number would silently move.
 *
 * The match screen, the stored placements and the Word download all work on these units, so one definition lives here. The units come from
 * the document the TRD already builds, so what a person places is exactly the text the Document page shows.
 */

/** The title, status and document details at the head of the TRD. The one unit that is not a section of the document. */
export const TRD_FRONT_UNIT = "front";
export const TRD_FRONT_TITLE = "Title, status and document details";

/** One placeable piece of the TRD: its stable id and the words the match screen shows for it (never a number). */
export interface TrdUnitInfo {
  id: string;
  title: string;
}

/** Cascade's own numbers in a sub-heading ("6.2 Buffer preparation"). A template has its own numbering, so they are taken out of the Word file. */
const CASCADE_NUMBER = /^\d+(?:\.\d+)+\s+/;

function withoutNumbers(blocks: readonly Block[]): Block[] {
  return blocks.map((b) => (b.type === "heading" ? { ...b, text: b.text.replace(CASCADE_NUMBER, "") } : b));
}

/** The id of one process description inside the overview. The library id is unique where the key is not (two descriptions share "aseptic_filling"). */
function overviewUnitId(w: { libraryId?: string; key: string }, taken: Set<string>): string {
  const base = `overview:${w.libraryId ?? w.key}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}#${n}`;
  taken.add(id);
  return id;
}

/**
 * The TRD document regrouped into units, for a Word download that follows a person's own template. Same words as the document, with
 * three differences: the manufacturing process overview is split into one unit per process description (so each can go under its own
 * heading), Cascade's section and sub-section numbers are taken out (the template numbers its own headings), and no section is marked as an
 * appendix. Nothing is added or dropped. The title, status and details stay on the model for the "front" unit.
 */
export function trdUnitModel(model: DocModel, d: TrdDocument): DocModel {
  const sections: DocSection[] = [];
  const plain = (s: DocSection, title = s.title, blocks: readonly Block[] = s.blocks): DocSection => ({ id: s.id, number: "", title, blocks: withoutNumbers(blocks) });
  for (const s of model.sections) {
    if (s.id !== "manufacturing-overview") {
      sections.push(plain(s));
      continue;
    }
    const order = writeupOrder(d);
    const taken = new Set<string>();
    // Where each process description starts: its own heading block ("5.2 Title"), in the order the document builder wrote them.
    const starts: { w: (typeof order.overview)[number]; at: number }[] = [];
    let from = 0;
    order.overview.forEach((w, i) => {
      const want = `${s.number}.${i + 1} ${w.title}`;
      const at = s.blocks.findIndex((b, k) => k >= from && b.type === "heading" && b.level === undefined && b.text === want);
      if (at >= 0) {
        starts.push({ w, at });
        from = at + 1;
      }
    });
    const preface = s.blocks.slice(0, starts[0]?.at ?? s.blocks.length);
    // The introduction heads the overview. Without one, the only preface is the note on open blanks, which moves to the first description.
    if (order.intro || !starts.length) sections.push(plain(s, order.intro?.title ?? OVERVIEW_TITLE, preface));
    starts.forEach(({ w, at }, i) => {
      const end = starts[i + 1]?.at ?? s.blocks.length;
      const lead = !order.intro && i === 0 ? preface : [];
      sections.push({ id: overviewUnitId(w, taken), number: "", title: w.title, blocks: withoutNumbers([...lead, ...s.blocks.slice(at + 1, end)]) });
    });
  }
  return { ...model, sections };
}

/** The units of a unit model: the front first, then one per section, in document order. */
export function trdUnitsOf(model: DocModel): TrdUnitInfo[] {
  return [{ id: TRD_FRONT_UNIT, title: TRD_FRONT_TITLE }, ...model.sections.map((s) => ({ id: s.id, title: s.title }))];
}

/** The sections the document builds itself, whatever the TRD holds. */
const BUILT_IN: TrdUnitInfo[] = [
  { id: "purpose-scope", title: "Purpose and scope" },
  { id: "product", title: "About this document" },
  { id: "overview", title: "Process overview" },
  { id: "process-parameters", title: "Process steps and parameters" },
  { id: "open-items", title: "Open items" },
  { id: "approval", title: "Approval" },
  { id: "references", title: "References" },
  { id: "overrides", title: "Overrides" },
];

/**
 * Every unit the TRD can have, from the write-up library: used on the Templates page, where no TRD is open. A unit the open TRD does not
 * have is simply not in its Word file; a placement for it is kept for the TRD that does.
 */
export function trdLibraryUnits(library: readonly TrdLibraryWriteup[]): TrdUnitInfo[] {
  const out: TrdUnitInfo[] = [{ id: TRD_FRONT_UNIT, title: TRD_FRONT_TITLE }];
  const seen = new Set<string>();
  const add = (u: TrdUnitInfo) => {
    if (seen.has(u.id)) return;
    seen.add(u.id);
    out.push(u);
  };
  for (const w of library) if (w.kind === "section" && w.key !== OVERVIEW_SECTION_KEY && !w.placement) add({ id: `writeup-${w.key}`, title: w.title });
  const intro = library.find((w) => w.kind === "section" && w.key === OVERVIEW_SECTION_KEY);
  add({ id: "manufacturing-overview", title: intro?.title ?? OVERVIEW_TITLE });
  for (const w of library) if (w.kind === "unitOp" || (w.kind === "section" && w.key !== OVERVIEW_SECTION_KEY && w.placement)) add({ id: `overview:${w.id}`, title: w.title });
  for (const b of BUILT_IN) add(b);
  return out;
}

/**
 * Other names a process description goes by, for suggesting where it belongs: the name of the step in this TRD and the catalog's own name
 * for the unit operation. Keyed by unit id. A hint helps a suggestion; a person still confirms every one.
 */
export function trdUnitHints(d: TrdDocument, content: ContentBundle): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const taken = new Set<string>();
  for (const w of writeupOrder(d).overview) {
    const id = overviewUnitId(w, taken);
    const names: string[] = [];
    if (w.kind === "unitOp") {
      const step = d.steps.find((s) => s.id === w.stepId);
      if (step?.label) names.push(step.label);
      const uo = content.catalog.unitOperations.find((u) => u.key === w.key);
      if (uo?.label) names.push(uo.label);
    }
    out[id] = names;
  }
  return out;
}
