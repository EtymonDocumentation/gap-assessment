/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_TEMPLATE_VERSION, buildStarterTemplate, importTemplateFile, renderDocx, suggestMapping, type RenderDocxInput } from "../src/index";
import { COVER_LABELS } from "../src/front";
import { ACCENT, BANNER_FILL, CATEGORY_TINTS, CONTRAST_PAIRS, LABEL_FILL, NEUTRAL_TINT, ON_ACCENT, SEVERITY_TINTS, ZEBRA_FILL, contrastRatio, tintForColumn } from "../src/palette";
import { BANNER, GENERATED_AT, buildModel, fixture, type Model } from "./fixtures";
import { customProps, plainText, strictDocx, type StrictResult } from "./strict";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// Rendering the whole demo document and checking it strictly takes a few seconds on a slow machine.
vi.setConfig({ testTimeout: 60000 });

/** The demo document with program stages filled in, as the program-stage wording will do. */
function staged(): Model {
  const m = buildModel();
  return { ...m, doc: { ...m.doc, cover: { ...m.doc.cover, sourceStage: "Commercial (process validated)", targetStage: "Clinical (GMP, not process validated)" } } };
}
const model = staged();

async function renderBuiltin(m: Model = model): Promise<StrictResult> {
  const out = await renderDocx({ doc: m.doc, tagData: m.tagData, mode: "builtin", generatedAt: GENERATED_AT });
  return strictDocx(out.bytes);
}

const kids = (e: Element, local: string): Element[] => Array.from({ length: e.childNodes.length }, (_, i) => e.childNodes.item(i) as Element).filter((n) => n.nodeType === 1 && n.localName === local);
const all = (e: Document | Element, local: string): Element[] => {
  // The node list is live: ask for it once, not once per item.
  const list = e.getElementsByTagNameNS(NS_W, local);
  return Array.from({ length: list.length }, (_, i) => list.item(i)!);
};
const wAttr = (e: Element | undefined, local: string): string | undefined => e?.getAttributeNS(NS_W, local) || undefined;
const text = (e: Element) => e.textContent ?? "";

/** The first table in word/document.xml whose first row contains all of `headers` (or whose first column holds all of them, for label tables). */
function findTable(res: StrictResult, headers: string[]): Element {
  for (const tbl of all(res.xml.get("word/document.xml")!, "tbl")) {
    const rows = kids(tbl, "tr");
    const first = rows[0] ? kids(rows[0], "tc").map(text) : [];
    if (headers.every((h) => first.includes(h))) return tbl;
  }
  throw new Error(`no table with columns ${headers.join(", ")}`);
}

const rowsOf = (tbl: Element) => kids(tbl, "tr").map((tr) => kids(tr, "tc"));
const fillOf = (tc: Element): string | undefined => wAttr(kids(kids(tc, "tcPr")[0]!, "shd")[0], "fill");

/** First-column label to second-column value of a two-column table found by its first label. */
function factsOf(res: StrictResult, firstLabel: string): Map<string, string> {
  for (const tbl of all(res.xml.get("word/document.xml")!, "tbl")) {
    const rows = rowsOf(tbl);
    if (rows[0]?.length === 2 && text(rows[0][0]!) === firstLabel) return new Map(rows.map((r) => [text(r[0]!), text(r[1]!)]));
  }
  throw new Error(`no facts table starting with ${firstLabel}`);
}

