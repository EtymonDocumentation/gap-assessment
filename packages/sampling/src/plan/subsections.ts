import { PLACEMENT_PATTERN, SAMPLING_TYPES, type CustomSubsection, type SamplingPlan, type SubsectionBlock, type SubsectionLibraryItem } from "@gap/process-model";
import { TYPE_LABEL } from "./labels.js";

/**
 * Custom subsections: user-written text that goes into the plan at a chosen place. The body is a small structured format
 * (paragraphs, bullet lists, simple tables, all plain text). There is no raw HTML anywhere: the renderers escape every value.
 */

// ---------------------------------------------------------------- where a subsection can go

/** Keys of the sections of the printed plan that a subsection can follow. They are also the ids of those sections. */
export const FIXED_SECTION_KEYS: { key: string; title: string }[] = [
  { key: "purpose-scope", title: "Purpose and scope" },
  { key: "product-site", title: "Product, presentation and receiving site" },
  { key: "batches", title: "PPQ batches" },
  { key: "statistical-bases", title: "Statistical bases used" },
];
export const TAIL_SECTION_KEYS: { key: string; title: string }[] = [
  { key: "agency-requests", title: "Agency requests and commitments" },
  { key: "totals", title: "Sample totals per batch" },
  { key: "open-items", title: "Open items" },
];
export const typeSectionKey = (type: string): string => `type-${type}`;
export const NO_TYPE_SECTION_KEY = "no-type";

/** All sections a subsection can follow, in print order. */
export function sectionChoices(): { key: string; title: string }[] {
  return [
    ...FIXED_SECTION_KEYS,
    ...SAMPLING_TYPES.map((t) => ({ key: typeSectionKey(t), title: TYPE_LABEL[t] })),
    { key: NO_TYPE_SECTION_KEY, title: "Points without a study type" },
    ...TAIL_SECTION_KEYS,
  ];
}

export const placementAfter = (key: string): string => `after_section:${key}`;
export const placementInPoint = (pointId: string): string => `in_point:${pointId}`;
export const placementInType = (type: string): string => `in_study_type:${type}`;

export function placementLabel(placement: string, plan?: Pick<SamplingPlan, "points">): string {
  if (placement === "appendix") return "In an appendix";
  const [kind, rest = ""] = placement.split(":");
  if (kind === "after_section") return `After the section "${sectionChoices().find((s) => s.key === rest)?.title ?? rest}"`;
  if (kind === "in_study_type") return `In the ${(TYPE_LABEL as Record<string, string>)[rest]?.toLowerCase() ?? rest} section`;
  if (kind === "in_point") {
    const p = plan?.points.find((x) => x.id === rest);
    return `Inside point ${rest}${p?.attribute.trim() ? ` (${p.attribute.trim()})` : ""}`;
  }
  return placement;
}

export const isPlacement = (s: string): boolean => PLACEMENT_PATTERN.test(s);

