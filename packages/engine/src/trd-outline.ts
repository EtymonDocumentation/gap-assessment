import { COLLECTION_LABELS, SEED_COLLECTIONS, type SeedAnswer, type SeedField, type SeedItem, type SeedUnitOperation, type TrdSeed } from "@gap/process-model";
import type { Block, DocModel, DocSection } from "./document";

/**
 * The draft TRD outline: a Word / HTML document built from a TRD seed ALONE (never from the live project), so the file a person
 * reads and the JSON a TRD tool reads can never disagree. It reuses the DocModel of the gap assessment document, so the existing
 * renderers (Markdown, HTML, built-in Word style) draw it without change.
 *
 * GMP rules kept here: values of the receiving unit (RU) only, the SU appears solely in the optional Traceability section; a TBD
 * best guess is written "TBD best guess, provisional" in words (never colour only); an unknown value reads "Not established"; the
 * outline never claims to be an approved TRD, and it never states a regulatory filing category.
 */

export const TRD_OUTLINE_TITLE = "Technical requirements document — draft outline";
export const TRD_BANNER = "Proof of concept. Not validated. Not for GMP use.";
const NOT_ESTABLISHED = "Not established";

export interface TrdOutlineOptions {
  /** Adds the Traceability section (SU reference values and gap ids per RU value). On by default. */
  traceability?: boolean;
}

/** The status of a field in words. */
export function seedStatusText(f: Pick<SeedAnswer, "status" | "provisional"> & { sameAsSu?: true }): string {
  if (f.status === "tbd") return f.provisional ? "TBD best guess (provisional)" : "TBD (to be determined)";
  if (f.status === "established") return f.sameAsSu ? "Established (same as SU)" : "Established";
  if (f.status === "not_applicable") return "Not applicable";
  return NOT_ESTABLISHED;
}

/** The value of a field as a reader sees it: unknown stays visible, a guess is labelled. */
export function seedValueText(f: SeedAnswer): string {
  const shown = f.display ?? (f.value === undefined ? "" : typeof f.value === "object" ? JSON.stringify(f.value) : String(f.value));
  if (f.status === "established") return shown || NOT_ESTABLISHED;
  if (f.status === "tbd") {
    const owner = f.tbd?.owner ? `; owner ${f.tbd.owner}` : "";
    const due = f.tbd?.due ? `; due ${f.tbd.due}` : "";
    return f.provisional && shown ? `${shown} (TBD best guess, provisional${owner}${due})` : `To be determined (TBD)${owner}${due}`;
  }
  if (f.status === "not_applicable") return f.justification ? `Not applicable: ${f.justification}` : "Not applicable";
  return NOT_ESTABLISHED;
}

const VERIFICATION_TEXT = { verified: "Verified", self_verified: "Verified (same person as recorder)", withdrawn: "Verification withdrawn", unverified: "Unverified" } as const;

interface Located {
  uo: SeedUnitOperation | undefined;
  item: SeedItem | undefined;
  field: SeedField;
}

function allFields(seed: TrdSeed): Located[] {
  const out: Located[] = seed.site.fields.map((field) => ({ uo: undefined, item: undefined, field }));
  for (const uo of seed.unitOperations) {
    for (const field of uo.fields) out.push({ uo, item: undefined, field });
    for (const item of uo.items) for (const field of item.fields) out.push({ uo, item, field });
  }
  return out;
}

/** Product and site answers, which are answers like any other and also count as open when unknown. */
function metaAnswers(seed: TrdSeed): { name: string; a: SeedAnswer }[] {
  const { product: p, receivingSite: s } = seed.meta;
  return [
    { name: "Program", a: p.program },
    { name: "Modality", a: p.modality },
    { name: "Dosage form", a: p.dosageForm },
    { name: "Presentation", a: p.presentation },
    { name: "RU site", a: s.name },
    { name: "RU line", a: s.line },
    { name: "RU program stage", a: s.programStage },
  ];
}

export interface TrdSeedCounts {
  key: string;
  label: string;
  established: number;
  /** Includes TBD best guesses: a guess is still open, never counted as established. */
  tbd: number;
  notEstablished: number;
  notApplicable: number;
  total: number;
}

const countOf = (fields: SeedAnswer[]): Omit<TrdSeedCounts, "key" | "label"> => {
  const tbd = fields.filter((f) => f.status === "tbd").length;
  const notEstablished = fields.filter((f) => f.status === "not_established").length;
  const notApplicable = fields.filter((f) => f.status === "not_applicable").length;
  return { established: fields.length - tbd - notEstablished - notApplicable, tbd, notEstablished, notApplicable, total: fields.length };
};

/** Counts per unit operation (RU values: established / TBD / not established), then a total row that also counts product and site answers. */
export function trdSeedCounts(seed: TrdSeed): { rows: TrdSeedCounts[]; total: Omit<TrdSeedCounts, "key" | "label"> } {
  const rows = seed.unitOperations.map((u) => ({ key: u.key, label: u.label, ...countOf([...u.fields, ...u.items.flatMap((i) => i.fields)]) }));
  return { rows, total: countOf([...allFields(seed).map((l) => l.field), ...metaAnswers(seed).map((m) => m.a)]) };
}

