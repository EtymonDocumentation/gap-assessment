import { describe, expect, it } from "vitest";
import { TRD_SEED_FORMAT, TRD_SEED_VERSION, addSource, attachSource, parseTrdSeed, verifyEntry, type Project, type SeedField, type TrdSeed } from "@gap/process-model";
import { addCustomItem, addCustomUnitOperation, assess, buildDemoProject, buildDocument, buildTrdSeed, effectiveContent, excludeStep, excludeTopic, recordExport, trdSeedFingerprint } from "@gap/engine";
import { ACTOR, DOC_A, OTHER_ACTOR, content, kit, q, rng } from "./helpers";
import { demos } from "../../../content/index";

const { base, pair, v, par, unk, ask, na, same } = kit;
const AT = "2026-10-21T08:00:00.000Z";
const seedOf = (p: Project): TrdSeed => buildTrdSeed(content, p, { exportedAt: AT, appVersion: "9.9.9" });
const fieldsOf = (s: TrdSeed): SeedField[] => [...s.site.fields, ...s.unitOperations.flatMap((u) => [...u.fields, ...u.items.flatMap((i) => i.fields)])];
const find = (s: TrdSeed, path: string) => fieldsOf(s).find((f) => f.path === path);

const PUMP = "uo.aseptic_filling.equip.filler.operatingPrinciple";
const MIX = "uo.compounding.param.mixing_speed";

