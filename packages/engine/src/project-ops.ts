import { newId, type Actor, type Project } from "@gap/process-model";

/**
 * Renaming, copying and importing a whole project (the "My projects" list). A project's name is the only thing that tells two saved
 * projects apart in that list, so these functions keep the names apart too: a copy is always marked "(copy)", an imported project is
 * marked "(imported)" when a listed project already has its name, and a rename to a name that is already listed is refused. Every
 * change is written to the project's change log, because the name is printed on the documents.
 */

/** A problem with a project name that the person can fix; the message is shown as it is. */
export class ProjectNameError extends Error {}

/** Case and extra spaces do not make a different name. */
const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** True when one of the listed names is this name. */
export function titleTaken(title: string, taken: readonly string[]): boolean {
  return taken.some((t) => same(t, title));
}

/** "<title> (<word>)", else "<title> (<word> 2)", "(<word> 3)" ... the first that no listed project has. */
function withSuffix(title: string, word: string, taken: readonly string[]): string {
  let candidate = `${title} (${word})`;
  for (let n = 2; titleTaken(candidate, taken); n++) candidate = `${title} (${word} ${n})`;
  return candidate;
}

/** The name of a copy. It is always marked, so the list never shows two projects with one name. */
export function copyTitle(title: string, taken: readonly string[]): string {
  return withSuffix(title, "copy", taken);
}

/** The name of an imported project: unchanged, unless a listed project already has it. */
export function importedTitle(title: string, taken: readonly string[]): string {
  return titleTaken(title, taken) ? withSuffix(title, "imported", taken) : title;
}

/**
 * Gives the project a new name. `taken` holds the names of the person's OTHER projects (not this one), so changing only the case of its
 * own name works. Throws a ProjectNameError for an empty name or one that is already listed. A name that did not change returns the
 * project as it is, with no log entry.
 */
export function renameProject(project: Project, title: string, actor: Actor, opts: { taken?: readonly string[]; detail?: string } = {}): Project {
  const next = title.trim();
  if (!next) throw new ProjectNameError("Enter a name for the project.");
  if (next === project.meta.title) return project;
  if (titleTaken(next, opts.taken ?? [])) throw new ProjectNameError(`Another project is already called "${next}". Choose a different name.`);
  return {
    ...project,
    meta: { ...project.meta, title: next },
    changeLog: [
      ...project.changeLog,
      { at: actor.at, by: actor.name, action: "project_rename", path: "meta.title", ...(opts.detail ? { detail: opts.detail } : {}), before: project.meta.title, after: next },
    ],
  };
}

/**
 * A new project that starts as a copy of this one: same answers, documents and history, a new id and a "(copy)" name. The change log
 * says where it came from, so the history of the original is not mistaken for the copy's own. A fictional demo stays marked as one.
 */
export function copyProject(project: Project, actor: Actor, taken: readonly string[]): Project {
  const title = copyTitle(project.meta.title, taken);
  const next = structuredClone(project);
  next.meta = { ...next.meta, id: newId("prj"), title, createdAt: actor.at, createdBy: actor.name };
  next.changeLog.push({ at: actor.at, by: actor.name, action: "project_copy", path: "meta", detail: `Copied from "${project.meta.title}" (${project.meta.id})`, after: title });
  return next;
}
