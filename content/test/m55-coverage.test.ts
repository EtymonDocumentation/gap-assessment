// Milestone 5.5: process coverage (drug substance shipping to the fill site, bulk packaging, shipping from the fill
// site), labelling location per side, and tailoring (topics switched off with a reason). All data are fictional.
import {
  assess,
  buildDemoProject,
  buildDocument,
  buildValidationPlan,
  changeLogView,
  excludeTopic,
  includeTopic,
  inactiveEntries,
  isTopicExcluded,
  labellingScopeText,
  scopeExclusions,
  TailoringError,
  topicsOfUo,
  visibleInstances,
  type DocModel,
} from "@gap/engine";
import { parseProject, type Actor, type Project } from "@gap/process-model";
import { renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { kit } from "../../packages/engine/test/helpers";
import { content, demos } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-04T09:00:00.000Z" };
const GENERATED = "2026-10-05T00:00:00.000Z";
const raw = demos["arx-217"] as { answers: { q: string; side: string; value?: unknown }[] };

const demo = buildDemoProject(content, demos["arx-217"]);
const ids = (p: Project) => new Set(visibleInstances(content, p, "paired").map((i) => i.question.id));
const docOf = (p: Project): DocModel => buildDocument(content, p, assess(content, p), GENERATED);
const scope = (d: DocModel) => d.sections.find((s) => s.id === "scope")!;
const scopeText = (d: DocModel) => renderMarkdown({ ...d, sections: [scope(d)] });

function withLocation(source: string, target: string): Project {
  const answers = raw.answers.map((x) =>
    x.q === "site.labelling_location" ? { ...x, value: x.side === "source" ? source : target } : x,
  );
  return buildDemoProject(content, { ...raw, answers });
}

describe("new unit operations", () => {
  const order = content.catalog.unitOperations.map((u) => u.key);

  it("sit in process order: shipping to the fill site, receipt, ..., inspection, bulk packaging, labelling, shipping away", () => {
    const at = (k: string) => order.indexOf(k);
    expect(at("ds_shipping_inbound")).toBeGreaterThanOrEqual(0);
    expect(at("ds_shipping_inbound")).toBe(at("ds_receipt_thaw") - 1);
    expect(at("bulk_packaging")).toBe(at("visual_inspection") + 1);
    expect(at("labeling_packaging")).toBe(at("bulk_packaging") + 1);
    expect(at("storage_shipping")).toBeGreaterThan(at("labeling_packaging"));
  });

  it("have no scoping switch: their presence questions are asked on every project", () => {
    const empty = new Set(ids(parseProject(JSON.parse(JSON.stringify(demo)))));
    expect(empty.has("dsi.presence")).toBe(true);
    expect(empty.has("bp.presence")).toBe(true);
  });

  it("keep transport of the packed bulk in storage_shipping, not in bulk packaging", () => {
    const bp = content.questions.filter((q) => q.section === "uo.bulk_packaging").map((q) => q.binds);
    expect(bp.some((b) => /shipper|shipping_lane|transit/.test(b))).toBe(false);
    const ss = content.questions.filter((q) => q.section === "uo.storage_shipping").map((q) => q.binds);
    expect(ss).toContain("uo.storage_shipping.mat.shipped_product.form");
    expect(ss).toContain("uo.storage_shipping.doc.shipping_lane.destination");
  });

  it("keep the three generic fallback rules last", () => {
    expect(content.rules.slice(-3).map((r) => r.id)).toEqual(["R-GEN-EQUIP-PRINCIPLE", "R-GEN-MAT-PRESENCE", "R-GEN-IPC-DESCRIPTION"]);
  });

  it("give every non-equivalent outcome of the new rules at least one activity", () => {
    const a = assess(content, demo);
    const mine = a.gaps.filter((g) => g.uoKey === "ds_shipping_inbound" || g.uoKey === "bulk_packaging");
    expect(mine.length).toBeGreaterThan(5);
    for (const g of mine.filter((g) => g.category !== "equivalent")) expect(g.activities.length, g.key).toBeGreaterThan(0);
  });

  it("make the demo project fully answered, with all eight categories still present", () => {
    expect(assess(content, demo).openItems.filter((o) => o.status === "not_established")).toEqual([]);
    expect(new Set(assess(content, demo).gaps.map((g) => g.category)).size).toBe(8);
  });
});

describe("labelling location per side", () => {
  it("this site on both sides keeps the labelling section and says so in the scope", () => {
    expect(ids(demo).has("lp.presence")).toBe(true);
    expect(labellingScopeText(content, demo, "source")).toMatch(/done at this site/);
  });

  it("another site hides the labelling questions for that side only, and the scope states where it happens", () => {
    const p = withLocation("this_site", "another_site");
    const list = visibleInstances(content, p, "paired");
    const lp = list.filter((i) => i.question.section === "uo.labeling_packaging");
    expect(lp.length).toBeGreaterThan(0);
    expect(lp.every((i) => i.side === "source")).toBe(true);
    expect(list.some((i) => i.question.id === "site.labelling_site" && i.side === "target")).toBe(true);
    expect(labellingScopeText(content, p, "target")).toMatch(/out of scope/);
    expect(scopeText(docOf(p))).toMatch(/Labelling and secondary packaging/);
    expect(scopeText(docOf(p))).toMatch(/another site/);
  });

  it("another site on both sides removes the section entirely and no labelling gap remains", () => {
    const p = withLocation("another_site", "another_site");
    expect(visibleInstances(content, p, "paired").some((i) => i.question.section === "uo.labeling_packaging")).toBe(false);
    expect(assess(content, p).gaps.some((g) => g.uoKey === "labeling_packaging")).toBe(false);
  });

  it("an unanswered location keeps the questions visible and is an open item (nothing is silently dropped)", () => {
    const answers = raw.answers.filter((x) => x.q !== "site.labelling_location");
    const p = buildDemoProject(content, { ...raw, answers });
    expect(ids(p).has("lp.presence")).toBe(true);
    expect(labellingScopeText(content, p, "source")).toMatch(/not established/);
    expect(assess(content, p).openItems.some((o) => o.questionId === "site.labelling_location")).toBe(true);
  });

  it("TBD is the one not-known answer for the location: still an open item, section still visible", () => {
    const p = kit.ask(kit.newProject(), "site.labelling_location", "target", { kind: "tbd" });
    expect(assess(content, p).openItems.some((o) => o.questionId === "site.labelling_location" && o.status === "tbd")).toBe(true);
    expect(visibleInstances(content, p, "paired").some((i) => i.question.id === "lp.presence" && i.side === "target")).toBe(true);
    expect(labellingScopeText(content, p, "target")).toMatch(/not established/);
  });
});

describe("tailoring", () => {
  const UO = "bulk_packaging";

  it("derives topics from the catalog, and the default is every topic included", () => {
    expect(topicsOfUo(content, UO).map((t) => t.key)).toEqual(["pack", "hold", "checks", "procedures"]);
    expect(demo.tailoring.excluded).toEqual([]);
    expect(isTopicExcluded(demo, UO, "hold")).toBe(false);
  });

  it("requires a reason", () => {
    expect(() => excludeTopic(content, demo, UO, "hold", "   ", ACTOR)).toThrow(TailoringError);
    expect(() => excludeTopic(content, demo, UO, "nope", "reason", ACTOR)).toThrow(TailoringError);
  });

  const off = excludeTopic(content, demo, UO, "hold", "Bulk is packed and labelled in one shift (fictional)", ACTOR);

  it("hides the topic's questions (and their follow-ups) but not the other topics", () => {
    const before = ids(demo);
    const after = ids(off);
    for (const id of ["bp.hold_time", "bp.hold_evidence", "bp.time_out", "bp.storage"]) {
      expect(before.has(id), id).toBe(true);
      expect(after.has(id), id).toBe(false);
    }
    expect(after.has("bp.container")).toBe(true);
    expect(after.has("bp.presence")).toBe(true);
  });

  it("removes the topic from gaps and the validation plan", () => {
    const gaps = assess(content, off).gaps;
    expect(gaps.some((g) => /bulk_packaging\.(param|study)\.(max_hold_time|hold_time|max_time_out_of_refrigeration|tor_stability)/.test(g.path))).toBe(false);
    expect(assess(content, demo).gaps.some((g) => g.path.includes("bulk_packaging.param.max_hold_time"))).toBe(true);
    const planGaps = (p: Project) => buildValidationPlan(content, p).flatMap((r) => r.gaps.map((g) => g.key));
    expect(planGaps(off).some((k) => k.includes("bulk_packaging.param.max_hold_time"))).toBe(false);
    expect(planGaps(demo).some((k) => k.includes("bulk_packaging.param.max_hold_time"))).toBe(true);
  });

  it("keeps the recorded values as inactive entries, and restores them when switched back on", () => {
    const inactive = inactiveEntries(off, visibleInstances(content, off, "paired")).map((e) => e.path);
    expect(inactive.some((p) => p.endsWith("uo.bulk_packaging.param.max_hold_time.max"))).toBe(true);
    const back = includeTopic(content, off, UO, "hold", ACTOR);
    expect(ids(back).has("bp.hold_time")).toBe(true);
    expect(back.processes).toEqual(off.processes);
    expect(assess(content, back).gaps.map((g) => g.key)).toEqual(assess(content, demo).gaps.map((g) => g.key));
  });

  it("is change-logged, in both directions", () => {
    const back = includeTopic(content, off, UO, "hold", ACTOR);
    const actions = back.changeLog.map((r) => r.action);
    expect(actions.slice(-2)).toEqual(["tailor_exclude", "tailor_include"]);
    const labels = changeLogView(content, back).map((r) => r.actionLabel);
    expect(labels.join("|")).toMatch(/Topic switched off \(scope\)/);
    expect(labels.join("|")).toMatch(/Topic switched on \(scope\)/);
    expect(off.changeLog.at(-1)!.detail).toMatch(/Bulk is packed and labelled/);
  });

  it("rejects a second exclusion of the same topic", () => {
    expect(() => excludeTopic(content, off, UO, "hold", "again", ACTOR)).toThrow(/already switched off/);
  });

  it("lists every excluded topic with its reason in the document scope", () => {
    const two = excludeTopic(content, off, "ds_shipping_inbound", "custody", "Handled under the supplier agreement (fictional)", ACTOR);
    expect(scopeExclusions(content, two).map((e) => e.topic)).toEqual(["custody", "hold"]);
    const md = scopeText(docOf(two));
    expect(md).toContain("Scope exclusions");
    expect(md).toContain("Bulk is packed and labelled in one shift (fictional)");
    expect(md).toContain("Handled under the supplier agreement (fictional)");
    expect(scopeText(docOf(demo))).toContain("No topics were left out of this assessment.");
  });
});
