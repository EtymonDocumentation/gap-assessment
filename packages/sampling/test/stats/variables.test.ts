/**
 * MIL-STD-414 tests.
 *
 * SOURCE 1 (the one the data was keyed from): MIL-STD-414, 11 June 1957, typeset scan at archive.org (item "MIL-STD-414"):
 * Table A-2, B-1, B-2, B-3, B-4 and the standard's own Examples B-1 to B-4.
 * SOURCE 2 (independent): the "Planesmuestra" R package (Table A-2 and the k values of Table B-1, normal and tightened),
 * see fixtures/planesmuestra414.ts. It has no M values and no reduced tables; those are checked with the standard's own
 * relation that a reduced value equals the normal value of the next AQL at the same sample size (see below).
 */
import { describe, expect, it } from "vitest";
import { AQL_VALUES_414, VAR_LEVELS, resolveVarCell, varCodeLetter, variablesPlan, type VarLevel } from "../../src/index";
import {
  CODE_LETTERS_414,
  K_NORMAL_414,
  K_REDUCED_414,
  M_NORMAL_414,
  M_REDUCED_414,
  SAMPLE_SIZE_414,
  SAMPLE_SIZE_414_REDUCED,
  TABLE_A2,
  TABLE_A2_LOT_MAX,
} from "../../src/stats/tables/mil-std-414";
import { K_CELLS_SECOND_SOURCE, TABLE_A2_SECOND_SOURCE } from "./fixtures/planesmuestra414";

describe("the standard's worked examples (lot of 40, inspection level IV, normal inspection, AQL 1 %)", () => {
  it("Example B-1 (Form 1, single limit): code letter D, n 5, k 1.53", () => {
    const r = variablesPlan({ lotSize: 40, level: "IV", aql: 1.0, inspection: "normal", limits: "single" });
    expect(r).toMatchObject({ method: "var-414", ok: true, problems: [], codeLetter: "D", sampleSize: 5, k: 1.53 });
    expect(r.maxPercentNonconforming).toBeUndefined();
    expect(r.hundredPercent).toBeUndefined();
    expect(r.citation).toContain("ANSI/ASQ Z1.9");
    expect(r.working.length).toBeGreaterThan(5);
  });

  it("Example B-2 and B-3 (Form 2, M method): code letter D, n 5, M 3.32 %", () => {
    const r = variablesPlan({ lotSize: 40, level: "IV", aql: 1.0, inspection: "normal", limits: "double" });
    expect(r).toMatchObject({ ok: true, codeLetter: "D", sampleSize: 5, maxPercentNonconforming: 3.32 });
    expect(r.k).toBeUndefined();
  });

  it("Example B-4 (AQL 2.5 % for the lower limit): the same code letter and n, M 9.80 %", () => {
    const r = variablesPlan({ lotSize: 40, level: "IV", aql: 2.5, inspection: "normal", limits: "double" });
    expect(r).toMatchObject({ ok: true, codeLetter: "D", sampleSize: 5, maxPercentNonconforming: 9.8 });
  });
});

describe("arrows, tightened and reduced inspection", () => {
  it("follows a down arrow to the first plan below and takes both its n and its k (lot 8, level IV = B, AQL 0.65: D, n 5, k 1.65)", () => {
    const r = variablesPlan({ lotSize: 8, level: "IV", aql: 0.65, inspection: "normal", limits: "single" });
    expect(r).toMatchObject({ ok: true, codeLetter: "D", sampleSize: 5, k: 1.65 });
    expect(r.working.find((w) => w.label.startsWith("Arrow"))?.value).toContain("code letter D");
  });

  it("an arrow can lead to a plan as large as the lot: then the whole lot is inspected (lot 3, level IV, AQL 1.0 -> n 5)", () => {
    const r = variablesPlan({ lotSize: 3, level: "IV", aql: 1.0, inspection: "normal", limits: "single" });
    expect(r).toMatchObject({ ok: true, hundredPercent: true, sampleSize: 3, k: 1.45, codeLetter: "C" });
  });

  it("tightened inspection reads the normal column one AQL lower (AQL 1.5 tightened = AQL 1.00 column: D, k 1.53)", () => {
    const r = variablesPlan({ lotSize: 40, level: "IV", aql: 1.5, inspection: "tightened", limits: "single" });
    expect(r).toMatchObject({ ok: true, codeLetter: "D", sampleSize: 5, k: 1.53 });
    expect(r.working.some((w) => w.label === "Tightened inspection")).toBe(true);
    expect(variablesPlan({ lotSize: 40, level: "IV", aql: 2.5, inspection: "tightened", limits: "double" }).maxPercentNonconforming).toBe(5.83); // tightened 2.5 = normal 1.50 column, D
  });

  it("tightened inspection is stricter: the same lot and AQL never get a larger k at tightened than normal", () => {
    for (const aql of AQL_VALUES_414.slice(1, 13)) {
      const n = variablesPlan({ lotSize: 500, level: "IV", aql, inspection: "normal", limits: "single" }).k!;
      const t = variablesPlan({ lotSize: 500, level: "IV", aql, inspection: "tightened", limits: "single" }).k!;
      expect(t, `AQL ${aql}`).toBeGreaterThanOrEqual(n);
    }
  });

  it("reduced inspection uses Tables B-2 and B-4 and their own sample sizes (lot 40, level IV, AQL 1.0: arrow to F, n 4, k 1.34, M 5.50)", () => {
    const k = variablesPlan({ lotSize: 40, level: "IV", aql: 1.0, inspection: "reduced", limits: "single" });
    expect(k).toMatchObject({ ok: true, codeLetter: "F", sampleSize: 4, k: 1.34 });
    const m = variablesPlan({ lotSize: 40, level: "IV", aql: 1.0, inspection: "reduced", limits: "double" });
    expect(m).toMatchObject({ ok: true, codeLetter: "F", sampleSize: 4, maxPercentNonconforming: 5.5 });
  });

  it("says plainly where the standard has no plan: tightened AQL 0.04 and reduced AQL 15", () => {
    const t = variablesPlan({ lotSize: 40, level: "IV", aql: 0.04, inspection: "tightened", limits: "single" });
    expect(t.ok).toBe(false);
    expect(t.problems[0]).toContain("no tightened plan for AQL 0.04");
    const r = variablesPlan({ lotSize: 40, level: "IV", aql: 15, inspection: "reduced", limits: "single" });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("no reduced-inspection plan for AQL 15");
  });
});

