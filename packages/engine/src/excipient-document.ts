import {
  EXCIPIENT_FACTS,
  EXCIPIENT_FACT_GROUPS,
  EXCIPIENT_FACT_GROUP_LABEL,
  EXCIPIENT_FORMAT_VERSION,
  EXCIPIENT_REGULATORY_SENTENCE,
  EXCIPIENT_SIDE_LABEL,
  EXCIPIENT_SIDES,
  PROCESS_MODEL_VERSION,
  SCHEMA_VERSION,
  type ExcipientAssessment,
  type ExcipientLine,
  type ExcipientSide,
  type ExcipientSpecSide,
  type Project,
} from "@gap/process-model";
import type { ContentBundle } from "./content";
import type { Block, DocModel, DocSection } from "./document";
import { SPEC_RESULT_LABEL, compareSpecRow, excipientFactResolved, excipientMarkers, excipientOpenItems, excipientRegulatory, excipientTbdText } from "./excipient-analysis";
import { excipientClassOf, type ExcipientClasses, type ExcipientWording } from "./excipient-content";
import { deriveExcipientQuestions, excipientMarkerExplanation, type ExcipientQuestion } from "./excipient-interview";
import { assessmentTrdReferences, trdLinkText } from "./excipient-links";
import { projectLabel } from "./format";
import { sourceShort } from "./labels";
import { NOTICE_DOCUMENT, PRODUCT_NAME, TBD_MARKER } from "./product";
import { STAGE_LABEL, coverStage, projectStage } from "./stage";
import { buildTrdSeed } from "./trd-seed";

/**
 * The excipient assessment as a document (the same DocModel the other outputs use, so the shared HTML, Markdown and Word renderers draw it).
 *
 * GMP rules kept here:
 *  - An open fact prints as "Not established" or "TBD (owner, due date)". Nothing is filled in on the team's behalf, and the document can be
 *    made with anything open.
 *  - The tool never decides a filing category. A line with a change marker carries the one fixed sentence "Requires regulatory affairs
 *    assessment" and nothing more; the person's own reference to that assessment is printed as they wrote it.
 *  - A specification comparison says Same, Different, Only at one site or Not compared yet. It never says which limit is better.
 *  - The document is a draft: it never states that it is approved.
 */

export const EXCIPIENT_ASSESSMENT_TITLE = "Excipient assessment";
/** The one shared notice (product.ts), the same wording in every document. */
export const EXCIPIENT_BANNER = NOTICE_DOCUMENT;
const NOT_ESTABLISHED = TBD_MARKER;

/** Sections the person can leave out of one export. Everything else is always there, so an export cannot hide an open item. */
export const EXCIPIENT_OPTIONAL_SECTIONS = [{ id: "change-log", label: "Change log extract" }] as const;
export type ExcipientOptionalSection = (typeof EXCIPIENT_OPTIONAL_SECTIONS)[number]["id"];

export interface ExcipientDocumentOptions {
  generatedAt?: string;
  generatorName?: string;
  appVersion?: string;
  /** The wording and class files (content/excipient). They are not part of the content bundle, so the caller hands them in. */
  wording: ExcipientWording;
  classes: ExcipientClasses;
  omit?: readonly ExcipientOptionalSection[];
}

export const excipientBasisText = (projectName: string): string => `Draft excipient assessment generated from project ${projectName}. Not approved.`;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const stop = (s: string): string => (/[.!?]$/.test(s.trimEnd()) ? s : `${s}.`);

/** How a fact reads in the document: an unknown stays visible. */
function reading(project: Project, assessmentId: string, lineId: string, q: ExcipientQuestion | undefined): string {
  if (!q) return "Not asked";
  switch (q.state) {
    case "answered":
    case "same_as_sending":
      return q.current ?? "Answered";
    case "not_applicable":
      return q.reason ? `Not applicable (${q.reason})` : "Not applicable";
    case "tbd": {
      if (q.target.kind === "fact") return excipientTbdText(excipientFactResolved(project, assessmentId, lineId, q.target.factKey, q.target.side).tbd);
      return "TBD";
    }
    default:
      return "Not established";
  }
}

/** One side of a comparison row. */
function specSideText(s: ExcipientSpecSide): string {
  if (s.state === "open") return "Not established";
  if (s.state === "not_tested") return "Not tested";
  const value = [s.criterion, s.unit].filter(Boolean).join(" ");
  const method = s.method ? `method: ${s.method}` : "";
  return [value, method].filter(Boolean).join("; ") || "Stated, no criterion entered";
}

