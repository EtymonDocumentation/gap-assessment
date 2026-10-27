import { describe, expect, it } from "vitest";
import { emptyProject, MEMO_LINES, MEMO_LINE_LABEL, parseProject, planPartySchema, SAMPLING_PLAN_FORMAT_VERSION, SCHEMA_VERSION, samplingPlanSchema, type Actor } from "../src/index";

// Schema 1.16.0 (now 1.19.0) / sampling plan format 1.3.0: a plan party may carry a department and a memo line. Both are optional, never defaulted.
const T0 = "2026-10-01T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: T0 };

const plan = (parties: unknown[]) => ({
  id: "SPL-001",
  title: "Plan (fictional)",
  runType: "ppq",
  status: "draft",
  steps: [],
  batches: [],
  batchRationale: "",
  parties,
  agencyRequests: [],
  points: [],
  subsections: [],
  createdAt: T0,
  updatedAt: T0,
});

describe("plan parties with a department and a memo line", () => {
  it("is schema 1.23.0 and plan format 1.5.0 (a later minor of the memo-party shapes)", () => {
    expect(SCHEMA_VERSION).toBe("1.23.0");
    expect(SAMPLING_PLAN_FORMAT_VERSION).toBe("1.5.0");
  });

  it("accepts a party with neither field, with one, or with both", () => {
    expect(planPartySchema.parse({ party: "cmo", name: "Site South (fictional)" })).toEqual({ party: "cmo", name: "Site South (fictional)" });
    expect(planPartySchema.parse({ party: "sponsor", name: "Pat", department: "Process Validation (fictional)" }).department).toBe("Process Validation (fictional)");
    expect(planPartySchema.parse({ party: "sponsor", name: "Pat", memoLine: "cc" }).memoLine).toBe("cc");
    expect(planPartySchema.parse({ party: "other", name: "Pat", department: "QA (fictional)", memoLine: "from" })).toMatchObject({ department: "QA (fictional)", memoLine: "from" });
  });

  it("offers From, To and Cc and refuses any other memo line; no default is added", () => {
    expect(MEMO_LINES).toEqual(["from", "to", "cc"]);
    expect(MEMO_LINE_LABEL).toEqual({ from: "From", to: "To", cc: "Cc" });
    expect(planPartySchema.safeParse({ party: "cmo", name: "X", memoLine: "bcc" }).success).toBe(false);
    expect("memoLine" in planPartySchema.parse({ party: "cmo", name: "X" })).toBe(false);
    expect("department" in planPartySchema.parse({ party: "cmo", name: "X" })).toBe(false);
  });

  it("keeps the fields when a plan is parsed", () => {
    const p = samplingPlanSchema.parse(plan([{ party: "cmo", name: "Site South (fictional)", role: "Takes samples", department: "Manufacturing (fictional)", memoLine: "to" }]));
    expect(p.parties[0]).toEqual({ party: "cmo", name: "Site South (fictional)", role: "Takes samples", department: "Manufacturing (fictional)", memoLine: "to" });
  });

  it("migrates a 1.15.0 project unchanged: the parties keep exactly what they had and gain nothing", () => {
    const old = JSON.parse(JSON.stringify(emptyProject({ title: "Old project (fictional)", actor: ACTOR, contentRefs: { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" } }))) as Record<string, any>;
    old.schemaVersion = "1.15.0";
    const parties = [
      { party: "cmo", name: "Site South (fictional)", role: "Takes samples" },
      { party: "contract_lab", name: "Example Test Laboratory (fictional)" },
    ];
    old.sampling = { plans: [plan(parties)] };
    const before = old.changeLog.length;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.23.0");
    expect(p.sampling.plans[0]!.parties).toEqual(parties);
    expect(p.changeLog.length).toBe(before);
  });
});
