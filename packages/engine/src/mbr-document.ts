import {
  POINT_AFTER_PPQ_LABEL, docRefLabel, mbrChoiceText, MBR_FORMAT_VERSION, printableUnit, PROCESS_MODEL_VERSION, SCHEMA_VERSION, type MbrParamRow, type MbrRecord, type MbrTrdRef, type Project, type TrdDocument } from "@gap/process-model";
import type { Block, DocModel, DocSection } from "./document";
import { effectiveField } from "./trd";
import { TRD_BANNER } from "./trd-outline";
import { holdEntryInfo, mbrOpenItems, numberSteps, renderStepText, splitIndex, stepNumberText, type HoldEntryInfo, type MbrOpenItem, type MbrPart } from "./mbr";
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
/** A visible write-in line: the operator fills it in while the batch is made. The site never fills a batch execution value. */
export const WRITE_IN = "______________________";
export const CMO_PLACEHOLDER = "[To be completed by the CMO]";

export interface MbrDocumentOptions {
  generatedAt?: string;
  generatorName?: string;
  appVersion?: string;
  catalogVersion?: string;
  /**
   * For a split record: 1 or 2 builds the document of that part (its own document number, its sections and its hold entry). Absent builds
   * the whole record, with both hold entries at the split. Ignored for a record that is not split.
   */
  part?: MbrPart;
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

/** Words for the time limit the elapsed hold time is compared with: the limit row, its value and where the value comes from. */
function holdLimitWords(info: HoldEntryInfo, src: SourceNumbers): string {
  const t = info.limit;
  const value = t ? withUnit(t.value, t.unit) : "";
  if (!t || !value) return "No limit stated" + (t ? ` (the time limit "${t.label}" has no value)` : "");
  return `${t.label}: ${value} (${trdWords(t.trd, src)})`;
}

/**
 * The hold-start entry that closes Part 1, or the hold-end entry that opens Part 2. The operators write every value while the batch is
 * made, so the fields are write-in lines. The elapsed hold time is written by the operator and sits next to the limit the record already
 * holds; the document does not say whether a time is acceptable.
 */
function holdEntrySection(project: Project, rec: MbrRecord, info: HoldEntryInfo, edge: "start" | "end", src: SourceNumbers): DocSection {
  const sp = rec.split!;
  const start = edge === "start";
  const hold = info.hold;
  const entry = info.entries.find((e) => e.edge === edge)!;
  const blocks: Block[] = [];
  const partRef = (n: 1 | 2) => sp[n === 1 ? "part1DocRef" : "part2DocRef"]?.trim() || "document number not given";
  blocks.push({
    type: "note",
    text: start
      ? `This entry closes Part 1 (${partRef(1)}). The product is held after the last step of Part 1. Part 2 (${partRef(2)}) opens with the hold-end entry.`
      : `This entry opens Part 2 (${partRef(2)}). Fill it in when the product leaves the hold: it closes the hold that began at the hold-start entry at the end of Part 1 (${partRef(1)}).`,
  });
  const planHold = hold ? `${hold.label}${hold.condition?.trim() ? ` (${hold.condition.trim()})` : ""}` : info.holdMissing ? "The hold named earlier is no longer in the sampling plan" : "No hold of the sampling plan was named for this gap";
  const rows: string[][] = [
    ["Hold in the sampling plan", planHold],
    [start ? "Date and time the hold started" : "Date and time the hold ended", WRITE_IN],
    ["Done by (signature and date)", WRITE_IN],
    ["Checked by (signature and date)", WRITE_IN],
    ["Vessel or bag ID", WRITE_IN],
    ["Storage temperature", WRITE_IN],
    ["Room or location", WRITE_IN],
  ];
  if (!start) {
    rows.push(["Elapsed hold time (written by the operator from the hold-start entry)", WRITE_IN]);
    rows.push(["Hold time limit of this record", holdLimitWords(info, src)]);
    rows.push(["Elapsed hold time compared with the limit (operator)", WRITE_IN]);
  }
  blocks.push({ type: "table", columns: ["Entry", "Record"], rows, caption: start ? "Hold start" : "Hold end", weights: [45, 55] });
  if (start) blocks.push({ type: "paragraph", text: `Hold time limit of this record: ${holdLimitWords(info, src)}` });
  if (entry.samples.length) {
    const plan = rec.planId ? project.sampling.plans.find((p) => p.id === rec.planId) : undefined;
    blocks.push({
      type: "table",
      columns: ["Sample", "Test", "Quantity", "Container", "Storage", "Moment in the process", "Result"],
      rows: entry.samples.map((x) => [x.pointId, x.test, x.quantity ?? "", x.container ?? "", x.storage ?? "", x.hour ?? "", CMO_PLACEHOLDER]),
      caption: `Samples at the ${start ? "start" : "end"} of the hold (from the sampling plan${plan ? ` ${plan.id}` : ""})`,
    });
  } else if (hold) {
    blocks.push({ type: "paragraph", text: `The sampling plan has no sample at the ${start ? "start" : "end"} of this hold.` });
  } else {
    blocks.push({ type: "paragraph", text: "No sampling plan hold was named for this gap, so no samples are listed here." });
  }
  return { id: start ? "hold-start" : "hold-end", number: start ? "H1" : "H2", title: start ? "Hold start (end of Part 1)" : "Hold end (start of Part 2)", blocks };
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

  // A split record: Part 1 ends with the hold-start entry and Part 2 opens with the hold-end entry. The section numbers run on across the
  // parts (Part 2 starts at the section after the split), so a step number means the same step in either document.
  const cut = splitIndex(rec);
  const part = cut >= 0 ? opts.part : undefined;
  const holdInfo = cut >= 0 ? holdEntryInfo(project, rec) : undefined;

  // The process sections, numbered exactly like the record so that "Step 9.14" is in section 9.
  rec.sections.forEach((s, si) => {
    if ((part === 1 && si > cut) || (part === 2 && si <= cut)) return;
    if (holdInfo && si === cut + 1 && part !== 1) sections.push(holdEntrySection(project, rec, holdInfo, "end", src));
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
    if (holdInfo && si === cut && part !== 2) sections.push(holdEntrySection(project, rec, holdInfo, "start", src));
  });

  appendix("basis", "Basis and how to read this draft", [
    { type: "note", text: mbrBasisText(project.meta.id, rec) },
    ...(part ? ([{ type: "paragraph", text: `This is Part ${part} of 2 of one batch record. The other part is a separate document (${rec.split![part === 1 ? "part2DocRef" : "part1DocRef"]?.trim() || "document number not given"}). Section and step numbers run on across the two parts, and the TRD values, time limits and open items below belong to the whole record.` }] as Block[]) : []),
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
        ["Batch record", `${rec.id}${rec.version ? `, version ${rec.version}` : ""}${part ? `, part ${part} of 2` : ""}, last changed ${rec.updatedAt.replace("T", " ").slice(0, 16)} UTC`],
        ["MBR format", MBR_FORMAT_VERSION],
        ["Process model", PROCESS_MODEL_VERSION],
        ["Catalog", opts.catalogVersion ?? "Not recorded"],
        ["Project schema", project.schemaVersion ?? SCHEMA_VERSION],
      ],
    },
    { type: "note", text: "Regulatory impact of any change to the process: Requires regulatory affairs assessment." },
  ]);

  const splitMeta = (): [string, string][] => {
    if (!rec.split) return [];
    const ref = (n: 1 | 2) => rec.split![n === 1 ? "part1DocRef" : "part2DocRef"]?.trim() || "Not given";
    const range = (n: MbrPart) => {
      const from = n === 1 ? 1 : cut + 2;
      const to = n === 1 ? cut + 1 : rec.sections.length;
      return from === to ? `section ${from}` : `sections ${from} to ${to}`;
    };
    return part
      ? [
          ["Part", `Part ${part} of 2 (${range(part)})`],
          [`Other part (Part ${part === 1 ? 2 : 1})`, ref(part === 1 ? 2 : 1)],
          ["Whole record reference", rec.docRef?.trim() || "Not given"],
        ]
      : [
          ["Part 1 document reference", `${ref(1)} (${range(1)})`],
          ["Part 2 document reference", `${ref(2)} (${range(2)})`],
        ];
  };
  const docRef = (part ? rec.split![part === 1 ? "part1DocRef" : "part2DocRef"]?.trim() : undefined) || (part ? undefined : rec.docRef?.trim()) || "Not given";

  return {
    title: part ? `Master batch record, Part ${part} of 2 (draft)` : MBR_DOCUMENT_TITLE,
    banner: TRD_BANNER,
    // The record is written for the sending side's idea of the process and has to be adapted by the unit that will run it.
    status: "DRAFT FOR RECEIVING-UNIT ADAPTATION",
    meta: [
      ["Project", project.meta.title],
      ["Batch record", `${rec.id}: ${rec.title}`],
      ["Document reference", docRef],
      ...splitMeta(),
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
