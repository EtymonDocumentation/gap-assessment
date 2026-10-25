import { COLLECTION_LABELS, docRefLabel, PROCESS_MODEL_VERSION, SCHEMA_VERSION, TRD_FORMAT_VERSION, type Project, type SeedCollection, type TrdDocument, type TrdField, type TrdItem, type TrdStep } from "@gap/process-model";
import type { Block, DocModel, DocSection } from "./document";
import { effectiveField, trdLimitChecks, trdOpenItems, trdOverrides, type TrdOpenItem } from "./trd";
import { rangeText, setPointText } from "./trd-check";
import { TRD_BANNER } from "./trd-outline";
import type { ContentBundle } from "./content";
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

export const TRD_DOCUMENT_TITLE = "Technology transfer document";

/** Sections the person can leave out of one export. Everything else is always there, so an export cannot hide an override or an open item. */
export const TRD_OPTIONAL_SECTIONS = [
  { id: "overview", label: "Process overview" },
  { id: "source-register", label: "Source register" },
  { id: "traceability", label: "Traceability appendix (SU reference and gap ids; project origin only)" },
] as const;
export type TrdOptionalSection = (typeof TRD_OPTIONAL_SECTIONS)[number]["id"];

export interface TrdDocumentOptions {
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
  d.origin.kind === "project" ? `Draft technology transfer document ${d.id}, started from project ${projectId}. Not approved.` : d.origin.kind === "seed-import" ? `Draft technology transfer document ${d.id}, started from an imported TRD seed. Not approved.` : `Draft technology transfer document ${d.id}, entered by hand. Not approved.`;

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
}

const fieldOf = (it: TrdItem, key: string) => it.fields.find((f) => f.key === key);

function openLines(open: readonly TrdOpenItem[]): string[][] {
  return open.map((o) => [o.where, stop(o.kind === "tbd" ? "To be determined (TBD)" : o.kind === "provisional" ? `${o.text}` : o.text)]);
}

export function trdDocumentOpenItems(d: TrdDocument): TrdOpenItem[] {
  return trdOpenItems(d);
}

