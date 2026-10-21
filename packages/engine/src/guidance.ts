import { z } from "zod";

// The Guidance library: links to the official text of regulations and guidance. It is reference material only. It does
// not feed the gap assessment, never decides anything, and works without a project open.

export const GUIDANCE_JURISDICTIONS = ["US", "ICH", "EU", "UK", "PICS", "WHO", "JP", "CA", "AU", "CH", "BR", "CN", "KR", "IN", "SG", "SA", "MX", "Pharmacopoeia"] as const;
export type GuidanceJurisdiction = (typeof GUIDANCE_JURISDICTIONS)[number];

/** Display names, in the order the page lists the groups (the big regulators and ICH first). */
export const GUIDANCE_JURISDICTION_LABELS: Record<GuidanceJurisdiction, string> = {
  US: "United States",
  ICH: "ICH",
  EU: "European Union",
  UK: "United Kingdom",
  PICS: "PIC/S",
  WHO: "WHO",
  JP: "Japan",
  CA: "Canada",
  AU: "Australia",
  CH: "Switzerland",
  BR: "Brazil",
  CN: "China",
  KR: "South Korea",
  IN: "India",
  SG: "Singapore",
  SA: "Saudi Arabia",
  MX: "Mexico",
  Pharmacopoeia: "Pharmacopoeias",
};

export const GUIDANCE_TYPES = ["regulation", "guidance", "guideline", "annex", "q&a", "index", "pharmacopoeia"] as const;
export type GuidanceType = (typeof GUIDANCE_TYPES)[number];
export const GUIDANCE_TYPE_LABELS: Record<GuidanceType, string> = {
  regulation: "Regulation",
  guidance: "Guidance",
  guideline: "Guideline",
  annex: "Annex",
  "q&a": "Questions and answers",
  index: "Index page",
  pharmacopoeia: "Pharmacopoeia",
};

export const GUIDANCE_STATUSES = ["final", "draft", "superseded"] as const;
export type GuidanceStatus = (typeof GUIDANCE_STATUSES)[number];
export const GUIDANCE_STATUS_LABELS: Record<GuidanceStatus, string> = { final: "Final", draft: "Draft", superseded: "Superseded" };

export const GUIDANCE_TOPICS = [
  "gmp",
  "aseptic",
  "sterile-filtration",
  "pupsit",
  "lyophilization",
  "visual-inspection",
  "cci",
  "single-use",
  "validation",
  "qualification",
  "stability",
  "risk",
  "data-integrity",
  "biologics",
  "tech-transfer",
  "changes",
  "gdp",
  "index",
] as const;
export type GuidanceTopic = (typeof GUIDANCE_TOPICS)[number];
export const GUIDANCE_TOPIC_LABELS: Record<GuidanceTopic, string> = {
  gmp: "GMP",
  aseptic: "Aseptic processing",
  "sterile-filtration": "Sterile filtration",
  pupsit: "PUPSIT",
  lyophilization: "Lyophilization",
  "visual-inspection": "Visual inspection",
  cci: "Container closure integrity",
  "single-use": "Single-use systems",
  validation: "Validation",
  qualification: "Qualification",
  stability: "Stability",
  risk: "Quality risk management",
  "data-integrity": "Data integrity",
  biologics: "Biologics",
  "tech-transfer": "Technology transfer",
  changes: "Post-approval changes",
  gdp: "Distribution (GDP)",
  index: "Index or overview page",
};

export const GUIDANCE_LANGUAGE_LABELS: Record<string, string> = { en: "English", pt: "Portuguese", zh: "Chinese", es: "Spanish" };

/**
 * Official sources only. A link in this library must point at a regulator, an intergovernmental body or a pharmacopoeia
 * publisher, never at a consultancy, a blog or a mirror: a reader acts on what they find, and a regulatory text copied
 * by a third party can be out of date. Adding an agency means adding its host here on purpose (a code review, not a
 * content tweak). The content test also fails on a host in this list that no item uses, so the list stays honest.
 */
export const OFFICIAL_GUIDANCE_HOSTS = [
  "assets.publishing.service.gov.uk",
  "cdn.who.int",
  "cdsco.gov.in",
  "database.ich.org",
  "diariooficial.gob.mx",
  "dof.gob.mx",
  "doi.usp.org",
  "english.nmpa.gov.cn",
  "eur-lex.europa.eu",
  "health.ec.europa.eu",
  "mfds.go.kr",
  "picscheme.org",
  "tga.gov.au",
  "www.canada.ca",
  "www.ecfr.gov",
  "www.edqm.eu",
  "www.ema.europa.eu",
  "www.fda.gov",
  "www.gob.mx",
  "www.gov.br",
  "www.gov.uk",
  "www.hsa.gov.sg",
  "www.ich.org",
  "www.nmpa.gov.cn",
  "www.pmda.go.jp",
  "www.sfda.gov.sa",
  "www.swissmedic.ch",
  "www.tga.gov.au",
  "www.uspnf.com",
  "www.who.int",
] as const;

