import {
  POINT_AFTER_PPQ_LABEL, docRefLabel, mbrChoiceText, MBR_FORMAT_VERSION, printableUnit, PROCESS_MODEL_VERSION, SCHEMA_VERSION, type MbrParamRow, type MbrRecord, type MbrTrdRef, type Project, type TrdDocument } from "@gap/process-model";
import type { Block, DocModel, DocSection } from "./document";
import { effectiveField } from "./trd";
import { TRD_BANNER } from "./trd-outline";
import { mbrOpenItems, numberSteps, renderStepText, stepNumberText, type MbrOpenItem } from "./mbr";
import { NOT_HELD, NOTE_OUTSIDE, NOTE_TIGHTER, paramNote, targetSum, trdRefText } from "./mbr-values";

/**
 * The batch record as a document (the same DocModel the other outputs use, so the shared renderers, the built-in Word style, a customer's
 * own template and the Templates library all work on it unchanged).
 *
 * GMP rules kept here:
 *  - The document is a draft. It never says a value is acceptable; a comparison with the TRD value is worded "for information".
 *  - Process sections are numbered like the record (section 1 is the first unit operation), so the step numbers in the text ("Step 9.14")
 *    match the headings. The front matter (basis, open items, sources, versions) is therefore in the appendices.
 *  - Everything only the CMO can state stays a visible placeholder: "[To be completed by the CMO]".
 *  - Unknown stays visible: "Not decided" and "value not held by the site" are written out in words, never only by colour.
 *  - It states no regulatory filing category.
 */

export const MBR_DOCUMENT_TITLE = "Master batch record (draft)";
export const CMO_PLACEHOLDER = "[To be completed by the CMO]";

export interface MbrDocumentOptions {
  generatedAt?: string;
  generatorName?: string;
  appVersion?: string;
  catalogVersion?: string;
}

const NOT_ESTABLISHED = "Not established";

export const mbrBasisText = (projectId: string, rec: MbrRecord): string => {
  const from = [rec.trdId ? `TRD ${rec.trdId}` : "", rec.planId ? `sampling plan ${rec.planId}` : ""].filter(Boolean);
  return `Draft master batch record ${rec.id}, started from project ${projectId}${from.length ? ` with ${from.join(" and ")}` : " without a TRD or a sampling plan"}. Not approved. It is a first draft for the CMO to complete and approve in its own system.`;
};

/** The documents the batch record's TRD values point at, numbered in order of first use. */
class SourceNumbers {
  private order: string[] = [];
  constructor(private readonly project: Project, private readonly trd: TrdDocument | undefined) {}
  cite(ref: MbrTrdRef | undefined): string {
    if (!ref || !ref.sourceIds.length) return "";
    return ref.sourceIds
      .map((id) => {
        if (!this.order.includes(id)) this.order.push(id);
        const loc = ref.locations?.[id];
        const where = [loc?.section ? `section ${loc.section}` : "", loc?.page ? `page ${loc.page}` : ""].filter(Boolean).join(", ");
        return `[${this.order.indexOf(id) + 1}]${where ? ` (${where})` : ""}`;
      })
      .join(" ");
  }
  rows(): string[][] {
    return this.order.map((id, i) => {
      const s = this.project.sources.find((x) => x.id === id);
      if (s) return [`[${i + 1}]`, s.docRef ? docRefLabel(s.docRef) : s.label, s.docRef?.docType ?? (s.type === "user_entry" ? "Recorded note" : s.type === "interview_answer" ? "Interview answer" : s.type), s.date.slice(0, 10), s.docRef ? `${s.docRef.identifier}${s.docRef.version ? `, version ${s.docRef.version}` : ""}` : ""];
      const q = (this.trd?.origin.seedSources ?? []).find((x) => x.id === id);
      if (q) return [`[${i + 1}]`, q.document ? docRefLabel(q.document) : q.label, q.document?.docType ?? q.type, q.date.slice(0, 10), q.document ? `${q.document.identifier}${q.document.version ? `, version ${q.document.version}` : ""}` : ""];
      return [`[${i + 1}]`, "Source not found in the register", "", "", id];
    });
  }
  get count() {
    return this.order.length;
  }
}

const withUnit = (v: string | undefined, u: string | undefined) => [v, printableUnit(u)].filter((x) => (x ?? "").trim()).join(" ");

/** Where a TRD value comes from, in words: "source [1] (section 4)", "no source cited", or nothing when the TRD holds no value. */
function trdSource(ref: MbrTrdRef | undefined, src: SourceNumbers): string {
  if (!ref || ref.status !== "established") return "";
  const cite = src.cite(ref);
  return cite ? `source ${cite}` : "no source cited";
}

/** The TRD value of a row in words, with where it comes from: "TRD value 72 h; source [1] (section 4)". */
function trdWords(ref: MbrTrdRef | undefined, src: SourceNumbers): string {
  if (!ref) return "no TRD value linked";
  const v = trdRefText(ref) + (ref.provisional ? " (provisional)" : "");
  const s = trdSource(ref, src);
  return `TRD value ${v}${s ? `; ${s}` : ""}`;
}

