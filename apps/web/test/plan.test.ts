import { describe, expect, it } from "vitest";
import { moduleLabel, modulesText, planLine, planText } from "../src/server/plan";

const plan = (over: Partial<{ id: string; status: string; modules: string[] }> = {}) => ({
  plan: { id: "trial-free", status: "active", since: "2026-01-01T00:00:00.000Z", modules: ["gap"], ...over },
});

describe("account plan text (server mode header)", () => {
  it("names the trial plan and the gap module in plain words", () => {
    expect(planText(plan())).toBe("Trial (free)");
    expect(moduleLabel("gap")).toBe("Gap assessment");
    expect(planLine(plan())).toBe("Plan: Trial (free) · Modules: Gap assessment");
  });

  it("lists several modules, and shows an unknown module or plan id as it is", () => {
    expect(modulesText(["gap", "reports"])).toBe("Gap assessment, reports");
    expect(planLine(plan({ id: "pro-monthly", modules: ["reports"] }))).toBe("Plan: pro-monthly · Modules: reports");
  });

  it("says when the plan is not active, and when there is no module", () => {
    expect(planText(plan({ status: "past-due" }))).toBe("Trial (free), past-due");
    expect(modulesText([])).toBe("none");
    expect(modulesText(undefined)).toBe("none");
  });
});
