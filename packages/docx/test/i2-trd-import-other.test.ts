import {
  SCANNED_PDF_MESSAGE,
  applyImport,
  buildDemoProject,
  importCounts,
  importSummaryText,
  isExact,
  sessionFromOther,
  tableGrid,
  type ImportDecisions,
  type ImportSession,
} from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdImportSynonyms } from "../../../content/index";
import { readTrdPdf, readTrdUpload } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { foreignBodyXml, foreignDocx, foreignPdf, pictureOnlyPdf } from "./i2-foreign";

vi.setConfig({ testTimeout: 60000 });

// Level 3 of the TRD upload (job I2): a Word or PDF file in a layout this tool did not write. Fictional files built by ./i2-foreign.
const actor = { name: "Test reviewer", at: GENERATED_AT };
const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });

const docxSession = () => sessionFromOther(readTrdUpload(foreignDocx(), "foreign.docx"), content.catalog, trdImportSynonyms);
const get = (s: ImportSession, id: string) => s.fields.find((f) => f.id === id)!;
const P = (uo: string, key: string, part: string) => `trd.step.${uo}.param.${key}.${part}`;

describe("the Word reader keeps merged cells", () => {
  it("reads gridSpan and vMerge, and the grid lines the cells up", () => {
    const read = readTrdUpload(foreignDocx(), "foreign.docx");
    expect(read.format).toBe("docx");
    expect(read.dataKind).toBeUndefined();
    const tables = read.blocks.filter((b) => b.kind === "table");
    expect(tables).toHaveLength(3);
    const filling = tables[1]!.kind === "table" ? tables[1]!.rows : [];
    expect(filling[0]![2]).toMatchObject({ text: "Normal operating range (NOR)", colSpan: 2 });
    expect(filling[0]![0]).toMatchObject({ text: "Parameter", rowSpan: 2 });
    expect(filling[1]![0]).toMatchObject({ vContinue: true });
    const grid = tableGrid(filling);
    expect(grid.every((r) => r.length === 7)).toBe(true);
    // Both columns under the NOR group point at the same document cell.
    expect(grid[0]![2]!.text).toBe("Normal operating range (NOR)");
    expect(grid[0]![3]!.text).toBe("Normal operating range (NOR)");
    expect(grid[1]![2]!.text).toBe("Min");
  });
});