/**
 * Column shares (percent) of the MBR parameter table: Parameter, MBR value (with TRD value and source), Choice, Reason and notes.
 * Left to the content, the reason column came out a sliver (its header wrapped to three lines and reasons were squeezed), yet the
 * reason is what a reviewer reads to judge a tightened or undecided value. The value column keeps a large share for the TRD and source text.
 */
export const MBR_PARAM_WEIGHTS = [22, 34, 14, 30];
/** Time limit or target, Value, Applies to, Source (TRD): the label and the TRD source text are the long ones. */
export const MBR_TIME_LIMIT_WEIGHTS = [32, 16, 20, 32];

function paramRow(r: MbrParamRow, src: SourceNumbers): string[] {
  const mbr = withUnit(r.mbrValue, r.mbrUnit);
  const note = paramNote(r);
  const notes = [r.reason?.trim() ? `Reason: ${r.reason.trim()}` : "", r.studyPoint ? "Study point, not a limit" : "", note ? `${note}` : ""].filter(Boolean).join(". ");
  let value: string;
  if (r.choice === "same_as_trd") value = r.trd && r.trd.status === "established" && mbr ? `${mbr} (same as TRD; ${trdSource(r.trd, src)})` : NOT_HELD;
  else if (r.choice === "tightened_by_cmo") value = `${mbr || "[value not entered]"} (${trdWords(r.trd, src)})`;
  else value = `${mbr || "Not decided"} (${trdWords(r.trd, src)})`;
  return [r.label, value, mbrChoiceText(r), notes];
}

export function mbrDocumentOpenItems(project: Project, rec: MbrRecord): MbrOpenItem[] {
  return mbrOpenItems(project, rec);
}