const roleText = (classes: ExcipientClasses, line: ExcipientLine): string => excipientClassOf(classes, line.classKey)?.label ?? line.classLabel ?? NOT_ESTABLISHED;

/** The cited sources of a line (facts and both sides of every comparison row), each once. */
function citedSourceIds(line: ExcipientLine): string[] {
  const ids = new Set<string>();
  for (const e of Object.values(line.facts)) for (const id of e.sourceIds) ids.add(id);
  for (const r of line.specs) for (const side of EXCIPIENT_SIDES) for (const id of r[side].sourceIds) ids.add(id);
  return [...ids];
}

function linkItems(project: Project, line: ExcipientLine): string[] {
  const out: string[] = [];
  if (line.links.gapIds.length) out.push(`Gaps: ${line.links.gapIds.join(", ")}`);
  for (const r of line.links.riskItems) out.push(`Risk item ${r.itemId} in risk assessment ${r.assessmentId}`);
  if (line.links.trdItem) out.push(trdLinkText(project, line.links.trdItem));
  if (line.links.regulatoryReference) out.push(`Regulatory affairs assessment written at: ${line.links.regulatoryReference}`);
  return out;
}

/** "Sending site: X. Receiving site: Y." for a fact that has a value for each site; the one value for a fact that has a single value. */
function sidesText(project: Project, a: ExcipientAssessment, line: ExcipientLine, byKey: Map<string, ExcipientQuestion>, factKey: string): string {
  const key = (side?: ExcipientSide) => `${line.id}/fact:${factKey}${side ? `.${side}` : ""}`;
  const both = byKey.get(key());
  if (both) return reading(project, a.id, line.id, both);
  return EXCIPIENT_SIDES.map((s) => `${EXCIPIENT_SIDE_LABEL[s]}: ${reading(project, a.id, line.id, byKey.get(key(s)))}`).join(". ");
}

