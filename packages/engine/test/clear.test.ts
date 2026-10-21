import { describe, expect, it } from "vitest";
import { changeLogView, clearInstances, clearableRefs, visibleInstances, type QuestionInstance } from "@gap/engine";
import { getEntry, verificationState, verifyEntry, type Actor, type Project } from "@gap/process-model";
import { ACTOR, OTHER_ACTOR, T1, content, kit, q, rng } from "./helpers";

const { v, base, inst } = kit;

const VESSEL_S = "source.uo.compounding.equip.vessel.type";
const VESSEL_T = "target.uo.compounding.equip.vessel.type";
const REVIEWER: Actor = { name: "A. Reviewer (fictional)", role: "QA", at: T1 };

function scenario(): Project {
  let p = base();
  p = v(p, "comp.vessel_type", "source", "stainless_tank");
  p = v(p, "comp.vessel_type", "target", "single_use_bag");
  return p;
}

describe("clearInstances: clearing answers on purpose", () => {
  it("clears one side only: that entry reverts, the other side and the source records stay", () => {
    const p = scenario();
    const sourcesBefore = p.sources.length;
    const { project, cleared } = clearInstances(p, [inst("comp.vessel_type", "target")], OTHER_ACTOR);
    expect(cleared).toBe(1);
    const e = getEntry(project, VESSEL_T)!;
    expect(e.status).toBe("not_established");
    expect(e.sourceIds).toEqual([]);
    expect("value" in e).toBe(false);
    expect(e.revision).toBe(getEntry(p, VESSEL_T)!.revision + 1);
    expect(getEntry(project, VESSEL_S)).toMatchObject({ status: "established", value: "stainless_tank" });
    // The interview-answer source is not deleted; it is simply not cited any more.
    expect(project.sources).toHaveLength(sourcesBefore);
    expect(JSON.stringify(project.processes)).not.toContain("single_use_bag");
  });

  it("logs one answer_cleared event per entry with the old value, who and when", () => {
    const p = scenario();
    const { project } = clearInstances(p, [inst("comp.vessel_type", "target")], OTHER_ACTOR);
    const log = project.changeLog.slice(p.changeLog.length);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: "answer_cleared",
      path: VESSEL_T,
      by: OTHER_ACTOR.name,
      at: OTHER_ACTOR.at,
      before: { status: "established", value: "single_use_bag" },
      after: { status: "not_established" },
    });
    expect(log[0]!.detail).toMatch(/Answer cleared/);
  });

  it("shows in the change log view with the old value and a note that it is kept only there", () => {
    const { project } = clearInstances(scenario(), [inst("comp.vessel_type", "target")], OTHER_ACTOR);
    const row = changeLogView(content, project, {}).find((r) => r.action === "answer_cleared")!;
    expect(row.actionLabel).toBe("Answer cleared");
    expect(row.before).toMatch(/single/i);
    expect(row.after).toMatch(/Not established/i);
    expect(row.detail).toMatch(/kept only in this log/i);
  });

  it("clears both sides of a paired question in one call", () => {
    const p = scenario();
    const { project, cleared } = clearInstances(p, [inst("comp.vessel_type", "source"), inst("comp.vessel_type", "target")], OTHER_ACTOR);
    expect(cleared).toBe(2);
    expect(getEntry(project, VESSEL_S)!.status).toBe("not_established");
    expect(getEntry(project, VESSEL_T)!.status).toBe("not_established");
    expect(project.changeLog.slice(p.changeLog.length).map((c) => c.action)).toEqual(["answer_cleared", "answer_cleared"]);
  });

  it("clears unknown and not-applicable answers too (anything that is not Not established)", () => {
    let p = kit.unk(base(), "comp.vessel_type", "source");
    p = kit.na(p, "comp.vessel_type", "target", "Not used (fictional)");
    const { project, cleared } = clearInstances(p, [inst("comp.vessel_type", "source"), inst("comp.vessel_type", "target")], ACTOR);
    expect(cleared).toBe(2);
    expect(getEntry(project, VESSEL_T)).not.toHaveProperty("justification");
    expect(project.changeLog.at(-1)).toMatchObject({ before: { status: "not_applicable", justification: "Not used (fictional)" } });
  });

  it("clears every bound entry of a parameter question, one log entry each", () => {
    const p = kit.par(base(), "comp.mixing_speed", "source", {
      classification: "KPP",
      setPoint: q(150, "rpm"),
      nor: "tbd",
      par: rng(100, 200, "rpm"),
      rangeBasis: "characterization",
    });
    const refs = clearableRefs(p, [inst("comp.mixing_speed", "source")]);
    expect(refs).toHaveLength(5);
    const { project, cleared } = clearInstances(p, [inst("comp.mixing_speed", "source")], OTHER_ACTOR);
    expect(cleared).toBe(5);
    for (const r of refs) expect(getEntry(project, r)!.status).toBe("not_established");
    expect(project.changeLog.filter((c) => c.action === "answer_cleared")).toHaveLength(5);
  });

  it("withdraws verification: the verified value is gone, so the fingerprint no longer matches", () => {
    const p = verifyEntry(scenario(), VESSEL_S, REVIEWER);
    expect(verificationState(p, VESSEL_S).state).toBe("verified");
    const { project } = clearInstances(p, [inst("comp.vessel_type", "source")], OTHER_ACTOR);
    expect(verificationState(project, VESSEL_S).state).toBe("withdrawn");
  });

  it("clearing an already empty entry is a no-op: same project object, no log entry", () => {
    const p = scenario();
    const { project, cleared } = clearInstances(p, [inst("comp.mixer", "source")], OTHER_ACTOR);
    expect(cleared).toBe(0);
    expect(project).toBe(p);
    const again = clearInstances(clearInstances(p, [inst("comp.vessel_type", "target")], ACTOR).project, [inst("comp.vessel_type", "target")], ACTOR);
    expect(again.cleared).toBe(0);
    expect(again.project.changeLog.filter((c) => c.action === "answer_cleared")).toHaveLength(1);
  });

  it("does not change the input project", () => {
    const p = scenario();
    const snapshot = JSON.stringify(p);
    clearInstances(p, [inst("comp.vessel_type", "target")], OTHER_ACTOR);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("a section clear empties every answered entry of that section on both sides and nothing else", () => {
    const p = scenario();
    const vis = visibleInstances(content, p, "paired");
    const sec = vis.filter((i) => i.section.id === "uo.compounding");
    const before = clearableRefs(p, sec);
    expect(before).toContain(VESSEL_S);
    expect(before).toContain(VESSEL_T);
    const { project, cleared } = clearInstances(p, sec, OTHER_ACTOR);
    expect(cleared).toBe(before.length);
    expect(clearableRefs(project, sec)).toEqual([]);
    // Another section keeps its answers.
    expect(getEntry(project, "source.uo.sterile_filtration.presence")?.status).toBe("established");
    expect(project.changeLog.slice(p.changeLog.length).every((c) => c.action === "answer_cleared")).toBe(true);
  });
});

