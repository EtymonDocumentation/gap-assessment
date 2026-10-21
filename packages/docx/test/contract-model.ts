import type { Block, DocModel, DocSection } from "@gap/engine";

/**
 * A hand-built document in the M5.2 shape (SU / RU wording, the lean gap table, the "Gap details" appendix, optional sections left out).
 * Fictional data only. It does not depend on the engine, so the layout tests check the contract itself.
 */

export const BANNER_TEXT = "Proof of concept. Not validated. Not for GMP use.";
export const REGULATORY = "Requires regulatory affairs assessment";

export const GAP_COLUMNS = ["ID", "Attribute", "SU", "RU", "Gap", "Severity", "Actions", "Notes"];
export const DETAIL_COLUMNS = ["ID", "Rule", "Owner", "Status", "Regulatory", "SU verification", "RU verification"];

/** Category labels as the two stage variants word them: a validated SU, and a SU that is not process validated. */
export const LABELS = {
  validated: {
    within: "Within validated range",
    outside: "Outside validated range",
  },
  su: {
    within: "Within SU range",
    outside: "Outside SU range",
  },
} as const;

export type LabelVariant = keyof typeof LABELS;

export interface GapSpec {
  id: string;
  attribute: string;
  su: string;
  ru: string;
  /** Category label, then the detail. */
  gap: string;
  severity: string;
  actions: string;
  notes: string;
  rule: string;
  owner: string;
  status: string;
  regulatory: string;
  suVerification: string;
  ruVerification: string;
}

/** One gap per category label, a gap with a label nobody knows, and long unbreakable words. */
export function gapSpecs(variant: LabelVariant = "validated", extreme = false): GapSpec[] {
  const l = LABELS[variant];
  const base = {
    owner: "A. Owner (fictional)",
    status: "Open",
    regulatory: "—",
    suVerification: "Verified by B. Checker (fictional), 2026-09-01",
    ruVerification: "Unverified",
    notes: "—",
  };
  return [
    { ...base, id: "G-001", attribute: "Hold time before filling", su: "8 h", ru: "12 h", gap: `${l.outside}. RU hold time of 12 h is longer than the 8 h demonstrated at the SU.`, severity: "High", actions: `Hold-time study; ${REGULATORY}`, rule: "R-PAR-RANGE v1.2.0", regulatory: REGULATORY, notes: "Discussed in the 2026-09-10 call (fictional)." },
    { ...base, id: "G-002", attribute: "Filter pore size", su: "0.2 µm", ru: "0.22 µm", gap: `${l.within}. RU value lies inside the SU range.`, severity: "Low", actions: "Confirm filter compatibility", rule: "R-PAR-RANGE v1.2.0" },
    { ...base, id: "G-003", attribute: "Filling line operating principle", su: "Rotary piston", ru: "Peristaltic pump", gap: "Different operating principle or design. Pump type differs in kind, not in value.", severity: "High", actions: "Fill accuracy study; Shear and particle study", rule: "R-GEN-EQUIP-PRINCIPLE v1.2.0", ruVerification: "Verification withdrawn" },
    { ...base, id: "G-004", attribute: "Batch size", su: "40 L", ru: "120 L", gap: "Scale change. Scale changes ×3.0 (40 L to 120 L).", severity: "Medium", actions: "Process performance qualification at scale", rule: "R-SCALE v1.1.0" },
    { ...base, id: "G-005", attribute: "In-process check: fill weight", su: "Not performed", ru: "Every 30 min", gap: "New requirement. Present at the RU, absent from the SU.", severity: "Medium", actions: "Write procedure; Train operators", rule: "R-GEN-IPC-DESCRIPTION v1.2.0" },
    { ...base, id: "G-006", attribute: "Nitrogen overlay", su: "Used", ru: "Not used", gap: "Removed element. Present at the SU, absent from the RU.", severity: "Low", actions: "Confirm oxygen limit in the stability data", rule: "R-GEN-MAT-PRESENCE v1.2.0" },
    { ...base, id: "G-007", attribute: extreme ? "Polyethersulfone-membrane-supplier" : "Membrane supplier", su: "[not established]", ru: "Vendor X (fictional)", gap: "Information required. The SU value is not established.", severity: "None", actions: "—", rule: "R-GEN-MAT-PRESENCE v1.2.0", owner: "[unassigned]" },
    { ...base, id: "G-008", attribute: "Stopper compression", su: "Setting A", ru: "Setting B", gap: "Something new. A label the tool has never produced.", severity: "High (adjusted from Medium by A. Reviewer (fictional): worst-case seal)", actions: "Seal integrity test", rule: "R-GEN-EQUIP-PRINCIPLE v1.2.0", status: "Accepted, no action" },
  ];
}

const SECTION_TITLES: Record<string, string> = {
  purpose: "Purpose",
  scope: "Scope",
  "source-summary": "SU program summary (current state)",
  "gap-table": "Detailed gap table",
  "validation-plan": "Validation plan",
  "open-items": "Open information items",
  approval: "Approval",
  "gap-details": "Gap details",
  "source-register": "Source register",
};

