import { buildDemoProject } from "@gap/engine";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

// The buffer numbers of the SYR-305 demo. The TRD shows an ESTIMATED buffer batch (25.0 kg) and says the receiving unit may change the
// amounts as long as the ratios (the formula) are followed. The batch record states its own, larger buffer batch (50.0 kg, enough for the
// 100 L PPQ batch plus losses). These tests check that every figure follows from the TRD ratios, so a QA reviewer can trust the working.
const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const doc = project.trd.documents[0]!;
const rec = project.mbr.records[0]!;
const buffer = doc.writeups!.find((w) => w.libraryId === "sec_dilution_buffer")!;
const table = (id: string) => buffer.parts.find((p) => p.id === id)!.rows!;
const num = (s: string) => Number(/-?\d+(?:\.\d+)?/.exec(s.replace(/ (?=\d{3}\b)/g, ""))![0]);

describe("SYR-305 TRD buffer example", () => {
  const formulation = table("formulation_table");
  const water = formulation.find((r) => r[0] === "Water for injection")!;
  const size = num(water[3]!); // "to 25.0 kg"

  it("is sized for the 50 L target batch plus about a third for losses", () => {
    const diluent = 18.75; // L for the 50 L target batch (comp.diluent_volume)
    expect(size).toBe(25);
    expect(size / diluent).toBeCloseTo(1.333, 3);
  });

  it("every quantity is ratio x batch size", () => {
    for (const r of formulation.filter((x) => x !== water)) expect(num(r[2]!) * size, r[0]).toBeCloseTo(num(r[3]!), 6);
  });

  it("the stock solutions add up: w/w x solution amount = excipient mass, and they cover what the buffer uses", () => {
    const stock = table("excipient_solution_table");
    const made = (name: string) => {
      const r = stock.find((x) => x[0] === name)!;
      const [mass, total] = [...r[3]!.matchAll(/(\d+(?:\.\d+)?) g/g)].map((m) => Number(m[1]));
      expect((num(r[2]!) / 100) * total!, name).toBeCloseTo(mass!, 6);
      return total!;
    };
    const used = (name: string) => num(formulation.find((r) => r[1]!.startsWith(name))![3]!);
    expect(made("Stabilizer stock")).toBeGreaterThanOrEqual(used("Stabilizer stock"));
    expect(made("Surfactant stock")).toBeGreaterThanOrEqual(used("Surfactant stock"));
  });

  it("says at the calculation that it is an estimated batch the receiving unit may change if the ratios are followed", () => {
    for (const id of ["excipient_solution_n1", "formulation_n3"]) {
      const text = buffer.parts.find((p) => p.id === id)!.text;
      expect(text, id).toContain("This calculation is for an estimated");
      expect(text, id).toContain("free to change the amounts to fit its manufacturing constraints, as long as the same ratios (the formula) are followed");
    }
  });
});

describe("SYR-305 batch record buffer calculation", () => {
  const trd = table("formulation_table");
  const steps = rec.sections.find((s) => s.unitOp === "buffer_prep")!.blocks.find((b) => b.libraryId === "buffer_preparation")!.steps.map((s) => s.text);
  const recordSize = num(/Buffer batch size of this record: ([\d.]+) kg/.exec(steps.join("\n"))![1]!);

  it("has its own buffer batch, not the TRD example", () => {
    expect(recordSize).toBe(50);
    expect(recordSize).toBeGreaterThan(37.5); // 100 L x 0.375 L/L: the largest PPQ batch
  });

  it("each component amount equals the TRD ratio x the record's buffer batch size", () => {
    for (const r of trd.filter((x) => x[0] !== "Water for injection")) {
      const name = r[1]!.replace(/ \(.*$/, "");
      const step = steps.find((t) => t.startsWith(`${name}: `))!;
      expect(step, name).toBeDefined();
      const worked = /= ([\d.]+) g/.exec(step)![1]!;
      expect(Number(worked), name).toBeCloseTo(num(r[2]!) * recordSize, 6);
      expect(step, name).toContain(`${num(r[2]!)}`);
    }
  });

  it("the water step closes the balance to the batch size", () => {
    const parts = trd.filter((x) => x[0] !== "Water for injection").map((r) => num(r[2]!) * recordSize);
    const total = parts.reduce((a, b) => a + b, 0);
    expect(recordSize * 1000 - total).toBeCloseTo(40967.5, 6);
    expect(steps.find((t) => t.startsWith("Water for injection to"))!).toContain("= 40 967.5 g");
  });

  it("the stock solutions of the record follow the TRD w/w and cover the stock the buffer needs", () => {
    const stab = steps.find((t) => t.startsWith("Stabilizer stock (40 % w/w"))!;
    const sur = steps.find((t) => t.startsWith("Surfactant stock (10 % w/w"))!;
    expect(stab).toContain("9000 g x 40 % = 3600 g");
    expect(sur).toContain("200 g x 10 % = 20.0 g");
    expect(9000).toBeGreaterThanOrEqual(175 * recordSize);
    expect(200).toBeGreaterThanOrEqual(2.0 * recordSize);
  });

  it("the diluent volume follows the TRD ratio for 9, 50 and 100 L", () => {
    const text = rec.sections.find((s) => s.unitOp === "compounding")!.blocks.find((b) => b.libraryId === "dilution_and_mixing")!.steps[0]!.text;
    const ratio = 18.75 / 50;
    expect(ratio).toBe(0.375);
    for (const [l, v] of [[9, "3.375"], [50, "18.75"], [100, "37.5"]] as const) expect(text).toContain(`${l} L x 0.375 = ${v} L`);
    expect(100 * ratio).toBeLessThan(recordSize);
  });
});

describe("SYR-305 batch record sample rows", () => {
  const samples = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.samples));
  it("name the moment in process words, never an hour of the flow figure", () => {
    expect(samples.length).toBe(17);
    for (const x of samples.filter((y) => y.hour)) expect(x.hour, x.pointId).not.toMatch(/^\d+(\.\d+)? h$/);
    const moments = new Set(samples.map((x) => x.hour));
    expect(moments).toContain("End of BBR filtration (start of hold)");
    expect(moments).toContain("After 30 h hold");
    expect([...moments].some((m) => /^Beginning of /.test(m ?? ""))).toBe(true);
  });
});

describe("the dilution buffer write-up of the library (every project)", () => {
  const lib = trdWriteups.find((w) => w.id === "sec_dilution_buffer")!;
  it("states at both calculation tables that the batch is an estimate and the receiving unit may change the amounts if the formula is followed", () => {
    expect(lib.version).toBe(3);
    expect(lib.history?.map((h) => h.version)).toEqual([2]);
    for (const id of ["excipient_solution_n1", "formulation_n3"]) {
      const text = lib.parts.find((p) => p.id === id)!.text;
      expect(text, id).toContain("This calculation is for an estimated batch.");
      expect(text, id).toContain("free to change the amounts to fit its manufacturing constraints, as long as the same ratios (the formula) are followed");
    }
  });
});
