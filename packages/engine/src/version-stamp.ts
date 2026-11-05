import type { Project } from "@gap/process-model";
import type { DocModel, VersionStamp } from "./document";
import { STAGE_SHORT, type ProgramStage } from "./stage";
import { hasUnsavedChanges, lastVersion } from "./version-history";

/**
 * Which version a document was made from, in the words every output repeats (cover row, page header line, template tags, document
 * properties, screen preview). One place, so Word, HTML and the screen say the same thing.
 */

/** The cover row of a project that has no version history (a project from before this release that was never opened here). */
export const NO_VERSION_HISTORY = "[no version history]";

/** The stamp of a saved version: its own label and day, and the project stage it was saved with. */
export function savedVersionStamp(v: { label: string; at: string; stage?: string }): VersionStamp {
  const stage = v.stage && (STAGE_SHORT as Record<string, string>)[v.stage as ProgramStage] ? (STAGE_SHORT as Record<string, string>)[v.stage]! : "not set";
  const day = v.at.slice(0, 10);
  return { row: `${v.label} (saved ${day}), project stage ${stage}`, label: v.label, saved: day };
}

/**
 * The stamp of the working copy. It never claims to be a saved version: it names the newest one it grew from and says whether anything
 * changed since, so a reader of a printed page knows if a saved copy of exactly this text exists.
 */
export function workingCopyStamp(project: Project): VersionStamp {
  const last = lastVersion(project);
  if (!last) return { row: NO_VERSION_HISTORY, label: "", saved: "" };
  const label = `Working copy after ${last.label}`;
  if (hasUnsavedChanges(project)) return { row: `${label} (changes since not saved as a version)`, label, saved: "" };
  return { row: `${label} (no changes since it was saved)`, label, saved: last.at.slice(0, 10) };
}

/** The document with the stamp on its cover. The content, the fingerprint and everything else stay as they were. */
export function stampDocument(doc: DocModel, stamp: VersionStamp): DocModel {
  return { ...doc, cover: { ...doc.cover, version: stamp } };
}

/**
 * The line under the banner on pages 2 onwards and in the screen preview: "<title> · Project stage: PPQ · v2". The project stage and the
 * version are in the header, not only on the cover, so a printed page picked up on its own says which batches and which version it is for.
 */
export function documentHeaderLine(doc: DocModel): string {
  const parts = [doc.title];
  if (doc.cover.stageShort) parts.push(`Project stage: ${doc.cover.stageShort}`);
  if (doc.cover.version?.label) parts.push(doc.cover.version.label);
  return parts.join(" · ");
}
