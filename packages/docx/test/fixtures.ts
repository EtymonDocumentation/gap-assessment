/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assess, buildDemoProject, buildDocument, citeEntries, type DocModel } from "@gap/engine";
import type { Project } from "@gap/process-model";
import { content, demos } from "../../../content/index";
import { buildTagData, type TagData } from "../src/tags";
import type { TemplateAnalysis } from "../src/types";

const here = dirname(fileURLToPath(import.meta.url));

export const BANNER = "Proof of concept. Not validated. Not for GMP use.";
export const GENERATED_AT = "2026-10-02T00:00:00.000Z";

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(here, "..", "fixtures", name)));
}

export interface Model {
  project: Project;
  doc: DocModel;
  tagData: TagData;
}

export function buildModel(): Model {
  const project = buildDemoProject(content, demos["arx-217"]);
  const a = assess(content, project);
  const doc = buildDocument(content, project, a, GENERATED_AT);
  return { project, doc, tagData: buildTagData(content, project, a, doc) };
}

export function emptyAnalysis(over: Partial<TemplateAnalysis> = {}): TemplateAnalysis {
  return { sourceFormat: "docx", stripped: [], hasHeader: false, hasFooter: false, hasLogo: false, outline: [], usableModes: [], warnings: [], ...over };
}

/** The demo with its first valued entry cited to a register document at section 4.2, page 12 (a citation location). */
export function buildModelWithLocation(): Model & { location: string } {
  const base = buildDemoProject(content, demos["arx-217"]);
  const doc0 = base.sources.find((s) => s.type === "document_reference")!;
  const ref = Object.values(base.processes.source.unitOperations).flatMap((u) => [...Object.values(u.fields), ...Object.values(u.collections).flatMap((c) => Object.values(c).flatMap((i) => Object.values(i.fields)))]).find((e) => e.value !== undefined && !e.sourceIds.includes(doc0.id))!.path;
  const actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: "2026-10-03T09:00:00.000Z" };
  const project = citeEntries(base, [ref], doc0.id, { section: "4.2", page: "12" }, actor).project;
  const a = assess(content, project);
  const doc = buildDocument(content, project, a, GENERATED_AT);
  return { project, doc, tagData: buildTagData(content, project, a, doc), location: "§4.2 p.12" };
}
