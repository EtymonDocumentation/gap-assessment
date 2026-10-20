/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { importTemplateFile, renderDocx, suggestMapping, type RenderDocxInput } from "../src/index";
import { columnNeeds, columnWidths } from "../src/writer";
import { GENERATED_AT, buildModel, fixture } from "./fixtures";
import { strictDocx, type StrictResult } from "./strict";

// Rendering and strictly checking whole documents takes several seconds on a busy machine.
vi.setConfig({ testTimeout: 60000 });

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const model = buildModel();

interface ParsedTable {
  columns: string[];
  rows: string[][];
  grid: number[];
  tblW: number;
  tcW: number[][];
  fixed: boolean;
  /** Text of the paragraph before the table, to tell tables apart in messages. */
  index: number;
}

const kids = (e: Element, local: string): Element[] => Array.from({ length: e.childNodes.length }, (_, i) => e.childNodes.item(i) as Element).filter((n) => n.nodeType === 1 && n.localName === local);

function parseTables(res: StrictResult, part = "word/document.xml"): ParsedTable[] {
  const doc = res.xml.get(part)!;
  const list = doc.getElementsByTagNameNS(NS_W, "tbl");
  const out: ParsedTable[] = [];
  for (let i = 0; i < list.length; i++) {
    const tbl = list.item(i)!;
    const trs = kids(tbl, "tr");
    const cells = trs.map((tr) => kids(tr, "tc"));
    const text = (tc: Element) => tc.textContent ?? "";
    const num = (e: Element | undefined) => Number(e?.getAttributeNS(NS_W, "w") ?? e?.getAttribute("w:w") ?? NaN);
    const tblPr = kids(tbl, "tblPr")[0]!;
    out.push({
      columns: cells[0]!.map(text),
      rows: cells.slice(1).map((r) => r.map(text)),
      grid: kids(kids(tbl, "tblGrid")[0]!, "gridCol").map((g) => num(g)),
      tblW: num(kids(tblPr, "tblW")[0]),
      tcW: cells.map((r) => r.map((tc) => num(kids(kids(tc, "tcPr")[0]!, "tcW")[0]))),
      fixed: kids(tblPr, "tblLayout")[0]?.getAttributeNS(NS_W, "type") === "fixed",
      index: i,
    });
  }
  return out;
}

