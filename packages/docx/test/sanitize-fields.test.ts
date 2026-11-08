import { describe, expect, it } from "vitest";
import { DocPackage } from "../src/docpkg";
import { fieldIsUnsafe, neutraliseFields, sanitizePackage } from "../src/sanitize";

/**
 * A Word file can hold fields: short instructions Word carries out when the file is opened or updated. The importer keeps a field's
 * visible text but removes instructions that would fetch outside content, open a file or run a macro. Each test below is one way
 * such an instruction can be written; all of them must be neutralised, and the ordinary fields must be left exactly as they were.
 * Only made-up file names are used.
 */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body: string): string => `<w:document ${W}><w:body><w:p>${body}</w:p></w:body></w:document>`;

/** A complex field: begin mark, the instruction in the given pieces (one run each), separate mark, visible result, end mark. */
function complex(pieces: string[], opts: { prefix?: string; shown?: string } = {}): string {
  const p = opts.prefix ?? "w";
  const run = (inner: string) => `<${p}:r>${inner}</${p}:r>`;
  return (
    run(`<${p}:fldChar ${p}:fldCharType="begin"/>`) +
    pieces.map((t) => run(`<${p}:instrText xml:space="preserve">${t}</${p}:instrText>`)).join("") +
    run(`<${p}:fldChar ${p}:fldCharType="separate"/>`) +
    run(`<${p}:t>${opts.shown ?? "shown text"}</${p}:t>`) +
    run(`<${p}:fldChar ${p}:fldCharType="end"/>`)
  );
}

const FICTIONAL_FILE = String.raw`c:\fictional\sheet.txt`;