const APPENDIX_IDS = new Set(["gap-details", "source-register"]);

/** All sections the contract model can hold, in document order. */
export const ALL_SECTION_IDS = ["purpose", "scope", "source-summary", "gap-table", "validation-plan", "open-items", "approval", "gap-details", "source-register"];

function blocksFor(id: string, specs: GapSpec[]): Block[] {
  switch (id) {
    case "purpose":
      return [{ type: "paragraph", text: "This document compares the sending unit (SU) and the receiving unit (RU) for a fictional product." }];
    case "scope":
      return [
        { type: "paragraph", text: "Scope of the comparison (fictional)." },
        { type: "table", columns: ["Scoping attribute", "Response", "Source", "Verification"], rows: [["Dosage form", "Liquid", "Batch record BR-1 (fictional)", "Unverified"]] },
      ];
    case "source-summary":
      return [{ type: "paragraph", text: "Current state at the SU (fictional)." }];
    case "gap-table":
      return [
        { type: "paragraph", text: "Every identified difference between the SU and the RU." },
        { type: "table", columns: GAP_COLUMNS, rows: specs.map((s) => [s.id, s.attribute, s.su, s.ru, s.gap, s.severity, s.actions, s.notes]) },
        { type: "note", text: `The tool never decides a filing category. A gap marked "${REGULATORY}" needs review.` },
      ];
    case "validation-plan":
      return [
        { type: "paragraph", text: "Activities implied by the gaps." },
        { type: "table", columns: ["Activity", "Description", "Implied by gaps", "Severity", "Regulatory", "Linked studies: SU status", "Linked studies: RU status", "Readiness"], rows: [["Hold-time study", "Show the longer hold time is acceptable.", "G-001", "High", REGULATORY, "—", "Not started", "Not ready"]] },
      ];
    case "open-items":
      return [{ type: "paragraph", text: "No open information items." }];
    case "approval":
      return [
        { type: "paragraph", text: "Names, signatures and dates are completed outside this tool." },
        { type: "table", columns: ["Role", "Name", "Signature", "Date"], rows: [["Author", "[name]", "", "[date]"], ["Approver", "[name]", "", "[date]"]] },
      ];
    case "gap-details":
      return [
        { type: "paragraph", text: "The rule, owner, status, regulatory note and verification state behind each gap." },
        { type: "table", columns: DETAIL_COLUMNS, rows: specs.map((s) => [s.id, s.rule, s.owner, s.status, s.regulatory, s.suVerification, s.ruVerification]) },
      ];
    case "source-register":
      return [{ type: "table", columns: ["ID", "Type", "Identifier, title, version", "Responder", "Date", "State", "Cited by"], rows: [["S-001", "Document", "BR-1 Batch record, v2 (fictional)", "A. Responder (fictional)", "2026-09-01", "In use", "G-001"]] }];
    default:
      return [];
  }
}

export interface ContractOptions {
  variant?: LabelVariant;
  /** Section ids to keep, in document order (default: all). Numbers are given again, 1, 2, ... and A, B, ... */
  keep?: string[];
  stages?: { su: string; ru: string };
  /** One attribute name with a very long word, to check that long words are never broken. */
  extreme?: boolean;
}

export function contractModel(o: ContractOptions = {}): DocModel {
  const specs = gapSpecs(o.variant ?? "validated", o.extreme);
  const keep = o.keep ?? ALL_SECTION_IDS;
  let n = 0;
  let a = 0;
  const sections: DocSection[] = keep.map((id) => {
    const appendix = APPENDIX_IDS.has(id);
    const number = appendix ? String.fromCharCode(65 + a++) : String(++n);
    return { id, number, ...(appendix ? { appendix: true } : {}), title: SECTION_TITLES[id] ?? id, blocks: blocksFor(id, specs) };
  });
  const omitted = ALL_SECTION_IDS.filter((id) => !keep.includes(id)).map((id) => SECTION_TITLES[id]);
  return {
    title: "Gap Assessment: ARX-217 (fictional)",
    banner: BANNER_TEXT,
    status: "DRAFT",
    meta: [
      ["Project", "ARX-217 (fictional)"],
      ["Generated", "2026-10-02 00:00 UTC"],
      ["Differences identified", String(specs.length)],
      ["Sections omitted", omitted.length ? omitted.join("; ") : "None"],
    ],
    cover: {
      program: "ARX-217",
      product: "Monoclonal antibody, liquid, 2R vial",
      sourceSite: "Site North (fictional), Line 2",
      targetSite: "Site South (fictional), Line 4",
      sourceStage: o.stages?.su ?? "Commercial (process validated)",
      targetStage: o.stages?.ru ?? "Clinical (GMP, not process validated)",
    },
    sections,
    tbdCount: 0,
  };
}