describe("level 3 matcher: a Word file in another layout", () => {
  const s = docxSession();

  it("is level 3, every field exists, and every match is 'matched', never 'exact'", () => {
    expect(s.level).toBe(3);
    const matched = s.fields.filter((f) => f.confidence === "matched");
    expect(matched.length).toBeGreaterThan(20);
    expect(s.fields.filter(isExact)).toHaveLength(0);
    expect(s.fields.filter((f) => f.confidence !== "matched").every((f) => f.confidence === "not_found" && f.value === "")).toBe(true);
    expect(importCounts(s, {}).taken).toBe(0);
  });

  it("the summary splits what was found from what the document never had (not one big 'still open' count)", () => {
    const c = importCounts(s, {});
    const matched = s.fields.filter((f) => f.confidence === "matched").length;
    expect(c.open - c.notFound).toBe(matched);
    expect(importSummaryText(c, 3)).toBe(`0 values taken, ${matched} found and waiting for you, ${c.notFound} not in this document (left open)`);
  });

  it("maps heading words to sections and 'label: value' lines to the document fields", () => {
    expect(get(s, "trd.purpose").value).toContain("Move the filling process");
    expect(get(s, "trd.purpose").source).toContain('heading "1 Aim"');
    expect(get(s, "trd.scopeNote").value).toContain("filling and filtration");
    expect(get(s, "trd.docRef").value).toBe("FX-DOC-0001");
    expect(get(s, "trd.detail.site").value).toBe("Site B (fictional)");
  });

  it("maps header words (target, NOR/PAR groups with Min/Max, unit) and row names to the parameter catalogue", () => {
    expect(get(s, P("aseptic_filling", "fill_volume", "set"))).toMatchObject({ value: "5", confidence: "matched" });
    expect(get(s, P("aseptic_filling", "fill_volume", "nor_low")).value).toBe("4.8");
    expect(get(s, P("aseptic_filling", "fill_volume", "nor_high")).value).toBe("5.2");
    expect(get(s, P("aseptic_filling", "fill_volume", "par_low")).value).toBe("4.5");
    expect(get(s, P("aseptic_filling", "fill_volume", "par_high")).value).toBe("5.5");
    expect(get(s, P("aseptic_filling", "fill_volume", "unit")).value).toBe("mL");
    expect(get(s, P("aseptic_filling", "line_speed", "unit")).value).toBe("vials/min");
  });

  it("splits ranges and limits into low/high and keeps the original text in the evidence", () => {
    const lo = get(s, P("sterile_filtration", "max_filtration_time", "nor_low"));
    expect(lo.value).toBe("20");
    expect(lo.source).toContain('"20-40"');
    expect(get(s, P("sterile_filtration", "max_filtration_time", "nor_high")).value).toBe("40");
    expect(get(s, P("sterile_filtration", "max_filtration_time", "par_high")).source).toContain('"NMT 90"');
    expect(get(s, P("sterile_filtration", "differential_pressure", "nor_low")).value).toBe("1");
    expect(get(s, P("sterile_filtration", "differential_pressure", "par_high")).source).toContain("≤ 2.5");
    expect(get(s, P("sterile_filtration", "max_filtration_time", "unit")).value).toBe("min");
  });

  it("takes the step from a sub-heading row and says so in the evidence; a strict limit is noted", () => {
    const low = get(s, P("lyophilization", "secondary_time", "par_low"));
    expect(low.value).toBe("4");
    expect(low.source).toContain('step from "Lyophilization"');
    expect(low.source).toContain("strictly greater than");
    expect(low.source).toContain('"> 4 h"');
  });

  it("evidence names the table, the row and the column (the change log keeps it)", () => {
    const f = get(s, P("aseptic_filling", "fill_volume", "nor_high"));
    expect(f.source).toMatch(/^Table 2 under "3 Filling", row "Fill volume", column Normal operating range \(NOR\) Max: "5.2"/);
  });

  it("'fill weight' is fill volume only when the unit says volume", () => {
    // The 'Fill weight' row gives grams: it is not taken for the fill volume (the 'Fill volume' row's 5 / 4.8 / ... stay).
    expect(get(s, P("aseptic_filling", "fill_volume", "set")).value).toBe("5");
    expect(s.notUsed.join("\n")).toMatch(/"fill weight" only counts as fill volume when the document gives a volume unit \(it gives "g"\)/);
    const vol = sessionFromOther(
      readTrdUpload(foreignDocx(fillWeightInMl()), "ml.docx"),
      content.catalog,
      trdImportSynonyms,
    );
    expect(get(vol, P("aseptic_filling", "fill_volume", "set"))).toMatchObject({ value: "5.1", confidence: "matched" });
    expect(get(vol, P("aseptic_filling", "fill_volume", "set")).source).toContain('row "Fill weight"');
  });

  it("does not guess: unknown rows, a bare 'Limit' column and a decimal comma go to 'Not used yet' with the reason", () => {
    const text = s.notUsed.join("\n");
    expect(text).toMatch(/row "Mixing speed".*no parameter with that name is known in/);
    expect(text).toMatch(/column "Limit" was not used because the heading "Limit" does not say whether it is a NOR or a PAR value/);
    expect(text).toMatch(/"NMT 120 min" was not used/);
    expect(text).toMatch(/"0,1 mbar" was not used because it uses a comma between digits/);
    // The comma value is not in any field, and neither is the limit.
    expect(s.fields.some((f) => f.value.includes("0,1") || f.source.includes("NMT 120") || f.source.includes("0,1 mbar"))).toBe(false);
  });

  it("lists important text that no field took (numbers with units, shall/must/limit)", () => {
    expect(s.notUsed.join("\n")).toContain('text "The filling operator shall check the fill volume every 30 minutes." was not matched to a field.');
  });

  it("names the tables that gave matches, in document order, and tags each matched field with its table", () => {
    expect(s.matchedTables!.map((t) => t.label)).toEqual(['Table 1 under "2 Field of application"', 'Table 2 under "3 Filling"', 'Table 3 under "4 Filtration"']);
    const f = get(s, P("aseptic_filling", "fill_volume", "set"));
    expect(s.matchedTables!.some((t) => t.block === f.table)).toBe(true);
    expect(s.fieldCells[f.id]!.length).toBeGreaterThan(0);
  });
});