export function buildMbrDocument(project: Project, rec: MbrRecord, opts: MbrDocumentOptions = {}): DocModel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const trd = rec.trdId ? project.trd.documents.find((d) => d.id === rec.trdId) : undefined;
  const open = mbrOpenItems(project, rec);
  const src = new SourceNumbers(project, trd);
  const numbers = numberSteps(rec);
  const detail = (key: string) => {
    const f = trd?.details.find((x) => x.key === key);
    return f ? effectiveField(f).text : NOT_ESTABLISHED;
  };

  const sections: DocSection[] = [];
  const appendix = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String.fromCharCode(65 + sections.filter((s) => s.appendix).length), appendix: true, title, blocks });

  // The process sections, numbered exactly like the record so that "Step 9.14" is in section 9.
  rec.sections.forEach((s, si) => {
    const blocks: Block[] = [];
    if (s.blocks.length === 0) blocks.push({ type: "paragraph", text: "No block has been added to this section yet." });
    for (const b of s.blocks) {
      blocks.push({ type: "heading", text: b.title });
      if (b.note?.trim()) blocks.push({ type: "note", text: b.note.trim() });
      if (b.steps.length) {
        blocks.push({ type: "table", columns: ["Step", "Instruction"], rows: b.steps.map((st) => [numbers.get(st.id) ?? "", renderStepText(st.text, numbers)]) });
      }
      if (b.params.length) {
        blocks.push({ type: "table", columns: ["Parameter", "MBR value (TRD value, source)", "Choice", "Reason and notes"], rows: b.params.map((r) => paramRow(r, src)), caption: "Parameters", weights: MBR_PARAM_WEIGHTS });
      }
      if (b.timeLimits.length) {
        const rows: string[][] = [];
        const notes: string[] = [];
        for (const t of b.timeLimits) {
          const crit = withUnit(t.value, t.unit);
          rows.push([t.label, crit || NOT_HELD, "Critical limit", trdWords(t.trd, src)]);
          for (const g of t.targets) {
            const range = g.fromStepId || g.toStepId ? [stepNumberText(numbers, g.fromStepId), stepNumberText(numbers, g.toStepId)].filter(Boolean).join(" to ") : "No step range given";
            rows.push([`${g.label} (target under ${t.label})`, withUnit(g.value, g.unit) || "[value not entered]", range, ""]);
          }
          if (t.targets.length) notes.push(`${t.label}: ${targetSum(t).text}`);
        }
        blocks.push({ type: "table", columns: ["Time limit or target", "Value", "Applies to", "Source (TRD)"], rows, caption: "Time limits", weights: MBR_TIME_LIMIT_WEIGHTS });
        if (notes.length) blocks.push({ type: "list", items: notes });
      }
      for (const f of b.forms ?? []) {
        // A fill-in table: the operators write the entries while the batch is made. The rows are empty on purpose.
        blocks.push({ type: "table", columns: f.columns, rows: Array.from({ length: f.blankRows }, () => f.columns.map(() => "")), caption: f.title });
        if (f.note?.trim()) blocks.push({ type: "note", text: f.note.trim() });
      }
      if (b.samples.length) {
        // The flag is read from the sampling plan point when the document is built (the plan stays the record of truth); a
        // point the plan does not flag reads "Not stated", never a guess.
        const plan = rec.planId ? project.sampling.plans.find((p) => p.id === rec.planId) : undefined;
        const flag = (pointId: string) => {
          const af = plan?.points.find((p) => p.id === pointId)?.afterPpq;
          return af ? POINT_AFTER_PPQ_LABEL[af] : "Not stated";
        };
        blocks.push({
          type: "table",
          columns: ["Sample", "Test", "Step", "Quantity", "Container", "Storage", "Moment in the process", "Hold", "After PPQ", "Result"],
          rows: b.samples.map((x) => [x.pointId, x.test, x.step ?? "", x.quantity ?? "", x.container ?? "", x.storage ?? "", x.hour ?? "", x.hold ?? "", flag(x.pointId), CMO_PLACEHOLDER]),
          caption: "Samples (from the sampling plan)",
        });
      }
      if (b.cmoFields.length) {
        blocks.push({ type: "table", columns: ["To be completed by the CMO", "Entry"], rows: b.cmoFields.map((f) => [f, CMO_PLACEHOLDER]) });
      }
    }
    sections.push({ id: `section-${s.id}`, number: String(si + 1), title: s.title, blocks });
  });

  appendix("basis", "Basis and how to read this draft", [
    { type: "note", text: mbrBasisText(project.meta.id, rec) },
    rec.purpose?.trim() ? { type: "paragraph", text: rec.purpose.trim() } : { type: "paragraph", text: "No purpose has been entered. This is left to the team; the tool does not supply wording." },
    { type: "list", items: [
      "TRD value: the value in the technical requirements document at the time it was copied. MBR value: the value this batch record states.",
      "Same as TRD: the MBR value is the TRD value. Tightened by the CMO: the MBR value is the CMO's own, with its reason. Not decided: nobody has chosen yet. Study point (not a limit): a challenge value kept for a study; it is not a limit and is not counted as not decided.",
      `${NOT_HELD}: the TRD record has no established value for it. Nothing was filled in.`,
      `${NOTE_OUTSIDE} and ${NOTE_TIGHTER} are comparisons for information only. They do not say a value is acceptable.`,
      `${CMO_PLACEHOLDER}: entries only the CMO can make (batch number, equipment IDs, calibration, BOM and ERP IDs, form and SOP numbers, alarm values, weights, densities, signatures and all results).`,
    ] },
  ]);

  appendix("open-items", "Open items", [
    { type: "paragraph", text: open.length ? "Choices not yet made and TRD requirements that have no step. Nothing has been decided on behalf of the team. The draft is not complete while these remain." : "No open items. This does not mean the batch record is complete or correct; that is for the CMO and quality assurance to judge." },
    ...(open.length ? ([{ type: "table", columns: ["Where", "Open item"], rows: open.map((o) => [o.where, o.text]) }] as Block[]) : []),
  ]);

  if (src.count) {
    appendix("sources", "Sources of the TRD values", [
      { type: "paragraph", text: "The documents cited for the TRD values in this draft, numbered in order of first use." },
      { type: "table", columns: ["No.", "Source", "Type", "Date", "Document"], rows: src.rows() },
    ]);
  }

  appendix("versions", "Versions", [
    {
      type: "table",
      columns: ["Item", "Value"],
      rows: [
        ["Generator", `${opts.generatorName ?? "Gap Assessment Generator (proof of concept)"} ${opts.appVersion ?? "unversioned"}`],
        ["Batch record", `${rec.id}${rec.version ? `, version ${rec.version}` : ""}, last changed ${rec.updatedAt.replace("T", " ").slice(0, 16)} UTC`],
        ["MBR format", MBR_FORMAT_VERSION],
        ["Process model", PROCESS_MODEL_VERSION],
        ["Catalog", opts.catalogVersion ?? "Not recorded"],
        ["Project schema", project.schemaVersion ?? SCHEMA_VERSION],
      ],
    },
    { type: "note", text: "Regulatory impact of any change to the process: Requires regulatory affairs assessment." },
  ]);

  return {
    title: MBR_DOCUMENT_TITLE,
    banner: TRD_BANNER,
    // The record is written for the sending side's idea of the process and has to be adapted by the unit that will run it.
    status: "DRAFT FOR RECEIVING-UNIT ADAPTATION",
    meta: [
      ["Project", project.meta.title],
      ["Batch record", `${rec.id}: ${rec.title}`],
      ["Document reference", rec.docRef?.trim() || "Not given"],
      ...(rec.version?.trim() ? ([["Version", rec.version.trim()]] as [string, string][]) : []),
      ["Based on", [rec.trdId ? `TRD ${rec.trdId}` : "", rec.planId ? `Sampling plan ${rec.planId}` : ""].filter(Boolean).join("; ") || "Neither (blank start)"],
      ["Generated", generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["Open items", String(open.length)],
    ],
    cover: {
      program: detail("program"),
      product: ["modality", "dosageForm", "presentation"].map(detail).join(", "),
      sourceSite: "",
      targetSite: [detail("site"), detail("line")].filter((x) => x !== NOT_ESTABLISHED).join(", ") || NOT_ESTABLISHED,
      sourceStage: "",
      targetStage: detail("programStage"),
    },
    sections,
    tbdCount: open.length,
  };
}
