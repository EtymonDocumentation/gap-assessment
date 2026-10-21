/// <reference types="node" />
import { assess, buildDemoProject, type DocModel } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos } from "../../../content/index";
import { importTemplateFile, renderDocx, suggestMapping, buildTagData, type RenderDocxInput } from "../src/index";
import { COVER_LABELS } from "../src/front";
import { CATEGORY_TINTS, NEUTRAL_TINT, SEVERITY_TINTS, ZEBRA_FILL } from "../src/palette";
import { ALL_SECTION_IDS, BANNER_TEXT, REGULATORY, contractModel, gapSpecs, type ContractOptions } from "./contract-model";
import { GENERATED_AT, buildModel, fixture } from "./fixtures";
import { plainText, strictDocx, type StrictResult } from "./strict";

// Rendering and strictly checking whole documents takes several seconds on a busy machine.
vi.setConfig({ testTimeout: 60000 });

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const real = buildModel();

async function renderDoc(doc: DocModel, mode: RenderDocxInput["mode"] = "builtin"): Promise<StrictResult> {
  const out = await renderDocx({ doc, tagData: real.tagData, mode, generatedAt: GENERATED_AT });
  return strictDocx(out.bytes);
}

const kids = (e: Element, local: string): Element[] => Array.from({ length: e.childNodes.length }, (_, i) => e.childNodes.item(i) as Element).filter((n) => n.nodeType === 1 && n.localName === local);
const all = (e: Document | Element, local: string): Element[] => {
  const list = e.getElementsByTagNameNS(NS_W, local);
  return Array.from({ length: list.length }, (_, i) => list.item(i)!);
};
const wAttr = (e: Element | undefined, local: string): string | undefined => e?.getAttributeNS(NS_W, local) || undefined;
const text = (e: Element) => e.textContent ?? "";
const rowsOf = (tbl: Element) => kids(tbl, "tr").map((tr) => kids(tr, "tc"));
const fillOf = (tc: Element): string | undefined => wAttr(kids(kids(tc, "tcPr")[0]!, "shd")[0], "fill");

function findTable(res: StrictResult, headers: string[]): Element {
  for (const tbl of all(res.xml.get("word/document.xml")!, "tbl")) {
    const first = rowsOf(tbl)[0]?.map(text) ?? [];
    if (headers.every((h) => first.includes(h))) return tbl;
  }
  throw new Error(`no table with columns ${headers.join(", ")}`);
}

function factsOf(res: StrictResult, firstLabel: string): Map<string, string> {
  for (const tbl of all(res.xml.get("word/document.xml")!, "tbl")) {
    const rows = rowsOf(tbl);
    if (rows[0]?.length === 2 && text(rows[0][0]!) === firstLabel) return new Map(rows.map((r) => [text(r[0]!), text(r[1]!)]));
  }
  throw new Error(`no facts table starting with ${firstLabel}`);
}

const styleOf = (res: StrictResult, id: string) => all(res.xml.get("word/styles.xml")!, "style").find((s) => wAttr(s, "styleId") === id)!;

describe("SU and RU in the front matter", () => {
  it("names the two sites and their program stages with the full terms on the cover", async () => {
    const res = await renderDoc(contractModel());
    const facts = factsOf(res, "Program");
    expect([...facts.keys()]).toEqual(["Program", "Product", COVER_LABELS.suSite, COVER_LABELS.suStage, COVER_LABELS.ruSite, COVER_LABELS.ruStage, "Status", "Generated"]);
    expect(facts.get("Sending unit (SU) site")).toBe("Site North (fictional), Line 2");
    expect(facts.get("Receiving unit (RU) site")).toBe("Site South (fictional), Line 4");
    expect(facts.get("Sending unit (SU) program stage")).toBe("Commercial (process validated)");
    expect(facts.get("Receiving unit (RU) program stage")).toBe("Clinical (GMP, not process validated)");
  });

  it("has no cover or document-control label that calls a site source or target", async () => {
    const res = await renderDoc(contractModel());
    const doc = res.xml.get("word/document.xml")!;
    const labels = all(doc, "tbl").flatMap((t) => rowsOf(t).map((r) => text(r[0]!)));
    expect(labels.filter((l) => /^(source|target)\b/i.test(l))).toEqual([]);
  });
});