/** Subsections at one placement, in their order (ties broken by id so the order is stable). */
export function subsectionsAt(plan: Pick<SamplingPlan, "subsections">, placement: string): CustomSubsection[] {
  return plan.subsections.filter((s) => s.placement === placement).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- tokens

export const SUBSECTION_TOKENS = [
  { token: "{planId}", help: "The plan id, for example SPL-001." },
  { token: "{productName}", help: "The program or product name from the project." },
  { token: "{batchCount}", help: "The number of PPQ batches in the plan." },
  { token: "{batchList}", help: "The batch labels, separated by commas." },
  { token: "{ruSite}", help: "The receiving site name from the project." },
  { token: "{pointId}", help: "The id of the point (only inside a point)." },
  { token: "{pointTest}", help: "The test or attribute of the point (only inside a point)." },
] as const;

export interface TokenContext {
  planId: string;
  productName?: string;
  batchCount: number;
  batchList: string;
  ruSite?: string;
  pointId?: string;
  pointTest?: string;
}

const TOKEN_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const POINT_TOKENS = new Set(["pointId", "pointTest"]);

export function tokenContext(plan: SamplingPlan, project: { productName?: string; ruSite?: string }): TokenContext {
  return {
    planId: plan.id,
    ...(project.productName ? { productName: project.productName } : {}),
    batchCount: plan.batches.length,
    batchList: plan.batches.map((b) => b.label).join(", "),
    ...(project.ruSite ? { ruSite: project.ruSite } : {}),
  };
}

/**
 * Replaces the tokens of one text. A token that is unknown, or that has no value yet, or that only works inside a point, is NOT
 * dropped: it stays in the text as typed and a problem says why, so the reader sees it instead of an empty gap.
 */
export function expandTokens(text: string, ctx: TokenContext, inPoint: boolean): { text: string; problems: string[] } {
  const problems: string[] = [];
  const values: Record<string, string | undefined> = {
    planId: ctx.planId,
    productName: ctx.productName,
    batchCount: String(ctx.batchCount),
    batchList: ctx.batchCount > 0 ? ctx.batchList : undefined,
    ruSite: ctx.ruSite,
    pointId: inPoint ? ctx.pointId : undefined,
    pointTest: inPoint ? ctx.pointTest : undefined,
  };
  const out = text.replace(TOKEN_RE, (whole, name: string) => {
    if (!(name in values) && !POINT_TOKENS.has(name)) {
      problems.push(`${whole} is not a known token.`);
      return whole;
    }
    if (POINT_TOKENS.has(name) && !inPoint) {
      problems.push(`${whole} works only inside a point.`);
      return whole;
    }
    const v = values[name];
    if (v === undefined || v === "") {
      problems.push(`${whole} has no value yet in this project.`);
      return whole;
    }
    return v;
  });
  return { text: out, problems: [...new Set(problems)] };
}

export interface RenderedSubsection {
  id: string;
  title: string;
  blocks: SubsectionBlock[];
  /** Token problems and an empty-title / empty-body warning. They are shown beside the editor and listed as open items. */
  problems: string[];
}

/** The subsection with its tokens filled in. `point` is given for a subsection placed inside a point. */
export function renderSubsection(sub: CustomSubsection, ctx: TokenContext, point?: { id: string; attribute: string }): RenderedSubsection {
  const inPoint = sub.placement.startsWith("in_point:");
  const c: TokenContext = point ? { ...ctx, pointId: point.id, pointTest: point.attribute.trim() || undefined } as TokenContext : ctx;
  const problems: string[] = [];
  const ex = (t: string): string => {
    const r = expandTokens(t, c, inPoint);
    problems.push(...r.problems);
    return r.text;
  };
  const title = ex(sub.title);
  const blocks = sub.blocks.map((b): SubsectionBlock => {
    switch (b.type) {
      case "paragraph":
        return { type: "paragraph", text: ex(b.text) };
      case "list":
        return { type: "list", items: b.items.map(ex) };
      case "table":
        return { type: "table", columns: b.columns.map(ex), rows: b.rows.map((r) => r.map(ex)) };
    }
  });
  if (!sub.title.trim()) problems.push("The subsection has no title.");
  if (!sub.blocks.length) problems.push("The subsection has no text.");
  return { id: sub.id, title: title.trim() || sub.id, blocks, problems: [...new Set(problems)] };
}

/** Problems of every subsection of a plan, for the open items. */
export function subsectionProblems(plan: SamplingPlan, ctx: TokenContext): { id: string; problems: string[] }[] {
  return plan.subsections
    .map((s) => {
      const p = s.placement.startsWith("in_point:") ? plan.points.find((x) => x.id === s.placement.slice("in_point:".length)) : undefined;
      return { id: s.id, problems: renderSubsection(s, ctx, p ? { id: p.id, attribute: p.attribute } : undefined).problems };
    })
    .filter((x) => x.problems.length);
}

// ---------------------------------------------------------------- plain-text editing format

/** Removes control characters (kept: new line and tab). Raw HTML is not interpreted anywhere, so there is nothing else to strip. */
export const cleanText = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

/**
 * The editor's text format: paragraphs are separated by a blank line; lines that start with "- " are a bullet list; two or more
 * lines with " | " between cells are a table (the first line is the header). Everything else is a paragraph.
 */
export function parseSubsectionText(raw: string): SubsectionBlock[] {
  const chunks = cleanText(raw).replace(/\r\n?/g, "\n").split(/\n{2,}/).map((c) => c.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== ""));
  const blocks: SubsectionBlock[] = [];
  for (const lines of chunks) {
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      blocks.push({ type: "list", items: lines.map((l) => l.replace(/^\s*-\s+/, "").trim()) });
    } else if (lines.length >= 2 && lines.every((l) => l.includes("|"))) {
      const rows = lines.map((l) => l.split("|").map((c) => c.trim()));
      const width = rows[0]!.length;
      blocks.push({ type: "table", columns: rows[0]!, rows: rows.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) });
    } else {
      blocks.push({ type: "paragraph", text: lines.map((l) => l.trim()).join(" ") });
    }
  }
  return blocks;
}

export function subsectionText(blocks: SubsectionBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "paragraph":
          return b.text;
        case "list":
          return b.items.map((i) => `- ${i}`).join("\n");
        case "table":
          return [b.columns, ...b.rows].map((r) => r.join(" | ")).join("\n");
      }
    })
    .join("\n\n");
}

// ---------------------------------------------------------------- library

/**
 * Says how a subsection copied from the library compares with the library item today. Never changes anything: an issued plan is
 * not updated behind the owner's back. Returns "" for a subsection written by hand or one that is up to date.
 */
export function libraryNote(sub: Pick<CustomSubsection, "origin">, item: Pick<SubsectionLibraryItem, "version" | "name"> | undefined): string {
  if (sub.origin.kind !== "library") return "";
  if (!item) return `Copied from the library item "${sub.origin.name}" version ${sub.origin.version}. That item is no longer in your library.`;
  if (item.version !== sub.origin.version) return `Library item "${item.name}" changed since this was copied: now version ${item.version}, copied version ${sub.origin.version}. This subsection has not been updated.`;
  return "";
}
