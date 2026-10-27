import { describe, expect, it } from "vitest";
import { emptyProject, MBR_CHOICE_LABEL, mbrRecordSchema, parseProject, type Actor } from "../src/index";

// Schema 1.19.0: the optional `mbr` part (master batch records). Old projects load unchanged and gain an empty list, nothing else.
const T0 = "2026-10-01T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: T0 };
const refs = { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" };

describe("migration to 1.19.0: batch records", () => {
  it("loads a 1.17.0 project without the mbr part, adds an empty list and changes nothing else", () => {
    const old = JSON.parse(JSON.stringify(emptyProject({ title: "Old project (fictional)", actor: ACTOR, contentRefs: refs }))) as Record<string, any>;
    delete old.mbr;
    old.schemaVersion = "1.17.0";
    const before = old.changeLog.length;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.24.0");
    expect(p.mbr).toEqual({ records: [] });
    expect(p.meta.title).toBe("Old project (fictional)");
    expect(p.changeLog.length).toBe(before);
  });

  it("a new project starts with no batch record", () => {
    expect(emptyProject({ title: "New (fictional)", actor: ACTOR, contentRefs: refs }).mbr.records).toEqual([]);
  });

  it("reads the unset choice as 'not decided' and never carries a default choice", () => {
    expect(MBR_CHOICE_LABEL.not_decided).toBe("Not decided");
    const rec = mbrRecordSchema.parse({
      id: "MBR-001",
      title: "Record (fictional)",
      status: "draft",
      sections: [{ id: "SC-01", title: "S", blocks: [{ id: "BL-001", title: "B", steps: [], params: [{ id: "R-0001", label: "Row" }], samples: [], timeLimits: [], cmoFields: [] }] }],
      createdAt: T0,
      updatedAt: T0,
    });
    expect(rec.sections[0]!.blocks[0]!.params[0]!.choice).toBeUndefined();
  });

  it("refuses an id used twice inside a record", () => {
    const step = { id: "ST-0001", text: "x" };
    const bad = { id: "MBR-001", title: "R", status: "draft", sections: [{ id: "SC-01", title: "S", blocks: [{ id: "BL-001", title: "B", steps: [step, step], params: [], samples: [], timeLimits: [], cmoFields: [] }] }], createdAt: T0, updatedAt: T0 };
    expect(mbrRecordSchema.safeParse(bad).success).toBe(false);
  });
});