describe("compact layout of the built-in look", () => {
  it("sets table text to 8 pt without paragraph spacing, headers to 8.5 pt bold, and tight cell padding", async () => {
    const res = await renderDoc(contractModel());
    const tableText = styleOf(res, "GapTableText");
    expect(wAttr(all(tableText, "sz")[0], "val")).toBe("16");
    const sp = all(tableText, "spacing")[0]!;
    expect(wAttr(sp, "before")).toBe("0");
    expect(wAttr(sp, "after")).toBe("0");
    const gap = findTable(res, ["ID", "Attribute", "SU", "RU", "Gap"]);
    const mar = kids(kids(gap, "tblPr")[0]!, "tblCellMar")[0]!;
    expect(wAttr(kids(mar, "top")[0], "w")).toBe("25");
    expect(wAttr(kids(mar, "bottom")[0], "w")).toBe("25");
    expect(wAttr(kids(mar, "left")[0], "w")).toBe("70");
    const [head, first] = rowsOf(gap);
    for (const tc of head!) {
      expect(wAttr(all(tc, "sz")[0], "val"), text(tc)).toBe("17");
      expect(all(tc, "b").length, text(tc)).toBeGreaterThan(0);
    }
    // Body cells carry no size of their own: they take the 8 pt of the style.
    expect(all(first![0]!, "sz").length).toBe(0);
  });

  it("tightens body spacing and heading spacing but keeps the heading sizes", async () => {
    const res = await renderDoc(contractModel());
    const styles = res.xml.get("word/styles.xml")!;
    const dflt = all(styles, "pPrDefault")[0]!;
    const sp = all(dflt, "spacing")[0]!;
    expect(Number(wAttr(sp, "after"))).toBeLessThan(120);
    expect(Number(wAttr(sp, "line"))).toBeLessThan(264);
    const sizes = [1, 2, 3].map((n) => wAttr(all(styleOf(res, `Heading${n}`), "sz")[0], "val"));
    expect(sizes).toEqual(["28", "24", "22"]);
    const before = [1, 2, 3].map((n) => Number(wAttr(all(styleOf(res, `Heading${n}`), "spacing")[0], "before")));
    expect(before[0]).toBeGreaterThan(before[1]!);
    expect(before[1]).toBeGreaterThan(before[2]!);
    expect(before[0]).toBeLessThan(360);
  });

  it("does not change the table text of the customer's look: their table style is added unchanged", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const out = await renderDocx({
      doc: contractModel(),
      tagData: real.tagData,
      mode: "their_look",
      generatedAt: GENERATED_AT,
      template: { name: "Brightwater (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis },
    });
    const res = strictDocx(out.bytes);
    const gap = findTable(res, ["ID", "Attribute", "SU", "RU", "Gap"]);
    const mar = kids(kids(gap, "tblPr")[0]!, "tblCellMar")[0]!;
    expect(wAttr(kids(mar, "top")[0], "w")).toBe("40");
    expect(wAttr(kids(mar, "left")[0], "w")).toBe("80");
    for (const tc of rowsOf(gap)[0]!) expect(all(tc, "sz").length, text(tc)).toBe(0);
  });
});

