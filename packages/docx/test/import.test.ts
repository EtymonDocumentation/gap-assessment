/// <reference types="node" />
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { importTemplateFile } from "../src/index";
import { fixture } from "./fixtures";
import { checkPackage, strictDocx } from "./strict";

const enc = (s: string) => new TextEncoder().encode(s);

describe("importing the Brightwater sample template", () => {
  it("reads headings with their automatic numbers, and the look", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const a = t.analysis;
    expect(a.sourceFormat).toBe("docx");
    expect(a.outline.map((h) => h.text)).toEqual([
      "Objective",
      "Applicability",
      "Definitions",
      "Comparison of Source and Receiving Processes",
      "Process Description",
      "Identified Differences",
      "Required Actions",
      "Outstanding Information",
      "Document Sign-off",
    ]);
    expect(a.outline.map((h) => h.number)).toEqual(["1", "2", "3", "4", "4.1", "4.2", "5", "6", "7"]);
    expect(a.outline.map((h) => h.level)).toEqual([1, 1, 1, 1, 2, 2, 1, 1, 1]);
    // Every heading has an instruction paragraph, except "Comparison..." which only holds sub-headings.
    expect(a.outline.find((h) => h.text.startsWith("Comparison"))!.hasBody).toBe(false);
    expect(a.outline.find((h) => h.text === "Objective")!.hasBody).toBe(true);
    expect(a.page).toEqual({ orientation: "portrait", widthTwips: 12240, heightTwips: 15840 });
    expect(a.hasHeader).toBe(true);
    expect(a.hasFooter).toBe(true);
    expect(a.hasLogo).toBe(true);
    expect(a.styles?.headings.map((h) => h.styleId)).toContain("BBHeading1");
    expect(a.styles?.headings.every((h) => h.numbered)).toBe(true);
    expect(a.usableModes).toEqual(["their_look", "mapped"]);
    expect(a.stripped).toEqual([]);
    expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);
    strictDocx(t.bytes);
  });

  it("finds the tags in the tag sample, with none unknown and none missing from the loops", async () => {
    const t = await importTemplateFile("brightwater-tags.docx", fixture("brightwater-tags.docx"));
    const tags = t.analysis.tags!;
    expect(tags.errors).toEqual([]);
    expect(tags.unknown).toEqual([]);
    expect(tags.found).toEqual(expect.arrayContaining(["banner", "title", "gaps", "gaps.id", "openItems", "approvals"]));
    expect(t.analysis.usableModes).toContain("tags");
  });

  it("removes macros, external links, comments and protection from the macro-enabled sample and says so", async () => {
    const t = await importTemplateFile("brightwater-macro.docm", fixture("brightwater-macro.docm"));
    const joined = t.analysis.stripped.join(" | ").toLowerCase();
    expect(joined).toContain("macro");
    expect(joined).toContain("comment");
    expect(joined).toMatch(/external|linked|attached/);
    const res = strictDocx(t.bytes);
    expect(res.names.some((n) => /vba|customizations/i.test(n))).toBe(false);
    expect(res.names).not.toContain("word/comments.xml");
    const ct = res.text("[Content_Types].xml");
    expect(ct).not.toMatch(/macroEnabled|vbaProject|vbaData|keyMapCustomizations/);
    const rels = res.text("word/_rels/document.xml.rels");
    expect(rels).not.toMatch(/vbaProject|oleObject|file:\/\/|comments/);
    expect(res.names.some((n) => n === "word/_rels/settings.xml.rels")).toBe(false);
    expect(res.text("word/settings.xml")).not.toMatch(/attachedTemplate|documentProtection/);
    expect(res.text("word/document.xml")).not.toMatch(/commentRange|commentReference/);
    // The sanitised file is a plain .docx now, and the visible text is still there.
    expect(res.text("[Content_Types].xml")).toContain("wordprocessingml.document.main+xml");
    expect(res.text("word/document.xml")).toContain("Objective");
    expect(t.analysis.sourceFormat).toBe("docm");
  });

  it("sanitises a .dotx made in memory", async () => {
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const ct = zip.file("[Content_Types].xml")!.asText().replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
    zip.file("[Content_Types].xml", ct);
    const bytes = zip.generate({ type: "uint8array" });
    const t = await importTemplateFile("lab.dotx", bytes);
    expect(t.analysis.sourceFormat).toBe("dotx");
    expect(t.analysis.outline.length).toBe(9);
    expect(strictDocx(t.bytes).text("[Content_Types].xml")).toContain("wordprocessingml.document.main+xml");
  });

  it("does not trust the file name: a .pdf-named docx is read as a docx", async () => {
    const t = await importTemplateFile("really-a-docx.pdf", fixture("brightwater-template.docx"));
    expect(t.analysis.sourceFormat).toBe("docx");
  });
});

