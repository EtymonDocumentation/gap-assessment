import { buildDemoProject, buildTrdDocument, segmentsOf, trdOpenItems } from "@gap/engine";
import { formatQuantity, formatRange, printableUnit } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, trdWriteups } from "../index";

/**
 * The short standard TRD and the ten wording and data fixes that came with it. The structure of the two documents is tested in
 * m9-trd.test.ts and in packages/docx/test/trd-standard.test.ts; this file holds the small rules.
 */

const q = (value: number, unit: string) => ({ value, unit });

describe("units and ranges in documents", () => {
  it("writes a range with a negative end with 'to', never as a double minus", () => {
    expect(formatRange({ min: q(-80, "°C"), max: q(-65, "°C") })).toBe("-80 to -65 °C");
    expect(formatRange({ min: q(-5, "°C"), max: q(8, "°C") })).toBe("-5 to 8 °C");
    // A range with no negative end keeps the en dash.
    expect(formatRange({ min: q(2, "°C"), max: q(8, "°C") })).toBe("2–8 °C");
    expect(formatRange({ min: q(-80, "°C"), max: q(-80, "°C") })).toBe("-80 °C");
  });

  it("never prints the unit 'count'", () => {
    expect(printableUnit("count")).toBe("");
    expect(formatQuantity(q(12, "count"))).toBe("12");
    expect(formatQuantity(q(12, "h"))).toBe("12 h");
  });
});

describe("blanks in the descriptions", () => {
  const val = (src: string, value: string) => segmentsOf(src, () => ({ key: "k", label: "x", filled: true, value, origin: "trd", where: "w" }) as never).map((s) => ("blank" in s ? s.blank.value : s.text)).join("");

  it("writes '1 hour', not '1 hours', and leaves other numbers alone", () => {
    expect(val("Held for {{k|x}}.", "1 hours")).toBe("Held for 1 hour.");
    expect(val("Held for {{k|x}}.", "2 hours")).toBe("Held for 2 hours.");
    expect(val("Held for {{k|x}}.", "11 hours")).toBe("Held for 11 hours.");
    expect(val("Within {{k|x}}.", "1 business days")).toBe("Within 1 business day.");
  });
});

describe("catalog options (1.8.0)", () => {
  const sets = content.catalog.optionSets;

  it("labels the PUPSIT option with the real test name", () => {
    const o = sets["integrityTests"]!.find((x) => x.value === "pre_use_pre_sterilization")!;
    expect(o.label).toBe("Pre-use, post-sterilization integrity test (PUPSIT)");
    expect(JSON.stringify(content.catalog)).not.toMatch(/pre-use pre-sterilization/i);
  });

  it("offers prefilled syringe and cartridge formats as options, with no default", () => {
    const labels = sets["containerFormat"]!.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["1 mL long prefilled syringe", "1 mL standard prefilled syringe", "2.25 mL prefilled syringe", "1.5 mL cartridge", "3 mL cartridge"]));
    expect(sets["containerFormat"]!.some((o) => o.label.includes("vial"))).toBe(true);
    const fmt = content.questions.find((x) => x.binds === "uo.aseptic_filling.mat.container.format")!;
    expect(JSON.stringify(fmt)).not.toMatch(/default/i);
  });
});

describe("TRD items for the lane, the filtration time and the hold time", () => {
  const ids = content.questions.map((x) => x.id);
  const byBind = (b: string) => content.questions.find((x) => x.binds === b);

  it("has a lane qualification status, a maximum sterile filtration time and a maximum compounding hold time", () => {
    expect(byBind("uo.ds_shipping_inbound.study.lane_qualification.status")).toBeDefined();
    expect(byBind("uo.sterile_filtration.param.max_filtration_time.max")).toBeDefined();
    expect(byBind("uo.compounding.param.max_hold_time.max")).toBeDefined();
    expect(ids).toContain("filt.filtration_time");
  });

  it("SYR-305 gets all three from the interview instead of typed write-up values", () => {
    const p = buildDemoProject(content, demos["syr-305"], undefined, undefined, undefined, undefined, { writeups: trdWriteups });
    const d = p.trd.documents[0]!;
    const item = (step: string, key: string) => d.steps.find((s) => s.key === step)!.items.find((i) => i.key === key);
    expect(item("ds_shipping_inbound", "lane_qualification")).toBeDefined();
    expect(item("sterile_filtration", "max_filtration_time")).toBeDefined();
    expect(item("compounding", "max_hold_time")).toBeDefined();
    expect(trdOpenItems(d)).toEqual([]);
    expect(JSON.stringify(d.writeups)).not.toMatch(/"trd\.(ds_shipping_inbound\.laneQualification|compounding\.maxHoldTime|sterile_filtration\.maxFiltrationTime)"/);
    const container = d.steps.find((s) => s.key === "aseptic_filling")!.items.find((i) => i.key === "container");
    expect(JSON.stringify(container)).toContain("1 mL long prefilled syringe");
    expect(JSON.stringify(d)).not.toContain('"override"');
  });
});

describe("the TRD the author wrote", () => {
  it("has no instruction-style text left in the shipped write-up wording", () => {
    const text = JSON.stringify(trdWriteups);
    for (const gone of [/Rows can be added/i, /Rows and columns can be added/i, /Update the storage temperature/i, /can be added or deleted as needed/i]) expect(text).not.toMatch(gone);
  });

  it("prints the SYR-305 standard TRD with no 'to be assigned' placeholder source, no '1 hours' and no double minus", () => {
    const p = buildDemoProject(content, demos["syr-305"], undefined, undefined, undefined, undefined, { writeups: trdWriteups });
    const text = JSON.stringify(buildTrdDocument(p, p.trd.documents[0]!, { content }));
    expect(text).not.toMatch(/\b1 hours\b/);
    expect(text).not.toMatch(/\d–-\d|-\d+–-\d/);
    expect(text).not.toContain("pre-use pre-sterilization");
  });
});

describe("export history of the two TRD documents", () => {
  it("records the evidence record as its own kind, compared only with earlier TRD outputs", async () => {
    const { recordExport, isTrdDocumentFormat } = await import("@gap/engine");
    const { emptyProject } = await import("@gap/process-model");
    const rec = (format: "trd-docx" | "trd-evidence-docx", fingerprint: string) => ({ at: "2026-01-01T00:00:00.000Z", format, template: { mode: "builtin" as const, name: "Built-in", version: "1" }, fingerprint });
    expect(isTrdDocumentFormat("trd-evidence-docx")).toBe(true);
    expect(isTrdDocumentFormat("trd-evidence-html")).toBe(true);
    let p = recordExport(emptyProject({ title: "Evidence export test (fictional)", actor: { name: "Test", role: "Tester" } as never, contentRefs: { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" } }), rec("trd-docx", "aaa") as never);
    p = recordExport(p, rec("trd-evidence-docx", "bbb") as never);
    expect(p.document.exports.map((e) => e.format)).toEqual(["trd-docx", "trd-evidence-docx"]);
  });
});