describe("fields that reach outside the file are neutralised", () => {
  it("an instruction split over several runs", () => {
    const xml = doc(complex([" D", "DE ", ` ${FICTIONAL_FILE} `]));
    const out = neutraliseFields(xml);
    expect(out.count).toBe(1);
    expect(out.xml).not.toMatch(/DDE/);
    expect(out.xml).not.toContain("fictional");
    expect(out.xml).toContain("shown text");
    expect(out.xml).toContain('QUOTE ""');
  });

  it("an instruction split in the middle of its first word, with the rest in a later run", () => {
    const xml = doc(complex(["INCL", "UDETEXT ", "&quot;", "file:///fictional/a.docx", "&quot;"]));
    const out = neutraliseFields(xml);
    expect(out.count).toBe(1);
    expect(out.xml).not.toMatch(/INCLUDETEXT|fictional/);
  });

  it("a simple field whose instruction uses single quotes", () => {
    const xml = doc(`<w:fldSimple w:instr='DDEAUTO ${FICTIONAL_FILE}'><w:r><w:t>shown text</w:t></w:r></w:fldSimple>`);
    const out = neutraliseFields(xml);
    expect(out.count).toBe(1);
    expect(out.xml).not.toMatch(/DDEAUTO|fictional/);
    expect(out.xml).toContain("shown text");
  });

  it("a simple field with double quotes (the usual form)", () => {
    const xml = doc(`<w:fldSimple w:instr="DDE ${FICTIONAL_FILE}"><w:r><w:t>shown text</w:t></w:r></w:fldSimple>`);
    const out = neutraliseFields(xml);
    expect(out.count).toBe(1);
    expect(out.xml).not.toMatch(/DDE|fictional/);
  });

  it("elements written with another namespace prefix", () => {
    const ns = 'xmlns:q="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const complexXml = `<q:document ${ns}><q:body><q:p>${complex([`DDE ${FICTIONAL_FILE}`], { prefix: "q" })}</q:p></q:body></q:document>`;
    const a = neutraliseFields(complexXml);
    expect(a.count).toBe(1);
    expect(a.xml).not.toMatch(/DDE|fictional/);

    const simpleXml = `<q:document ${ns}><q:body><q:p><q:fldSimple q:instr="INCLUDEPICTURE &quot;file:///fictional/a.png&quot;"><q:r><q:t>x</q:t></q:r></q:fldSimple></q:p></q:body></q:document>`;
    const b = neutraliseFields(simpleXml);
    expect(b.count).toBe(1);
    expect(b.xml).not.toMatch(/INCLUDEPICTURE|fictional/);
  });

  it("an instruction whose first word is wrapped in quotes", () => {
    for (const lead of ['"DDE" ', "'DDEAUTO' ", "\u201cLINK\u201d ", ' "  INCLUDETEXT"']) {
      const out = neutraliseFields(doc(complex([`${lead}${FICTIONAL_FILE}`])));
      expect(out.count, lead).toBe(1);
      expect(out.xml, lead).not.toContain("fictional");
    }
  });

  it("an instruction with characters that have no width, or written as character references", () => {
    const hidden = neutraliseFields(doc(complex(["D\u200bDE ", "\ufeff", FICTIONAL_FILE])));
    expect(hidden.count).toBe(1);
    expect(hidden.xml).not.toContain("fictional");
    const encoded = neutraliseFields(doc(complex([`&#68;&#x44;E ${FICTIONAL_FILE}`])));
    expect(encoded.count).toBe(1);
    expect(encoded.xml).not.toContain("fictional");
  });

  it("a link field that points to a file address", () => {
    const out = neutraliseFields(doc(complex([' HYPERLINK "file:///fictional/a.docx" '])));
    expect(out.count).toBe(1);
    expect(out.xml).not.toContain("fictional");
    expect(out.xml).toContain("shown text");
  });

  it("a link field that points to a network share (quoted or not)", () => {
    const quoted = neutraliseFields(doc(complex([String.raw` HYPERLINK "\\\\fictional-host\\share\\a.docx" `])));
    expect(quoted.count).toBe(1);
    expect(quoted.xml).not.toContain("fictional-host");
    const bare = neutraliseFields(doc(complex([String.raw` HYPERLINK \\fictional-host\share\a.docx `])));
    expect(bare.count).toBe(1);
    expect(bare.xml).not.toContain("fictional-host");
  });

  it("a link field to a file with a place in that file added after it", () => {
    const out = neutraliseFields(doc(complex([' HYPERLINK "file:///fictional/a.docx" \\l "Section2" '])));
    expect(out.count).toBe(1);
    expect(out.xml).not.toContain("fictional");
  });

  it("a text inside another attribute does not hide the real instruction", () => {
    const xml = doc(`<w:fldSimple w:fldLock="x w:instr='PAGE'" w:instr="DDE ${FICTIONAL_FILE}"><w:r><w:t>y</w:t></w:r></w:fldSimple>`);
    const out = neutraliseFields(xml);
    expect(out.count).toBe(1);
    expect(out.xml).not.toContain("fictional");
  });

  it("a field mark whose type is single quoted, or hidden inside another attribute's value", () => {
    const xml = doc(
      `<w:r><w:fldChar w:fldCharType='begin'/></w:r><w:r><w:instrText>DDE ${FICTIONAL_FILE}</w:instrText></w:r>` +
        `<w:r><w:fldChar w:dirty="w:fldCharType='end'" w:fldCharType='end'/></w:r>`,
    );
    const out = neutraliseFields(xml);
    expect(out.count).toBe(1);
    expect(out.xml).not.toContain("fictional");
  });

  it("an instruction with no field mark around it, and a field that is never closed", () => {
    const loose = neutraliseFields(doc(`<w:r><w:instrText>DDE ${FICTIONAL_FILE}</w:instrText></w:r>`));
    expect(loose.count).toBe(1);
    expect(loose.xml).not.toContain("fictional");
    const open = neutraliseFields(doc(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>MACROBUTTON Run ${FICTIONAL_FILE}</w:instrText></w:r>`));
    expect(open.count).toBe(1);
    expect(open.xml).not.toContain("fictional");
  });

  it("an unsafe field nested inside a harmless one", () => {
    const inner = complex([`INCLUDETEXT ${FICTIONAL_FILE}`]);
    const xml = doc(
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> IF </w:instrText></w:r>${inner}<w:r><w:instrText> = 1 "a" "b" </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>x</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`,
    );
    const out = neutraliseFields(xml);
    expect(out.count).toBe(1);
    expect(out.xml).not.toContain("fictional");
  });
});

describe("ordinary fields are left exactly as they were", () => {
  const keep = [
    " PAGE ",
    " NUMPAGES \\* MERGEFORMAT ",
    ' TOC \\o "1-3" \\h \\z \\u ',
    " REF _Ref123456 \\h ",
    ' HYPERLINK "https://example.org/fictional" ',
    ' HYPERLINK "mailto:someone@example.org" ',
    ' HYPERLINK \\l "Section2" ',
    " HYPERLINK \\l Section2 ",
    ' HYPERLINK "https://example.org/fictional" \\o "A tool tip" \\t "_blank" ',
    ' DATE \\@ "d MMMM yyyy" ',
    " SEQ Table \\* ARABIC ",
  ];
  for (const instruction of keep) {
    it(`keeps ${instruction.trim().split(/\s+/)[0]}: ${instruction.trim().slice(0, 40)}`, () => {
      const xml = doc(complex([instruction]));
      const out = neutraliseFields(xml);
      expect(out.count).toBe(0);
      expect(out.xml).toBe(xml);
    });
  }

  it("keeps a simple field that is harmless", () => {
    const xml = doc(`<w:fldSimple w:instr=" PAGE \\* MERGEFORMAT "><w:r><w:t>1</w:t></w:r></w:fldSimple>`);
    expect(neutraliseFields(xml)).toEqual({ xml, count: 0 });
  });

  it("judges the instruction text on its own", () => {
    expect(fieldIsUnsafe(" PAGE ")).toBe(false);
    expect(fieldIsUnsafe("")).toBe(false);
    expect(fieldIsUnsafe(" DDE x ")).toBe(true);
    expect(fieldIsUnsafe("hyperlink 'file:///fictional/a'")).toBe(true);
  });
});

describe("the whole sanitiser", () => {
  it("removes the unsafe fields from every part, tells the user how many, and keeps the visible text", () => {
    const dp = DocPackage.fresh();
    dp.setMainXml(
      doc(complex(["DD", `E ${FICTIONAL_FILE}`], { shown: "first result" }) + complex([" PAGE "], { shown: "2" })) ,
    );
    dp.pkg.set("word/header1.xml", `<w:hdr ${W}><w:p><w:fldSimple w:instr='LINK Excel.Sheet.12 "${FICTIONAL_FILE}"'><w:r><w:t>head</w:t></w:r></w:fldSimple></w:p></w:hdr>`);
    const stripped = sanitizePackage(dp);
    expect(stripped.join(" | ")).toContain("Fields that could fetch outside content or run a macro (2)");
    const main = dp.mainXml();
    expect(main).not.toMatch(/DDE|fictional/);
    expect(main).toContain("first result");
    expect(main).toContain(" PAGE ");
    const header = dp.pkg.text("word/header1.xml")!;
    expect(header).not.toMatch(/LINK Excel|fictional/);
    expect(header).toContain("head");
  });

  it("removes a chunk of another document whether or not the tag is self-closing, with any prefix", () => {
    const dp = DocPackage.fresh();
    dp.setMainXml(doc(`<w:altChunk r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><x:altChunk x:id="rId8"></x:altChunk><w:r><w:t>kept</w:t></w:r>`));
    const stripped = sanitizePackage(dp);
    expect(stripped.join(" | ")).toContain("Embedded document chunks (2)");
    expect(dp.mainXml()).not.toMatch(/altChunk/);
    expect(dp.mainXml()).toContain("kept");
  });
});