export function buildExcipientAssessmentDocument(content: ContentBundle, project: Project, assessment: ExcipientAssessment, opts: ExcipientDocumentOptions): DocModel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const omit = new Set<string>(opts.omit ?? []);
  const a = assessment;
  const seed = buildTrdSeed(content, project, { exportedAt: generatedAt, ...(opts.appVersion ? { appVersion: opts.appVersion } : {}) });
  const program = seed.meta.product.program.display ?? NOT_ESTABLISHED;
  const open = excipientOpenItems(project, a);
  const stage = projectStage(project);
  const questions = deriveExcipientQuestions(project, a.id, { wording: opts.wording, classes: opts.classes });
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const sources = new Map(project.sources.map((s) => [s.id, s]));

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.filter((s) => !s.appendix).length + 1), title, blocks });
  const appendix = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String.fromCharCode(65 + sections.filter((s) => s.appendix).length), appendix: true, title, blocks });

  // 1. Purpose and scope
  const refs = assessmentTrdReferences(project, a);
  const referenceBlocks: Block[] = [];
  const stated = refs.filter((r) => r.document || r.procedure);
  if (stated.length) {
    for (const r of stated) {
      if (r.document) referenceBlocks.push({ type: "paragraph", text: `Assessment reference stated in ${r.trdId}: ${r.document}.` });
      if (r.procedure) referenceBlocks.push({ type: "paragraph", text: `Procedure or agreement stated in ${r.trdId}: ${r.procedure}.` });
    }
  } else {
    referenceBlocks.push({ type: "paragraph", text: "No assessment reference has been entered in a technical requirements document yet. Use the button \"Use in the TRD\" on the page of an excipient to enter it." });
  }
  add("purpose-scope", "Purpose and scope", [
    { type: "note", text: excipientBasisText(projectLabel(project.meta)) },
    {
      type: "paragraph",
      text: `This draft records which excipients ${program} uses, what is known about each at the sending and the receiving site, and where the two sites differ. It records what the team entered. Anything the team does not know yet is shown as open.`,
    },
    { type: "paragraph", text: `Assessment ${a.id}: ${a.title}. ${plural(a.lines.length, "excipient", "excipients")}, ${plural(open.length, "open item", "open items")}.` },
    ...(a.scopeNote?.trim() ? ([{ type: "heading", text: "Scope" }, { type: "paragraph", text: a.scopeNote.trim() }] as Block[]) : []),
    { type: "heading", text: "Assessment reference" },
    ...referenceBlocks,
  ]);

  // 2. Project stage
  add("project-stage", "Project stage", [
    {
      type: "paragraph",
      text: stage
        ? `This assessment is written for the ${STAGE_LABEL[stage]} stage. The questions are the same at every stage; the reasons and explanations are worded for this one.`
        : "The project stage has not been entered. The questions are the same at every stage.",
    },
  ]);

  // 3. Summary
  add("summary", "Summary", [
    {
      type: "paragraph",
      text: a.lines.length
        ? "One row for each excipient. The change markers say where the sites differ. A marker is not a finding."
        : "No excipient has been added yet.",
    },
    ...(a.lines.length
      ? ([
          {
            type: "table",
            columns: ["Excipient", "Role", "Compendial standards", "Origin", "Supplier", "What differs", "Regulatory"],
            rows: a.lines.map((l) => {
              const markers = excipientMarkers(project, a.id, l);
              const reg = excipientRegulatory(project, a.id, l);
              return [
                l.name,
                roleText(opts.classes, l),
                sidesText(project, a, l, byKey, "grade"),
                sidesText(project, a, l, byKey, "origin"),
                sidesText(project, a, l, byKey, "supplier"),
                markers.length ? markers.map((m) => m.label).join("; ") : "None so far",
                reg.required ? EXCIPIENT_REGULATORY_SENTENCE : "-",
              ];
            }),
          },
        ] as Block[])
      : []),
  ]);

  // 4. One block (section) for each excipient
  for (const l of a.lines) {
    const markers = excipientMarkers(project, a.id, l);
    const reg = excipientRegulatory(project, a.id, l);
    const blocks: Block[] = [{ type: "paragraph", text: `Excipient ${l.id}. Role: ${roleText(opts.classes, l)}.` }];

    const single: string[][] = [];
    const perSite: string[][] = [];
    // Facts, in the order of the fact list, grouped by their heading.
    const factRows = (group: (typeof EXCIPIENT_FACT_GROUPS)[number]) => {
      const sing: string[][] = [];
      const per: string[][] = [];
      const seen = new Set<string>();
      for (const q of questions) {
        if (q.lineId !== l.id || q.target.kind !== "fact") continue;
        const k = q.target.factKey;
        if (seen.has(k)) continue;
        const f = factDefOf(k);
        if (!f || f.group !== group) continue;
        seen.add(k);
        if (f.perSide) per.push([f.label, reading(project, a.id, l.id, byKey.get(`${l.id}/fact:${k}.sending`)), reading(project, a.id, l.id, byKey.get(`${l.id}/fact:${k}.receiving`))]);
        else sing.push([f.label, reading(project, a.id, l.id, byKey.get(`${l.id}/fact:${k}`))]);
      }
      return { sing, per };
    };
    for (const g of EXCIPIENT_FACT_GROUPS) {
      const { sing, per } = factRows(g);
      single.push(...sing.map((r) => [EXCIPIENT_FACT_GROUP_LABEL[g], ...r]));
      perSite.push(...per.map((r) => [EXCIPIENT_FACT_GROUP_LABEL[g], ...r]));
    }
    blocks.push({ type: "heading", text: "Facts for each site" });
    blocks.push(perSite.length ? { type: "table", columns: ["Group", "Fact", EXCIPIENT_SIDE_LABEL.sending, EXCIPIENT_SIDE_LABEL.receiving], rows: perSite } : { type: "paragraph", text: "No fact is asked for each site." });
    blocks.push({ type: "heading", text: "Facts for both sites" });
    blocks.push(single.length ? { type: "table", columns: ["Group", "Fact", "Value"], rows: single } : { type: "paragraph", text: "No fact is asked for both sites." });

    blocks.push({ type: "heading", text: "What differs between the sites" });
    if (markers.length) {
      blocks.push({ type: "list", items: markers.map((m) => `${m.label}. ${excipientMarkerExplanation(project, opts.wording, m.key)}`) });
    } else {
      blocks.push({ type: "paragraph", text: "Nothing differs so far in what has been entered. Open facts are not counted as a difference." });
    }
    if (reg.required) blocks.push({ type: "paragraph", text: `${EXCIPIENT_REGULATORY_SENTENCE}.` });

    blocks.push({ type: "heading", text: "Specification comparison" });
    blocks.push(
      l.specs.length
        ? { type: "table", columns: ["Test", EXCIPIENT_SIDE_LABEL.sending, EXCIPIENT_SIDE_LABEL.receiving, "Result"], rows: l.specs.map((r) => [r.test, specSideText(r.sending), specSideText(r.receiving), SPEC_RESULT_LABEL[compareSpecRow(r)]]) }
        : { type: "paragraph", text: "No test has been added for comparison." },
    );

    const links = linkItems(project, l);
    blocks.push({ type: "heading", text: "Linked to" });
    blocks.push(links.length ? { type: "list", items: links } : { type: "paragraph", text: "Nothing is linked." });

    const cited = citedSourceIds(l)
      .map((id) => sources.get(id))
      .filter((s) => !!s)
      .map((s) => sourceShort(s!));
    blocks.push({ type: "heading", text: "References" });
    blocks.push(cited.length ? { type: "list", items: cited } : { type: "paragraph", text: "No document is cited for this excipient yet." });
    add(`excipient-${l.id}`, l.name, blocks);
  }

  // 5. Open items
  add("open-items", "Open items", [
    {
      type: "paragraph",
      text: open.length
        ? "Entries still missing or to be decided. Nothing has been filled in on behalf of the team."
        : "No open items. This does not mean the excipients are acceptable; that is for the team and quality assurance to judge.",
    },
    ...(open.length ? ([{ type: "table", columns: ["Where", "Open item"], rows: open.map((o) => [o.where, stop(o.text)]) }] as Block[]) : []),
  ]);

  // Appendix: change log extract
  if (!omit.has("change-log")) {
    const mine = project.changeLog.filter((e) => e.path === `excipient.${a.id}` || e.path?.startsWith(`excipient.${a.id}.`));
    appendix("change-log", "Change log extract", [
      { type: "paragraph", text: "Every change made to this assessment, oldest first, with who made it. The change log of the project keeps the old values." },
      mine.length ? { type: "table", columns: ["When", "Who", "Change"], rows: mine.map((e) => [e.at.replace("T", " ").slice(0, 16) + " UTC", e.by, e.detail ?? e.action]) } : { type: "paragraph", text: "No changes have been recorded." },
    ]);
  }

  // Appendix: versions
  appendix("versions", "Versions", [
    {
      type: "table",
      columns: ["Item", "Value"],
      rows: [
        ["Generator", `${opts.generatorName ?? PRODUCT_NAME} ${opts.appVersion ?? "unversioned"}`],
        ["Excipient assessment format", EXCIPIENT_FORMAT_VERSION],
        ["Process model", PROCESS_MODEL_VERSION],
        ["Excipient classes", opts.classes.version],
        ["Excipient wording", opts.wording.version],
        ["Project schema", project.schemaVersion ?? SCHEMA_VERSION],
        ["Assessment last changed", a.updatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ],
    },
    { type: "note", text: "This document uses the built-in style only. A customer template is not applied to the excipient assessment." },
  ]);

  const m = seed.meta;
  return {
    title: EXCIPIENT_ASSESSMENT_TITLE,
    banner: EXCIPIENT_BANNER,
    status: "DRAFT",
    meta: [
      ["Project", project.meta.title],
      ["Assessment", `${a.id}: ${a.title}`],
      ["Project stage", stage ? STAGE_LABEL[stage] : NOT_ESTABLISHED],
      ["Generated", generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["Excipients", String(a.lines.length)],
      ["Open items", String(open.length)],
    ],
    cover: {
      program,
      product: [m.product.modality, m.product.dosageForm, m.product.presentation].map((x) => x.display ?? NOT_ESTABLISHED).join(", "),
      sourceSite: "",
      targetSite: [m.receivingSite.name.display, m.receivingSite.line.display].filter(Boolean).join(", ") || NOT_ESTABLISHED,
      sourceStage: "",
      ...coverStage(stage),
    },
    sections,
    tbdCount: open.length,
  };
}

// The fact definitions live in the process model; a tiny lookup keeps the loops above readable.
const FACT_DEFS = new Map(EXCIPIENT_FACTS.map((f) => [f.key, f]));
function factDefOf(key: string) {
  return FACT_DEFS.get(key);
}
