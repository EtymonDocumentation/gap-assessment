// M14 job 1: schema 1.34.0 (the optional facility areas of the interview maps), the 1.32.0 migration and the rules the schema enforces.
// Fictional data only.
import { describe, expect, it } from "vitest";
import {
  FACILITY_GRADES,
  FACILITY_GRADE_LABEL,
  SCHEMA_VERSION,
  emptyProject,
  facilityAreas,
  facilityStateSchema,
  facilityUnitOf,
  facilityUnitOfSide,
  parseProject,
  type Actor,
  type FacilityArea,
  type Project,
} from "@gap/process-model";
import { content as realContent } from "../../../content/index";

const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: "2026-11-10T09:00:00.000Z" };
const empty = (): Project => emptyProject({ title: "Facility schema test (fictional)", actor: ACTOR, contentRefs: realContent.versions });
const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const area = (id: string, over: Partial<FacilityArea> = {}): FacilityArea => ({ id, name: `Room ${id} (fictional)`, stepKeys: [], createdAt: ACTOR.at, updatedAt: ACTOR.at, ...over });
const refuses = (f: unknown, message: RegExp) => {
  const r = facilityStateSchema.safeParse(f);
  expect(r.success).toBe(false);
  expect(r.error!.issues.map((i) => i.message).join(" | ")).toMatch(message);
};

describe("schema 1.34.0 (the facility part)", () => {
  it("is schema 1.34.0, and a new project has no facility part and so no areas", () => {
    expect(SCHEMA_VERSION).toBe("1.34.0");
    const p = empty();
    expect(p.facility).toBeUndefined();
    expect(facilityAreas(p, "su")).toEqual([]);
    expect(facilityAreas(p, "ru")).toEqual([]);
  });

  it("migrates a 1.32.0 project by moving only the version; nothing is filled in, and twice gives the same", () => {
    const p = empty();
    const raw = json(p);
    raw.schemaVersion = "1.32.0";
    const once = parseProject(raw);
    expect(once.schemaVersion).toBe("1.34.0");
    expect(once.facility).toBeUndefined();
    expect({ ...once, schemaVersion: "" }).toEqual({ ...p, schemaVersion: "" });
    expect(parseProject(json(once))).toEqual(once);
    expect(raw.schemaVersion).toBe("1.32.0"); // the file it was given is not changed
  });

  it("runs an older project through every minor on the way (1.31.0 to the current version)", () => {
    const raw = json(empty());
    raw.schemaVersion = "1.31.0";
    expect(parseProject(raw).schemaVersion).toBe("1.34.0");
  });

  it("keeps the areas of both units through a round trip, in the order they were listed", () => {
    const raw = json(empty());
    raw.facility = {
      su: { areas: [area("AR-01", { grade: "B", stepKeys: ["sterile_filtration"] })] },
      ru: { areas: [area("AR-02", { grade: "D" }), area("AR-03", { insideAreaId: "AR-02", fromExample: true, note: "An isolator" })] },
    };
    const p = parseProject(raw);
    expect(facilityAreas(p, "ru").map((a) => a.id)).toEqual(["AR-02", "AR-03"]);
    expect(facilityUnitOf(p, "AR-01")).toBe("su");
    expect(facilityUnitOf(p, "AR-03")).toBe("ru");
    expect(facilityUnitOf(p, "AR-99")).toBeUndefined();
    expect(parseProject(json(p))).toEqual(p);
  });

  it("states a grade only when the person chose one: absent means not stated, and the word Grade is part of every label", () => {
    expect(area("AR-01").grade).toBeUndefined();
    expect([...FACILITY_GRADES]).toEqual(["A", "B", "C", "D", "none", "other"]);
    expect(FACILITY_GRADE_LABEL.B).toBe("Grade B");
    expect(FACILITY_GRADE_LABEL.none).toBe("Not classified");
  });

  it("maps the gap assessment's sides to the units", () => {
    expect(facilityUnitOfSide("source")).toBe("su");
    expect(facilityUnitOfSide("target")).toBe("ru");
  });

  it("refuses a cycle, an area inside itself, a parent from the other unit, an id used twice and a step twice in one area", () => {
    refuses({ ru: { areas: [area("AR-01", { insideAreaId: "AR-02" }), area("AR-02", { insideAreaId: "AR-01" })] } }, /inside/);
    refuses({ ru: { areas: [area("AR-01", { insideAreaId: "AR-01" })] } }, /inside itself/);
    refuses({ su: { areas: [area("AR-01")] }, ru: { areas: [area("AR-02", { insideAreaId: "AR-01" })] } }, /not in the same unit/);
    refuses({ su: { areas: [area("AR-01")] }, ru: { areas: [area("AR-01")] } }, /used twice/);
    refuses({ ru: { areas: [area("AR-01", { stepKeys: ["compounding", "compounding"] })] } }, /same step twice/);
  });

  it("accepts a step in several areas of one unit, and an area without a name is refused", () => {
    const r = facilityStateSchema.safeParse({ ru: { areas: [area("AR-01", { stepKeys: ["ds_receipt_thaw"] }), area("AR-02", { stepKeys: ["ds_receipt_thaw"] })] } });
    expect(r.success).toBe(true);
    refuses({ ru: { areas: [area("AR-01", { name: "  " })] } }, /.+/);
  });
});