describe("built-in look: cover page", () => {
  it("opens with the banner in a bordered, shaded, bold box, then the title and the facts block", async () => {
    const res = await renderBuiltin();
    const body = res.xml.get("word/document.xml")!.getElementsByTagNameNS(NS_W, "body").item(0)!;
    const first = kids(body, "p")[0]!;
    expect(text(first)).toBe(BANNER);
    expect(kids(kids(first, "pPr")[0]!, "pBdr").length).toBe(1);
    expect(wAttr(kids(kids(first, "pPr")[0]!, "shd")[0], "fill")).toBe(BANNER_FILL);
    expect(all(first, "b").length).toBeGreaterThan(0);
    // The title follows in the Title style.
    const second = kids(body, "p")[1]!;
    expect(text(second)).toBe(model.doc.title);
    expect(wAttr(kids(kids(second, "pPr")[0]!, "pStyle")[0], "val")).toBe("Title");
  });

  it("lists program, product, both sites and both program stages, status and generated date, straight from the document", async () => {
    const res = await renderBuiltin();
    const facts = factsOf(res, "Program");
    const c = model.doc.cover;
    const meta = (k: string) => model.doc.meta.find(([x]) => x === k)![1];
    expect([...facts.keys()]).toEqual(["Program", "Product", COVER_LABELS.suSite, COVER_LABELS.suStage, COVER_LABELS.ruSite, COVER_LABELS.ruStage, "Status", "Generated"]);
    expect(facts.get("Program")).toBe(c.program);
    expect(facts.get("Product")).toBe(c.product);
    expect(facts.get("Sending unit (SU) site")).toBe(c.sourceSite);
    expect(facts.get("Receiving unit (RU) site")).toBe(c.targetSite);
    expect(facts.get("Sending unit (SU) program stage")).toBe("Commercial (process validated)");
    expect(facts.get("Receiving unit (RU) program stage")).toBe("Clinical (GMP, not process validated)");
    // The sites are SU and RU everywhere in the front matter: no label calls them source or target.
    expect([...facts.keys()].some((k) => /(source|target)/i.test(k))).toBe(false);
    expect(facts.has("Revision")).toBe(false);
    expect(facts.get("Status")).toBe(model.doc.status);
    expect(facts.get("Generated")).toBe(meta("Generated"));
  });

  it("escapes every cover value", async () => {
    const BAD = '<w:p>&amp; ]]> "q" \u0001 <script>x</script>';
    const m: Model = { ...model, doc: { ...model.doc, cover: { program: BAD, product: BAD, sourceSite: BAD, targetSite: BAD, sourceStage: BAD, targetStage: BAD } } };
    const res = await renderBuiltin(m);
    const facts = factsOf(res, "Program");
    for (const k of ["Program", "Product", COVER_LABELS.suSite, COVER_LABELS.ruSite, COVER_LABELS.suStage, COVER_LABELS.ruStage]) expect(facts.get(k), k).toContain("<w:p>&amp; ]]>");
    expect(res.text("word/document.xml")).not.toContain("<script>");
    expect(res.text("word/document.xml")).not.toMatch(/\u0001/);
  });

  it("has a different first page, with no page-number footer on the cover, and the banner and page numbers on the other pages", async () => {
    const res = await renderBuiltin();
    const doc = res.xml.get("word/document.xml")!;
    const sect = all(doc, "sectPr");
    expect(sect.length).toBe(1);
    expect(kids(sect[0]!, "titlePg").length).toBe(1);
    // Only a default header and footer are referenced: the first page has none of its own.
    expect(kids(sect[0]!, "headerReference").map((e) => wAttr(e, "type"))).toEqual(["default"]);
    expect(kids(sect[0]!, "footerReference").map((e) => wAttr(e, "type"))).toEqual(["default"]);
    expect(plainText(res, "word/header1.xml")).toContain(BANNER);
    expect(plainText(res, "word/footer1.xml")).toContain(BANNER);
    expect(res.text("word/footer1.xml")).toMatch(/PAGE/);
    // The cover is followed by a page break (the Contents heading starts a new page).
    expect(res.text("word/document.xml")).toMatch(/<w:pStyle w:val="TOCHeading"\/><w:pageBreakBefore\/>/);
    // A4 landscape stays.
    expect(res.text("word/document.xml")).toMatch(/<w:pgSz[^>]*w:w="16838"[^>]*w:h="11906"[^>]*w:orient="landscape"/);
  });
});