async function render(mode: RenderDocxInput["mode"], file?: string, map = false) {
  const t = file ? await importTemplateFile(file, fixture(file)) : undefined;
  const out = await renderDocx({
    doc: model.doc,
    tagData: model.tagData,
    mode,
    generatedAt: GENERATED_AT,
    ...(t ? { template: { name: "Brightwater (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis, ...(map ? { mapping: suggestMapping(t.analysis, model.doc) } : {}) } } : {}),
  });
  return strictDocx(out.bytes);
}

/** The font size the tool's own table text style has (8 pt); the tests recompute the needs with it. */
const TABLE_PT = 8;

function checkTables(res: StrictResult, allowedTotals: number[]) {
  const tables = parseTables(res);
  expect(tables.length).toBeGreaterThan(5);
  for (const t of tables) {
    const label = `table ${t.index} (${t.columns.slice(0, 3).join(" | ")})`;
    expect(t.fixed, label).toBe(true);
    expect(t.grid.length, label).toBe(t.columns.length);
    const sum = t.grid.reduce((a, b) => a + b, 0);
    expect(sum, label).toBe(t.tblW);
    expect(allowedTotals, label).toContain(t.tblW);
    for (const row of t.tcW) expect(row, label).toEqual(t.grid);
    const header = t.columns;
    const needs = columnNeeds(header, t.rows, TABLE_PT, header[0] === "Item" && t.columns.length === 2);
    const minSum = needs.min.reduce((a, b) => a + b, 0);
    if (minSum <= t.tblW) t.grid.forEach((w, i) => expect(w, `${label}, column ${i + 1} "${header[i]}"`).toBeGreaterThanOrEqual(needs.min[i]! - 1));
    else {
      // Not everything can fit: only the widest minimums are squeezed, all to the same width; the others keep their whole words.
      const squeezed = t.grid.filter((w, i) => w < needs.min[i]! - 1);
      expect(squeezed.length, label).toBeGreaterThan(0);
      expect(Math.max(...squeezed) - Math.min(...squeezed), label).toBeLessThanOrEqual(t.grid.length + 1);
      t.grid.forEach((w, i) => {
        if (needs.min[i]! <= Math.min(...squeezed)) expect(w, `${label}, column ${i + 1}`).toBeGreaterThanOrEqual(needs.min[i]! - 1);
      });
    }
  }
  return tables;
}

describe("content-aware column widths", () => {
  it("never makes a column narrower than its longest word, and fills the width, in the portrait their-look output", async () => {
    const res = await render("their_look", "brightwater-template.docx");
    // Portrait Letter with 1-inch margins is 9360 wide; the wide gap table gets a landscape section of 12960.
    const tables = checkTables(res, [9360, 12960]);
    expect(tables.some((t) => t.tblW === 12960)).toBe(true);
  });

  it("does the same in the mapped output, and in the built-in output (A4 landscape, 15138)", async () => {
    checkTables(await render("their_look", "brightwater-template.docx"), [9360, 12960]);
    checkTables(await render("mapped", "brightwater-template.docx", true), [9360, 12960]);
    const builtin = await render("builtin");
    const tables = checkTables(builtin, [15138]);
    const gap = tables.find((t) => t.columns.includes("Attribute") && t.columns.includes("Rule"))!;
    expect(gap.columns.length).toBeGreaterThanOrEqual(15);
    expect(gap.grid.reduce((a, b) => a + b, 0)).toBe(15138);
  });

  it("keeps the words of the headers whole: Verification, Unverified, Presentation, Containment", async () => {
    const res = await render("their_look", "brightwater-template.docx");
    // The 15-column gap table cannot keep every word whole; it is checked in the test above.
    const tables = parseTables(res).filter((t) => columnNeeds(t.columns, t.rows, TABLE_PT).min.reduce((a, b) => a + b, 0) <= t.tblW);
    const widthOfWord = (word: string, bold: boolean) => columnNeeds([bold ? word : "x"], bold ? [] : [[word]], TABLE_PT).min[0]!;
    let seen = 0;
    for (const t of tables) {
      t.columns.forEach((h, i) => {
        for (const w of h.split(/\s+/)) {
          if (/^(Verification|Unverified|Presentation|Containment|Validated|Background)$/.test(w)) {
            seen++;
            expect(t.grid[i]!, `header word ${w}`).toBeGreaterThanOrEqual(widthOfWord(w, true) - 1);
          }
        }
      });
      t.rows.forEach((r) =>
        r.forEach((cell, i) => {
          for (const w of cell.split(/\s+/)) if (/^(Unverified|Presentation|Containment|Validated)$/.test(w)) expect(t.grid[i]!, `cell word ${w}`).toBeGreaterThanOrEqual(widthOfWord(w, false) - 1);
        }),
      );
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("allocation rules: minimums first, the rest by wish, scaled only when the minimums do not fit", () => {
    const cols = ["Attribute", "Verification", "Notes"];
    const rows = [
      ["Concentration", "Unverified", "A fairly long note about the value that should get most of the spare room in the table"],
      ["pH", "Verified", "Short"],
    ];
    const total = 9360;
    const w = columnWidths(cols, rows, total, 10);
    expect(w.reduce((a, b) => a + b, 0)).toBe(total);
    const needs = columnNeeds(cols, rows, 10);
    w.forEach((x, i) => expect(x).toBeGreaterThanOrEqual(needs.min[i]!));
    expect(w[2]!).toBeGreaterThan(w[0]!);
    // Too narrow: widths still add up, and are scaled in proportion.
    const tight = columnWidths(cols, rows, 1500, 10);
    expect(tight.reduce((a, b) => a + b, 0)).toBe(1500);
    expect(tight.every((x) => x > 0)).toBe(true);
    // A short column (an ID) stays whole while the long ones give way.
    const mixed = columnWidths(["ID", "Verification of the attribute", "Everything else"], [["G-1", "Unverified", "x"]], 2000, 8);
    expect(mixed[0]!).toBeGreaterThanOrEqual(columnNeeds(["ID"], [["G-1"]], 8).min[0]! - 1);
    expect(mixed.reduce((a, b) => a + b, 0)).toBe(2000);
    // Empty table body and a single column.
    expect(columnWidths(["Only"], [], 5000, 10)).toEqual([5000]);
    expect(columnWidths([], [], 5000, 10)).toEqual([]);
  });

  it("is deterministic and survives hostile cell text", () => {
    const rows = [["\u{1F600}".repeat(50), "a\nb\n" + "x".repeat(300), "<w:p>"]];
    const a = columnWidths(["A", "B", "C"], rows, 9000, 8);
    expect(a).toEqual(columnWidths(["A", "B", "C"], rows, 9000, 8));
    expect(a.reduce((x, y) => x + y, 0)).toBe(9000);
  });
});

describe("page header spacing", () => {
  it("the built-in header leaves a clear gap before the body, and the footer before the page number", async () => {
    const res = await render("builtin");
    const hdr = res.text("word/header1.xml");
    const paras = hdr.match(/<w:p>[\s\S]*?<\/w:p>/g)!;
    const last = paras[paras.length - 1]!;
    expect(Number(/<w:spacing[^>]*w:after="(\d+)"/.exec(last)![1])).toBeGreaterThanOrEqual(160);
    const ftr = res.text("word/footer1.xml");
    expect(Number(/<w:spacing[^>]*w:before="(\d+)"/.exec(ftr)![1])).toBeGreaterThanOrEqual(120);
  });

  it("the customer's own header and footer are kept exactly as they were", async () => {
    const original = (await import("pizzip")).default;
    const zip = new original(fixture("brightwater-template.docx"));
    const res = await render("their_look", "brightwater-template.docx");
    expect(res.text("word/header1.xml")).toBe(zip.file("word/header1.xml")!.asText());
    expect(res.text("word/footer1.xml")).toBe(zip.file("word/footer1.xml")!.asText());
  });
});
