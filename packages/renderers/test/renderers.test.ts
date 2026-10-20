import type { Project } from "@gap/process-model";
import { adaptText, addComment, assess, buildDemoProject, buildDocument, CSV_COLUMNS, gapsToCsv, issueRevision, replyToComment, resolveComment, type DocModel, type Gap } from "@gap/engine";
import { describe, expect, it } from "vitest";
import { content, demos } from "../../../content/index";
import { DOCUMENT_CSS, escapeHtml, renderHtml, renderHtmlBody, renderMarkdown } from "../src/index";

const project = buildDemoProject(content, demos["arx-217"]);
const assessment = assess(content, project);
const doc = buildDocument(content, project, assessment, "2026-10-02T00:00:00.000Z");
const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const EMPTY_COVER: DocModel["cover"] = { program: "", product: "", sourceSite: "", targetSite: "", sourceStage: "", targetStage: "" };

/** A small document with hostile content, built by hand so the test controls every string. */
const hostile: DocModel = {
  title: 'Title <script>alert("t")</script> & "co"',
  banner: "<b>Banner</b>",
  status: "DRAFT",
  meta: [
    ["Key <i>", "Value <script>alert(1)</script>"],
    ["Quote", `He said "hi" & it's fine`],
    ["Revision", "1 (Draft, 2026-10-05) <script>alert(7)</script>"],
  ],
  cover: { program: "<b>P</b>", product: "x & y", sourceSite: "<i>S</i>", targetSite: "T", sourceStage: "<script>s</script>", targetStage: "t" },
  // The renderers draw only meta and sections; revisions and comments reach the page through the appendices
  // the engine builds from them. They carry hostile strings here so no future renderer can trust them.
  revisions: [
    { number: 1, statusLabel: "Draft", date: "2026-10-05", by: "<b>Reviewer</b> & co", summary: "Summary <script>alert(8)</script>", template: 'Template "x" <i>1.0</i>' },
  ],
  comments: [
    {
      id: "C-001",
      sectionId: "one",
      anchorText: "1. Section <script>x</script>, G-001",
      by: "<b>Checker</b>",
      at: "2026-10-06T09:00:00.000Z",
      text: "Comment <script>alert(9)</script> | pipe",
      status: "open",
      replies: [{ kind: "reply", by: "<i>Author</i>", at: "2026-10-06T10:00:00.000Z", text: "Reply <img src=x onerror=alert(10)>" }],
    },
  ],
  sections: [
    {
      id: "one",
      number: "1",
      title: "Section <script>x</script>",
      blocks: [
        { type: "paragraph", text: "Para <script>alert(2)</script> & more" },
        { type: "heading", text: "Head <img src=x onerror=alert(3)>" },
        { type: "note", text: "Note <script>alert(4)</script>" },
        { type: "list", items: ["Item <script>alert(5)</script>", "plain"] },
        {
          type: "table",
          columns: ["Col <script>c</script>", "B|pipe"],
          rows: [
            ["cell <script>alert(6)</script>", "a|b"],
            ["back\\slash", "line1\nline2"],
          ],
        },
        { type: "table", columns: ["A"], rows: [] },
      ],
    },
  ],
};

// ================================================================== Markdown

