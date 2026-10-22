/**
 * MIL-STD-105E tests.
 *
 * SOURCE 1 (the one the data was keyed from): MIL-STD-105E, Notice 1, typeset scan at archive.org (item "MIL-STD-105E_1").
 * SOURCE 2 (independent, used here only to check source 1): the "Planesmuestra" R package (Montgomery 2005 tables of
 * MIL-STD-105E), see fixtures/planesmuestra.ts. Every Table I cell (105) and every plan cell of Tables II-A, II-B and II-C
 * that holds a plan (440 cells, each with its n and Ac) is compared.
 */
import { describe, expect, it } from "vitest";
import { AQL_LEVELS, AQL_VALUES_105E, aqlCodeLetter, aqlPlan, resolveAqlCell, type AqlLevel, type Inspection } from "../../src/index";
import {
  CODE_LETTERS_105E,
  SAMPLE_SIZE_105E,
  SAMPLE_SIZE_105E_REDUCED,
  TABLE_I,
  TABLE_II_A_NORMAL,
  TABLE_II_B_TIGHTENED,
  TABLE_II_C_REDUCED,
  TABLE_I_LOT_MAX,
} from "../../src/stats/tables/mil-std-105e";
import { PLAN_CELLS_SECOND_SOURCE, TABLE_I_SECOND_SOURCE } from "./fixtures/planesmuestra";

const SECOND_LEVEL_ORDER: AqlLevel[] = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"];
const TABLES = { n: TABLE_II_A_NORMAL, t: TABLE_II_B_TIGHTENED, r: TABLE_II_C_REDUCED } as const;
const SEVERITY = { n: "normal", t: "tightened", r: "reduced" } as const;

describe("known values from the standard", () => {
  it("lot 3201 to 10000, level II -> code letter L, n 200", () => {
    for (const lotSize of [3201, 5000, 10000]) {
      expect(aqlCodeLetter(lotSize, "II")).toBe("L");
    }
    const r = aqlPlan({ lotSize: 5000, level: "II", aql: 0.65, inspection: "normal" });
    expect(r.codeLetter).toBe("L");
    expect(r.sampleSize).toBe(200);
  });

  it("code letter L, AQL 0.65, normal -> Ac 3, Re 4", () => {
    const r = aqlPlan({ lotSize: 5000, level: "II", aql: 0.65, inspection: "normal" });
    expect(r).toMatchObject({ method: "aql-105e", ok: true, problems: [], accept: 3, reject: 4 });
    expect(r.hundredPercent).toBeUndefined();
    expect(r.citation).toBe("MIL-STD-105E (public domain); tables equivalent to ANSI/ASQ Z1.4 — confirm against your licensed copy");
  });

  it("lot 51 to 90, level II -> code letter E, n 13", () => {
    for (const lotSize of [51, 90]) {
      const r = aqlPlan({ lotSize, level: "II", aql: 1.0, inspection: "normal" });
      expect(r.codeLetter).toBe("E");
      expect(r.sampleSize).toBe(13);
    }
  });

  it("follows a down arrow to the first plan below and uses that plan's n AND Ac/Re (lot 501-1200, level II = J, AQL 0.065: arrow to L, n 200, 0/1)", () => {
    const cell = resolveAqlCell("normal", "J", AQL_VALUES_105E.indexOf(0.065));
    expect(cell).toEqual({ letter: "L", sampleSize: 200, accept: 0, reject: 1, arrow: "down" });
    const r = aqlPlan({ lotSize: 1000, level: "II", aql: 0.065, inspection: "normal" });
    expect(r).toMatchObject({ ok: true, codeLetter: "L", sampleSize: 200, accept: 0, reject: 1 });
    expect(r.hundredPercent).toBeUndefined();
    expect(r.working.find((w) => w.label.startsWith("Arrow"))?.value).toContain("code letter L");
  });

  it("follows an up arrow to the first plan above (lot over 500000, level III = R, AQL 1.0: arrow up to Q, n 1250, 21/22)", () => {
    const r = aqlPlan({ lotSize: 600000, level: "III", aql: 1.0, inspection: "normal" });
    expect(r).toMatchObject({ ok: true, codeLetter: "Q", sampleSize: 1250, accept: 21, reject: 22 });
    expect(r.working.find((w) => w.label.startsWith("Arrow"))?.value).toContain("up");
  });

  it("flags 100 % inspection when the plan's n is not smaller than the lot (lot 5, level II = A, AQL 1.0: arrow down to E, n 13 > 5)", () => {
    const r = aqlPlan({ lotSize: 5, level: "II", aql: 1.0, inspection: "normal" });
    expect(r).toMatchObject({ ok: true, codeLetter: "E", hundredPercent: true, sampleSize: 5, accept: 0, reject: 1 });
    expect(r.working.at(-1)?.label).toBe("Lot size check");
  });

  it("uses the reduced sample sizes for reduced inspection (L is 80, not 200)", () => {
    const r = aqlPlan({ lotSize: 5000, level: "II", aql: 0.65, inspection: "reduced" });
    expect(r.codeLetter).toBe("L");
    expect(r.sampleSize).toBe(80);
  });
});

