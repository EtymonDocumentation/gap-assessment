// Renaming, copying and importing a whole project (the "My projects" list). Tester D rows 17 and 18. All names are fictional.
import { describe, expect, it } from "vitest";
import { emptyProject, parseProject, type Actor } from "@gap/process-model";
import { changeLogView, copyProject, copyTitle, importedTitle, ProjectNameError, renameProject, titleTaken } from "@gap/engine";
import { content } from "./helpers";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", at: "2026-10-06T09:00:00.000Z" };
const project = (title = "Program X transfer (fictional)") => emptyProject({ title, actor: ACTOR, contentRefs: content.versions });

describe("names in the project list", () => {
  it("treats case and extra spaces as the same name", () => {
    expect(titleTaken("program  x TRANSFER", ["Program X transfer"])).toBe(true);
    expect(titleTaken("Program Y", ["Program X transfer"])).toBe(false);
    expect(titleTaken("Program X", [])).toBe(false);
  });

  it("marks a copy every time, and counts up when that name is listed too", () => {
    expect(copyTitle("Alpha", [])).toBe("Alpha (copy)");
    expect(copyTitle("Alpha", ["Alpha", "Alpha (copy)"])).toBe("Alpha (copy 2)");
    expect(copyTitle("Alpha", ["Alpha (copy)", "alpha (copy 2)"])).toBe("Alpha (copy 3)");
  });

  it("leaves an imported name alone unless a listed project has it", () => {
    expect(importedTitle("Alpha", ["Beta"])).toBe("Alpha");
    expect(importedTitle("Alpha", ["Alpha"])).toBe("Alpha (imported)");
    expect(importedTitle("Alpha", ["Alpha", "Alpha (imported)"])).toBe("Alpha (imported 2)");
  });
});

describe("renameProject", () => {
  it("changes only the title and writes the old and new name to the change log", () => {
    const p = project();
    const next = renameProject(p, "  Program X, line 2 (fictional) ", { ...ACTOR, at: "2026-10-07T09:00:00.000Z" });
    expect(next.meta.title).toBe("Program X, line 2 (fictional)");
    expect(next.meta.id).toBe(p.meta.id);
    expect(next.meta.createdAt).toBe(p.meta.createdAt);
    expect(p.meta.title).toBe("Program X transfer (fictional)");
    const row = changeLogView(content, next).at(-1)!;
    expect(row.actionLabel).toBe("Project renamed");
    expect(row.subject).toBe("Project name");
    expect(row.before).toBe("Program X transfer (fictional)");
    expect(row.after).toBe("Program X, line 2 (fictional)");
    expect(row.by).toBe(ACTOR.name);
  });

  it("does nothing, and logs nothing, when the name did not change", () => {
    const p = project();
    expect(renameProject(p, " Program X transfer (fictional) ", ACTOR)).toBe(p);
  });

  it("refuses an empty name and a name another project has, but allows changing the case of its own name", () => {
    const p = project("Alpha");
    expect(() => renameProject(p, "   ", ACTOR)).toThrow(ProjectNameError);
    expect(() => renameProject(p, "Beta", ACTOR, { taken: ["beta"] })).toThrow('Another project is already called "Beta". Choose a different name.');
    expect(renameProject(p, "ALPHA", ACTOR, { taken: ["Beta"] }).meta.title).toBe("ALPHA");
  });

  it("keeps a reason in the log entry when one is given", () => {
    const next = renameProject(project("Alpha"), "Alpha (imported)", ACTOR, { detail: "Renamed on import" });
    expect(changeLogView(content, next).at(-1)!.detail).toBe("Renamed on import");
  });
});

describe("copyProject", () => {
  it("is a new project with the same content, a new id and a marked name, and says where it came from", () => {
    const p = project("Alpha");
    p.meta.demo = true;
    const later: Actor = { name: "Sam Sample (fictional)", at: "2026-10-08T10:00:00.000Z" };
    const c = copyProject(p, later, ["Alpha"]);
    expect(c.meta.title).toBe("Alpha (copy)");
    expect(c.meta.id).not.toBe(p.meta.id);
    expect(c.meta.createdBy).toBe(later.name);
    expect(c.meta.createdAt).toBe(later.at);
    // A copy of a fictional demo is still a fictional demo.
    expect(c.meta.demo).toBe(true);
    expect(c.processes).toEqual(p.processes);
    expect(p.changeLog).toHaveLength(0);
    const row = changeLogView(content, c).at(-1)!;
    expect(row.actionLabel).toBe("Project copied");
    expect(row.detail).toBe(`Copied from "Alpha" (${p.meta.id})`);
    expect(row.after).toBe("Alpha (copy)");
  });

  it("does not share objects with the original, and still parses as a project", () => {
    const p = project("Alpha");
    const c = copyProject(p, ACTOR, []);
    c.scope["x"] = { id: "x", ref: "scope.x", status: "tbd" } as never;
    expect(p.scope["x"]).toBeUndefined();
    expect(() => parseProject(JSON.parse(JSON.stringify(copyProject(p, ACTOR, []))))).not.toThrow();
  });
});
