import { describe, expect, it } from "vitest";
import { companySamplingTableSchema, companyTablePlan, validateCompanyTable, type CompanySamplingTable } from "../../src/index";

const table: CompanySamplingTable = {
  id: "t1",
  name: "Fictional sampling table",
  version: "2",
  documentRef: "DOC-0001",
  owner: "Quality",
  rows: [
    { lotMin: 1, lotMax: 50, sampleSize: 5, accept: 0, reject: 1 },
    { lotMin: 51, lotMax: 500, sampleSize: 20, accept: 1, reject: 2 },
    { lotMin: 501, lotMax: null, sampleSize: 50, accept: 2, reject: 3 },
  ],
};

describe("companyTablePlan", () => {
  it("finds the row that holds the lot size, at the edges of each range", () => {
    const n = (lotSize: number) => companyTablePlan({ table, lotSize }).sampleSize;
    expect([n(60), n(51), n(500), n(501), n(1_000_000)]).toEqual([20, 20, 20, 50, 50]);
    const r = companyTablePlan({ table, lotSize: 200 });
    expect(r).toMatchObject({ method: "company-table", ok: true, problems: [], sampleSize: 20, accept: 1, reject: 2 });
    expect(r.working.length).toBeGreaterThan(3);
  });

  it("cites the table name, version and document reference", () => {
    const r = companyTablePlan({ table, lotSize: 200 });
    expect(r.citation).toContain("Fictional sampling table");
    expect(r.citation).toContain("version 2");
    expect(r.citation).toContain("DOC-0001");
  });

  it("never extrapolates: a lot size outside every row is a problem and has no sample size", () => {
    const closed: CompanySamplingTable = { ...table, rows: table.rows.slice(0, 2) };
    const r = companyTablePlan({ table: closed, lotSize: 501 });
    expect(r.ok).toBe(false);
    expect(r.sampleSize).toBeUndefined();
    expect(r.problems).toEqual(["Lot size 501 is outside table Fictional sampling table v2."]);
  });

  it("asks for the lot size when it is missing, and rejects a lot size that is not a whole number", () => {
    expect(companyTablePlan({ table }).problems).toEqual(["Enter the lot size."]);
    expect(companyTablePlan({ table, lotSize: 0 }).ok).toBe(false);
    expect(companyTablePlan({ table, lotSize: 10.5 }).ok).toBe(false);
  });

  it("reports a table with no rows", () => {
    const r = companyTablePlan({ table: { ...table, rows: [] }, lotSize: 10 });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("has no rows");
  });

  it("uses the rows of the chosen test when the table is per test, and asks for the test when it is missing", () => {
    const perTest: CompanySamplingTable = {
      ...table,
      rows: [
        { lotMin: 1, lotMax: null, sampleSize: 3, testKey: "assay" },
        { lotMin: 1, lotMax: null, sampleSize: 8, testKey: "micro" },
      ],
    };
    expect(companyTablePlan({ table: perTest, lotSize: 100, testKey: "assay" }).sampleSize).toBe(3);
    expect(companyTablePlan({ table: perTest, lotSize: 100, testKey: "micro" }).sampleSize).toBe(8);
    expect(companyTablePlan({ table: perTest, lotSize: 100 }).problems.join(" ")).toContain("choose the test");
    const unknown = companyTablePlan({ table: perTest, lotSize: 100, testKey: "other" });
    expect(unknown.ok).toBe(false);
    expect(unknown.problems[0]).toContain('for test "other"');
  });

  it("does not use a row for a different test", () => {
    const perTest: CompanySamplingTable = { ...table, rows: [{ lotMin: 1, lotMax: 10, sampleSize: 3, testKey: "assay" }, { lotMin: 11, lotMax: null, sampleSize: 8, testKey: "micro" }] };
    expect(companyTablePlan({ table: perTest, lotSize: 20, testKey: "assay" }).ok).toBe(false);
  });

  it("refuses to pick between overlapping rows", () => {
    const overlap: CompanySamplingTable = { ...table, rows: [{ lotMin: 1, lotMax: 100, sampleSize: 5 }, { lotMin: 50, lotMax: null, sampleSize: 9 }] };
    const r = companyTablePlan({ table: overlap, lotSize: 70 });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("More than one row");
  });

  it("flags 100 % inspection when the sample is not smaller than the lot", () => {
    const r = companyTablePlan({ table, lotSize: 5 });
    expect(r.hundredPercent).toBe(true);
    expect(r.sampleSize).toBe(5);
  });

  it("never gives a smaller sample for a bigger lot (monotone table)", () => {
    let last = 0;
    for (let lot = 6; lot <= 2000; lot++) {
      const n = companyTablePlan({ table, lotSize: lot }).sampleSize!;
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });
});

describe("validateCompanyTable", () => {
  it("accepts a clean table", () => {
    expect(validateCompanyTable(table)).toEqual([]);
  });

  it("reports a gap between rows", () => {
    const t = { ...table, rows: [{ lotMin: 1, lotMax: 50, sampleSize: 5 }, { lotMin: 60, lotMax: null, sampleSize: 20 }] };
    expect(validateCompanyTable(t).join("\n")).toContain("lot sizes 51 to 59 are not covered");
  });

  it("reports overlapping rows, including a row after an open-ended one", () => {
    const t = { ...table, rows: [{ lotMin: 1, lotMax: 60, sampleSize: 5 }, { lotMin: 50, lotMax: 100, sampleSize: 20 }] };
    expect(validateCompanyTable(t).join("\n")).toContain("overlap");
    const open = { ...table, rows: [{ lotMin: 1, lotMax: null, sampleSize: 5 }, { lotMin: 100, lotMax: 200, sampleSize: 20 }] };
    expect(validateCompanyTable(open).join("\n")).toContain("no upper limit");
  });

  it("reports rows out of order", () => {
    const t = { ...table, rows: [{ lotMin: 51, lotMax: null, sampleSize: 20 }, { lotMin: 1, lotMax: 50, sampleSize: 5 }] };
    expect(validateCompanyTable(t).join("\n")).toContain("out of order");
  });

  it("reports lotMax below lotMin, a sample size below 1, accept not below reject, and a sample larger than the largest lot", () => {
    const t = { ...table, rows: [{ lotMin: 10, lotMax: 5, sampleSize: 0, accept: 2, reject: 2 }] };
    const text = validateCompanyTable(t).join("\n");
    expect(text).toContain("largest lot size is smaller than the smallest");
    expect(text).toContain("sample size must be 1 or more");
    expect(text).toContain("accept number must be smaller than the reject number");
    const big = { ...table, rows: [{ lotMin: 1, lotMax: 10, sampleSize: 20 }] };
    expect(validateCompanyTable(big).join("\n")).toContain("larger than the largest lot");
  });

  it("checks each test on its own", () => {
    const t = { ...table, rows: [{ lotMin: 1, lotMax: null, sampleSize: 3, testKey: "a" }, { lotMin: 1, lotMax: null, sampleSize: 4, testKey: "b" }] };
    expect(validateCompanyTable(t)).toEqual([]);
  });

  it("reports a table with no rows", () => {
    expect(validateCompanyTable({ ...table, rows: [] })).toEqual(["The table has no rows."]);
  });
});

describe("companySamplingTableSchema", () => {
  it("accepts a table and rejects a sample size below 1 or a missing name", () => {
    expect(companySamplingTableSchema.safeParse(table).success).toBe(true);
    expect(companySamplingTableSchema.safeParse({ ...table, rows: [{ lotMin: 1, lotMax: null, sampleSize: 0 }] }).success).toBe(false);
    expect(companySamplingTableSchema.safeParse({ ...table, name: "" }).success).toBe(false);
  });
});