describe("missing and invalid input", () => {
  it("lists every missing input", () => {
    const r = aqlPlan({});
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(4);
    expect(r.sampleSize).toBeUndefined();
    expect(r.problems.join(" ")).toContain("lot size");
  });

  it.each([
    [{ level: "II", aql: 1, inspection: "normal" }, "Enter the lot size."],
    [{ lotSize: 100, aql: 1, inspection: "normal" }, "Choose the inspection level (S-1 to S-4, I, II or III)."],
    [{ lotSize: 100, level: "II", inspection: "normal" }, "Choose the AQL (acceptance quality limit)."],
    [{ lotSize: 100, level: "II", aql: 1 }, "Choose the inspection severity (normal, tightened or reduced)."],
  ] as const)("one missing input %#", (input, problem) => {
    expect(aqlPlan(input as never).problems).toEqual([problem]);
  });

  it("rejects an AQL that is not in the standard rather than rounding it", () => {
    const r = aqlPlan({ lotSize: 100, level: "II", aql: 0.7, inspection: "normal" });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("AQL 0.7 is not one of the MIL-STD-105E values");
  });

  it("rejects an unknown level, an unknown severity and a lot size below 2", () => {
    expect(aqlPlan({ lotSize: 100, level: "IV" as never, aql: 1, inspection: "normal" }).ok).toBe(false);
    expect(aqlPlan({ lotSize: 100, level: "II", aql: 1, inspection: "strict" as never }).ok).toBe(false);
    expect(aqlPlan({ lotSize: 1, level: "II", aql: 1, inspection: "normal" }).ok).toBe(false);
    expect(aqlPlan({ lotSize: 12.5, level: "II", aql: 1, inspection: "normal" }).ok).toBe(false);
  });

  it("has no plan for tightened letter S outside AQL 0.025 (the standard prints none)", () => {
    expect(resolveAqlCell("tightened", "S", AQL_VALUES_105E.indexOf(1.0))).toBeNull();
    expect(resolveAqlCell("tightened", "S", AQL_VALUES_105E.indexOf(0.025))).not.toBeNull();
  });
});