describe("missing and invalid input", () => {
  it("lists every missing input and gives no plan", () => {
    const r = variablesPlan({});
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(5);
    expect(r.sampleSize).toBeUndefined();
    expect(r.k).toBeUndefined();
  });

  it.each([
    [{ level: "IV", aql: 1, inspection: "normal", limits: "single" }, "Enter the lot size."],
    [{ lotSize: 40, aql: 1, inspection: "normal", limits: "single" }, "Choose the inspection level (I, II, III, IV or V; IV is the standard's normal level)."],
    [{ lotSize: 40, level: "IV", inspection: "normal", limits: "single" }, "Choose the AQL (acceptance quality limit)."],
    [{ lotSize: 40, level: "IV", aql: 1, limits: "single" }, "Choose the inspection severity (normal, tightened or reduced)."],
    [{ lotSize: 40, level: "IV", aql: 1, inspection: "normal" }, "Choose whether the characteristic has a single or a double specification limit."],
  ] as const)("one missing input %#", (input, problem) => {
    expect(variablesPlan(input as never).problems).toEqual([problem]);
  });

  it("rejects an AQL that is not in the standard as not supported, rather than rounding it", () => {
    const r = variablesPlan({ lotSize: 40, level: "IV", aql: 0.5, inspection: "normal", limits: "single" });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("not supported in this version");
  });

  it("rejects the 105E-only levels, unknown values and a lot size below 3", () => {
    expect(variablesPlan({ lotSize: 40, level: "S-3" as never, aql: 1, inspection: "normal", limits: "single" }).ok).toBe(false);
    expect(variablesPlan({ lotSize: 40, level: "IV", aql: 1, inspection: "strict" as never, limits: "single" }).ok).toBe(false);
    expect(variablesPlan({ lotSize: 40, level: "IV", aql: 1, inspection: "normal", limits: "triple" as never }).ok).toBe(false);
    expect(variablesPlan({ lotSize: 2, level: "IV", aql: 1, inspection: "normal", limits: "single" }).ok).toBe(false);
  });
});

