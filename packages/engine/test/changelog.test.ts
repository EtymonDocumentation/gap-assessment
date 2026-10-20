import { describe, expect, it } from "vitest";
import { addSource, attachSource, detachSource, getEntry, removeSource, unverifyEntry, updateSource, verifyEntry, type Actor, type Project } from "@gap/process-model";
import {
  actionLabel,
  addCustomItem,
  addCustomUnitOperation,
  changeLogActionCounts,
  changeLogOptions,
  changeLogToCsv,
  changeLogView,
  confirmSection,
  CHANGE_LOG_COLUMNS,
  renameCustomItem,
  removeCustomItem,
  removeCustomUnitOperation,
  renameCustomUnitOperation,
  setEntrySequence,
  setGapOverlay,
  setResponder,
} from "@gap/engine";
import { ACTOR, DOC_A, OTHER_ACTOR, T1, content, kit } from "./helpers";

const { v, pair, same, na, unk, base, run } = kit;

const VESSEL_S = "source.uo.compounding.equip.vessel.type";
const VESSEL_T = "target.uo.compounding.equip.vessel.type";
const REVIEWER: Actor = { name: "A. Reviewer (fictional)", role: "QA", at: T1 };

const last = (p: Project) => p.changeLog.at(-1)!;
const view = (p: Project, f = {}) => changeLogView(content, p, f);