describe("properties", () => {
  const combos: [AqlLevel, Inspection, number][] = [];
  for (const level of AQL_LEVELS) for (const inspection of ["normal", "tightened", "reduced"] as const) for (const aql of [0.065, 0.65, 1.0, 2.5, 4.0, 10, 100]) combos.push([level, inspection, aql]);

  it("a bigger lot never gets a smaller sample, for every level, severity and a spread of AQLs", () => {
    const lots = [2, 3, 8, 9, 15, 16, 25, 26, 50, 51, 90, 91, 150, 151, 280, 281, 500, 501, 1200, 1201, 3200, 3201, 10000, 10001, 35000, 35001, 150000, 150001, 500000, 500001, 5_000_000];
    for (const [level, inspection, aql] of combos) {
      let last = 0;
      for (const lotSize of lots) {
        const r = aqlPlan({ lotSize, level, aql, inspection });
        if (!r.ok) continue; // a cell the standard does not print
        expect(r.sampleSize!, `${level} ${inspection} AQL ${aql} lot ${lotSize}`).toBeGreaterThanOrEqual(last);
        last = r.sampleSize!;
      }
    }
  });

  it("the sample never exceeds the lot", () => {
    for (const [level, inspection, aql] of combos) {
      for (const lotSize of [2, 5, 20, 100, 1000]) {
        const r = aqlPlan({ lotSize, level, aql, inspection });
        if (r.ok) expect(r.sampleSize!).toBeLessThanOrEqual(lotSize);
      }
    }
  });
});

describe("table integrity", () => {
  const allTables = [
    ["normal", TABLE_II_A_NORMAL],
    ["tightened", TABLE_II_B_TIGHTENED],
    ["reduced", TABLE_II_C_REDUCED],
  ] as const;

  it("has 26 AQL values in increasing order", () => {
    expect(AQL_VALUES_105E).toHaveLength(26);
    for (let i = 1; i < 26; i++) expect(AQL_VALUES_105E[i]!).toBeGreaterThan(AQL_VALUES_105E[i - 1]!);
  });

  it("every table row has 26 cells, and Table II-B has letter S", () => {
    for (const [name, t] of allTables) {
      for (const [letter, row] of Object.entries(t)) expect(row, `${name} ${letter}`).toHaveLength(26);
      expect(Object.keys(t), name).toEqual(name === "tightened" ? [...CODE_LETTERS_105E, "S"] : [...CODE_LETTERS_105E]);
    }
  });

  it("every code letter at every AQL resolves to a plan, and no arrow loops or leads outside the table", () => {
    for (const [name, t] of allTables) {
      for (const letter of Object.keys(t)) {
        for (let col = 0; col < 26; col++) {
          const cell = t[letter]![col]!;
          if (cell === "") continue; // only letter S outside the 0.025 column of Table II-B
          const r = resolveAqlCell(name, letter, col);
          const order = [...CODE_LETTERS_105E, "S"] as string[];
          expect(r, `${name} ${letter} col ${col} (${cell})`).not.toBeNull();
          expect(r!.accept).toBeLessThan(r!.reject);
          expect(r!.sampleSize).toBeGreaterThan(0);
          if (cell === "v") expect(order.indexOf(r!.letter)).toBeGreaterThan(order.indexOf(letter));
          if (cell === "^") expect(order.indexOf(r!.letter)).toBeLessThan(order.indexOf(letter));
        }
      }
    }
  });

  it("blank cells exist only for tightened letter S", () => {
    for (const [name, t] of allTables) {
      for (const [letter, row] of Object.entries(t)) {
        const blanks = row.filter((c) => c === "").length;
        if (name === "tightened" && letter === "S") expect(blanks).toBe(25);
        else expect(blanks, `${name} ${letter}`).toBe(0);
      }
    }
  });

  it("acceptance numbers rise (never fall) down a column and from left to right along a staircase", () => {
    for (const [name, t] of allTables) {
      for (let col = 0; col < 26; col++) {
        let last = -1;
        for (const letter of Object.keys(t)) {
          const c = t[letter]![col]!;
          if (!c || c === "v" || c === "^") continue;
          const ac = Number(c.split("/")[0]);
          expect(ac, `${name} col ${col} letter ${letter}`).toBeGreaterThanOrEqual(last);
          last = ac;
        }
      }
    }
  });

  it("sample sizes rise with the code letter", () => {
    const sizes = CODE_LETTERS_105E.map((l) => SAMPLE_SIZE_105E[l]!);
    expect(sizes).toEqual([2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1250, 2000]);
    expect(CODE_LETTERS_105E.map((l) => SAMPLE_SIZE_105E_REDUCED[l]!)).toEqual([2, 2, 2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800]);
  });

  it("Table I has 15 lot ranges for each of the 7 levels, each a letter A to R, never falling with the lot size", () => {
    expect(TABLE_I_LOT_MAX).toHaveLength(15);
    for (const level of AQL_LEVELS) {
      const letters = TABLE_I[level]!;
      expect(letters).toHaveLength(15);
      for (let i = 1; i < 15; i++) expect(letters.charCodeAt(i) >= letters.charCodeAt(i - 1) || letters.charAt(i - 1) === "H" /* H to J skips I */).toBe(true);
      expect([...letters].every((l) => CODE_LETTERS_105E.includes(l as never))).toBe(true);
    }
  });

  it("the cells and the standard's plan sequence: Ac/Re follow 0/1, 1/2, 2/3, 3/4, 5/6, 7/8, 10/11, 14/15, 21/22 in normal inspection", () => {
    const seq = new Set(["0/1", "1/2", "2/3", "3/4", "5/6", "7/8", "10/11", "14/15", "21/22", "30/31", "44/45"]);
    for (const row of Object.values(TABLE_II_A_NORMAL)) for (const c of row) expect(c === "v" || c === "^" || seq.has(c), c).toBe(true);
  });
});

