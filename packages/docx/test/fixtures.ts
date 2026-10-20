/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addComment, assess, buildDemoProject, buildDocument, type DocModel } from "@gap/engine";
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

/** A model whose document has reviewer comments on several sections (the demo already has one on the gap table). */
export function buildModelWithComments(): Model {
  const base = buildDemoProject(content, demos["arx-217"]);
  let project: Project = base;
  const who = (name: string, at: string) => ({ name, role: "QA reviewer (fictional)", at });
  project = addComment(project, { sectionId: "purpose", text: "Please confirm the objective wording (fictional comment)." }, who("B. Checker (fictional)", "2026-10-06T09:00:00.000Z"));
  project = addComment(project, { sectionId: "approval", text: "Sign-off table needs a second row (fictional comment)." }, who("B. Checker (fictional)", "2026-10-06T09:30:00.000Z"));
  const a = assess(content, project);
  const doc = buildDocument(content, project, a, GENERATED_AT);
  return { project, doc, tagData: buildTagData(content, project, a, doc) };
}

export function emptyAnalysis(over: Partial<TemplateAnalysis> = {}): TemplateAnalysis {
  return { sourceFormat: "docx", stripped: [], hasHeader: false, hasFooter: false, hasLogo: false, outline: [], usableModes: [], warnings: [], ...over };
}
