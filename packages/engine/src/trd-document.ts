import { COLLECTION_LABELS, docRefLabel, PROCESS_MODEL_VERSION, printableUnit, SCHEMA_VERSION, TRD_FORMAT_VERSION, type Project, type SeedCollection, type TrdDocument, type TrdField, type TrdItem, type TrdRange, type TrdStep } from "@gap/process-model";
import type { Block, DocModel, DocSection, Run } from "./document";
import { effectiveField, trdLimitChecks, trdOpenItems, trdOverrides, type TrdOpenItem } from "./trd";
import { rangeText, setPointText } from "./trd-check";
import { TRD_BANNER } from "./trd-outline";
import type { ContentBundle } from "./content";
import { activeParts } from "./trd-writeup";
import { addWriteupSections } from "./trd-writeup-document";

/**
 * The TRD as a document (the same DocModel the other outputs use, so the shared renderers, the built-in Word style, a customer's
 * own template and the Templates library all work on it unchanged).
 *
 * GMP rules kept here:
 *  - The document is a draft and never says it is approved or that a range is acceptable. The PAR/NOR check lists facts only.
 *  - The RU value is the TRD value. The SU value appears only in the optional traceability appendix, as reference.
 *  - Every override is listed in an appendix with the project value beside it and the reason, or "No reason recorded".
 *  - Unknown stays visible: "Not established", "TBD", "provisional" are written out in words, never only by colour.
 *  - It states no regulatory filing category.
 */

export const TRD_DOCUMENT_TITLE = "Technical requirements document";

/** Sections the person can leave out of one export. Everything else is always there, so an export cannot hide an override or an open item. */
export const TRD_OPTIONAL_SECTIONS = [
  { id: "overview", label: "Process overview" },
  { id: "source-register", label: "Source register" },
  { id: "traceability", label: "Traceability appendix (SU reference and gap ids; project origin only)" },
] as const;
export type TrdOptionalSection = (typeof TRD_OPTIONAL_SECTIONS)[number]["id"];

/**
 * The TRD comes in two documents built from the same record:
 *  - "standard": the short document sent for approval. Document control, the numbered sections and process descriptions, one compact
 *    parameter table per step, and a list of the documents referred to. A reviewer reads about 15 pages, not 50.
 *  - "evidence": the evidence record for audit and inspection. Every value with its basis, sources, status and classification, the
 *    other recorded values, the PAR/NOR check, the overrides, the process description values, the source register and traceability.
 * Nothing the standard leaves out is lost; it is all in the evidence record.
 */
export type TrdVariant = "standard" | "evidence";

export const TRD_EVIDENCE_TITLE = "Technical requirements document: evidence record";
export const TRD_EVIDENCE_NOTE = "This is the evidence record of the technical requirements document. It is for audit and inspection. It is not for approval; the standard document is the one sent for approval.";

export interface TrdDocumentOptions {
  /** Which document to build. Absent means the standard one. */
  variant?: TrdVariant;
  generatedAt?: string;
  generatorName?: string;
  appVersion?: string;
  /** Version of the catalog the project was assessed with (for the versions table). */
  catalogVersion?: string;
  omit?: readonly TrdOptionalSection[];
  /** Content bundle: lets blanks in the process descriptions read the project's answers (barrier, labelling site ...). Optional. */
  content?: ContentBundle;
}

export const trdBasisText = (projectId: string, d: TrdDocument): string =>
  d.origin.kind === "project" ? `Draft technical requirements document ${d.id}, started from project ${projectId}. Not approved.` : d.origin.kind === "seed-import" ? `Draft technical requirements document ${d.id}, started from an imported TRD seed. Not approved.` : `Draft technical requirements document ${d.id}, entered by hand. Not approved.`;

const NOT_ESTABLISHED = "Not established";
const stop = (s: string) => (/[.!?]$/.test(s.trimEnd()) ? s : `${s}.`);

/**
 * The label of a field in the document. The project's own set point and range answers (its "normal operating range" and "proven acceptable
 * range") are shown as project values, because the TRD's NOR and PAR are the ones the team enters with a source; the two must not
 * be read as the same thing.
 */
function fieldLabel(f: TrdField): string {
  if (f.pulled && (f.key === "setPoint" || f.key === "nor" || f.key === "par" || f.key === "validatedRange")) return `Project value: ${f.label}`;
  return f.label;
}

/** The status of a field in words. An override is named as such so a reader sees it without comparing values. */
function statusWords(f: TrdField): string {
  const v = effectiveField(f);
  const base = v.status === "established" ? "Established" : v.status === "not_applicable" ? "Not applicable" : v.status === "tbd" ? (v.provisional ? "TBD (provisional best guess)" : "TBD") : NOT_ESTABLISHED;
  return v.overridden ? `${base}; overridden` : base;
}

/** The TRD value of a field with the project value beside it when the user overrode it. */
function valueWords(f: TrdField): string {
  const v = effectiveField(f);
  return v.overridden && v.pulledText !== undefined ? `${v.text} (overridden; project: ${v.pulledText})` : v.text;
}