describe("cross-check against a second, independent source (Planesmuestra)", () => {
  it("has at least 40 cells in the second source", () => {
    expect(PLAN_CELLS_SECOND_SOURCE.length).toBeGreaterThanOrEqual(40);
  });

  it("Table I: all 15 x 7 code letters agree", () => {
    expect(TABLE_I_SECOND_SOURCE).toHaveLength(15);
    let compared = 0;
    TABLE_I_SECOND_SOURCE.forEach((row, lotIdx) => {
      SECOND_LEVEL_ORDER.forEach((level, j) => {
        expect(TABLE_I[level]![lotIdx], `lot range ${lotIdx} level ${level}`).toBe(row[j]);
        compared++;
      });
    });
    expect(compared).toBe(105);
    // and the lookup function lands in the same row for the first and last lot size of every range
    const first = [2, 9, 16, 26, 51, 91, 151, 281, 501, 1201, 3201, 10001, 35001, 150001, 500001];
    first.forEach((lot, lotIdx) => {
      SECOND_LEVEL_ORDER.forEach((level, j) => expect(aqlCodeLetter(lot, level), `lot ${lot} ${level}`).toBe(TABLE_I_SECOND_SOURCE[lotIdx]![j]));
    });
  });

  it("Tables II-A, II-B, II-C: every plan cell agrees in n and in the acceptance number", () => {
    for (const [sev, letter, col, n, c] of PLAN_CELLS_SECOND_SOURCE) {
      const cell = TABLES[sev as "n" | "t" | "r"][letter]![col]!;
      expect(Number(cell.split("/")[0]), `${sev} ${letter} col ${col}`).toBe(c);
      const sizes = sev === "r" ? SAMPLE_SIZE_105E_REDUCED : SAMPLE_SIZE_105E;
      expect(sizes[letter], `${sev} ${letter} n`).toBe(n);
      // and the same through the public function for a lot big enough that the plan is not 100 % inspection
      const lot = 1_000_000;
      const r = resolveAqlCell(SEVERITY[sev as "n" | "t" | "r"], letter, col)!;
      expect([r.accept, r.sampleSize]).toEqual([c, n]);
      expect(lot).toBeGreaterThan(n);
    }
    expect(PLAN_CELLS_SECOND_SOURCE).toHaveLength(440);
  });

  it("the plan cells cover all three severities and many columns", () => {
    for (const sev of ["n", "t", "r"]) expect(PLAN_CELLS_SECOND_SOURCE.filter((c) => c[0] === sev).length).toBeGreaterThan(100);
  });
});
