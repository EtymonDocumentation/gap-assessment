/**
 * Where each page sits, for the breadcrumb at the top of the page: "Project name > Area > Page". The area is the top-level menu the page is
 * under (Documents or Library), matching the menu's own grouping (nav.tsx), so a person who found a page through the menu sees the same
 * words above its title. Parts with a path are links; the last part is the page itself, so it is plain text.
 *
 * A page that is shared by a list and one record (the TRD list and one TRD) names the list in the trail; the page passes the record's own
 * name as `crumb`, and the list part becomes a link back to the list. The libraries (templates, guidance, saved answers, and the tables,
 * subsections, methods, step blocks and process descriptions of each module) belong to the browser, not to a project, so their trail
 * has no project part.
 */
export interface TrailPart {
  label: string;
  path?: string;
}

export interface Trail {
  /** True when the page belongs to the open project, so the project's name comes first. */
  project: boolean;
  parts: TrailPart[];
}

const DOCS = "Documents";
const LIB = "Library";
const gap: TrailPart = { label: "Gap assessment", path: "/scope" };
const trd: TrailPart = { label: "TRD", path: "/trd" };
const sampling: TrailPart = { label: "Sampling plan", path: "/sampling" };
const mbr: TrailPart = { label: "Batch record", path: "/mbr" };
const risk: TrailPart = { label: "Risk assessment", path: "/risk" };

const t = (project: boolean, ...parts: (string | TrailPart)[]): Trail => ({ project, parts: parts.map((p) => (typeof p === "string" ? { label: p } : p)) });

const TRAILS: Record<string, Trail> = {
  "/scope": t(true, DOCS, "Gap assessment"),
  "/interview": t(true, DOCS, gap, "Interview"),
  "/compare": t(true, DOCS, gap, "Side by side"),
  "/register": t(true, DOCS, gap, "Gap register"),
  "/validation": t(true, DOCS, gap, "Validation"),
  "/document": t(true, DOCS, gap, "Document"),
  "/trd": t(true, DOCS, "TRD"),
  "/trd-seed": t(true, DOCS, trd, "TRD seed"),
  "/trd/writeups": t(false, DOCS, trd, "Process descriptions"),
  "/sampling": t(true, DOCS, "Sampling plan"),
  "/sampling/tables": t(false, DOCS, sampling, "Sampling tables"),
  "/sampling/subsections": t(false, DOCS, sampling, "Plan subsections"),
  "/mbr": t(true, DOCS, "Batch record"),
  "/mbr/view": t(true, DOCS, mbr),
  "/mbr/library": t(false, DOCS, mbr, "Step blocks"),
  "/risk": t(true, DOCS, "Risk assessment"),
  "/risk/methods": t(false, DOCS, risk, "Risk methods"),
  "/templates": t(false, LIB, "Templates"),
  "/guidance": t(false, LIB, "Guidance"),
  "/saved-answers": t(false, LIB, "Saved answers"),
  "/sources": t(true, LIB, "Sources"),
  "/builder": t(true, LIB, "Builder"),
  "/changes": t(true, LIB, "Change log"),
};

/** The trail of a route, or undefined for a route that has none (Home, the account pages). */
export function pageTrail(path: string): Trail | undefined {
  if (/^\/templates\/[^/]+\/mapping$/.test(path)) return t(false, LIB, { label: "Templates", path: "/templates" }, "Heading mapping");
  return TRAILS[path === "/model" ? "/builder" : path];
}
