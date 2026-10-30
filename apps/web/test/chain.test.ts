import { assess, buildDemoProject } from "@gap/engine";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "@gap/content";
import { emptyProject } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { chainBar, chainStageOf, chainStages, thenStep, type ChainAllowed } from "../src/chain";

const all: ChainAllowed = { trd: true, sampling: true, mbr: true, risk: true };
const blank = () => emptyProject({ title: "Test project", actor: { name: "Tester", at: "2026-01-01T00:00:00.000Z" }, contentRefs: content.versions });
// Building the demo takes a few seconds, so it is built once and shared (the tests only read it).
let cached: ReturnType<typeof buildDemoProject> | undefined;
const syr = () =>
  (cached ??= buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups }));
const route = (path: string, q = "") => ({ path, params: new URLSearchParams(q) });

describe("the document chain", { timeout: 60_000 }, () => {
  it("lists five stages, all 'Not started' on an empty project, and none is marked required", () => {
    const p = blank();
    const stages = chainStages(p, assess(content, p), all);
    expect(stages.map((s) => s.id)).toEqual(["gap", "trd", "sampling", "mbr", "view"]);
    expect(stages.filter((s) => ["trd", "sampling", "mbr"].includes(s.id)).map((s) => s.status)).toEqual(["Not started", "Not started", "Not started"]);
    expect(stages.find((s) => s.id === "view")!.path).toBe("/mbr");
  });

  it("leaves out the stages of modules the account does not have", () => {
    const p = blank();
    const ids = chainStages(p, assess(content, p), { ...all, trd: false, mbr: false }).map((s) => s.id);
    expect(ids).toEqual(["gap", "sampling"]);
  });

  it("marks the stage a route belongs to", () => {
    expect(chainStageOf("/register")).toBe("gap");
    expect(chainStageOf("/mbr/view")).toBe("view");
    expect(chainStageOf("/mbr/library")).toBeUndefined();
    expect(chainStageOf("/risk")).toBeUndefined();
  });

  it("derives status from the stored documents, and Next follows an existing link", () => {
    const p = syr();
    const a = assess(content, p);
    const rec = p.mbr.records[0]!;
    expect(chainStages(p, a, all).find((s) => s.id === "trd")!.status).toMatch(/^TRD-001, /);
    const bar = chainBar(p, a, all, route("/mbr", `mbr=${rec.id}`));
    expect(bar.next).toMatchObject({ label: "Next: Process view", path: "/mbr/view", params: { mbr: rec.id } });
    if (rec.planId) expect(bar.back).toMatchObject({ path: "/sampling", params: { plan: rec.planId } });
    if (rec.planId) expect(chainBar(p, a, all, route("/sampling", `plan=${rec.planId}`)).next).toMatchObject({ path: "/mbr", params: { mbr: rec.id } });
    expect(chainBar(p, a, all, route("/mbr/view", `mbr=${rec.id}`)).next).toBeUndefined();
  });

  it("gives only the last gap step a chain Next, and offers the TRD as optional", () => {
    const p = blank();
    const a = assess(content, p);
    expect(chainBar(p, a, all, route("/interview"))).toEqual({});
    expect(chainBar(p, a, all, route("/document"))).toMatchObject({ next: { path: "/trd" }, hint: expect.stringContaining("Optional") });
  });

  it("proposes the first document that has nothing yet", () => {
    const p = blank();
    expect(thenStep(p, all)).toMatchObject({ label: "Start a TRD", path: "/trd" });
    expect(thenStep(p, { ...all, trd: false })).toMatchObject({ path: "/sampling" });
    expect(thenStep(syr(), all)).toMatchObject({ label: "Open the Process view" });
  });
});