describe("built-in look: table of contents and document control", () => {
  it("has a real TOC field over heading levels 1 to 3, and asks Word to update fields on open", async () => {
    const res = await renderBuiltin();
    const instr = all(res.xml.get("word/document.xml")!, "instrText").map(text);
    expect(instr.some((t) => t.trim() === 'TOC \\o "1-3" \\h \\z \\u')).toBe(true);
    const settings = res.text("word/settings.xml");
    expect(settings).toContain('<w:updateFields w:val="true"/>');
    // Schema order: updateFields comes after characterSpacingControl and before compat.
    expect(settings.indexOf("characterSpacingControl")).toBeLessThan(settings.indexOf("updateFields"));
    expect(settings.indexOf("updateFields")).toBeLessThan(settings.indexOf("<w:compat>"));
    // The placeholder text sits between the separate and end markers of the field.
    expect(plainText(res)).toMatch(/Table of contents\. Word fills this in/);
  });

  it("puts the TOC and the document control between the cover and section 1, in that order", async () => {
    const res = await renderBuiltin();
    const t = plainText(res);
    const at = (s: string) => t.indexOf(s);
    expect(at("Contents")).toBeGreaterThan(at(BANNER));
    expect(at("Document control")).toBeGreaterThan(at("Contents"));
    expect(at(`1. ${model.doc.sections[0]!.title}`)).toBeGreaterThan(at("Document control"));
  });

  it("gives heading styles outline levels, and writes every section and appendix heading in a heading style", async () => {
    const res = await renderBuiltin();
    const styles = res.xml.get("word/styles.xml")!;
    const byId = (id: string) => all(styles, "style").find((s) => wAttr(s, "styleId") === id)!;
    for (const n of [1, 2, 3]) {
      const ol = all(byId(`Heading${n}`), "outlineLvl")[0];
      expect(wAttr(ol, "val"), `Heading${n}`).toBe(String(n - 1));
    }
    // The "Contents" heading must stay out of the table of contents.
    expect(all(byId("TOCHeading"), "outlineLvl").length).toBe(0);
    for (const n of [1, 2, 3]) expect(byId(`TOC${n}`)).toBeTruthy();
    const heading1 = all(res.xml.get("word/document.xml")!, "p")
      .filter((p) => wAttr(kids(kids(p, "pPr")[0] ?? p, "pStyle")[0], "val") === "Heading1")
      .map(text);
    for (const s of model.doc.sections) {
      const expected = s.appendix ? `Appendix ${s.number}. ${s.title}` : `${s.number}. ${s.title}`;
      expect(heading1, expected).toContain(expected);
    }
    expect(model.doc.sections.some((s) => s.appendix)).toBe(true);
  });

  it("has a document-control table with a placeholder ID, status and author, reviewer and approver rows, but no signatures", async () => {
    const res = await renderBuiltin();
    const control = factsOf(res, "Document ID");
    expect(control.get("Document ID")).toBe("[to be assigned]");
    expect(control.has("Revision")).toBe(false);
    expect(control.get("Status")).toBe(model.doc.status);
    const people = rowsOf(findTable(res, ["Responsibility", "Name", "Role", "Date"])).map((r) => r.map(text));
    expect(people).toEqual([
      ["Responsibility", "Name", "Role", "Date"],
      ["Author", "[name]", "[role]", "[date]"],
      ["Reviewer", "[name]", "[role]", "[date]"],
      ["Approver", "[name]", "[role]", "[date]"],
    ]);
    const t = plainText(res);
    expect(t).toContain("This tool does not capture approvals or electronic signatures.");
    // No signature column or line was added for the document-control block (the engine's own approvals section keeps its table).
    const control1 = t.slice(t.indexOf("Document control"), t.indexOf(`1. ${model.doc.sections[0]!.title}`));
    expect(control1).not.toMatch(/Signature/);
    expect(res.text("word/document.xml")).not.toMatch(/<w:sdt>|<w:pict|<w:drawing/);
  });

  it("keeps the engine's approvals section and shows the remaining document details", async () => {
    const res = await renderBuiltin();
    const approval = model.doc.sections.find((s) => s.id === "approval")!;
    expect(plainText(res)).toContain(`${approval.number}. ${approval.title}`);
    expect(rowsOf(findTable(res, ["Role", "Name", "Signature", "Date"])).length).toBeGreaterThan(1);
    const summary = rowsOf(findTable(res, ["Item", "Value"])).map((r) => r.map(text));
    for (const [k, v] of model.doc.meta) {
      if (k === "Generated") continue;
      expect(summary, k).toContainEqual([k, v]);
    }
  });
});