const officialUrl = z
  .url()
  .refine((u) => u.startsWith("https://"), "must be an https link")
  .refine((u) => (OFFICIAL_GUIDANCE_HOSTS as readonly string[]).includes(new URL(u).host), "host is not on the official-source list");

export const guidanceItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  jurisdiction: z.enum(GUIDANCE_JURISDICTIONS),
  agency: z.string().min(1),
  title: z.string().min(1),
  reference: z.string().min(1),
  type: z.enum(GUIDANCE_TYPES),
  status: z.enum(GUIDANCE_STATUSES),
  /** Free text: an ISO date, "current", or empty when the landing page did not show one. Empty is shown as not captured. */
  date: z.string(),
  language: z.string().min(2),
  access: z.enum(["free", "subscription"]),
  url: officialUrl,
  /** Optional direct link to the PDF, when the landing page and the PDF are different pages. */
  pdf: officialUrl.optional(),
  topics: z.array(z.enum(GUIDANCE_TOPICS)).min(1),
  /** ok: answered an automated check. blocked-but-official: a real official page that refuses scripts (opens in a browser). */
  verified: z.enum(["ok", "blocked-but-official"]),
  notes: z.string(),
});
export type GuidanceItem = z.infer<typeof guidanceItemSchema>;

export const guidanceFileSchema = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** The day a person last reviewed the list against the agency pages (YYYY-MM-DD). */
  checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(guidanceItemSchema).min(1),
});
export type GuidanceLibrary = z.infer<typeof guidanceFileSchema>;

/** Validates the raw YAML. Throws a readable message naming the item that is wrong. */
export function parseGuidance(raw: unknown): GuidanceLibrary {
  const r = guidanceFileSchema.safeParse(raw);
  if (!r.success) {
    const problems = r.error.issues.map((i) => {
      const [, idx, ...rest] = i.path;
      const id = typeof idx === "number" ? ((raw as { items?: { id?: string }[] })?.items?.[idx]?.id ?? `item ${idx}`) : "file";
      return `guidance.yaml ${id}${rest.length ? `.${rest.join(".")}` : ""}: ${i.message}`;
    });
    throw new Error(`Guidance library is invalid:\n${problems.join("\n")}`);
  }
  const lib = r.data;
  const seen = new Set<string>();
  for (const it of lib.items) {
    if (seen.has(it.id)) throw new Error(`Guidance library is invalid: duplicate id ${it.id}`);
    seen.add(it.id);
  }
  return lib;
}

// ------------------------------------------------------------------ search and filter

/**
 * Items whose notes say "confirm" are ones the research could not fully pin down (an issue date, or whether a draft
 * has since become final). The page marks them in words so nobody takes the listed date or status as settled.
 */
export function needsConfirmation(item: Pick<GuidanceItem, "notes">): boolean {
  return /\bconfirm/i.test(item.notes);
}

export interface GuidanceFilter {
  text?: string;
  /** "all" or empty means no restriction. */
  jurisdiction?: string;
  agency?: string;
  topic?: string;
  type?: string;
  status?: string;
}

const active = (v: string | undefined): v is string => !!v && v !== "all";

/** True when no restriction is set. */
export function isGuidanceFilterEmpty(f: GuidanceFilter): boolean {
  return !(f.text ?? "").trim() && !active(f.jurisdiction) && !active(f.agency) && !active(f.topic) && !active(f.type) && !active(f.status);
}

/**
 * Narrows the list. Text matches title, reference, agency and notes, ignoring case; every word typed must appear
 * somewhere in those fields, so "annex 1 sterile" finds Annex 1 without the words being next to each other.
 * File order is kept.
 */
export function filterGuidance(items: readonly GuidanceItem[], f: GuidanceFilter): GuidanceItem[] {
  const words = (f.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (active(f.jurisdiction) && it.jurisdiction !== f.jurisdiction) return false;
    if (active(f.agency) && it.agency !== f.agency) return false;
    if (active(f.topic) && !(it.topics as string[]).includes(f.topic)) return false;
    if (active(f.type) && it.type !== f.type) return false;
    if (active(f.status) && it.status !== f.status) return false;
    if (!words.length) return true;
    const hay = [it.title, it.reference, it.agency, it.notes].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export interface GuidanceGroup {
  jurisdiction: GuidanceJurisdiction;
  label: string;
  items: GuidanceItem[];
}

/** Groups by jurisdiction in the fixed display order; groups with no item are left out. */
export function groupGuidance(items: readonly GuidanceItem[]): GuidanceGroup[] {
  return GUIDANCE_JURISDICTIONS.map((j) => ({ jurisdiction: j, label: GUIDANCE_JURISDICTION_LABELS[j], items: items.filter((i) => i.jurisdiction === j) })).filter(
    (g) => g.items.length > 0,
  );
}

/** The distinct values present in the list, for the filter drop-downs (so an option never leads to an empty result by itself). */
export function guidanceAgencies(items: readonly GuidanceItem[]): string[] {
  return [...new Set(items.map((i) => i.agency))].sort((a, b) => a.localeCompare(b));
}