describe("renderMarkdown", () => {
  const md = renderMarkdown(doc);
  const lines = md.split("\n");

  it("starts with the banner, then the title", () => {
    expect(lines[0]).toBe(`> **${BANNER}**`);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(`# ${doc.title}`);
  });

  it("repeats the banner as a footer after a rule", () => {
    expect(md.trimEnd().endsWith(`---\n\n_${BANNER}_`)).toBe(true);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("shows the status and every metadata line", () => {
    expect(md).toContain("**Status:** DRAFT");
    for (const [k, v] of doc.meta) expect(md).toContain(`- **${k}:** ${v}`);
  });

  it("numbers the sections 1 to 13 and the appendices A to D in order", () => {
    const headings = lines.filter((l) => l.startsWith("## "));
    expect(headings).toHaveLength(17);
    headings.slice(0, 13).forEach((h, i) => expect(h.startsWith(`## ${i + 1}. `), h).toBe(true));
    expect(headings[13]).toMatch(/^## Appendix A\. Source register$/);
    expect(headings[14]).toMatch(/^## Appendix B\. Change log summary$/);
    expect(headings[15]).toMatch(/^## Appendix C\. Revision history$/);
    expect(headings[16]).toMatch(/^## Appendix D\. Reviewer comments$/);
    expect(headings).toEqual(doc.sections.map((s) => `## ${s.appendix ? "Appendix " : ""}${s.number}. ${s.title}`));
  });

  it("leaves no empty heading and no unfilled placeholder", () => {
    for (const h of lines.filter((l) => /^#{1,3} /.test(l))) expect(h.replace(/^#+ (\d+\. )?/, "").trim()).not.toBe("");
    expect(md).not.toMatch(/\{(program|sourceSite|targetSite|date|markets)\}/);
  });

  it("every table row in the real document has exactly as many unescaped pipes as its table needs", () => {
    const widths = new Set(doc.sections.flatMap((s) => s.blocks).filter((b) => b.type === "table").map((b) => (b.type === "table" ? b.columns.length + 1 : 0)));
    const tableLines = lines.filter((l) => l.startsWith("| "));
    expect(tableLines.length).toBeGreaterThan(20);
    for (const l of tableLines) {
      const pipes = (l.match(/(?<!\\)\|/g) ?? []).length;
      expect(widths.has(pipes), l).toBe(true);
    }
  });

  it("table rows are single lines: no raw newline survives inside a cell", () => {
    const tables = doc.sections.flatMap((s) => s.blocks).filter((b) => b.type === "table");
    const sepCount = lines.filter((l) => /^\| (---(?: \| ---)*) \|$/.test(l)).length;
    expect(sepCount).toBe(tables.filter((t) => t.type === "table" && t.rows.length).length);
  });

  describe("on a hand-built document", () => {
    const out = renderMarkdown(hostile);

    it("escapes pipes in table headers and cells", () => {
      expect(out).toContain("| Col <script>c</script> | B\\|pipe |");
      expect(out).toContain("| cell <script>alert(6)</script> | a\\|b |");
    });

    it("escapes backslashes first, so an escaped pipe cannot be forged", () => {
      expect(out).toContain("| back\\\\slash | line1<br>line2 |");
      const forged = renderMarkdown({ ...hostile, sections: [{ id: "x", number: "1", title: "T", blocks: [{ type: "table", columns: ["A", "B"], rows: [["x\\|y", "z"]] }] }] });
      // "x\|y" must become "x\\\|y": a literal backslash followed by an escaped pipe, still two columns.
      expect(forged).toContain("| x\\\\\\|y | z |");
    });

    it("turns newlines (LF and CRLF) in cells into <br>", () => {
      const o = renderMarkdown({ ...hostile, sections: [{ id: "x", number: "1", title: "T", blocks: [{ type: "table", columns: ["A"], rows: [["a\r\nb\nc"]] }] }] });
      expect(o).toContain("| a<br>b<br>c |");
    });

    it("writes the header separator with one --- per column", () => {
      expect(out).toContain("| --- | --- |");
    });

    it("renders an empty table as a placeholder rather than a bare header", () => {
      expect(out).toContain("_None._");
      expect(out).not.toContain("| A |");
    });

    it("renders the other block types", () => {
      expect(out).toContain("Para <script>alert(2)</script> & more");
      expect(out).toContain("### Head <img src=x onerror=alert(3)>");
      expect(out).toContain("> Note <script>alert(4)</script>");
      expect(out).toContain("- Item <script>alert(5)</script>\n- plain");
    });

    it("does not HTML-escape (Markdown output is plain text for the viewer to interpret)", () => {
      expect(out).not.toContain("&lt;");
    });
  });

  it("renders a document with no sections and no metadata", () => {
    const out = renderMarkdown({ title: "T", banner: "B", status: "DRAFT", meta: [], cover: EMPTY_COVER, sections: [], revisions: [], comments: [] });
    expect(out).toBe("> **B**\n\n# T\n\n**Status:** DRAFT\n\n\n---\n\n_B_\n");
  });
});

// ================================================================== HTML

describe("renderHtml", () => {
  const html = renderHtml(doc);

  it("is a complete standalone page", () => {
    expect(html.startsWith("<!doctype html>\n<html lang=\"en\">")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport"');
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain(`<title>${escapeHtml(doc.title)}</title>`);
  });

  it("puts the banner first in the body, then the title", () => {
    const body = html.slice(html.indexOf("<body>"));
    expect(body.indexOf('class="banner"')).toBeGreaterThan(-1);
    expect(body.indexOf('class="banner"')).toBeLessThan(body.indexOf("<h1>"));
    expect(body).toContain(`<div class="banner" role="note">${BANNER}</div>`);
    expect(body).toContain(`<h1>${escapeHtml(doc.title)}</h1>`);
  });

  it("repeats the banner as a footer", () => {
    expect(html).toContain(`<div class="footer">${BANNER}</div>`);
  });

  it("numbers the sections 1 to 13 and the appendices A to D, each in its own section element", () => {
    const h2 = [...html.matchAll(/<h2>(?:Appendix )?([0-9A-Z]+)\. ([^<]*)<\/h2>/g)];
    expect(h2.map((m) => m[1])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "A", "B", "C", "D"]);
    for (const s of doc.sections) expect(html).toContain(`<section id="doc-${s.id}">`);
  });

  it("includes the print stylesheet inline", () => {
    expect(html).toContain("<style>");
    expect(html).toContain("@media print");
    expect(html).toContain("@page { size: A4 landscape");
    expect(html).toContain("thead { display: table-header-group; }");
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain(DOCUMENT_CSS);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/<script/i);
  });

  it("marks tables as scrollable regions with column-scoped headers", () => {
    expect(html).toContain('class="table-wrap" role="region" aria-label="Table" tabindex="0"');
    expect(html).toContain('<th scope="col">');
  });

  it("has balanced section, table and article tags", () => {
    const count = (re: RegExp) => (html.match(re) ?? []).length;
    expect(count(/<section /g)).toBe(count(/<\/section>/g));
    expect(count(/<table>/g)).toBe(count(/<\/table>/g));
    expect(count(/<tr>/g)).toBe(count(/<\/tr>/g));
    expect(count(/<article /g)).toBe(1);
    expect(count(/<\/article>/g)).toBe(1);
  });

  describe("on a hand-built document", () => {
    const out = renderHtml(hostile);

    it("never lets a script tag through", () => {
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toContain("<img");
      expect(out).not.toContain("<i>");
      expect(out).not.toContain("<b>");
    });

    it("escapes every field: title, banner, meta, headings, paragraphs, notes, lists and table cells", () => {
      expect(out).toContain("<title>Title &lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt; &amp; &quot;co&quot;</title>");
      expect(out).toContain('<div class="banner" role="note">&lt;b&gt;Banner&lt;/b&gt;</div>');
      expect(out).toContain("<dt>Key &lt;i&gt;</dt><dd>Value &lt;script&gt;alert(1)&lt;/script&gt;</dd>");
      expect(out).toContain("<h2>1. Section &lt;script&gt;x&lt;/script&gt;</h2>");
      expect(out).toContain("<p>Para &lt;script&gt;alert(2)&lt;/script&gt; &amp; more</p>");
      expect(out).toContain("<h3>Head &lt;img src=x onerror=alert(3)&gt;</h3>");
      expect(out).toContain('<p class="note">Note &lt;script&gt;alert(4)&lt;/script&gt;</p>');
      expect(out).toContain("<li>Item &lt;script&gt;alert(5)&lt;/script&gt;</li><li>plain</li>");
      expect(out).toContain('<th scope="col">Col &lt;script&gt;c&lt;/script&gt;</th>');
      expect(out).toContain("<td>cell &lt;script&gt;alert(6)&lt;/script&gt;</td><td>a|b</td>");
    });

    it("escapes quotes and apostrophes so values are safe inside attributes too", () => {
      expect(out).toContain("<dd>He said &quot;hi&quot; &amp; it&#39;s fine</dd>");
    });

    it("renders an empty table as a placeholder", () => {
      expect(out).toContain('<p class="none">None.</p>');
    });

    it("keeps newlines inside cells as plain text (no markup injected)", () => {
      expect(out).toContain("<td>line1\nline2</td>");
    });
  });

  it("escapeHtml handles all five characters and leaves other text alone", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    expect(escapeHtml("plain text 123 — é")).toBe("plain text 123 — é");
    expect(escapeHtml("")).toBe("");
  });

  it("renderHtmlBody is the article alone, without the page wrapper", () => {
    const body = renderHtmlBody(doc);
    expect(body.startsWith('<article class="gap-doc">')).toBe(true);
    expect(body.endsWith("</article>")).toBe(true);
    expect(body).not.toContain("<html");
    expect(body).not.toContain("<style");
    expect(html).toContain(body);
  });

  it("is deterministic", () => {
    expect(renderHtml(doc)).toBe(html);
    expect(renderMarkdown(doc)).toBe(renderMarkdown(doc));
  });
});

// ================================================================== CSV

/** Minimal RFC 4180 parser so the tests check what a spreadsheet would read, not the writer's own quoting. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const baseGap = assessment.gaps[0]!;
const withGap = (over: Partial<Gap>): Gap => ({ ...baseGap, ...over });
const csvOf = (g: Gap) => gapsToCsv(content, [g], project);
const dataRow = (g: Gap) => parseCsv(csvOf(g))[1]!;
const COL = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);

describe("gapsToCsv", () => {
  const csv = gapsToCsv(content, assessment.gaps, project);

  it("has one header row plus one row per gap, 19 columns each, CRLF line endings and a final CRLF", () => {
    expect(CSV_COLUMNS).toHaveLength(19);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(assessment.gaps.length + 1);
    for (const r of rows) expect(r).toHaveLength(CSV_COLUMNS.length);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/(?<!")\n/);
  });

  it("quotes every cell, including the headers and empty values", () => {
    const first = csv.split("\r\n")[0]!;
    expect(first).toBe(CSV_COLUMNS.map((c) => `"${c}"`).join(","));
    const g = withGap({ owner: undefined, notes: undefined, regulatoryNote: undefined, severityOverride: undefined });
    const line = csvOf(g).split("\r\n")[1]!;
    expect(line.startsWith('"')).toBe(true);
    expect(line.endsWith('"')).toBe(true);
    const row = dataRow(g);
    expect(row[COL("Owner")]).toBe("");
    expect(row[COL("Regulatory")]).toBe("");
    expect(row[COL("Severity justification")]).toBe("");
    expect(line).toContain('"",');
  });

  it("every cell of the full register is wrapped in quotes", () => {
    // After removing quoted cells ("" inside is a doubled quote), only commas and line breaks may be left.
    const stripped = csv.replace(/"(?:[^"]|"")*"/g, "");
    expect(stripped.replace(/,/g, "").replace(/\r\n/g, "")).toBe("");
  });

  it("doubles quotes inside a value, and the value reads back unchanged", () => {
    const g = withGap({ detail: 'He said "stop", then left' });
    expect(csvOf(g)).toContain('"He said ""stop"", then left"');
    expect(dataRow(g)[COL("Detail")]).toBe('He said "stop", then left');
  });

  it("keeps commas and line breaks inside quoted cells", () => {
    const g = withGap({ rationale: "line one\r\nline two, with comma" });
    const row = dataRow(g);
    expect(row[COL("Why it matters")]).toBe("line one\r\nline two, with comma");
    expect(row).toHaveLength(CSV_COLUMNS.length);
  });

  describe("spreadsheet formula injection", () => {
    it.each([
      ["=", '=HYPERLINK("http://evil","x")'],
      ["+", "+1+1"],
      ["-", "-2+3"],
      ["@", "@SUM(A1:A9)"],
      ["tab", "\t=1+1"],
      ["carriage return", "\r=1+1"],
    ])("neutralises a cell starting with %s by prefixing an apostrophe", (_name, value) => {
      const g = withGap({ attribute: value, detail: value, sourceDisplay: value, targetDisplay: value, rationale: value, sectionTitle: value });
      const row = dataRow(g);
      for (const col of ["Attribute", "Detail", "Source value", "Target value", "Why it matters", "Section"] as const) {
        expect(row[COL(col)], col).toBe(`'${value}`);
      }
    });

    it("neutralises formula text coming from the free-text fields a person types (owner, override justification, regulatory note)", () => {
      const g = withGap({
        owner: "=cmd|' /C calc'!A0",
        regulatoryNote: "@note",
        severityOverride: { value: "low", justification: "-1 because", by: "x", at: "2026-10-02T00:00:00.000Z" },
      });
      const row = dataRow(g);
      expect(row[COL("Owner")]).toBe("'=cmd|' /C calc'!A0");
      expect(row[COL("Regulatory")]).toBe("'@note");
      expect(row[COL("Severity justification")]).toBe("'-1 because");
    });

    it("neutralises each entry of the input references", () => {
      const g = withGap({ inputRefs: ["=A1", "source.x"] });
      expect(dataRow(g)[COL("Inputs")]).toBe("'=A1 | source.x");
    });

    it("still doubles quotes inside a neutralised value", () => {
      const g = withGap({ detail: '=IF(A1="x",1,2)' });
      expect(csvOf(g)).toContain(`"'=IF(A1=""x"",1,2)"`);
    });

    it("leaves harmless text untouched, including a formula character that is not first", () => {
      const g = withGap({ detail: "a=b, c+d, e-f, g@h", attribute: " =leading space", sourceDisplay: "5 mm" });
      const row = dataRow(g);
      expect(row[COL("Detail")]).toBe("a=b, c+d, e-f, g@h");
      expect(row[COL("Attribute")]).toBe(" =leading space");
      expect(row[COL("Source value")]).toBe("5 mm");
    });

    it("leaves a bare negative number as a number but guards negative text", () => {
      const row = dataRow(withGap({ sourceDisplay: "-20", targetDisplay: "-20 °C" }));
      expect(row[COL("Source value")]).toBe("-20");
      expect(row[COL("Target value")]).toBe("'-20 °C");
    });

    it("also neutralises the header-independent ID and rule columns", () => {
      const g = withGap({ displayId: "=ID", ruleId: "-R", ruleVersion: "1" });
      const row = dataRow(g);
      expect(row[COL("ID")]).toBe("'=ID");
      expect(row[COL("Rule")]).toBe("'-R v1");
    });

    it("no cell of the real register starts with a formula character", () => {
      for (const r of parseCsv(csv).slice(1)) for (const c of r) expect(c).not.toMatch(/^[=+@\t\r]/);
    });
  });

  describe("content of the columns", () => {
    const rows = parseCsv(csv).slice(1);

    it("lists gaps in the same order with their display ids", () => {
      expect(rows.map((r) => r[COL("ID")])).toEqual(assessment.gaps.map((g) => g.displayId));
    });

    it("uses category and activity labels, not internal keys", () => {
      for (const [i, g] of assessment.gaps.entries()) {
        const label = adaptText(content.catalog.categories.find((c) => c.key === g.category)!.label, true);
        expect(rows[i]![COL("Category")], g.key).toBe(label);
        const acts = rows[i]![COL("Activities implied")]!;
        for (const a of g.activities) expect(acts).not.toContain(a);
        expect(acts === "" ? 0 : acts.split("; ").length, g.key).toBe(g.activities.length);
      }
    });

    it("shows the effective severity and the rule's own severity separately", () => {
      const g = withGap({
        ruleSeverity: "medium",
        severity: "high",
        severityOverride: { value: "high", justification: "Because we say so", by: "x", at: "2026-10-02T00:00:00.000Z" },
      });
      const row = dataRow(g);
      expect(row[COL("Rule severity")]).toBe("medium");
      expect(row[COL("Severity")]).toBe("high");
      expect(row[COL("Severity justification")]).toBe("Because we say so");
    });

    it("records the rule id with its version, and joins inputs with ' | '", () => {
      const g = withGap({ ruleId: "R-TEST", ruleVersion: "2.3.4", inputRefs: ["source.a", "target.b", "target.c"] });
      const row = dataRow(g);
      expect(row[COL("Rule")]).toBe("R-TEST v2.3.4");
      expect(row[COL("Inputs")]).toBe("source.a | target.b | target.c");
    });

    it("carries owner and status through", () => {
      const row = dataRow(withGap({ owner: "Pat", status: "in_progress" }));
      expect(row[COL("Owner")]).toBe("Pat");
      expect(row[COL("Status")]).toBe("in_progress");
    });

    it("for the demo, contains the regulatory note on at least one row and the original values on all", () => {
      expect(rows.some((r) => r[COL("Regulatory")] === "Requires regulatory affairs assessment.")).toBe(true);
      for (const [i, g] of assessment.gaps.entries()) {
        const expected = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
        expect(rows[i]![COL("Source value")]).toBe(expected(g.sourceDisplay));
        expect(rows[i]![COL("Target value")]).toBe(expected(g.targetDisplay));
      }
    });
  });

  it("writes only the header for an empty register", () => {
    expect(gapsToCsv(content, [], project)).toBe(CSV_COLUMNS.map((c) => `"${c}"`).join(",") + "\r\n");
  });
});

// ================================================================== validation sections

describe("validation plan and equipment qualification sections", () => {
  const plan = doc.sections.find((s) => s.id === "validation-plan")!;
  const equipment = doc.sections.find((s) => s.id === "equipment-qualification")!;

  it("are present, adjacent and numbered consecutively", () => {
    expect(plan).toBeDefined();
    expect(equipment).toBeDefined();
    expect(Number(equipment.number)).toBe(Number(plan.number) + 1);
    expect(doc.sections.map((s) => s.id)).not.toContain("activities");
  });

  it("Markdown renders both headings and the plan table with readiness and gap ids", () => {
    const md = renderMarkdown(doc);
    expect(md).toContain(`## ${plan.number}. Validation plan`);
    expect(md).toContain(`## ${equipment.number}. Equipment qualification comparison`);
    expect(md).toContain("| Activity | Description | Implied by gaps | Severity | Regulatory | Linked studies: source status | Linked studies: target status | Readiness |");
    const table = plan.blocks.find((b) => b.type === "table");
    expect(table?.type === "table" && table.rows.length).toBeGreaterThan(0);
    if (table?.type === "table") {
      for (const r of table.rows) {
        expect(r[2], r[0]).toMatch(/G-\d{3}/);
        expect(r[7], r[0]).not.toBe("");
      }
    }
    const section = md.slice(md.indexOf(`## ${plan.number}. `), md.indexOf(`## ${equipment.number}. `));
    expect(section).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  it("HTML renders both sections with scrollable tables, or the plain empty statement", () => {
    const html = renderHtml(doc);
    expect(html).toContain('<section id="doc-validation-plan">');
    expect(html).toContain('<section id="doc-equipment-qualification">');
    const eq = html.slice(html.indexOf('<section id="doc-equipment-qualification">'), html.indexOf("</section>", html.indexOf('<section id="doc-equipment-qualification">')));
    const hasTable = equipment.blocks.some((b) => b.type === "table");
    if (hasTable) expect(eq).toContain('<div class="table-wrap" role="region"');
    else expect(eq).toContain("No equipment qualification information has been recorded.");
    const pl = html.slice(html.indexOf('<section id="doc-validation-plan">'), html.indexOf("</section>", html.indexOf('<section id="doc-validation-plan">')));
    expect(pl).toContain('<th scope="col">Readiness</th>');
  });

  it("escapes cell text in both renderers", () => {
    const evil: DocModel = {
      ...hostile,
      sections: [{ id: "validation-plan", number: "1", title: "Validation plan", blocks: [{ type: "table", columns: ["Activity", "Readiness"], rows: [["<script>x</script> | y", "Planned"]] }] }],
    };
    expect(renderHtml(evil)).not.toContain("<script>x");
    expect(renderMarkdown(evil)).toContain("<script>x</script> \\| y");
  });
});

// ================================================================== Revision line and appendices C and D (M5)

describe("revision history and reviewer comments in the rendered document", () => {
  const BAD = '<script>alert("x")</script> & "q" | pipe';
  const who = (name: string, at: string) => ({ name, role: "Role <b>x</b>", at });

  /** A project whose revision and comment strings are all hostile, so every field has to be escaped. */
  const evilProject = () => {
    const base = buildDemoProject(content, demos["arx-217"]);
    const d0 = buildDocument(content, base, assess(content, base), "2026-10-02T00:00:00.000Z");
    let p: Project = { ...base, document: { revisions: [], comments: [], exports: [] } };
    p = issueRevision(p, d0, { status: "issued_for_review", summary: `Summary ${BAD}`, template: { mode: "their_look", name: `Tpl ${BAD}`, version: "2.0" } }, who(`Rev ${BAD}`, "2026-10-05T09:00:00.000Z"));
    p = addComment(p, { sectionId: "gap-table", gapKey: "R-NO-SUCH-RULE:uo.nowhere", text: `Comment ${BAD}` }, who(`Chk ${BAD}`, "2026-10-06T09:00:00.000Z"));
    p = replyToComment(p, 1, `Reply ${BAD}`, who("Author", "2026-10-06T10:00:00.000Z"));
    p = resolveComment(p, 1, `Resolved ${BAD}`, who("Author", "2026-10-06T11:00:00.000Z"));
    return p;
  };
  const evilDoc = () => {
    const p = evilProject();
    return buildDocument(content, p, assess(content, p), "2026-10-07T00:00:00.000Z");
  };

  it("shows the Revision line right after Generated, in Markdown and HTML", () => {
    const rev = doc.meta.find(([k]) => k === "Revision")!;
    expect(doc.meta.findIndex(([k]) => k === "Revision")).toBe(doc.meta.findIndex(([k]) => k === "Generated") + 1);
    expect(rev[1]).toBe("1 (Draft, 2026-10-05)");
    expect(renderMarkdown(doc)).toContain("- **Revision:** 1 (Draft, 2026-10-05)");
    expect(renderHtml(doc)).toContain("<dt>Revision</dt><dd>1 (Draft, 2026-10-05)</dd>");
  });

  it("renders appendices C and D from the demo with their tables", () => {
    const md = renderMarkdown(doc);
    expect(md).toContain("| Revision | Status | Date | By | Summary of change | Template |");
    expect(md).toContain("| 1 | Draft | 2026-10-05 | A. Reviewer (fictional) (MSAT lead (fictional)) | First draft for internal review | — |");
    expect(md).toContain("| ID | Location | Comment | By | Date | Status | Responses |");
    expect(md).toMatch(/\| C-001 \| 6\. Detailed gap table, G-\d+ \|/);
    expect(md).toContain("Resolution by A. Reviewer (fictional), 2026-10-06:");
    expect(md).toContain("a revision is not an approval");
    const html = renderHtml(doc);
    expect(html).toContain('<section id="doc-revision-history">');
    expect(html).toContain('<section id="doc-reviewer-comments">');
  });

  it("escapes revision and comment text in HTML", () => {
    const html = renderHtml(evilDoc());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("Summary &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;q&quot; | pipe");
    expect(html).toContain("Comment &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;q&quot; | pipe");
    expect(html).toContain("Tpl &lt;script&gt;");
    expect(html).toContain("Role &lt;b&gt;x&lt;/b&gt;");
  });

  it("escapes pipes in Markdown tables so a comment cannot add columns", () => {
    const md = renderMarkdown(evilDoc());
    expect(md).toContain('Comment <script>alert("x")</script> & "q" \\| pipe');
    expect(md).toContain('Summary <script>alert("x")</script> & "q" \\| pipe');
    const row = md.split("\n").find((l) => l.startsWith("| C-001 |"))!;
    expect((row.match(/(?<!\\)\|/g) ?? []).length).toBe(8); // 7 columns + 1
    const revRow = md.split("\n").find((l) => l.startsWith("| 1 | Issued for review |"))!;
    expect((revRow.match(/(?<!\\)\|/g) ?? []).length).toBe(7); // 6 columns + 1
  });

  it("states that a comment's gap is no longer present instead of dropping the comment", () => {
    const md = renderMarkdown(evilDoc());
    expect(md).toContain("gap no longer present (R-NO-SUCH-RULE:uo.nowhere)");
  });

  it("renders the empty cases in plain words", () => {
    const base = buildDemoProject(content, demos["arx-217"]);
    const empty = { ...base, document: { revisions: [], comments: [], exports: [] } };
    const d = buildDocument(content, empty, assess(content, empty), "2026-10-07T00:00:00.000Z");
    const md = renderMarkdown(d);
    expect(md).toContain("- **Revision:** Not yet issued");
    expect(md).toContain("No revision has been issued yet.");
    expect(md).toContain("No reviewer comments have been recorded.");
  });
});