describe("built-in look: tables", () => {
  const gap = (res: StrictResult) => findTable(res, ["ID", "Attribute", "SU", "RU", "Gap", "Severity", "Actions", "Notes"]);

  it("gives header rows an accent fill with white bold text that repeats on every page", async () => {
    const res = await renderBuiltin();
    const tables = all(res.xml.get("word/document.xml")!, "tbl");
    const headed = tables.filter((t) => kids(kids(kids(t, "tr")[0]!, "trPr")[0] ?? t, "tblHeader").length > 0);
    expect(headed.length).toBeGreaterThan(8);
    for (const tbl of headed) {
      for (const tc of rowsOf(tbl)[0]!) {
        expect(fillOf(tc), text(tc)).toBe(ACCENT);
        const run = all(tc, "r")[0]!;
        expect(wAttr(all(run, "color")[0], "val"), text(tc)).toBe(ON_ACCENT);
        expect(all(run, "b").length, text(tc)).toBe(1);
      }
    }
    const g = gap(res);
    expect(kids(kids(kids(g, "tr")[0]!, "trPr")[0]!, "tblHeader").length).toBe(1);
  });

  it("shades alternate body rows with a subtle fill", async () => {
    const res = await renderBuiltin();
    const g = gap(res);
    const rows = rowsOf(g);
    const header = rows[0]!.map(text);
    const plain = header.indexOf("Attribute");
    expect(rows.length).toBeGreaterThan(5);
    rows.slice(1).forEach((r, i) => expect(fillOf(r[plain]!), `row ${i + 1}`).toBe(i % 2 === 1 ? ZEBRA_FILL : undefined));
  });

  it("shows the gap category (the start of the Gap cell) and the severity as text plus one subtle tint per value, found by column header", async () => {
    const res = await renderBuiltin();
    const rows = rowsOf(gap(res));
    const header = rows[0]!.map(text);
    const sev = header.indexOf("Severity");
    const cat = header.indexOf("Gap");
    const severities = new Set<string>();
    const categories = new Set<string>();
    for (const r of rows.slice(1)) {
      const sevText = text(r[sev]!);
      const catText = text(r[cat]!);
      expect(sevText).not.toBe("");
      expect(catText).not.toBe("");
      const key = /^(high|medium|low|none)/i.exec(sevText)![1]!.toLowerCase() as keyof typeof SEVERITY_TINTS;
      expect(fillOf(r[sev]!), sevText).toBe(SEVERITY_TINTS[key]);
      const tint = CATEGORY_TINTS.find((c) => c.match.test(catText.toLowerCase()));
      // The category label is followed by ". " and the detail, so the cell always holds more than the label.
      expect(catText, catText).toMatch(/^[^.]+. ./);
      expect(tint, catText).toBeTruthy();
      expect(fillOf(r[cat]!), catText).toBe(tint!.fill);
      severities.add(key);
      categories.add(tint!.key);
    }
    // The demo shows several values, so the tints really differ.
    expect(severities.size).toBeGreaterThanOrEqual(2);
    expect(categories.size).toBeGreaterThanOrEqual(3);
    // The risk ranking and the validation plan have the same columns and are shaded the same way.
    const risk = rowsOf(findTable(res, ["Rank", "ID", "Category", "Severity"]));
    const rsev = risk[0]!.map(text).indexOf("Severity");
    for (const r of risk.slice(1)) expect(fillOf(r[rsev]!)).toBe(SEVERITY_TINTS[text(r[rsev]!).toLowerCase() as keyof typeof SEVERITY_TINTS]);
    const plan = rowsOf(findTable(res, ["Activity", "Severity", "Readiness"]));
    const psev = plan[0]!.map(text).indexOf("Severity");
    for (const r of plan.slice(1)) expect(fillOf(r[psev]!)).toBeTruthy();
  });

  it("matches columns by header, never by value, and falls back to a neutral tint", () => {
    const sev = tintForColumn("Severity")!;
    const cat = tintForColumn(" category ")!;
    expect(tintForColumn("Gap")).toBe(cat);
    expect(tintForColumn("Implied by gaps")).toBeUndefined();
    expect(tintForColumn("Attribute")).toBeUndefined();
    expect(tintForColumn("Regulatory")).toBeUndefined();
    expect(sev("High (adjusted from Medium by A. Reviewer (fictional): reason)")).toBe(SEVERITY_TINTS.high);
    expect(sev("Medium")).toBe(SEVERITY_TINTS.medium);
    expect(sev("Low")).toBe(SEVERITY_TINTS.low);
    expect(sev("None")).toBe(SEVERITY_TINTS.none);
    expect(sev("something new")).toBe(NEUTRAL_TINT);
    expect(sev("")).toBeUndefined();
    // Category labels worded for a program stage still find their tint.
    expect(cat("Within source range. Target lies inside the PAR.")).toBe(CATEGORY_TINTS.find((c) => c.key === "within_validated_range")!.fill);
    expect(cat("Outside validated range. x")).toBe(CATEGORY_TINTS.find((c) => c.key === "outside_validated_range")!.fill);
    expect(cat("A label nobody has seen")).toBe(NEUTRAL_TINT);
    expect(cat("")).toBeUndefined();
    // Eight categories, eight different tints except for the neutral grey of "Equivalent".
    expect(new Set(CATEGORY_TINTS.map((c) => c.fill)).size).toBe(CATEGORY_TINTS.length);
  });

  it("keeps the layout fixes: fixed layout, grid equals the text width", async () => {
    const res = await renderBuiltin();
    for (const tbl of all(res.xml.get("word/document.xml")!, "tbl")) {
      const w = Number(wAttr(kids(kids(tbl, "tblPr")[0]!, "tblW")[0], "w"));
      expect(w).toBe(15138);
      expect(wAttr(kids(kids(tbl, "tblPr")[0]!, "tblLayout")[0], "type")).toBe("fixed");
      expect(kids(kids(tbl, "tblGrid")[0]!, "gridCol").reduce((a, g) => a + Number(wAttr(g, "w")), 0)).toBe(w);
    }
  });
});