describe("properties and table integrity", () => {
  it("a bigger lot never gets a smaller sample, for every level, severity and form", () => {
    const lots = [3, 8, 9, 15, 16, 25, 26, 40, 41, 65, 66, 110, 111, 180, 181, 300, 301, 500, 501, 800, 801, 1300, 1301, 3200, 3201, 8000, 8001, 22000, 22001, 110000, 110001, 550000, 550001, 2_000_000];
    for (const level of VAR_LEVELS) {
      for (const inspection of ["normal", "tightened", "reduced"] as const) {
        for (const limits of ["single", "double"] as const) {
          for (const aql of [0.65, 1.0, 2.5]) {
            let last = 0;
            for (const lotSize of lots) {
              const r = variablesPlan({ lotSize, level, aql, inspection, limits });
              expect(r.ok, `${level} ${inspection} ${limits} ${aql} lot ${lotSize}`).toBe(true);
              expect(r.sampleSize!).toBeGreaterThanOrEqual(last);
              expect(r.sampleSize!).toBeLessThanOrEqual(lotSize);
              last = r.sampleSize!;
            }
          }
        }
      }
    }
  });

  it("every code letter at every AQL resolves to a plan (normal 14 columns, reduced 13), and arrows only point down", () => {
    for (const letter of CODE_LETTERS_414) {
      for (const table of ["k", "m"] as const) {
        for (let col = 0; col < 14; col++) {
          const r = resolveVarCell(table, false, letter, col);
          expect(r, `normal ${table} ${letter} ${col}`).not.toBeNull();
          expect(CODE_LETTERS_414.indexOf(r!.letter)).toBeGreaterThanOrEqual(CODE_LETTERS_414.indexOf(letter));
          expect(r!.sampleSize).toBe(SAMPLE_SIZE_414[r!.letter]);
        }
        for (let col = 0; col < 13; col++) {
          const r = resolveVarCell(table, true, letter, col);
          expect(r, `reduced ${table} ${letter} ${col}`).not.toBeNull();
          expect(r!.sampleSize).toBe(SAMPLE_SIZE_414_REDUCED[r!.letter]);
        }
      }
    }
  });

  it("the arrow cells are the same in the k and the M tables (an arrow is an arrow in B-1 and B-3, and in B-2 and B-4)", () => {
    for (const letter of CODE_LETTERS_414) {
      expect(K_NORMAL_414[letter]!.map((v) => v === null)).toEqual(M_NORMAL_414[letter]!.map((v) => v === null));
      expect(K_REDUCED_414[letter]!.map((v) => v === null)).toEqual(M_REDUCED_414[letter]!.map((v) => v === null));
    }
  });

  it("k falls and M rises as the AQL rises, for every code letter (a looser AQL accepts a worse lot)", () => {
    for (const letter of CODE_LETTERS_414) {
      const k = K_NORMAL_414[letter]!.filter((v): v is number => v !== null);
      const m = M_NORMAL_414[letter]!.filter((v): v is number => v !== null);
      for (let i = 1; i < k.length; i++) {
        expect(k[i]!, `k ${letter}`).toBeLessThan(k[i - 1]!);
        expect(m[i]!, `M ${letter}`).toBeGreaterThan(m[i - 1]!);
      }
    }
  });

  it("the standard's own relation: a reduced value equals the normal value of the next AQL at the same sample size (cross-checks B-2 and B-4 against B-1 and B-3)", () => {
    let compared = 0;
    for (const [reduced, normal] of [[K_REDUCED_414, K_NORMAL_414], [M_REDUCED_414, M_NORMAL_414]] as const) {
      for (const letter of CODE_LETTERS_414) {
        const n = SAMPLE_SIZE_414_REDUCED[letter];
        const twin = CODE_LETTERS_414.find((l) => SAMPLE_SIZE_414[l] === n);
        for (let col = 0; col < 13; col++) {
          const v = reduced[letter]![col];
          if (v === null) continue;
          expect(twin, `no normal letter with n ${n}`).toBeDefined();
          expect(normal[twin!]![col + 1], `reduced ${letter} col ${col}`).toBe(v);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(200);
  });

  it("sample sizes", () => {
    expect(CODE_LETTERS_414.map((l) => SAMPLE_SIZE_414[l])).toEqual([3, 4, 5, 7, 10, 15, 20, 25, 30, 35, 40, 50, 75, 100, 150, 200]);
    expect(CODE_LETTERS_414.map((l) => SAMPLE_SIZE_414_REDUCED[l])).toEqual([3, 3, 3, 3, 4, 5, 7, 10, 10, 15, 20, 20, 25, 30, 50, 75]);
    expect(AQL_VALUES_414).toEqual([0.04, 0.065, 0.1, 0.15, 0.25, 0.4, 0.65, 1, 1.5, 2.5, 4, 6.5, 10, 15]);
  });
});

describe("cross-check against a second, independent source (Planesmuestra)", () => {
  it("Table A-2: all 17 x 5 code letters agree, for the first and last lot size of every range", () => {
    expect(TABLE_A2_SECOND_SOURCE).toHaveLength(17);
    const levels: VarLevel[] = ["I", "II", "III", "IV", "V"];
    const first = [3, 9, 16, 26, 41, 66, 111, 181, 301, 501, 801, 1301, 3201, 8001, 22001, 110001, 550001];
    const last = [...TABLE_A2_LOT_MAX.slice(0, 16), 10_000_000] as number[];
    let compared = 0;
    TABLE_A2_SECOND_SOURCE.forEach((row, i) => {
      levels.forEach((level, j) => {
        expect(TABLE_A2[level]![i], `range ${i} level ${level}`).toBe(row[j]);
        expect(varCodeLetter(first[i]!, level)).toBe(row[j]);
        expect(varCodeLetter(last[i]!, level)).toBe(row[j]);
        compared++;
      });
    });
    expect(compared).toBe(85);
  });

  it("Table B-1: every k that the standard prints (not an arrow) agrees, for normal and tightened inspection (at least 40 cells)", () => {
    let compared = 0;
    for (const [sev, letter, aql, k, n] of K_CELLS_SECOND_SOURCE) {
      const idx = AQL_VALUES_414.indexOf(aql as never);
      expect(idx, `AQL ${aql}`).toBeGreaterThanOrEqual(0);
      const col = sev === "n" ? idx : idx - 1; // tightened AQL sits under the normal column one lower
      if (col < 0) continue;
      const printed = K_NORMAL_414[letter as keyof typeof K_NORMAL_414]![col];
      if (printed === null || printed === undefined) continue; // the package fills arrows with another cell's value
      expect(printed, `${sev} ${letter} AQL ${aql}`).toBe(k);
      expect(SAMPLE_SIZE_414[letter as keyof typeof SAMPLE_SIZE_414]).toBe(n);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(40);
    expect(compared).toBe(374);
  });
});