describe("clearing a scoping answer that hides questions", () => {
  it("keeps the values of the questions it hides (they become inactive, like any hide)", () => {
    let p = base({ dilution: "yes" });
    p = kit.both(p, "buf.presence", "yes");
    p = v(p, "buf.route", "source", "prepared_on_site");
    const route = "source.uo.buffer_prep.mat.buffer.supplyRoute";
    expect(getEntry(p, route)?.status).toBe("established");
    expect(visibleInstances(content, p, "paired").some((i) => i.question.id === "buf.route")).toBe(true);

    const shared = [inst("scope.dilution", "shared")] as QuestionInstance[];
    const { project, cleared } = clearInstances(p, shared, OTHER_ACTOR);
    expect(cleared).toBe(1);
    expect(getEntry(project, "scope.dilution")!.status).toBe("not_established");
    // Hidden now (an unanswered scoping condition does not show the section) but not deleted.
    expect(getEntry(project, route)).toMatchObject({ status: "established", value: "prepared_on_site" });
    expect(project.changeLog.filter((c) => c.action === "answer_cleared").map((c) => c.path)).toEqual(["scope.dilution"]);
  });

  it("a section clear only touches visible questions, so a hidden section keeps its values", () => {
    let p = base({ dilution: "yes" });
    p = kit.both(p, "buf.presence", "yes");
    p = v(p, "buf.route", "source", "prepared_on_site");
    const route = "source.uo.buffer_prep.mat.buffer.supplyRoute";
    // Hide the section, then clear it: the visible list does not contain it.
    p = v(p, "scope.dilution", "shared", "no");
    const vis = visibleInstances(content, p, "paired");
    expect(vis.some((i) => i.section.id === "uo.buffer_prep")).toBe(false);
    const { project, cleared } = clearInstances(p, vis.filter((i) => i.section.id === "uo.buffer_prep"), OTHER_ACTOR);
    expect(cleared).toBe(0);
    expect(getEntry(project, route)).toMatchObject({ status: "established" });
  });
});