describe("built-in look: colours", () => {
  it("gives every text and shading pair at least 4.5:1 contrast", () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(15);
    for (const p of CONTRAST_PAIRS) expect(contrastRatio(p.fg, p.bg), `${p.name} (${p.fg} on ${p.bg})`).toBeGreaterThanOrEqual(4.5);
    // The formula itself: black on white is 21:1.
    expect(contrastRatio("000000", "FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("FFFFFF", "FFFFFF")).toBeCloseTo(1, 5);
  });

  it("uses no shading and no text colour in the document that is not in the checked pairs", async () => {
    const res = await renderBuiltin();
    const allowedFills = new Set([...CONTRAST_PAIRS.map((p) => p.bg), ACCENT, "FFFFFF"]);
    const allowedText = new Set(CONTRAST_PAIRS.map((p) => p.fg));
    for (const part of ["word/document.xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml"]) {
      const xml = res.xml.get(part)!;
      for (const shd of all(xml, "shd")) {
        const fill = wAttr(shd, "fill")!;
        expect(allowedFills.has(fill), `${part} fill ${fill}`).toBe(true);
      }
      for (const c of all(xml, "color")) expect(allowedText.has(wAttr(c, "val")!), `${part} colour ${wAttr(c, "val")}`).toBe(true);
    }
    expect(LABEL_FILL).toBeTruthy();
  });

  it("checks the white-on-accent header text against the real fill used in the file", async () => {
    const res = await renderBuiltin();
    expect(res.text("word/document.xml")).toContain(`w:fill="${ACCENT}"`);
    expect(contrastRatio(ON_ACCENT, ACCENT)).toBeGreaterThanOrEqual(7);
  });
});

describe("built-in look: versioning and the other modes", () => {
  it("bumps the built-in template version", async () => {
    expect(BUILTIN_TEMPLATE_VERSION).toBe("1.2.0");
    const out = await renderDocx({ doc: model.doc, tagData: model.tagData, mode: "builtin", generatedAt: GENERATED_AT });
    expect(out.templateRecord).toEqual({ mode: "builtin", name: "Built-in default", version: "1.2.0" });
    expect(customProps(strictDocx(out.bytes)).templateVersion).toBe("1.2.0");
  });

  async function other(mode: RenderDocxInput["mode"], file: string, mapped: boolean): Promise<StrictResult> {
    const t = await importTemplateFile(file, fixture(file));
    const out = await renderDocx({
      doc: model.doc,
      tagData: model.tagData,
      mode,
      generatedAt: GENERATED_AT,
      template: { name: "Brightwater (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis, ...(mapped ? { mapping: suggestMapping(t.analysis, model.doc) } : {}) },
    });
    return strictDocx(out.bytes);
  }

  it("leaves their look, mapped headings, mapped PDF outline and placeholder tags without the cover, TOC, accent colours or field refresh", async () => {
    const results: [string, StrictResult][] = [
      ["their_look", await other("their_look", "brightwater-template.docx", false)],
      ["mapped", await other("mapped", "brightwater-template.docx", true)],
      ["mapped pdf", await other("mapped", "brightwater-outline.pdf", true)],
      ["tags", await other("tags", "brightwater-tags.docx", false)],
    ];
    for (const [mode, res] of results) {
      const doc = res.text("word/document.xml");
      expect(doc, mode).not.toContain(ACCENT);
      expect(doc, mode).not.toContain(ZEBRA_FILL);
      expect(doc, mode).not.toContain("<w:titlePg/>");
      expect(doc, mode).not.toMatch(/TOC \\o/);
      expect(doc, mode).not.toContain("Document control");
      expect(res.text("word/styles.xml"), mode).not.toContain(ACCENT);
      expect(res.names.includes("word/settings.xml") ? res.text("word/settings.xml") : "", mode).not.toContain("updateFields");
    }
    // The PDF-outline document uses the generated styles: the original heading colour, not the accent.
    expect(results[2]![1].text("word/styles.xml")).toContain('w:color w:val="1F3864"');
  });

  it("keeps the starter template as it was", () => {
    const res = strictDocx(buildStarterTemplate());
    expect(res.text("word/settings.xml")).not.toContain("updateFields");
    expect(res.text("word/document.xml")).not.toContain("<w:titlePg/>");
    expect(res.text("word/document.xml")).not.toContain(ACCENT);
    expect(res.text("word/styles.xml")).toContain('w:color w:val="1F3864"');
  });
});