describe("change log: every mutation leaves an event with before and after", () => {
  it("answers record the value before and after, in plain words", () => {
    let p = base();
    p = v(p, "comp.vessel_type", "source", "stainless_tank", ACTOR);
    p = v(p, "comp.vessel_type", "source", "glass", OTHER_ACTOR);
    const rows = view(p).filter((r) => r.action === "answer" && r.sectionId === "uo.compounding");
    const row = rows[0]!;
    expect(row.by).toBe(OTHER_ACTOR.name);
    expect(row.before).toMatch(/stainless/i);
    expect(row.after).toMatch(/glass/i);
    expect(row.subject).toMatch(/vessel/i);
    expect(row.sectionTitle).toBeTruthy();
  });

  it("first answers have no 'before' and unknown, N/A and same-as-source read as words", () => {
    let p = base();
    p = unk(p, "comp.vessel_type", "source");
    p = na(p, "comp.mixer", "source", "Not used in this fictional line");
    p = v(p, "comp.vessel_type", "target", "glass");
    p = v(p, "comp.vessel_type", "source", "glass");
    p = same(p, "comp.vessel_type");
    const rows = view(p).filter((r) => r.action === "answer");
    const text = rows.map((r) => `${r.before} | ${r.after}`).join("\n");
    expect(text).toMatch(/Unknown/);
    expect(text).toMatch(/Not applicable: Not used in this fictional line/);
    expect(text).toMatch(/same as SU/i);
    const first = view(p).find((r) => r.after.match(/Unknown/))!;
    expect(first.before).toBe("—");
  });

  it("is newest first and numbers are stable positions in the stored log", () => {
    const p = pair(base(), "comp.vessel_type", "stainless_tank", "glass");
    const rows = view(p);
    expect(rows).toHaveLength(p.changeLog.length);
    expect(rows[0]!.no).toBe(p.changeLog.length);
    expect(rows.at(-1)!.no).toBe(1);
    const times = rows.map((r) => r.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("sources: add, edit, attach, detach and remove each log an event with a readable subject", () => {
    let p = base();
    p = v(p, "comp.vessel_type", "source", "stainless_tank", ACTOR);
    const added = addSource(p, { type: "document_reference", docRef: DOC_A }, OTHER_ACTOR);
    p = added.project;
    expect(last(p).action).toBe("add_source");
    p = updateSource(p, added.source.id, { version: "2.0" }, OTHER_ACTOR);
    expect(last(p).action).toBe("update_source");
    p = attachSource(p, VESSEL_S, added.source.id, OTHER_ACTOR);
    expect(last(p).action).toBe("attach_source");
    p = detachSource(p, VESSEL_S, added.source.id, OTHER_ACTOR).project;
    expect(last(p).action).toBe("detach_source");
    p = attachSource(p, VESSEL_S, added.source.id, OTHER_ACTOR);
    p = removeSource(p, added.source.id, OTHER_ACTOR).project;
    const actions = p.changeLog.map((e) => e.action);
    for (const a of ["add_source", "update_source", "attach_source", "detach_source", "remove_source"]) expect(actions).toContain(a);
    const rows = view(p);
    for (const a of ["add_source", "update_source", "attach_source", "detach_source", "remove_source"]) {
      const r = rows.find((x) => x.action === a)!;
      expect(r.subject, a).toBeTruthy();
      expect(r.actionLabel).toBe(actionLabel(a));
    }
    const attach = rows.find((r) => r.action === "attach_source")!;
    expect(attach.after).toMatch(/TEST-DOC-001/);
    expect(attach.before).not.toMatch(/TEST-DOC-001/);
  });

  it("removal cascade: the removed source, the reverted entry and the kept value are all in the log", () => {
    let p = base();
    p = v(p, "comp.vessel_type", "source", "stainless_tank", ACTOR, [DOC_A]);
    const doc = getEntry(p, VESSEL_S)!.sourceIds.find((id) => p.sources.find((s) => s.id === id)!.type === "document_reference")!;
    const interview = getEntry(p, VESSEL_S)!.sourceIds.filter((id) => id !== doc);
    for (const id of interview) p = removeSource(p, id, OTHER_ACTOR).project;
    p = removeSource(p, doc, OTHER_ACTOR).project;
    expect(getEntry(p, VESSEL_S)!.status).toBe("not_established");
    const rows = view(p);
    const reverted = rows.find((r) => r.action === "revert_on_source_removal")!;
    expect(reverted).toBeTruthy();
    expect(reverted.before).toMatch(/stainless/i);
    expect(reverted.after).toMatch(/Not established/i);
    expect(reverted.detail).toMatch(/kept only in this log/i);
    const removed = rows.find((r) => r.action === "remove_source" && /TEST-DOC-001/.test(r.subject))!;
    expect(removed.detail).toMatch(/reverted to Not established/);
  });

  it("verification: verify and unverify log the verifier, the status change and the reason", () => {
    let p = v(base(), "comp.vessel_type", "source", "stainless_tank", ACTOR);
    p = verifyEntry(p, VESSEL_S, REVIEWER);
    expect(last(p)).toMatchObject({ action: "verify", by: REVIEWER.name, path: VESSEL_S });
    p = unverifyEntry(p, VESSEL_S, REVIEWER, "Checked against the wrong batch record");
    expect(last(p).action).toBe("unverify");
    const rows = view(p);
    const un = rows[0]!;
    expect(un.actionLabel).toBe("Verification withdrawn");
    expect(un.detail).toBe("Reason: Checked against the wrong batch record");
    expect(un.before.toLowerCase()).toContain("verified");
    const ver = rows[1]!;
    expect(ver.by).toBe(REVIEWER.name);
    expect(ver.subject).toMatch(/vessel/i);
  });

  it("gap decisions, confirmations, responder and entry order are logged", () => {
    let p = pair(base(), "comp.vessel_type", "stainless_tank", "single_use_bag");
    const gap = run(p).gaps.find((g) => g.sectionId === "uo.compounding")!;
    p = setGapOverlay(p, gap.key, { status: "in_progress", owner: "Pat Example (fictional)", notes: "Fictional note" }, OTHER_ACTOR);
    p = confirmSection(p, "uo.compounding", "source", OTHER_ACTOR);
    p = setResponder(p, { name: "Robin Placeholder (fictional)", role: "QA" }, T1);
    p = setEntrySequence(p, "sequential", OTHER_ACTOR);
    const rows = view(p);
    const g = rows.find((r) => r.action === "gap_update")!;
    expect(g.subject).toMatch(/^Gap: /);
    expect(g.before).toMatch(/Open/);
    expect(g.after).toMatch(/Status: In progress/);
    expect(g.after).toMatch(/Owner: Pat Example/);
    expect(g.sectionId).toBe("uo.compounding");
    const c = rows.find((r) => r.action === "confirm_section")!;
    expect(c.sectionId).toBe("uo.compounding");
    const r = rows.find((x) => x.action === "set_responder")!;
    expect(r.after).toBe("Robin Placeholder (fictional) (QA)");
    expect(r.before).toBe("—");
    const s = rows.find((x) => x.action === "set_entry_sequence")!;
    expect(s.before).toBe("paired");
    expect(s.after).toBe("sequential");
  });

  it("custom definitions are logged with their labels", () => {
    let p = base();
    p = addCustomUnitOperation(p, content, { label: "Fictional hold step" }, ACTOR);
    const key = p.custom.unitOperations[0]!.key;
    p = renameCustomUnitOperation(p, key, "Fictional hold stage", ACTOR);
    p = addCustomItem(p, content, { uo: key, coll: "param", label: "Hold time", dimension: "time" }, ACTOR);
    const item = p.custom.items[0]!;
    p = renameCustomItem(p, { uo: key, coll: "param", key: item.key }, "Hold duration", ACTOR);
    p = removeCustomItem(p, { uo: key, coll: "param", key: item.key }, ACTOR);
    p = removeCustomUnitOperation(p, key, ACTOR);
    const actions = p.changeLog.map((e) => e.action).filter((a) => a.startsWith("custom_"));
    expect(actions).toEqual(["custom_uo_add", "custom_uo_rename", "custom_item_add", "custom_item_rename", "custom_item_remove", "custom_uo_remove"]);
    const rows = view(p).reverse();
    const rename = rows.find((r) => r.action === "custom_uo_rename")!;
    expect(rename.before).toBe("Fictional hold step");
    expect(rename.after).toBe("Fictional hold stage");
    expect(rows.find((r) => r.action === "custom_item_rename")!.after).toBe("Hold duration");
  });

  it("no event is dropped: every stored event becomes exactly one row", () => {
    let p = pair(base(), "comp.vessel_type", "stainless_tank", "glass");
    p = verifyEntry(p, VESSEL_T, REVIEWER);
    p = setResponder(p, { name: "Robin Placeholder (fictional)" }, T1);
    expect(view(p).map((r) => r.no).sort((a, b) => a - b)).toEqual(p.changeLog.map((_, i) => i + 1));
    expect(changeLogToCsv(content, p).trim().split("\r\n")).toHaveLength(p.changeLog.length + 1);
  });
});

describe("change log: filters and options", () => {
  const scenario = () => {
    let p = pair(base(), "comp.vessel_type", "stainless_tank", "glass");
    p = verifyEntry(p, VESSEL_S, REVIEWER);
    p = unverifyEntry(p, VESSEL_S, REVIEWER, "Re-check needed");
    return p;
  };

  it("filters by actor, ignoring case and surrounding spaces", () => {
    const p = scenario();
    const rows = view(p, { actor: "  a. reviewer (FICTIONAL) " });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.by === REVIEWER.name)).toBe(true);
  });

  it("filters by action, by section and by text", () => {
    const p = scenario();
    expect(view(p, { action: "verify" })).toHaveLength(1);
    expect(view(p, { action: "unverify" })[0]!.detail).toMatch(/Re-check/);
    const sec = view(p, { section: "uo.compounding" });
    expect(sec.length).toBeGreaterThan(0);
    expect(sec.every((r) => r.sectionId === "uo.compounding")).toBe(true);
    expect(view(p, { text: "RE-CHECK" })).toHaveLength(1);
    expect(view(p, { text: "no such thing anywhere" })).toHaveLength(0);
  });

  it("combines filters with AND", () => {
    const p = scenario();
    expect(view(p, { actor: REVIEWER.name, action: "verify" })).toHaveLength(1);
    expect(view(p, { actor: ACTOR.name, action: "verify" })).toHaveLength(0);
  });

  it("offers only the actors, actions and sections that occur", () => {
    const p = scenario();
    const o = changeLogOptions(content, p);
    expect(o.actors).toEqual([ACTOR.name, REVIEWER.name].sort((a, b) => a.localeCompare(b)));
    expect(o.actions.map((a) => a.value)).toContain("unverify");
    expect(o.actions.map((a) => a.value)).not.toContain("remove_source");
    expect(o.sections.map((s) => s.id)).toContain("uo.compounding");
  });

  it("counts events per action, most frequent first", () => {
    const counts = changeLogActionCounts(scenario());
    expect(counts[0]!.action).toBe("answer");
    expect(counts.find((c) => c.action === "verify")).toMatchObject({ count: 1, label: "Verified" });
    for (let i = 1; i < counts.length; i++) expect(counts[i - 1]!.count).toBeGreaterThanOrEqual(counts[i]!.count);
  });

  it("falls back to a readable label for an unknown action", () => {
    expect(actionLabel("some_new_thing")).toBe("Some new thing");
  });
});

describe("change log CSV", () => {
  it("has the documented header and chronological order", () => {
    const p = scenario2();
    const lines = changeLogToCsv(content, p).trim().split("\r\n");
    expect(lines[0]).toBe(CHANGE_LOG_COLUMNS.map((c) => `"${c}"`).join(","));
    expect(lines[1]!.startsWith('"1"')).toBe(true);
  });

  it("neutralises spreadsheet formulas typed into labels and notes", () => {
    let p = base();
    p = addSource(p, { type: "user_entry", label: "=HYPERLINK(\"http://example.invalid\",\"x\")" }, { ...ACTOR, name: "+SUM(A1)" }).project;
    p = setResponder(p, { name: "@cmd" }, T1);
    const csv = changeLogToCsv(content, p);
    expect(csv).toContain(`"'=HYPERLINK(""http://example.invalid"",""x"")"`);
    expect(csv).toContain(`"'+SUM(A1)"`);
    expect(csv).toContain(`"'@cmd"`);
    for (const line of csv.trim().split("\r\n").slice(1)) {
      for (const m of line.matchAll(/(?:^|,)"([^"]|"")*"/g)) {
        const inner = m[0].replace(/^,/, "").slice(1, -1);
        expect(inner, line).not.toMatch(/^[=+@\t\r]/);
      }
    }
  });

  it("applies the filter to the export", () => {
    const p = scenario2();
    const all = changeLogToCsv(content, p).trim().split("\r\n").length;
    const some = changeLogToCsv(content, p, { action: "verify" }).trim().split("\r\n").length;
    expect(some).toBeLessThan(all);
    expect(some).toBe(2);
  });

  it("quotes commas, quotes and line breaks inside cells", () => {
    let p = base();
    p = addSource(p, { type: "user_entry", label: 'Note, with "quotes"' }, ACTOR).project;
    expect(changeLogToCsv(content, p)).toContain('"Note, with ""quotes"""');
  });
});

function scenario2(): Project {
  let p = v(base(), "comp.vessel_type", "source", "stainless_tank", ACTOR);
  p = verifyEntry(p, VESSEL_S, REVIEWER);
  return p;
}