export function buildTrdDocument(project: Project, d: TrdDocument, opts: TrdDocumentOptions = {}): DocModel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const omit = new Set<string>(opts.omit ?? []);
  const open = trdOpenItems(d);
  const src = new SourceNumbers(project, d);
  const detail = (key: string) => {
    const f = d.details.find((x) => x.key === key);
    return f ? effectiveField(f).text : NOT_ESTABLISHED;
  };
  const detailRow = (key: string): string[] => {
    const f = d.details.find((x) => x.key === key);
    return f ? [f.label, valueWords(f), statusWords(f)] : [key, NOT_ESTABLISHED, NOT_ESTABLISHED];
  };

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.filter((s) => !s.appendix).length + 1), title, blocks });
  const appendix = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String.fromCharCode(65 + sections.filter((s) => s.appendix).length), appendix: true, title, blocks });

  // 1. Purpose and scope
  add("purpose-scope", "Purpose and scope", [
    { type: "note", text: trdBasisText(project.meta.id, d) },
    ...(open.length ? ([{ type: "note", text: `This draft lists ${open.length} open item${open.length === 1 ? "" : "s"}: values not established or still to be determined, provisional values, and findings of the PAR/NOR check. It is not complete while they remain.` }] as Block[]) : []),
    d.purpose?.trim() ? { type: "paragraph", text: d.purpose.trim() } : { type: "paragraph", text: "No purpose has been entered. This is left to the team; the tool does not supply wording." },
    ...(d.scopeNote?.trim() ? ([{ type: "heading", text: "Scope" }, { type: "paragraph", text: d.scopeNote.trim() }] as Block[]) : []),
    { type: "paragraph", text: "This document covers the process only: unit operations, process parameters (including set point, normal operating range and proven acceptable range), equipment, materials, in-process controls, studies and procedures. It does not cover analytical method transfer, equipment or facility comparison, cleaning, EHS or shipping." },
  ]);

  // 2. Product and presentation, 3. Receiving site and line
  add("product", "Product and presentation", [{ type: "table", columns: ["Item", "Value", "Status"], rows: ["program", "modality", "dosageForm", "presentation"].map(detailRow) }]);
  add("site", "Receiving site and line", [
    { type: "table", columns: ["Item", "Value", "Status"], rows: ["site", "line", "programStage"].map(detailRow) },
    { type: "note", text: "The values are those of the receiving unit. The sending unit's values are not shown here (see the traceability appendix when it is included)." },
  ]);

  // 4. Process overview
  if (!omit.has("overview")) {
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
        ? ([{ type: "table", columns: ["No.", "Step", "Stage group", "Parameters", "Equipment", "Materials", "IPCs", "Studies", "Procedures"], rows: d.steps.map((s, i) => [String(i + 1), s.label, s.stageGroup?.label ?? "", ...(["param", "equip", "mat", "ipc", "study", "doc"] as SeedCollection[]).map((c) => String(s.items.filter((x) => x.collection === c).length))]) }] as Block[])
        : []),
    ]);
  }

  // Process descriptions (TRD format 1.1.0): the TRD-level prose sections and the "Manufacturing process overview". A TRD without
  // write-ups adds nothing here, so it exports exactly as it did before.
  const blankCtx = { project, doc: d, ...(opts.content ? { content: opts.content } : {}) };
  const wu = addWriteupSections(blankCtx, d, (id, title, make) => {
    const number = String(sections.filter((s) => !s.appendix).length + 1);
    sections.push({ id, number, title, blocks: make(number) });
  });

  // 5... one section per step
  for (const s of d.steps) {
    const blocks: Block[] = [];
    blocks.push(s.description?.trim() ? { type: "paragraph", text: s.description.trim() } : { type: "paragraph", text: "No description has been entered for this step." });
    if (s.fields.length) blocks.push({ type: "table", columns: ["Item", "Value", "Status"], rows: s.fields.map((f) => [f.label, valueWords(f), statusWords(f)]) });
    for (const coll of ["param", "equip", "mat", "ipc", "study", "doc"] as SeedCollection[]) {
      const items = s.items.filter((i) => i.collection === coll);
      if (!items.length) continue;
      blocks.push({ type: "heading", text: coll === "doc" ? "Procedures and documents" : COLLECTION_LABELS[coll] });
      if (coll === "param") blocks.push(...parameterBlocks(items, src));
      else blocks.push(...plainItemBlocks(items, src, coll === "ipc"));
    }
    add(`step-${s.id}`, s.label, blocks);
  }

  // PAR / NOR check
  const checks = trdLimitChecks(d);
  const findings = checks.flatMap((c) => c.findings.map((f) => [c.step.label, c.item.label, f.level === "problem" ? "Finding" : f.level === "open" ? "Open item" : "Note", stop(f.text)]));
  add("par-nor", "PAR and NOR check", [
    { type: "paragraph", text: "The team entered each set point, normal operating range (NOR) and proven acceptable range (PAR) from the documents cited. The tool compared them as entered, without converting units, and reports what it found. It does not judge any value acceptable or unacceptable, and it does not decide anything." },
    findings.length ? { type: "table", columns: ["Step", "Parameter", "Kind", "Finding"], rows: findings } : { type: "paragraph", text: checks.length ? "No findings. This does not mean the ranges are acceptable; that is for the team and quality assurance to judge." : "No set point, NOR or PAR has been entered." },
    ...(checks.some((c) => c.working.length) ? ([{ type: "heading", text: "Comparisons made" }, { type: "list", items: checks.flatMap((c) => c.working.map((w) => `${c.step.label}, ${c.item.label}: ${w}`)) }] as Block[]) : []),
  ]);

  // Open items (always in the document)
  add("open-items", "Open items", [
    { type: "paragraph", text: open.length ? "Entries still missing, to be determined, or provisional, and the findings above. Nothing has been filled in on behalf of the team. The document cannot be approved while these remain." : "No open items. This does not mean the TRD is complete or correct; that is for the team and quality assurance to judge." },
    ...(open.length ? ([{ type: "table", columns: ["Where", "Open item"], rows: openLines(open) }] as Block[]) : []),
  ]);

  // Approval
  if (d.approvals?.length) {
    add("approval", "Approval", [
      { type: "paragraph", text: "The roles below were named by the team. This document is a draft and is not signed." },
      { type: "table", columns: ["Role", "Name", "Signature", "Date"], rows: d.approvals.map((x) => [x.role, x.name ?? "[placeholder]", "[placeholder]", x.date ?? "[placeholder]"]) },
    ]);
  }

  // Appendix: overrides (always)
  const overrides = trdOverrides(d);
  appendix("overrides", "Overrides", [
    { type: "paragraph", text: overrides.some((o) => o.overridesProject) ? "Fields where the TRD value differs from the value that came in from the project. The project value is kept; the TRD value is the user's entry." : "No value that came in from the project has been overridden." },
    ...(overrides.some((o) => o.overridesProject)
      ? ([{ type: "table", columns: ["Field", "Project value", "TRD value", "Reason", "By", "At"], rows: overrides.filter((o) => o.overridesProject).map((o) => [`${o.where}, ${o.field}`, o.projectValue, o.trdValue, o.reason, o.by, o.at.replace("T", " ").slice(0, 16) + " UTC"]) }] as Block[])
      : []),
    ...(overrides.some((o) => !o.overridesProject) ? ([{ type: "paragraph", text: `${overrides.filter((o) => !o.overridesProject).length} value${overrides.filter((o) => !o.overridesProject).length === 1 ? " was" : "s were"} entered by the team where the project had none; they are shown in the sections above.` }] as Block[]) : []),
  ]);

  // Appendix: where each filled blank of the process descriptions came from, and which blanks have no value yet. Built before the
  // source register so the documents it cites are numbered in it.
  if (wu.filled.length || wu.open.length) {
    appendix("writeup-values", "Process description values", [
      { type: "paragraph", text: "The blanks of the process descriptions. A value found in the TRD or the project, or typed by the team, is shown with where it came from. A blank with no value is left open; the tool does not supply one." },
      ...(wu.filled.length
        ? ([
            { type: "table", columns: ["Description", "Item", "Value", "Source"], caption: "Filled blanks", rows: wu.filled.map(({ writeup, blank }) => [`${writeup.id}: ${writeup.title}`, blank.label, blank.value ?? "", [blank.where, blank.sourceIds?.length ? src.cite(blank.sourceIds, blank.locations) : ""].filter(Boolean).join("; ")]) },
          ] as Block[])
        : []),
      ...(wu.open.length
        ? ([{ type: "table", columns: ["Description", "Item still open", "Note"], caption: "Blanks without a value", rows: wu.open.map(({ writeup, blank }) => [`${writeup.id}: ${writeup.title}`, blank.label, blank.note ?? "No value in the TRD or the project"]) }] as Block[])
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

  return {
    title: TRD_DOCUMENT_TITLE,
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
