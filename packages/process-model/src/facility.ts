import { z } from "zod";
import type { Project } from "./types";

/*
 * Facility areas (schema 1.33.0, M14). OPTIONAL and used only to navigate an interview by room: the rooms of each unit, the grade the user
 * states for each, and the process steps done in each. Nothing here is a default: a project starts with no areas, a grade is only what the
 * user chose, and an example layout is copied in only when the user presses the button. The areas write nothing into any other document.
 */

/** The two units. The same keys as the project's `su` / `ru` wording; the gap assessment stores them as source / target. */
export const FACILITY_UNITS = ["su", "ru"] as const;
export type FacilityUnit = (typeof FACILITY_UNITS)[number];
export const FACILITY_UNIT_LABEL: Readonly<Record<FacilityUnit, string>> = { su: "Sending unit", ru: "Receiving unit" };

/** Grades the user can state. Absent = "Not stated". The word "Grade" is always printed next to the letter, so a grade never rests on colour. */
export const FACILITY_GRADES = ["A", "B", "C", "D", "none", "other"] as const;
export type FacilityGrade = (typeof FACILITY_GRADES)[number];
export const FACILITY_GRADE_LABEL: Readonly<Record<FacilityGrade, string>> = {
  A: "Grade A",
  B: "Grade B",
  C: "Grade C",
  D: "Grade D",
  none: "Not classified",
  other: "Another grade",
};

export interface FacilityArea {
  /** AR-01, AR-02 ... Never reused, and unique across both units. */
  id: string;
  /** The user's own words. */
  name: string;
  grade?: FacilityGrade;
  /** The area this one sits inside (an isolator in a filling room). Same unit only. */
  insideAreaId?: string;
  /** Catalog or custom unit-operation keys. A step may be in SEVERAL areas (rooms are often interchangeable for a step). */
  stepKeys: string[];
  /** Copied from the example layout and not yet edited or confirmed by the user. */
  fromExample?: true;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityUnitAreas {
  areas: FacilityArea[];
}

export interface FacilityState {
  su?: FacilityUnitAreas;
  ru?: FacilityUnitAreas;
}

export const facilityAreaSchema = z.object({
  id: z.string().regex(/^AR-\d+$/),
  name: z.string().trim().min(1),
  grade: z.enum(FACILITY_GRADES).optional(),
  insideAreaId: z.string().regex(/^AR-\d+$/).optional(),
  stepKeys: z.array(z.string().min(1)),
  fromExample: z.literal(true).optional(),
  note: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const unitAreas = z.object({ areas: z.array(facilityAreaSchema) });

export const facilityStateSchema = z.object({ su: unitAreas.optional(), ru: unitAreas.optional() }).superRefine((f, ctx) => {
  const seen = new Set<string>();
  for (const unit of FACILITY_UNITS) {
    const areas = f[unit]?.areas ?? [];
    const ids = new Set(areas.map((a) => a.id));
    const parent = new Map(areas.map((a) => [a.id, a.insideAreaId] as const));
    for (const a of areas) {
      if (seen.has(a.id)) ctx.addIssue({ code: "custom", message: `Area id ${a.id} is used twice` });
      seen.add(a.id);
      if (new Set(a.stepKeys).size !== a.stepKeys.length) ctx.addIssue({ code: "custom", message: `${a.id} lists the same step twice` });
      if (a.insideAreaId !== undefined && !ids.has(a.insideAreaId)) ctx.addIssue({ code: "custom", message: `${a.id} sits inside ${a.insideAreaId}, which is not in the same unit` });
      // Walk up: a chain that comes back to this area (or to itself) is a cycle.
      let at = a.insideAreaId;
      for (let n = 0; at !== undefined && n <= areas.length; n++) {
        if (at === a.id) {
          ctx.addIssue({ code: "custom", message: `${a.id} sits inside itself` });
          break;
        }
        at = parent.get(at);
      }
    }
  }
});

/** The areas of one unit, in the order the user listed them. A project from before 1.33.0 has none. */
export function facilityAreas(project: Pick<Project, "facility">, unit: FacilityUnit): FacilityArea[] {
  return project.facility?.[unit]?.areas ?? [];
}

/** The unit an area belongs to, or undefined when no area has this id. */
export function facilityUnitOf(project: Pick<Project, "facility">, areaId: string): FacilityUnit | undefined {
  return FACILITY_UNITS.find((u) => facilityAreas(project, u).some((a) => a.id === areaId));
}

/** The gap assessment stores the sending unit as `source` and the receiving unit as `target`. */
export const facilityUnitOfSide = (side: "source" | "target"): FacilityUnit => (side === "source" ? "su" : "ru");