describe("tints in the lean gap table", () => {
  for (const variant of ["validated", "su"] as const) {
    it(`tints the Gap cell by its category label and the Severity cell by its severity, text always present (${variant})`, async () => {
      const doc = contractModel({ variant });
      const res = await renderDoc(doc);
      const rows = rowsOf(findTable(res, ["ID", "Attribute", "SU", "RU", "Gap", "Severity", "Actions", "Notes"]));
      const header = rows[0]!.map(text);
      const g = header.indexOf("Gap");
      const sev = header.indexOf("Severity");
      const seen = new Set<string>();
      for (const [i, r] of rows.slice(1).entries()) {
        const gapText = text(r[g]!);
        const sevText = text(r[sev]!);
        expect(gapText, gapText).toMatch(/^[^.]+\. ./);
        expect(sevText).not.toBe("");
        const tint = CATEGORY_TINTS.find((c) => c.match.test(gapText.toLowerCase()));
        // The category label decides the shading; a label nobody knows gets the neutral grey, never no text.
        expect(fillOf(r[g]!), gapText).toBe(tint ? tint.fill : NEUTRAL_TINT);
        seen.add(tint?.key ?? "unknown");
        const key = /^(high|medium|low|none)/i.exec(sevText)![1]!.toLowerCase() as keyof typeof SEVERITY_TINTS;
        expect(fillOf(r[sev]!), sevText).toBe(SEVERITY_TINTS[key]);
        // Columns without a tint keep the zebra rows.
        expect(fillOf(r[header.indexOf("Attribute")]!), `row ${i + 1}`).toBe(i % 2 === 1 ? ZEBRA_FILL : undefined);
      }
      // Within / outside, different principle, scale, new, removed, information required, and the unknown label: eight different kinds.
      expect(seen).toEqual(new Set(["within_validated_range", "outside_validated_range", "different_principle", "scale_change", "new_requirement", "removed_element", "information_required", "unknown"]));
    });
  }

  it("leaves the Gap details table untinted apart from zebra rows, with the regulatory wording in words", async () => {
    const res = await renderDoc(contractModel());
    const rows = rowsOf(findTable(res, ["ID", "Rule", "Owner", "Status", "Regulatory", "SU verification", "RU verification"]));
    expect(rows.length).toBe(9);
    rows.slice(1).forEach((r, i) => r.forEach((tc) => expect(fillOf(tc)).toBe(i % 2 === 1 ? ZEBRA_FILL : undefined)));
    expect(rows.slice(1).map((r) => text(r[4]!))).toContain(REGULATORY);
  });

  it("writes the banner once as a box on the cover and keeps the exact banner text", async () => {
    const res = await renderDoc(contractModel());
    expect(plainText(res)).toContain(BANNER_TEXT);
    expect(plainText(res, "word/header1.xml")).toContain(BANNER_TEXT);
  });
});

describe("any subset of sections", () => {
  const MANDATORY = ["purpose", "scope", "gap-table", "open-items"];
  const subsets: [string, string[]][] = [
    ["everything", ALL_SECTION_IDS],
    ["no approval", ALL_SECTION_IDS.filter((id) => id !== "approval")],
    ["no appendices", ALL_SECTION_IDS.filter((id) => id !== "gap-details" && id !== "source-register")],
    ["no validation plan and no approval", ALL_SECTION_IDS.filter((id) => id !== "validation-plan" && id !== "approval")],
    ["the mandatory sections only", MANDATORY],
    ["the gap table and Gap details only", ["gap-table", "gap-details"]],
    ["appendices only", ["gap-details", "source-register"]],
    ["nothing at all", []],
  ];

  for (const [name, keep] of subsets) {
    it(`renders cover, contents and document control, and exactly the headings that are kept: ${name}`, async () => {
      const doc = contractModel({ keep });
      const res = await renderDoc(doc);
      const t = plainText(res);
      expect(t).toContain(BANNER_TEXT);
      expect(t).toContain("Contents");
      expect(t).toContain("Document control");
      expect(res.text("word/document.xml")).toMatch(/TOC \\o/);
      const heading1 = all(res.xml.get("word/document.xml")!, "p")
        .filter((p) => wAttr(kids(kids(p, "pPr")[0] ?? p, "pStyle")[0], "val") === "Heading1")
        .map(text);
      const expected = doc.sections.map((s) => (s.appendix ? `Appendix ${s.number}. ${s.title}` : `${s.number}. ${s.title}`));
      // Document control is the only other level-1 heading; numbers follow the sections that are there.
      expect(heading1.filter((h) => h !== "Document control")).toEqual(expected);
      // The omitted-sections line reaches the document summary.
      const summary = rowsOf(findTable(res, ["Item", "Value"])).map((r) => r.map(text));
      expect(summary).toContainEqual(["Sections omitted", doc.meta.find(([k]) => k === "Sections omitted")![1]]);
    });
  }

  it("numbers sections 1, 2, 3 and appendices A, B again after sections are left out", () => {
    const doc = contractModel({ keep: ["purpose", "gap-table", "open-items", "source-register"] });
    expect(doc.sections.map((s) => s.number)).toEqual(["1", "2", "3", "A"]);
  });
});