const where = (l: Located) => [l.uo?.label ?? "Site and facility", l.item?.label ?? ""].filter(Boolean).join(": ");

export function buildTrdOutline(seed: TrdSeed, opts: TrdOutlineOptions = {}): DocModel {
  const traceability = opts.traceability ?? true;
  const m = seed.meta;
  const program = m.product.program.display ?? NOT_ESTABLISHED;
  const revision = m.gapAssessment.revision ? `revision ${m.gapAssessment.revision}` : "no issued revision";
  const basis = `Draft outline seeded from gap assessment ${m.project.name} (${revision}). Not an approved TRD.`;
  const fields = allFields(seed);
  const answers = metaAnswers(seed);
  const tbdCount = [...fields.map((l) => l.field), ...answers.map((x) => x.a)].filter((f) => f.status === "tbd").length;
  const notEstablishedCount = [...fields.map((l) => l.field), ...answers.map((x) => x.a)].filter((f) => f.status === "not_established").length;

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.length + 1), title, blocks });
  const val = seedValueText;

  // 1. Purpose and scope
  const scopeRows: string[][] = [
    ...seed.scope.included.map((u) => [u.label, "In scope", u.note ?? ""]),
    ...seed.scope.excluded.map((u) => [u.label, "Left out of the assessment", `${u.reason} (${u.by}, ${u.at.slice(0, 10)})`]),
    ...seed.scope.notApplicable.map((u) => [u.label, "Not applicable", u.reason]),
    ...seed.scope.topicsLeftOut.map((t) => [`${t.uoLabel}: ${t.topicLabel}`, "Topic left out", `${t.reason} (${t.by}, ${t.at.slice(0, 10)})`]),
  ];
  add("purpose-scope", "Purpose and scope", [
    { type: "note", text: basis },
    {
      type: "paragraph",
      text: `This outline lists what the gap assessment recorded about the planned process at the receiving unit (RU) for ${program}. It is meant as a starting point for the technical requirements document (TRD): each value shows whether it is established, still to be determined (TBD) or not established. Nothing has been filled in on behalf of the project, and unit operations or topics left out are not listed below.`,
    },
    { type: "table", columns: ["Unit operation or topic", "Scope", "Note"], rows: scopeRows, caption: "Scope of the outline" },
  ]);

  // 2. Product and presentation
  add("product", "Product and presentation", [
    {
      type: "table",
      columns: ["Item", "Value", "Status"],
      rows: answers.slice(0, 4).map((x) => [x.name, val(x.a), seedStatusText(x.a)]),
    },
  ]);

  // 3. Receiving site and line
  const siteBlocks: Block[] = [
    { type: "table", columns: ["Item", "Value", "Status"], rows: answers.slice(4).map((x) => [x.name, val(x.a), seedStatusText(x.a)]) },
  ];
  if (seed.site.fields.length) {
    siteBlocks.push({ type: "heading", text: "Facility answers" }, {
      type: "table",
      columns: ["Attribute", "RU value", "Status", "Verification"],
      rows: seed.site.fields.map((f) => [f.label, val(f), seedStatusText(f), VERIFICATION_TEXT[f.verification]]),
    });
  }
  add("site", "Receiving site and line", siteBlocks);

  // 4. Process overview
  const counts = trdSeedCounts(seed);
  add("overview", "Process overview", [
    {
      type: "paragraph",
      text: "The unit operations in process order, with how many RU values are established, TBD or not established. Unit operations that wait for an unanswered scoping question have no values yet.",
    },
    {
      type: "table",
      columns: ["Unit operation", "Stage group", "Established", "TBD", "Not established", "Not applicable"],
      rows: seed.scope.included.map((u) => {
        const c = counts.rows.find((r) => r.key === u.key);
        return [u.label, u.stageGroup?.label ?? "Added by the project", c ? String(c.established) : "0", c ? String(c.tbd) : "0", c ? String(c.notEstablished) : "0", c ? String(c.notApplicable) : "0"];
      }),
    },
  ]);

  // Readers look sources up in the source register, so tables cite register numbers instead of internal ids. The numbers
  // are the gap assessment document's own (S-012 means the same source in both documents); a source the gap document
  // does not list falls back to its id. The register shows both, so the seed JSON can be matched too.
  const refOf = new Map(seed.sources.map((s) => [s.id, s.gapRegisterRef ?? s.id]));
  const refs = (ids: readonly string[]) => ids.map((id) => refOf.get(id) ?? id).join(", ");

  // 5..: one section per unit operation
  for (const uo of seed.unitOperations) {
    const blocks: Block[] = [];
    const colls = SEED_COLLECTIONS.filter((c) => uo.items.some((i) => i.collection === c));
    if (uo.fields.length) {
      blocks.push(
        { type: "heading", text: "Unit operation" },
        { type: "table", columns: ["Attribute", "RU value", "Status", "Verification", "Sources"], rows: uo.fields.map((f) => [f.label, val(f), seedStatusText(f), VERIFICATION_TEXT[f.verification], refs(f.sourceIds)]) },
      );
    }
    for (const c of colls) {
      const rows: string[][] = [];
      for (const item of uo.items.filter((i) => i.collection === c)) {
        for (const f of item.fields) {
          rows.push([item.custom ? `${item.label} (added by the project)` : item.label, f.label, val(f), seedStatusText(f), VERIFICATION_TEXT[f.verification], refs(f.sourceIds)]);
        }
      }
      blocks.push({ type: "heading", text: COLLECTION_LABELS[c] }, { type: "table", columns: ["Item", "Attribute", "RU value", "Status", "Verification", "Sources"], rows });
    }
    if (!blocks.length) blocks.push({ type: "paragraph", text: "No values have been recorded for this unit operation." });
    add(`uo-${uo.key}`, uo.label, blocks);
  }

  // Open items
  const open = fields.filter((l) => l.field.status === "tbd" || l.field.status === "not_established");
  const openRows: string[][] = [
    ...answers.filter((x) => x.a.status === "tbd" || x.a.status === "not_established").map((x) => ["Product and site", x.name, seedStatusText(x.a), "", "", ""]),
    ...open.map((l) => [where(l), l.field.label, seedStatusText(l.field), l.field.tbd?.owner ?? "", l.field.tbd?.due ?? "", l.field.tbd?.note ?? ""]),
  ];
  add("open-items", "Open items", [
    {
      type: "paragraph",
      text: openRows.length
        ? "Values that are still to be determined (TBD) or not established. They must be resolved or accepted before the TRD can rely on them."
        : "The gap assessment holds no TBD or not established values for the units listed in this outline.",
    },
    ...(openRows.length ? ([{ type: "table", columns: ["Where", "Attribute", "Status", "Owner", "Due", "Note"], rows: openRows }] as Block[]) : []),
  ]);

  // Source register
  add("sources", "Source register", [
    seed.sources.length
      ? {
          type: "table",
          columns: ["Ref", "Id", "Type", "Label", "Document", "Date"],
          rows: seed.sources.map((s) => [
            refOf.get(s.id) ?? s.id,
            s.id,
            s.type,
            s.label,
            s.document ? [s.document.identifier, s.document.title, s.document.version ? `v${s.document.version}` : ""].filter(Boolean).join(", ") : (s.file?.name ?? ""),
            s.date,
          ]),
        }
      : { type: "paragraph", text: "No sources are cited." },
  ]);

  // Optional traceability
  if (traceability) {
    const rows: string[][] = [];
    for (const l of fields) {
      const r = l.field.reference;
      if (!r || (!r.su && !r.gapIds.length)) continue;
      rows.push([where(l), l.field.label, val(l.field), r.su ? val(r.su ) : "Not compared", r.gapIds.join(", ")]);
    }
    add("traceability", "Traceability to the gap assessment", [
      {
        type: "paragraph",
        text: "For each RU value, the SU value it was compared with and the gap register rows (gap ids) of the gap assessment. SU values are shown for reference only and are not RU values. Gap ids can renumber when the gap assessment changes.",
      },
      rows.length ? { type: "table", columns: ["Where", "Attribute", "RU value", "SU reference", "Gap ids"], rows } : { type: "paragraph", text: "No RU value has an SU reference." },
    ]);
  }

  // Versions
  add("versions", "Versions", [
    {
      type: "table",
      columns: ["Item", "Value"],
      rows: [
        ["Generator", `${m.generator.name} ${m.generator.version}`],
        ["Process model", m.processModelVersion],
        ...Object.entries(m.contentVersions).map(([k, v]) => [`Content: ${k}`, v]),
        ["TRD seed format", `${m.format} ${m.formatVersion}`],
        ["Project schema", m.projectSchemaVersion],
        ["Gap assessment document fingerprint", m.gapAssessment.documentFingerprint],
        ["Gap assessment revision", revision],
        ["Seed exported", m.exportedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ],
    },
    { type: "note", text: "This outline uses the built-in style only. A customer template is not applied to the TRD outline." },
  ]);

  return {
    title: TRD_OUTLINE_TITLE,
    banner: TRD_BANNER,
    status: "DRAFT",
    meta: [
      ["Project", m.project.name],
      ["Basis", basis],
      ["Generated", m.exportedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["TBD values", String(tbdCount)],
      ["Values not established", String(notEstablishedCount)],
      ["Traceability section", traceability ? "Included" : "Left out"],
    ],
    cover: {
      program,
      product: [m.product.modality, m.product.dosageForm, m.product.presentation].map((a) => a.display ?? NOT_ESTABLISHED).join(", "),
      // The seed describes the RU only. Empty SU fields make the Word cover leave those rows out.
      sourceSite: "",
      targetSite: [m.receivingSite.name.display, m.receivingSite.line.display].filter(Boolean).join(", ") || NOT_ESTABLISHED,
      sourceStage: "",
      targetStage: m.receivingSite.programStage.display ?? NOT_ESTABLISHED,
    },
    sections,
    tbdCount,
  };
}