describe("level 3: accepting matches puts them in the TRD with their evidence", () => {
  it("applies only what the person took; the rest stays open", () => {
    const s = docxSession();
    const dec: ImportDecisions = {};
    const fillingBlock = get(s, P("aseptic_filling", "fill_volume", "set")).table;
    // "Accept all matched in this table": every matched field that came from that table.
    for (const f of s.fields) if (f.confidence === "matched" && f.table === fillingBlock) dec[f.id] = { value: f.value };
    expect(Object.keys(dec).length).toBeGreaterThan(5);
    const r = applyImport(project, s, dec, { actor, target: { kind: "new", title: "Imported from another layout" } });
    expect(r.counts.taken).toBe(Object.keys(dec).length);
    const made = r.project.trd.documents.find((x) => x.id === r.trdId)!;
    const item = made.steps.find((x) => x.key === "aseptic_filling")!.items.find((i) => i.key === "fill_volume")!;
    expect(item.limits).toMatchObject({ setPoint: { value: 5, unit: "mL" }, nor: { min: 4.8, max: 5.2, unit: "mL" }, par: { min: 4.5, max: 5.5, unit: "mL" } });
    // Nothing from the other table was taken.
    expect(made.steps.find((x) => x.key === "sterile_filtration")?.items.find((i) => i.key === "differential_pressure")?.limits).toBeUndefined();
    const log = r.project.changeLog.find((e) => e.action === "trd_import")!;
    expect(log.detail).toContain("Imported from foreign.docx");
    // The evidence of every value (table, row, column, the original text) is kept in the change log entry.
    const ev = (log.after as { evidence: { field: string; value: string; source: string }[] }).evidence;
    expect(ev).toHaveLength(Object.keys(dec).length);
    expect(ev.find((e) => e.field === P("aseptic_filling", "fill_volume", "nor_high"))).toMatchObject({ value: "5.2", source: expect.stringContaining('row "Fill volume", column Normal operating range (NOR) Max: "5.2"') });
  });
});

describe("level 3: the PDF reader", () => {
  it("reads headings, a paragraph and a column table, and the matcher fills from it", async () => {
    const read = await readTrdPdf(await foreignPdf(), "report.pdf");
    expect(read.format).toBe("pdf");
    expect(read.noText).toBeUndefined();
    expect(read.blocks.filter((b) => b.kind === "heading").map((b) => (b.kind === "heading" ? b.text : ""))).toEqual(
      expect.arrayContaining(["1 Objective", "2 Sterile filtration"]),
    );
    const t = read.blocks.find((b) => b.kind === "table");
    expect(t?.kind === "table" && t.rows).toHaveLength(3);
    expect(t?.kind === "table" && t.rows[0]!.map((c) => c.text)).toEqual(["Parameter", "Set point", "NOR min", "NOR max", "PAR max", "Unit"]);
    expect(t?.page).toBe(1);

    const s = sessionFromOther(read, content.catalog, trdImportSynonyms);
    expect(get(s, P("sterile_filtration", "max_filtration_time", "set"))).toMatchObject({ value: "60", confidence: "matched" });
    expect(get(s, P("sterile_filtration", "max_filtration_time", "nor_low")).value).toBe("40");
    expect(get(s, P("sterile_filtration", "max_filtration_time", "par_high")).value).toBe("90");
    expect(get(s, P("sterile_filtration", "max_filtration_time", "unit")).value).toBe("min");
    expect(get(s, P("sterile_filtration", "differential_pressure", "nor_high")).value).toBe("2");
    expect(get(s, P("sterile_filtration", "differential_pressure", "set")).source).toMatch(/^Page 1, table 1 under "2 Sterile filtration", row "Differential pressure"/);
    expect(get(s, "trd.purpose").source).toContain("Page 1");
    expect(s.fields.filter(isExact)).toHaveLength(0);
    expect(s.notUsed.join("\n")).toContain("integrity tested after use");
  });

  it("a PDF with no text layer says so in plain words and has nothing to read", async () => {
    const read = await readTrdPdf(await pictureOnlyPdf(), "scan.pdf");
    expect(read.noText).toBe(true);
    expect(read.blocks).toEqual([]);
    expect(SCANNED_PDF_MESSAGE).toBe("This PDF is a picture of text; save it from the original file as .docx or a text PDF.");
  });
});

/** The foreign body with the "Fill volume" row dropped and the "Fill weight" row given in mL: then the weight row is a fill volume. */
function fillWeightInMl(): string {
  const xml = foreignBodyXml();
  const rowOf = (x: string, name: string) => [x.lastIndexOf("<w:tr>", x.indexOf(">" + name + "<")), x.indexOf("</w:tr>", x.indexOf(">" + name + "<")) + 7] as const;
  const [a, b] = rowOf(xml, "Fill volume");
  const without = xml.slice(0, a) + xml.slice(b);
  const [c, d] = rowOf(without, "Fill weight");
  return without.slice(0, c) + without.slice(c, d).replace(">g<", ">mL<") + without.slice(d);
}