describe("rejecting files that cannot be used", () => {
  it("rejects an old .doc (OLE) file with a plain message", async () => {
    const cfb = new Uint8Array(2048);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(importTemplateFile("old.doc", cfb)).rejects.toThrow(/old Word format|\.doc|Save As/i);
  });

  it("rejects an encrypted (password-protected) Word file", async () => {
    const cfb = new Uint8Array(4096);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const name = "EncryptedPackage";
    for (let i = 0; i < name.length; i++) cfb[1024 + i * 2] = name.charCodeAt(i);
    await expect(importTemplateFile("secret.docx", cfb)).rejects.toThrow(/password|encrypt/i);
  });

  it("rejects RTF, ODT and random bytes", async () => {
    await expect(importTemplateFile("a.rtf", enc("{\\rtf1\\ansi Hello}"))).rejects.toThrow(/rtf/i);
    const odt = new PizZip();
    odt.file("mimetype", "application/vnd.oasis.opendocument.text");
    odt.file("content.xml", "<office:document-content/>");
    await expect(importTemplateFile("a.odt", odt.generate({ type: "uint8array" }))).rejects.toThrow(/OpenDocument|odt/i);
    await expect(importTemplateFile("x.docx", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow();
    await expect(importTemplateFile("empty.docx", new Uint8Array(0))).rejects.toThrow();
  });

  it("rejects a zip that is not a Word document", async () => {
    const z = new PizZip();
    z.file("hello.txt", "hello");
    await expect(importTemplateFile("t.docx", z.generate({ type: "uint8array" }))).rejects.toThrow();
  });

  it("rejects a file that is too large", async () => {
    await expect(importTemplateFile("big.docx", new Uint8Array(30 * 1024 * 1024))).rejects.toThrow(/too large|MB/i);
  });

  it("rejects a zip bomb by the size it declares", async () => {
    const z = new PizZip();
    z.file("[Content_Types].xml", "<Types/>");
    z.file("word/document.xml", "a".repeat(64));
    const bytes = z.generate({ type: "uint8array", compression: "STORE" });
    // Change the size written in the zip's directory to 300 MB, without making the file bigger.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let patched = 0;
    for (let i = 0; i + 28 < bytes.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 300 * 1024 * 1024, true);
        patched++;
      }
    }
    expect(patched).toBe(2);
    expect(bytes.length).toBeLessThan(2000);
    await expect(importTemplateFile("bomb.docx", bytes)).rejects.toThrow(/expand|MB/i);
  });

  it("rejects an XML part with a DOCTYPE (no entity tricks)", async () => {
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const doc = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", doc.replace("?>\n", '?>\n<!DOCTYPE x [<!ENTITY a "bb">]>\n'));
    await expect(importTemplateFile("evil.docx", zip.generate({ type: "uint8array" }))).rejects.toThrow();
  });
});

describe("importing a PDF", () => {
  it("reads the bookmark outline of the sample PDF", async () => {
    const t = await importTemplateFile("brightwater-outline.pdf", fixture("brightwater-outline.pdf"));
    expect(t.analysis.sourceFormat).toBe("pdf");
    expect(t.analysis.usableModes).toEqual(["mapped"]);
    expect(t.analysis.outline.map((h) => h.text)).toEqual([
      "Objective",
      "Applicability",
      "Definitions",
      "Comparison of Source and Receiving Processes",
      "Process Description",
      "Identified Differences",
      "Required Actions",
      "Outstanding Information",
      "Document Sign-off",
    ]);
    expect(t.analysis.outline.map((h) => h.level)).toEqual([1, 1, 1, 1, 2, 2, 1, 1, 1]);
    expect(t.analysis.outline.map((h) => h.number)).toEqual(["1", "2", "3", "4", "4.1", "4.2", "5", "6", "7"]);
    // A PDF is kept unchanged.
    expect(t.storedSha256).toBe(t.sha256);
    expect(t.analysis.warnings.join(" ")).toMatch(/PDF/);
  });
});

describe("package helper itself", () => {
  it("fails on a package with a missing relationship target", () => {
    const zip = new PizZip(fixture("brightwater-template.docx"));
    zip.remove("word/styles.xml");
    expect(() => checkPackage(zip.generate({ type: "uint8array" }))).toThrow(/does not exist|missing part|content type/);
  });
  it("fails on malformed XML", () => {
    const zip = new PizZip(fixture("brightwater-template.docx"));
    zip.file("word/document.xml", "<w:document><w:body></w:document>");
    expect(() => checkPackage(zip.generate({ type: "uint8array" }))).toThrow();
  });
});