describe("buildTrdSeed", () => {
  it("round-trips the demo project through JSON and the schema", () => {
    const p = buildDemoProject(content, demos["arx-217"]);
    const seed = seedOf(p);
    const back = parseTrdSeed(JSON.stringify(seed));
    expect(back).toEqual(JSON.parse(JSON.stringify(seed)));
    expect(back.meta).toMatchObject({ format: TRD_SEED_FORMAT, formatVersion: TRD_SEED_VERSION, exportedAt: AT, generator: { version: "9.9.9" }, processModelVersion: "1.6.0" });
    expect(back.meta.product.program).toMatchObject({ status: "established", value: "ARX-217" });
    expect(back.unitOperations.length).toBeGreaterThan(5);
    expect(back.meta.gapAssessment.revision).toBeUndefined();
    expect(back.meta.contentVersions).toMatchObject({ catalog: content.versions.catalog, overlay: content.overlayVersion });
  });

  it("gives each source the number the gap assessment document's source register prints for it", () => {
    const p = buildDemoProject(content, demos["arx-217"]);
    const seed = seedOf(p);
    const doc = buildDocument(effectiveContent(content, p), p, assess(effectiveContent(content, p), p), AT);
    const table = doc.sections.find((s) => s.id === "source-register")!.blocks.find((b) => b.type === "table") as { rows: string[][] };
    const byRef = new Map(table.rows.map((r) => [r[0], r]));
    expect(seed.sources.length).toBeGreaterThan(0);
    for (const s of seed.sources) {
      expect(s.gapRegisterRef).toMatch(/^S-\d{3}$/);
      const row = byRef.get(s.gapRegisterRef!)!;
      // Same source under the same number: the register row names this source's document, or its label for an interview.
      expect(row.join(" ")).toContain(s.document?.identifier ?? s.label.split(":")[0]);
    }
    expect(new Set(seed.sources.map((s) => s.gapRegisterRef)).size).toBe(seed.sources.length);
  });

  it("is deterministic and its fingerprint ignores the export time", () => {
    const p = buildDemoProject(content, demos["arx-217"]);
    expect(seedOf(p)).toEqual(seedOf(p));
    const later = buildTrdSeed(content, p, { exportedAt: "2027-01-01T00:00:00.000Z", appVersion: "9.9.9" });
    expect(trdSeedFingerprint(later)).toBe(trdSeedFingerprint(seedOf(p)));
    const a = trdSeedFingerprint(seedOf(pair(base(), "fill.pump", "rotary_piston", "peristaltic")));
    const b = trdSeedFingerprint(seedOf(pair(base(), "fill.pump", "rotary_piston", "time_pressure")));
    expect(a).not.toBe(b);
  });

  it("does not export a unit operation the project left out, nor its values", () => {
    const withValues = par(base(), "comp.mixing_speed", "target", { setPoint: q(100, "rpm"), nor: "tbd" });
    expect(find(seedOf(withValues), `${MIX}.setPoint`)).toBeDefined();
    const out = excludeStep(content, withValues, "compounding", "Not part of this transfer (fictional)", ACTOR);
    const seed = seedOf(out);
    expect(seed.unitOperations.map((u) => u.key)).not.toContain("compounding");
    expect(seed.scope.excluded).toEqual([expect.objectContaining({ key: "compounding", reason: "Not part of this transfer (fictional)", by: ACTOR.name })]);
    expect(seed.scope.included.map((u) => u.key)).not.toContain("compounding");
    expect(JSON.stringify(seed)).not.toContain("mixing_speed");
  });

  it("states 'No reason recorded' for a step left out without a reason", () => {
    expect(seedOf(excludeStep(content, base({ uos: ["compounding", "capping"] }), "capping", undefined, ACTOR)).scope.excluded[0]!.reason).toBe("No reason recorded");
  });

  it("does not export a tailored-out topic but lists it in the scope", () => {
    const p = excludeTopic(content, par(base(), "comp.mixing_speed", "target", { setPoint: q(100, "rpm"), nor: "tbd" }), "compounding", "param", "Fixed by the recipe (fictional)", ACTOR);
    const seed = seedOf(p);
    expect(fieldsOf(seed).some((f) => f.path.startsWith("uo.compounding.param."))).toBe(false);
    expect(seed.scope.topicsLeftOut).toEqual([expect.objectContaining({ uo: "compounding", topic: "param", reason: "Fixed by the recipe (fictional)" })]);
  });

  it("exports an unanswered active question as not_established, with no value and no default", () => {
    const seed = seedOf(base());
    const f = find(seed, PUMP)!;
    expect(f).toMatchObject({ status: "not_established", verification: "unverified" });
    expect(f.value).toBeUndefined();
    expect(f.display).toBeUndefined();
    expect(() => parseTrdSeed(JSON.stringify(seed))).not.toThrow();
  });

  it("marks a TBD best guess provisional and keeps a TBD without a guess free of values", () => {
    const withGuess = ask(v(base(), "fill.pump", "source", "rotary_piston"), "fill.pump", "target", {
      kind: "tbd",
      bestGuess: "peristaltic",
      owner: "Process lead (fictional)",
      due: "2026-12-01",
      note: "Waiting for vendor data",
    });
    expect(find(seedOf(withGuess), PUMP)).toMatchObject({
      status: "tbd",
      provisional: true,
      value: "peristaltic",
      tbd: { owner: "Process lead (fictional)", due: "2026-12-01", note: "Waiting for vendor data" },
    });
    const noGuess = find(seedOf(unk(base(), "fill.pump", "target")), PUMP)!;
    expect(noGuess).toMatchObject({ status: "tbd" });
    expect(noGuess.value).toBeUndefined();
    expect(noGuess.provisional).toBeUndefined();
  });

  it("exports not applicable with its justification and no value", () => {
    const f = find(seedOf(na(base(), "fill.pump", "target", "Gravity fill, no pump (fictional)")), PUMP)!;
    expect(f).toMatchObject({ status: "not_applicable", justification: "Gravity fill, no pump (fictional)" });
    expect(f.value).toBeUndefined();
  });

  it("exports custom unit operations and custom items, marked custom and without a stage group", () => {
    let p = addCustomUnitOperation(base(), content, { label: "Visual check (custom)", description: "Added for the test.", after: "aseptic_filling" }, ACTOR);
    const key = p.custom.unitOperations.at(-1)!.key;
    p = addCustomItem(p, content, { uo: "compounding", coll: "param", label: "Foam level", dimension: "percent" }, ACTOR);
    const seed = seedOf(p);
    const uo = seed.unitOperations.find((u) => u.key === key);
    expect(uo).toMatchObject({ custom: true, label: "Visual check (custom)" });
    expect(uo!.stageGroup).toBeUndefined();
    expect(seed.scope.included.find((u) => u.key === key)).toMatchObject({ custom: true });
    const item = seed.unitOperations.find((u) => u.key === "compounding")!.items.find((i) => i.label === "Foam level");
    expect(item).toMatchObject({ custom: true, collection: "param" });
    expect(item!.key.startsWith("x_")).toBe(true);
  });

  it("carries the verification state of each value", () => {
    let p = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    p = verifyEntry(p, `target.${PUMP}`, OTHER_ACTOR);
    expect(find(seedOf(p), PUMP)!.verification).toBe("verified");
    // The recorder verifying their own entry is kept apart from an independent verification.
    const own = verifyEntry(pair(base(), "fill.pump", "rotary_piston", "peristaltic"), `target.${PUMP}`, ACTOR, { selfVerification: true });
    expect(find(seedOf(own), PUMP)!.verification).toBe("self_verified");
    // Changing the value afterwards withdraws the verification.
    const changed = v(p, "fill.pump", "target", "time_pressure");
    expect(find(seedOf(changed), PUMP)!.verification).toBe("withdrawn");
  });

  it("keeps the SU value out of the RU field: it appears only under reference.su", () => {
    const f = find(seedOf(pair(base(), "fill.pump", "rotary_piston", "peristaltic")), PUMP)!;
    expect(f.value).toBe("peristaltic");
    expect(f.reference?.su).toMatchObject({ status: "established", value: "rotary_piston" });
    expect(f.reference!.gapIds.length).toBeGreaterThan(0);
    // An unanswered RU field stays empty even when the SU is answered.
    const open = find(seedOf(v(base(), "fill.pump", "source", "rotary_piston")), PUMP)!;
    expect(open.status).toBe("not_established");
    expect(open.value).toBeUndefined();
    expect(open.reference?.su?.value).toBe("rotary_piston");
  });

  it("marks 'same as SU' on the RU field", () => {
    const f = find(seedOf(same(v(base(), "fill.pump", "source", "rotary_piston"), "fill.pump")), PUMP)!;
    expect(f).toMatchObject({ status: "established", sameAsSu: true, value: "rotary_piston" });
  });

  it("exports parameter values with units, and a range as a range", () => {
    const p = par(base(), "comp.mixing_speed", "target", { setPoint: q(100, "rpm"), nor: rng(80, 120, "rpm") });
    const seed = seedOf(p);
    expect(find(seed, `${MIX}.setPoint`)).toMatchObject({ value: { value: 100, unit: "rpm" }, unit: "rpm", display: "100 rpm" });
    expect(find(seed, `${MIX}.nor`)).toMatchObject({ value: { min: { value: 80, unit: "rpm" }, max: { value: 120, unit: "rpm" } }, unit: "rpm" });
  });

  it("cites only the sources of exported RU values, with the document and not the file", () => {
    const withDocs = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    const ru = addSource(withDocs, { type: "document_reference", docRef: DOC_A }, ACTOR);
    const su = addSource(ru.project, { type: "document_reference", docRef: { ...DOC_A, identifier: "TEST-DOC-SU" } }, ACTOR);
    let p = attachSource(su.project, `target.${PUMP}`, ru.source.id, ACTOR);
    p = attachSource(p, `source.${PUMP}`, su.source.id, ACTOR);
    const seed = seedOf(p);
    expect(find(seed, PUMP)!.sourceIds).toContain(ru.source.id);
    expect(seed.sources.find((s) => s.id === ru.source.id)).toMatchObject({ document: { identifier: DOC_A.identifier, docType: DOC_A.docType } });
    // A document that only supports an SU value is not an RU source.
    expect(seed.sources.map((s) => s.id)).not.toContain(su.source.id);
  });

  it("never states a regulatory filing category", () => {
    const text = JSON.stringify(seedOf(buildDemoProject(content, demos["arx-217"])));
    expect(text).not.toMatch(/filing category|CBE-30|prior approval|annual report/i);
  });

  it("does not change the project it was given", () => {
    const p = buildDemoProject(content, demos["arx-217"]);
    const before = JSON.stringify(p);
    seedOf(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe("recordExport for TRD outputs", () => {
  const rec = (format: "trd-seed-json" | "trd-outline-docx" | "trd-outline-html" | "docx", fingerprint: string) => ({
    at: AT,
    format,
    template: { mode: "builtin" as const, name: "Built-in default", version: "1.0.0" },
    fingerprint,
    versions: { processModel: "1.0.0", catalog: "1.7.0", format: "1.0.0" },
  });

  it("accepts the three TRD formats and stores the versions, with no omitted sections", () => {
    let p = base();
    for (const f of ["trd-seed-json", "trd-outline-docx", "trd-outline-html"] as const) p = recordExport(p, rec(f, "aaaa"));
    expect(p.document.exports.map((e) => e.format)).toEqual(["trd-seed-json", "trd-outline-docx", "trd-outline-html"]);
    expect(p.document.exports[0]!.versions).toEqual({ processModel: "1.0.0", catalog: "1.7.0", format: "1.0.0" });
    expect(p.document.exports[0]!.omittedSections).toBeUndefined();
  });

  it("compares a TRD output only with the previous TRD output", () => {
    let p = recordExport(base(), rec("docx", "doc1"));
    p = recordExport(p, rec("trd-seed-json", "seed1"));
    expect(p.document.exports[1]!.changedSincePrevious).toBeUndefined();
    p = recordExport(p, rec("trd-outline-html", "seed1"));
    expect(p.document.exports[2]!.changedSincePrevious).toBe(false);
    p = recordExport(p, rec("trd-seed-json", "seed2"));
    expect(p.document.exports[3]!.changedSincePrevious).toBe(true);
    // The gap document still compares with the previous gap document, not with a seed.
    p = recordExport(p, rec("docx", "doc1"));
    expect(p.document.exports[4]!.changedSincePrevious).toBe(false);
  });
});