describe("the other modes with the new columns and the Gap details appendix", () => {
  async function other(mode: "their_look" | "mapped" | "tags", file: string, opts: ContractOptions = {}): Promise<StrictResult> {
    const t = await importTemplateFile(file, fixture(file));
    const doc = contractModel(opts);
    const out = await renderDocx({
      doc,
      tagData: real.tagData,
      mode,
      generatedAt: GENERATED_AT,
      template: { name: "Brightwater (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis, ...(mode === "mapped" ? { mapping: suggestMapping(t.analysis, doc) } : {}) },
    });
    return strictDocx(out.bytes);
  }

  it("their look writes both new tables in full, and keeps the customer's look", async () => {
    const res = await other("their_look", "brightwater-template.docx");
    const gap = rowsOf(findTable(res, ["ID", "Attribute", "SU", "RU", "Gap"]));
    expect(gap.length).toBe(9);
    expect(rowsOf(findTable(res, ["ID", "Rule", "SU verification", "RU verification"])).length).toBe(9);
    expect(res.text("word/styles.xml")).toContain("Georgia");
    expect(res.text("word/document.xml")).not.toContain("<w:titlePg/>");
  });

  it("mapped writes the Gap details appendix under a heading of its own, or appended, and loses no row", async () => {
    const res = await other("mapped", "brightwater-template.docx");
    expect(rowsOf(findTable(res, ["ID", "Rule", "SU verification", "RU verification"])).length).toBe(9);
    expect(plainText(res)).toContain("Gap details");
    expect(plainText(res)).toContain(BANNER_TEXT);
  });

  it("mapped and their look cope with a document that left sections out", async () => {
    for (const mode of ["their_look", "mapped"] as const) {
      const res = await other(mode, "brightwater-template.docx", { keep: ["purpose", "scope", "gap-table", "open-items"] });
      expect(plainText(res), mode).toContain(BANNER_TEXT);
    }
  });

  it("tags fills the gap loop from the lean table, joining the Gap details appendix by gap ID", () => {
    const project = buildDemoProject(content, demos["arx-217"]);
    // Without matching assessment gaps every field has to come from the two tables.
    const a = { ...assess(content, project), gaps: [] };
    const doc = contractModel();
    const data = buildTagData(content, project, a, doc);
    const specs = gapSpecs();
    expect(data.gaps.map((g) => g.id)).toEqual(specs.map((s) => s.id));
    const g1 = data.gaps[0]!;
    // From the lean table.
    expect([g1.attribute, g1.source, g1.target, g1.severity]).toEqual([specs[0]!.attribute, "8 h", "12 h", "High"]);
    // From the Gap details appendix.
    expect([g1.rule, g1.owner, g1.status, g1.regulatory]).toEqual(["R-PAR-RANGE v1.2.0", "A. Owner (fictional)", "Open", REGULATORY]);
    expect([g1.sourceVerification, g1.targetVerification]).toEqual([specs[0]!.suVerification, specs[0]!.ruVerification]);
    expect(data.gaps[2]!.targetVerification).toBe("Verification withdrawn");
    // With the real assessment, the attribute is the attribute alone (the table cell also names the section).
    const withGaps = buildTagData(content, project, assess(content, project), doc);
    expect(withGaps.gaps[0]!.attribute).not.toContain(" — ");
    // Every field is a string, also for a document without the appendix.
    const lean = buildTagData(content, project, a, contractModel({ keep: ["gap-table"] }));
    for (const g of lean.gaps) for (const v of Object.values(g)) expect(typeof v).toBe("string");
  });
});