/** The documents the TRD's citations point at, numbered in order of first use. */
class SourceNumbers {
  private order: string[] = [];
  constructor(private readonly project: Project, private readonly d: TrdDocument) {}
  cite(ids: readonly string[], locations?: Record<string, { section?: string; page?: string }>): string {
    return ids
      .map((id) => {
        if (!this.order.includes(id)) this.order.push(id);
        const n = this.order.indexOf(id) + 1;
        const loc = locations?.[id];
        const where = [loc?.section ? `section ${loc.section}` : "", loc?.page ? `page ${loc.page}` : ""].filter(Boolean).join(", ");
        return `[${n}]${where ? ` (${where})` : ""}`;
      })
      .join(" ");
  }
  rows(): string[][] {
    return this.order.map((id, i) => {
      const s = this.project.sources.find((x) => x.id === id);
      if (s) return [`[${i + 1}]`, s.docRef ? docRefLabel(s.docRef) : s.label, s.docRef?.docType ?? (s.type === "user_entry" ? "Recorded note" : s.type === "interview_answer" ? "Interview answer" : s.type), s.date.slice(0, 10), s.docRef ? `${s.docRef.identifier}${s.docRef.version ? `, version ${s.docRef.version}` : ""}` : ""];
      const q = (this.d.origin.seedSources ?? []).find((x) => x.id === id);
      if (q) return [`[${i + 1}]`, q.document ? docRefLabel(q.document) : q.label, q.document?.docType ?? q.type, q.date.slice(0, 10), q.document ? `${q.document.identifier}${q.document.version ? `, version ${q.document.version}` : ""}` : ""];
      return [`[${i + 1}]`, "Source not found in the register", "", "", id];
    });
  }
  get count() {
    return this.order.length;
  }
  /** Marks documents as cited without printing a citation (the standard document cites nothing in its body; it lists the documents at the end). */
  note(ids: readonly string[] | undefined): void {
    for (const id of ids ?? []) if (!this.order.includes(id)) this.order.push(id);
  }
  /** One line per document cited: identifier, title and version. A source without a document reference is listed by its label. */
  references(): string[] {
    const lines: string[] = [];
    for (const id of this.order) {
      const s = this.project.sources.find((x) => x.id === id);
      const q = s ? undefined : (this.d.origin.seedSources ?? []).find((x) => x.id === id);
      const ref = s?.docRef ?? q?.document;
      // An interview answer or a recorded note is not a document; only a source that names a document is a reference. (All of them
      // are still in the evidence record's source register.)
      if (!ref) continue;
      const line = `${ref.identifier}${ref.title ? `: ${ref.title}` : ""}${ref.version ? `, version ${ref.version}` : ""}`;
      // Several source records can point at one document; it is listed once.
      if (!lines.includes(line)) lines.push(line);
    }
    return lines;
  }
}

const fieldOf = (it: TrdItem, key: string) => it.fields.find((f) => f.key === key);

function openLines(open: readonly TrdOpenItem[]): string[][] {
  return open.map((o) => [o.where, stop(o.kind === "tbd" ? "To be determined (TBD)" : o.kind === "provisional" ? `${o.text}` : o.text)]);
}

export function trdDocumentOpenItems(d: TrdDocument): TrdOpenItem[] {
  return trdOpenItems(d);
}

/** True when a step is a shipping step: the standard document then must not say the TRD leaves shipping out. */
const isShippingStep = (s: TrdStep) => (s.key ?? "").includes("shipping") || /shipping/i.test(s.label);

/**
 * The sentence on what the document covers. It follows the steps the TRD really holds: a TRD with a shipping step covers shipping, so it
 * must not say shipping is outside the document (the sentence used to be fixed text).
 */
export function trdCoverageText(d: TrdDocument): string {
  const shipping = d.steps.some(isShippingStep);
  return `This document covers the process only: unit operations${shipping ? " (including the shipping steps listed in it)" : ""}, process parameters (including set point, normal operating range and proven acceptable range), equipment, materials, in-process controls, studies and procedures. It does not cover analytical method transfer, equipment or facility comparison, cleaning${shipping ? " or" : ","} EHS${shipping ? "." : " or shipping."}`;
}

