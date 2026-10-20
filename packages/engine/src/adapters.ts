import { parseProject, type DocRef, type EntryValue, type Project } from "@gap/process-model";
import type { ContentBundle } from "./content";
import type { Question } from "./content-schema";
import type { QuestionInstance } from "./sequencer";
import { nextInstance, visibleInstances } from "./sequencer";

/**
 * Extension points for later AI-assisted features. The PoC ships only the
 * deterministic implementations below; a backend could add others without
 * changing the data model.
 */

/** A value proposed by an ingestion source. It is never written to the model until a person accepts it. */
export interface ProposedEntry {
  /** Full entry reference, e.g. "source.uo.aseptic_filling.equip.filler.operatingPrinciple". */
  ref: string;
  value: EntryValue;
  /** Where in the document the value was found (page, section, table). */
  locator?: string;
  document: DocRef;
  /** Would be "ai_extraction" for a future backend extraction service. */
  sourceType: "imported_file" | "ai_extraction";
}

export interface IngestionAdapter {
  id: string;
  accepts(fileName: string, mime: string): boolean;
  /** Either a whole project (JSON import) or proposals for user review. */
  ingest(text: string): Promise<{ project?: Project; proposals?: ProposedEntry[] }>;
}

/** Project JSON import (the only ingestion adapter in the PoC). */
export const projectJsonAdapter: IngestionAdapter = {
  id: "project-json",
  accepts: (name, mime) => name.endsWith(".json") || mime === "application/json",
  async ingest(text) {
    return { project: parseProject(JSON.parse(text)) };
  },
};

/**
 * Supplies the next question. The PoC uses the static question bank; a future
 * backend "author interview" could propose follow-ups or draft rationale, with
 * answers still flowing through applyAnswer and its source records.
 */
export interface QuestionProvider {
  next(project: Project, fromKey?: string): QuestionInstance | undefined;
  rationale(q: Question): string;
}

export function staticQuestionProvider(content: ContentBundle): QuestionProvider {
  return {
    next: (project, fromKey) => nextInstance(visibleInstances(content, project, project.settings.entrySequence), project, fromKey),
    rationale: (q) => q.why,
  };
}