export function buildTrdDocument(project: Project, d: TrdDocument, opts: TrdDocumentOptions = {}): DocModel {
  const evidence = opts.variant === "evidence";
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const omit = new Set<string>(opts.omit ?? []);
  const open = trdOpenItems(d);
  const src = new SourceNumbers(project, d);
  const detail = (key: string) => {
    const f = d.details.find((x) => x.key === key);
    return f ? effectiveField(f).text : NOT_ESTABLISHED;
  };
  // The evidence record keeps the Status column; the standard document shows the value only (an unknown value reads "Not established").
  const detailRow = (key: string): string[] => {
    const f = d.details.find((x) => x.key === key);
    if (evidence) return f ? [f.label, valueWords(f), statusWords(f)] : [key, NOT_ESTABLISHED, NOT_ESTABLISHED];
    return f ? [f.label, valueWords(f)] : [key, NOT_ESTABLISHED];
  };
  const detailColumns = evidence ? ["Item", "Value", "Status"] : ["Item", "Value"];

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.filter((s) => !s.appendix).length + 1), title, blocks });
  const appendix = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String.fromCharCode(65 + sections.filter((s) => s.appendix).length), appendix: true, title, blocks });

  const blankCtx = { project, doc: d, ...(opts.content ? { content: opts.content } : {}) };
  const hasWriteup = (key: string) => (d.writeups ?? []).some((w) => w.kind === "section" && w.key === key && !w.notApplicable?.on);
  const libraryPurposeScope = !evidence && (hasWriteup("purpose") || hasWriteup("scope"));
  const stepWriteup = new Set((d.writeups ?? []).filter((w) => w.kind === "unitOp" && !w.notApplicable?.on).map((w) => w.stepId));

  // 1. Purpose and scope. Printed once: when the library has a purpose or scope write-up, that one is the section and the built-in text is not repeated.
  if (!libraryPurposeScope) {
    add("purpose-scope", "Purpose and scope", [
      ...(evidence ? ([{ type: "note", text: TRD_EVIDENCE_NOTE }] as Block[]) : []),
      { type: "note", text: trdBasisText(project.meta.id, d) },
      ...(open.length ? ([{ type: "note", text: `This draft lists ${open.length} open item${open.length === 1 ? "" : "s"}: values not established or still to be determined, provisional values, and findings of the PAR/NOR check. It is not complete while they remain.` }] as Block[]) : []),
      d.purpose?.trim() ? { type: "paragraph", text: d.purpose.trim() } : { type: "paragraph", text: "No purpose has been entered. This is left to the team; the tool does not supply wording." },
      ...(d.scopeNote?.trim() ? ([{ type: "heading", text: "Scope" }, { type: "paragraph", text: d.scopeNote.trim() }] as Block[]) : []),
      { type: "paragraph", text: trdCoverageText(d) },
    ]);
  }

  // 2. Product and presentation, 3. Receiving site and line
  if (evidence) {
    add("product", "Product and presentation", [{ type: "table", columns: detailColumns, rows: ["program", "modality", "dosageForm", "presentation"].map(detailRow) }]);
    add("site", "Receiving site and line", [
      { type: "table", columns: detailColumns, rows: ["site", "line", "programStage"].map(detailRow) },
      { type: "note", text: "The values are those of the receiving unit. The sending unit's values are not shown here (see the traceability appendix when it is included)." },
    ]);
  } else {
    // The cover page already shows the product and the receiving site, so the standard document does not repeat them in a table (the
    // evidence record keeps its tables). What stays are the notes: whose values these are, the draft status and what is covered.
    add("product", "About this document", [
      { type: "note", text: "The product and site values on the cover page are those of the receiving unit. The sending unit's values are not shown here." },
      // The built-in purpose and scope section is replaced by the library's, so its draft status and coverage sentences live here, once.
      ...(libraryPurposeScope ? ([{ type: "note", text: trdBasisText(project.meta.id, d) }, { type: "note", text: trdCoverageText(d) }] as Block[]) : []),
    ]);
  }

  // 4. Process overview. The standard document has the manufacturing process overview of the descriptions when it has them; its own list of steps is only for a TRD without.
  if (!omit.has("overview") && (evidence || !(d.writeups ?? []).some((w) => w.kind === "unitOp"))) {
    const groups: { label: string; steps: TrdStep[] }[] = [];
    for (const s of d.steps) {
      const label = s.stageGroup?.label ?? "Other steps";
      const g = groups.find((x) => x.label === label);
      if (g) g.steps.push(s);
      else groups.push({ label, steps: [s] });
    }
    add("overview", "Process overview", [
      d.steps.length ? { type: "paragraph", text: `The process has ${d.steps.length} step${d.steps.length === 1 ? "" : "s"}, in process order.` } : { type: "paragraph", text: "No process steps have been added." },
      ...(d.steps.length
        ? evidence
          ? ([{ type: "table", columns: ["No.", "Step", "Stage group", "Parameters", "Equipment", "Materials", "IPCs", "Studies", "Procedures"], rows: d.steps.map((s, i) => [String(i + 1), s.label, s.stageGroup?.label ?? "", ...(["param", "equip", "mat", "ipc", "study", "doc"] as SeedCollection[]).map((c) => String(s.items.filter((x) => x.collection === c).length))]) }] as Block[])
          : ([{ type: "list", items: d.steps.map((s) => s.label) }] as Block[])
        : []),
    ]);
  }

  // 5... one section per step
  // The evidence record keeps one section per step. The standard document puts the parameter tables of the steps in the overall process
  // parameters section (one sub-block per step, in process order), because the section that introduces the parameters is where a reader
  // looks for them and eleven sections of one table each cost more pages in headings than in content.
  const stepBlocksOf = (s: TrdStep): Block[] => {
    const blocks: Block[] = [];
    if (evidence) {
      blocks.push(s.description?.trim() ? { type: "paragraph", text: s.description.trim() } : { type: "paragraph", text: "No description has been entered for this step." });
      if (s.fields.length) blocks.push({ type: "table", columns: ["Item", "Value", "Status"], rows: s.fields.map((f) => [f.label, valueWords(f), statusWords(f)]) });
      for (const coll of ["param", "equip", "mat", "ipc", "study", "doc"] as SeedCollection[]) {
        const items = s.items.filter((i) => i.collection === coll);
        if (!items.length) continue;
        blocks.push({ type: "heading", text: coll === "doc" ? "Procedures and documents" : COLLECTION_LABELS[coll] });
        if (coll === "param") blocks.push(...parameterBlocks(items, src));
        else blocks.push(...plainItemBlocks(items, src, coll === "ipc"));
      }
    } else {
      // The description is printed unless the process descriptions already describe this step (the same words must not appear twice).
      if (!stepWriteup.has(s.id)) blocks.push(s.description?.trim() ? { type: "paragraph", text: s.description.trim() } : { type: "paragraph", text: "No description has been entered for this step." });
      // A step field is shown only when it is not a settled answer (an unknown presence must stay visible).
      const unsettled = s.fields.filter((f) => effectiveField(f).status !== "established");
      if (unsettled.length) blocks.push({ type: "table", columns: ["Item", "Value"], rows: unsettled.map((f) => [f.label, valueWords(f)]) });
      const params = s.items.filter((i) => i.collection === "param");
      const table = params.length ? compactParameterTable(params, src) : undefined;
      if (table) blocks.push(table);
      // A step the process descriptions already describe (its equipment, materials and controls are in the words) gets no second table.
      const rest = stepWriteup.has(s.id) ? [] : compactItemRows(s, src);
      if (rest.length) blocks.push({ type: "table", columns: ["Kind", "Item", "Details"], rows: rest, caption: "Equipment, materials and controls" });
    }
    return blocks;
  };
  /** The sub-blocks of the standard document, "10.1 Step" ..., one per step that has something to show. */
  const standardStepBlocks = (number: string): Block[] => {
    const out: Block[] = [];
    for (const s of d.steps) {
      const blocks = stepBlocksOf(s);
      // A step the descriptions cover and whose parameters are all not applicable has nothing to show: no heading without a table.
      if (!blocks.length) continue;
      out.push({ type: "heading", text: `${number}.${out.filter((b) => b.type === "heading").length + 1} ${s.label}` }, ...blocks);
    }
    return out;
  };
  // Process descriptions (TRD format 1.1.0): the TRD-level prose sections and the "Manufacturing process overview". A TRD without
  // write-ups adds nothing here. The evidence record does not print the prose; it only needs which blanks have a value (for its appendix),
  // so its sections are made and thrown away.
  const wu = addWriteupSections(
    blankCtx,
    d,
    (id, title, make) => {
      if (evidence) return void make("0");
      const number = String(sections.filter((s) => !s.appendix).length + 1);
      sections.push({ id, number, title, blocks: make(number) });
    },
    evidence ? "evidence" : "standard",
    // A closure over a function declared below: it is only called while the sections are made, after the declaration has run.
    !evidence ? { process_parameters: (n) => standardStepBlocks(n) } : {},
  );
  // An empty note (no open blank to point at) is not printed.
  for (const s of sections) s.blocks = s.blocks.filter((b) => !(b.type === "note" && b.text === ""));

  const paramIntro: Block = { type: "paragraph", text: "Each step with its parameters: set point, normal operating range (NOR) and proven acceptable range (PAR). The documents they rest on are listed under References." };
  // The extra blocks go into the library's section "Overall process parameters" when the TRD has it; a TRD without it keeps a section of its own.
  const placed = wu.extrasPlaced.includes("process_parameters");
  if (evidence) for (const s of d.steps) add(`step-${s.id}`, s.label, stepBlocksOf(s));
  else if (d.steps.length && !placed) add("process-parameters", "Process steps and parameters", [paramIntro, ...standardStepBlocks(String(sections.filter((x) => !x.appendix).length + 1))]);

  // PAR / NOR check (evidence record only: the findings that matter to an approver are also listed in the open items)
  const checks = trdLimitChecks(d);
  if (evidence) {
    const findings = checks.flatMap((c) => c.findings.map((f) => [c.step.label, c.item.label, f.level === "problem" ? "Finding" : f.level === "open" ? "Open item" : "Note", stop(f.text)]));
    add("par-nor", "PAR and NOR check", [
      { type: "paragraph", text: "The team entered each set point, normal operating range (NOR) and proven acceptable range (PAR) from the documents cited. The tool compared them as entered, without converting units, and reports what it found. It does not judge any value acceptable or unacceptable, and it does not decide anything." },
      findings.length ? { type: "table", columns: ["Step", "Parameter", "Kind", "Finding"], rows: findings } : { type: "paragraph", text: checks.length ? "No findings. This does not mean the ranges are acceptable; that is for the team and quality assurance to judge." : "No set point, NOR or PAR has been entered." },
      ...(checks.some((c) => c.working.length) ? ([{ type: "heading", text: "Comparisons made" }, { type: "list", items: checks.flatMap((c) => c.working.map((w) => `${c.step.label}, ${c.item.label}: ${w}`)) }] as Block[]) : []),
    ]);
  }

  // Open items (always in the document)
  add("open-items", "Open items", [
    { type: "paragraph", text: open.length ? "Entries still missing, to be determined, or provisional, and the findings of the PAR/NOR check. Nothing has been filled in on behalf of the team. The document cannot be approved while these remain." : "No open items. This does not mean the TRD is complete or correct; that is for the team and quality assurance to judge." },
    ...(open.length ? ([{ type: "table", columns: ["Where", "Open item"], rows: openLines(open) }] as Block[]) : []),
    // A sentence, not a note: it is a statement of how changes are handled. The tool names no filing category; the only wording is this one.
    ...(evidence ? [] : ([{ type: "paragraph", text: "Any change to the process requires regulatory affairs assessment before it is made." }] as Block[])),
  ]);

  // Approval
  if (d.approvals?.length) {
    add("approval", "Approval", [
      { type: "paragraph", text: "The roles below were named by the team. This document is a draft and is not signed." },
      { type: "table", columns: ["Role", "Name", "Signature", "Date"], rows: d.approvals.map((x) => [x.role, x.name ?? "", "", x.date ?? ""]) },
    ]);
  }

  if (!evidence) {
    // References: one line per document the limits, the recorded values and the descriptions rest on. The body cites nothing; the
    // evidence record gives the full source register with section and page.
    for (const s of d.steps)
      for (const i of s.items) {
        src.note(i.limits?.setPoint?.sourceIds);
        src.note(i.limits?.nor?.sourceIds);
        src.note(i.limits?.par?.sourceIds);
        for (const f of i.fields) src.note(f.pulled?.sourceIds);
      }
    for (const f of d.details) src.note(f.pulled?.sourceIds);
    for (const { blank } of wu.filled) src.note(blank.sourceIds);
    const refs = src.references();
    add("references", "References", [refs.length ? { type: "list", items: refs } : { type: "paragraph", text: "No document is cited in this TRD." }]);
  }

  if (!evidence) settleAcronyms(sections, d);

  // Appendix: overrides. An override is never hidden: the standard document shows it whenever a value differs from the project.
  // The standard document shows the appendix only when a value was overridden: an empty appendix is a page of "nothing" for the reader.
  // The evidence record always has it, and says when nothing was overridden, so the absence of an override stays on the record.
  const overrides = trdOverrides(d);
  if (evidence || overrides.some((o) => o.overridesProject)) appendix("overrides", "Overrides", [
    { type: "paragraph", text: overrides.some((o) => o.overridesProject) ? "Fields where the TRD value differs from the value that came in from the project. The project value is kept; the TRD value is the user's entry." : "No value that came in from the project has been overridden." },
    ...(overrides.some((o) => o.overridesProject)
      ? ([{ type: "table", columns: ["Field", "Project value", "TRD value", "Reason", "By", "At"], rows: overrides.filter((o) => o.overridesProject).map((o) => [`${o.where}, ${o.field}`, o.projectValue, o.trdValue, o.reason, o.by, o.at.replace("T", " ").slice(0, 16) + " UTC"]) }] as Block[])
      : []),
    ...(overrides.some((o) => !o.overridesProject) ? ([{ type: "paragraph", text: `${overrides.filter((o) => !o.overridesProject).length} value${overrides.filter((o) => !o.overridesProject).length === 1 ? " was" : "s were"} entered by the team where the project had none; they are shown in the sections above.` }] as Block[]) : []),
  ]);

  if (evidence) {
    // Appendix: where each filled blank of the process descriptions came from, and which blanks have no value yet. Built before the
    // source register so the documents it cites are numbered in it.
    if (wu.filled.length || wu.open.length || wu.openFigures.length) {
      appendix("writeup-values", "Process description values", [
        { type: "paragraph", text: "The blanks and figures of the process descriptions. A value found in the TRD or the project, or typed by the team, is shown with where it came from. A blank with no value is left open; the tool does not supply one." },
        ...(wu.filled.length
          ? ([
              { type: "table", columns: ["Description", "Item", "Value", "Source"], caption: "Filled blanks", rows: wu.filled.map(({ writeup, blank }) => [`${writeup.id}: ${writeup.title}`, blank.label, blank.value ?? "", [blank.where, blank.sourceIds?.length ? src.cite(blank.sourceIds, blank.locations) : ""].filter(Boolean).join("; ")]) },
            ] as Block[])
          : []),
        ...(wu.open.length
          ? ([{ type: "table", columns: ["Description", "Item still open", "Note"], caption: "Blanks without a value", rows: wu.open.map(({ writeup, blank }) => [`${writeup.id}: ${writeup.title}`, blank.label, blank.note ?? "No value in the TRD or the project"]) }] as Block[])
          : []),
        ...(wu.openFigures.length
          ? ([{ type: "table", columns: ["Description", "Figure still open", "Note"], caption: "Figures without a picture", rows: wu.openFigures.map(({ writeup, part }) => [`${writeup.id}: ${writeup.title}`, part.caption?.trim() || part.text.trim() || part.id, "No picture has been added yet"]) }] as Block[])
          : []),
      ]);
    }

    // Appendix: source register
    const traceBlocks = !omit.has("traceability") && d.origin.kind === "project" ? traceability(d) : undefined;
    // Built after the sections, so every citation is numbered by now (nothing below cites a source).
    if (!omit.has("source-register")) {
      appendix("source-register", "Source register", [
        src.count ? { type: "paragraph", text: "The documents cited in this TRD, numbered in order of first use." } : { type: "paragraph", text: "No source is cited in this TRD. This is an open item for every value that should rest on a document." },
        ...(src.count ? ([{ type: "table", columns: ["No.", "Source", "Type", "Date", "Document"], rows: src.rows() }] as Block[]) : []),
      ]);
    }

    if (traceBlocks) appendix("traceability", "Traceability", traceBlocks);

    // Appendix: versions
    appendix("versions", "Versions", [
      {
        type: "table",
        columns: ["Item", "Value"],
        rows: [
          ["Generator", `${opts.generatorName ?? "Gap Assessment Generator (proof of concept)"} ${opts.appVersion ?? "unversioned"}`],
          ["TRD document", `${d.id}${d.version ? `, version ${d.version}` : ""}, last changed ${d.updatedAt.replace("T", " ").slice(0, 16)} UTC`],
          ["TRD format", TRD_FORMAT_VERSION],
          ["Started from", d.origin.kind === "project" ? "The project" : d.origin.kind === "seed-import" ? "An imported TRD seed" : "Blank (entered by hand)"],
          ...(d.origin.seed ? [["TRD seed format", d.origin.seed.formatVersion], ["Seed exported", d.origin.seed.exportedAt.replace("T", " ").slice(0, 16) + " UTC"]] : []),
          ["Process model", PROCESS_MODEL_VERSION],
          ["Catalog", opts.catalogVersion ?? "Not recorded"],
          ["Project schema", project.schemaVersion ?? SCHEMA_VERSION],
        ],
      },
      { type: "note", text: "Regulatory impact of any change to the process: Requires regulatory affairs assessment." },
    ]);
  }

  return {
    title: evidence ? TRD_EVIDENCE_TITLE : TRD_DOCUMENT_TITLE,
    banner: TRD_BANNER,
    status: "DRAFT",
    meta: [
      ["Project", project.meta.title],
      ["TRD", `${d.id}: ${d.title}`],
      ["Document reference", d.docRef?.trim() || "Not given"],
      ...(d.version?.trim() ? ([["Version", d.version.trim()]] as [string, string][]) : []),
      ["Generated", generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["Open items", String(open.length)],
    ],
    // Document control prints the TRD's own reference, version and named roles instead of "[to be assigned]" and three empty rows.
    control: {
      ...(d.docRef?.trim() ? { documentId: d.docRef.trim() } : {}),
      ...(d.version?.trim() ? { version: d.version.trim() } : {}),
      people: (d.approvals ?? []).map((a) => ({ role: a.role, ...(a.name?.trim() ? { name: a.name.trim() } : {}), ...(a.date?.trim() ? { date: a.date.trim() } : {}) })),
    },
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

/**
 * Abbreviations the generated text uses that the shipped acronym list may not hold. A reader should find every abbreviation of the
 * document in the list, and nothing the document never uses; the list is therefore settled at export from the words actually printed.
 */
const KNOWN_ACRONYMS: Record<string, string> = {
  AQL: "Acceptance quality limit (AQL)",
  AVI: "Automated visual inspection (AVI)",
  BBR: "Bioburden reduction (BBR)",
  CFR: "Code of Federal Regulations (CFR)",
  CFU: "Colony-forming unit (CFU)",
  FDA: "Food and Drug Administration (FDA)",
  MSAT: "Manufacturing science and technology (MSAT)",
  NOR: "Normal operating range (NOR)",
  PAR: "Proven acceptable range (PAR)",
  PES: "Polyethersulfone (PES)",
  PFS: "Prefilled syringe (PFS)",
  PQ: "Performance qualification (PQ)",
  TBD: "To be determined (TBD)",
};

function blockText(b: Block): string {
  switch (b.type) {
    case "paragraph":
    case "note":
    case "heading":
      return b.text;
    case "list":
      return b.items.join("\n");
    case "rich":
      return b.runs.map((r) => r.text).join("");
    case "rich-list":
      return b.items.map((i) => i.map((r) => r.text).join("")).join("\n");
    case "table":
      return [...b.columns, ...b.rows.flat(), b.caption ?? ""].join("\n");
    default:
      return "";
  }
}

/**
 * Brings the acronym list in line with the document. An entry of the shipped list that the document never uses is left out (an entry the
 * team added or edited is theirs and stays); a known abbreviation the document does use is added. An abbreviation counts as used when it
 * stands alone as a word: "DP-305-0001" or "RU-PN-305-001" do not use "DP" or "RU". Entries stay in alphabetical order of the long form.
 */
function settleAcronyms(sections: DocSection[], d: TrdDocument): void {
  const sec = sections.find((s) => s.id === "writeup-acronyms");
  const w = (d.writeups ?? []).find((x) => x.key === "acronyms");
  const at = sec?.blocks.findIndex((b) => b.type === "rich-list") ?? -1;
  if (!sec || !w || at < 0) return;
  const list = sec.blocks[at] as Extract<Block, { type: "rich-list" }>;
  const bullets = activeParts(w).filter((p) => p.kind === "bullet");
  if (bullets.length !== list.items.length) return;
  const corpus = sections
    .filter((s) => s !== sec && !s.appendix)
    .flatMap((s) => [s.title, ...s.blocks.map(blockText)])
    .join("\n");
  const escape = (a: string) => a.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const used = (a: string) => new RegExp("(?<![A-Za-z0-9-])" + escape(a) + "(?![A-Za-z0-9]|-\\d)").test(corpus);
  const abbreviationOf = (text: string) => /\(([^()]+)\)\s*$/.exec(text.trim())?.[1];
  const kept: { text: string; runs: Run[] }[] = [];
  list.items.forEach((runs, i) => {
    const text = runs.map((r) => r.text).join("");
    const a = abbreviationOf(text);
    const own = bullets[i]!.edited || bullets[i]!.id.startsWith("x_");
    if (own || !a || used(a)) kept.push({ text, runs });
  });
  for (const [a, long] of Object.entries(KNOWN_ACRONYMS)) {
    if (!kept.some((k) => abbreviationOf(k.text) === a) && used(a)) kept.push({ text: long, runs: [{ text: long }] });
  }
  kept.sort((x, y) => x.text.localeCompare(y.text, "en", { sensitivity: "base" }));
  list.items = kept.map((k) => k.runs);
}

/** Splits "48 h", "-80 to -65 °C" or "100 mg/mL" into the number text and the unit, so the unit can sit in its own column. */
function splitUnit(text: string): { value: string; unit: string } {
  const m = /^(.+?\d)\s+([^\d\s][^\d]*)$/.exec(text.trim());
  return m ? { value: m[1]!, unit: m[2]!.trim() } : { value: text.trim(), unit: "" };
}

/**
 * The one parameter table of a step in the standard document: Parameter, Set point, NOR, PAR, Unit. No basis, sources, status or
 * classification (those are in the evidence record). A limit the team entered wins; otherwise the project value recorded for the
 * parameter is shown, so a parameter that only has a maximum still reads "max 48 h". A value that is not established reads so in words.
 */
function compactParameterTable(items: TrdItem[], src: SourceNumbers): Block | undefined {
  // A parameter the project answered "not applicable" in full (nothing typed, every field not applicable) is left out: a row of empty
  // cells says nothing to an approver. The evidence record still lists it, with its status.
  const shown = items.filter((i) => {
    const l = i.limits;
    return Boolean(l?.setPoint || l?.nor || l?.par) || !i.fields.length || !i.fields.every((x) => effectiveField(x).status === "not_applicable");
  });
  if (!shown.length) return undefined;
  const rows = shown.map((i) => {
    const l = i.limits;
    const f = (key: string) => {
      const x = fieldOf(i, key);
      return x ? effectiveField(x) : undefined;
    };
    const units = new Set<string>();
    const cell = (limit: { value: string; unit: string } | undefined, field: ReturnType<typeof f>, label = ""): string => {
      if (limit) {
        // "count" is never printed after a number in a sentence, but the Unit column of a table must not be empty beside a number.
        if (printableUnit(limit.unit) || limit.unit.trim()) units.add(printableUnit(limit.unit) || limit.unit.trim());
        return label + limit.value;
      }
      if (!field) return "";
      if (field.status !== "established") return field.text;
      const s = splitUnit(field.text);
      if (printableUnit(s.unit)) units.add(printableUnit(s.unit));
      return label + s.value;
    };
    const num = (n: number | undefined) => (n === undefined ? "" : String(n));
    const rng = (r: TrdRange | undefined) => (r ? { value: rangeText({ ...r, unit: undefined }), unit: r.unit?.trim() ?? "" } : undefined);
    const setPoint = l?.setPoint ? { value: `${num(l.setPoint.value)}${l.setPoint.provisional ? " (provisional)" : ""}`, unit: l.setPoint.unit?.trim() ?? "" } : undefined;
    // Cited documents of the limits go to the reference list, not into the cells.
    src.note(l?.setPoint?.sourceIds);
    src.note(l?.nor?.sourceIds);
    src.note(l?.par?.sourceIds);
    const maxF = f("max");
    const minF = f("min");
    const set = setPoint || f("setPoint") ? cell(setPoint, f("setPoint")) : "";
    let nor = cell(rng(l?.nor), f("nor"));
    const par = cell(rng(l?.par), f("par"));
    // A parameter that only has a maximum (or minimum) recorded in the project reads like one with a limit: "up to 24" in the NOR column
    // and the unit in the Unit column. The bound is the project's value, not a set point, so the Set point cell stays empty and nothing
    // is presented as a proven range that nobody entered.
    if (!set && !nor && !par) nor = maxF ? cell(undefined, maxF, "up to ") : minF ? cell(undefined, minF, "at least ") : "";
    const unit = units.size === 1 ? [...units][0]! : units.size > 1 ? "See cells" : "";
    // With several units the cells keep theirs, so no value is shown without its unit.
    return [i.label, set, nor, par, unit];
  });
  return { type: "table", columns: ["Parameter", "Set point", "NOR", "PAR", "Unit"], rows };
}

/**
 * Equipment, materials and in-process controls of a step as one compact table: the item and its recorded values in words, with no
 * status, source or field columns. Studies and procedures are in the evidence record. An item with nothing recorded says so.
 */
function compactItemRows(s: TrdStep, src: SourceNumbers): string[][] {
  const kinds: [SeedCollection, string][] = [
    ["equip", "Equipment"],
    ["mat", "Material"],
    ["ipc", "Control"],
  ];
  const rows: string[][] = [];
  for (const [coll, kind] of kinds)
    for (const i of s.items.filter((x) => x.collection === coll)) {
      const parts = i.fields.map((f) => `${fieldLabel(f)}: ${valueWords(f)}`);
      if (coll === "ipc" && i.limits) {
        const l = i.limits;
        if (l.setPoint) parts.push(`Set point ${setPointText(l.setPoint)}`);
        if (l.nor) parts.push(`NOR ${rangeText(l.nor)}`);
        if (l.par) parts.push(`PAR ${rangeText(l.par)}`);
        src.note(l.setPoint?.sourceIds);
        src.note(l.nor?.sourceIds);
        src.note(l.par?.sourceIds);
      }
      rows.push([kind, i.label, parts.length ? parts.join("; ") : "Nothing recorded"]);
    }
  return rows;
}

/** One status for an item: the statuses of its fields in words, with "overridden" once if any field is. */
function statusSummary(fields: TrdField[], hasLimits: boolean): string {
  if (!fields.length) return hasLimits ? "Entered by the team" : NOT_ESTABLISHED;
  const base = [...new Set(fields.map((f) => statusWords(f).replace("; overridden", "")))];
  return fields.some((f) => f.override) ? `${base.join("; ")}; overridden` : base.join("; ");
}

/** Number text for a range cell: numbers only when the unit is shown in its own column. */
function parameterBlocks(items: TrdItem[], src: SourceNumbers): Block[] {
  const rows = items.map((i) => {
    const l = i.limits;
    const units = new Set([l?.setPoint?.unit, l?.nor?.unit, l?.par?.unit].filter((u): u is string => Boolean(u && u.trim())));
    const single = units.size <= 1;
    const num = (n: number | undefined) => (n === undefined ? "" : String(n));
    const rng = (r: NonNullable<typeof l>["nor"]) => (!r ? "" : single ? rangeText({ ...r, unit: undefined }) : rangeText(r));
    // Only a set point the team entered with its source is a TRD limit here; the project's own set point is in the table below, marked as a project value.
    const setCell = l?.setPoint ? (single ? `${num(l.setPoint.value)}${l.setPoint.provisional ? " (provisional)" : ""}` : setPointText(l.setPoint)) : "";
    const cls = fieldOf(i, "classification");
    const basis = [l?.nor?.basis ? `NOR: ${l.nor.basis}` : "", l?.par?.basis ? `PAR: ${l.par.basis}` : ""].filter(Boolean).join("; ");
    // Only the citations of the entered limits are in this table; the sources of the project values are in the table below it.
    const cites = [l?.setPoint ? `Set point ${src.cite(l.setPoint.sourceIds, l.setPoint.locations) || "no source cited"}` : "", l?.nor ? `NOR ${src.cite(l.nor.sourceIds, l.nor.locations) || "no source cited"}` : "", l?.par ? `PAR ${src.cite(l.par.sourceIds, l.par.locations) || "no source cited"}` : ""].filter(Boolean).join("; ");
    const status = statusSummary(i.fields, Boolean(l));
    return [i.label, setCell, rng(l?.nor), rng(l?.par), single ? [...units][0] ?? "" : "See cells", cls ? valueWords(cls) : "", basis, cites, status];
  });
  const out: Block[] = [{ type: "table", columns: ["Parameter", "Set point", "NOR", "PAR", "Unit", "Classification", "Basis", "Sources", "Status"], rows }];
  // The other values recorded for a parameter (maximum, minimum, range from the project ...), so none is dropped.
  const other = items.flatMap((i) => i.fields.filter((f) => f.key !== "classification").map((f) => [i.label, fieldLabel(f), valueWords(f), statusWords(f), f.pulled?.sourceIds.length ? src.cite(f.pulled.sourceIds, f.pulled.locations) : ""]));
  if (other.length) out.push({ type: "table", columns: ["Parameter", "Field", "Value", "Status", "Sources"], rows: other, caption: "Other recorded values" });
  return out;
}

function plainItemBlocks(items: TrdItem[], src: SourceNumbers, allowLimits: boolean): Block[] {
  const rows: string[][] = [];
  for (const i of items) {
    if (!i.fields.length && !(allowLimits && i.limits)) rows.push([i.label, "", "Nothing recorded", NOT_ESTABLISHED, ""]);
    for (const f of i.fields) rows.push([i.label, fieldLabel(f), valueWords(f), statusWords(f), f.pulled?.sourceIds.length ? src.cite(f.pulled.sourceIds, f.pulled.locations) : ""]);
    if (allowLimits && i.limits) {
      const l = i.limits;
      const parts = [l.setPoint ? `Set point ${setPointText(l.setPoint)} ${src.cite(l.setPoint.sourceIds, l.setPoint.locations)}` : "", l.nor ? `NOR ${rangeText(l.nor)} ${src.cite(l.nor.sourceIds, l.nor.locations)}` : "", l.par ? `PAR ${rangeText(l.par)} ${src.cite(l.par.sourceIds, l.par.locations)}` : ""].filter(Boolean);
      rows.push([i.label, "Set point, NOR and PAR", parts.join("; "), "Entered by the team", ""]);
    }
  }
  return [{ type: "table", columns: ["Item", "Field", "Value", "Status", "Sources"], rows }];
}

/** SU reference and gap ids per field, for the optional traceability appendix. The SU value is reference only. */
function traceability(d: TrdDocument): Block[] {
  const rows: string[][] = [];
  const row = (where: string, f: TrdField) => {
    const r = f.pulled?.reference;
    if (!r || (!r.su && !r.gapIds.length)) return;
    rows.push([where, f.label, r.su ? `${r.su.display ?? (r.su.status === "established" ? "" : r.su.status)}` : "Not recorded", r.gapIds.join(", ")]);
  };
  for (const s of d.steps) {
    for (const f of s.fields) row(s.label, f);
    for (const i of s.items) for (const f of i.fields) row(`${s.label}, ${i.label}`, f);
  }
  return [
    { type: "paragraph", text: "For each value that came in from the project: the sending unit's value, shown as reference only, and the gap ids that compare the two. The sending unit's value is never the value of this TRD. Gap ids can renumber when the gap assessment changes." },
    rows.length ? { type: "table", columns: ["Where", "Field", "SU value (reference only)", "Gap ids"], rows } : { type: "paragraph", text: "No reference values." },
  ];
}
