import { TemplateError } from "./errors";
import { DocPackage } from "./docpkg";
import { classifyBody, pageFromSectPr } from "./inspect";
import { MAIN_CONTENT_TYPES, MAX_FILE_BYTES, Pkg, REL, resolveTarget } from "./package";
import { readOutlineFromPdf } from "./pdf";
import { sanitizePackage } from "./sanitize";
import { splitDocument } from "./scan";
import { sha256Hex } from "./sha256";
import { StyleTable, parseNumbering } from "./styles";
import { inspectTags } from "./templater";
import type { ImportedTemplate, TemplateAnalysis, TemplateMode } from "./types";
import { parseXml } from "./xml";

const HOW_TO_DOCX = "Open it in Word and choose File > Save As > Word Document (.docx), or in LibreOffice choose File > Save As > Word 2007-365 (.docx). Then upload the .docx copy.";

type Kind = "pdf" | "zip" | "ole" | "rtf" | "unknown";

function startsWith(bytes: Uint8Array, sig: number[], at = 0): boolean {
  return sig.every((b, i) => bytes[at + i] === b);
}

/** What the file really is, from its first bytes (the file name is only used for the messages). */
function detect(bytes: Uint8Array): Kind {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (/^[\s﻿]*\{\\rtf/.test(head)) return "rtf";
  return "unknown";
}

/** True when the OLE container holds an encrypted Office package (its directory lists "EncryptedPackage" in UTF-16). */
function isEncryptedOle(bytes: Uint8Array): boolean {
  const needle = [..."EncryptedPackage"].flatMap((c) => [c.charCodeAt(0), 0]);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    if (bytes[i] !== needle[0]) continue;
    for (let k = 1; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

function nameWith(fileName: string): string {
  return fileName.trim() || "the file";
}

/** Messages for zip packages that are not Word documents. */
function nonWordZip(pkg: Pkg, fileName: string): TemplateError | undefined {
  const names = pkg.names();
  const n = nameWith(fileName);
  const mimetype = pkg.text("mimetype") ?? "";
  if (mimetype.startsWith("application/vnd.oasis.opendocument")) {
    return new TemplateError(`"${n}" is an OpenDocument file (.odt). In LibreOffice Writer choose File > Save As > Word 2007-365 (.docx), then upload the .docx copy.`);
  }
  if (names.some((x) => /^Index(\.zip|\/)/.test(x)) || names.includes("buildVersionHistory.plist")) {
    return new TemplateError(`"${n}" is an Apple Pages file. In Pages choose File > Export To > Word, then upload the .docx copy.`);
  }
  return undefined;
}

function checkParts(dp: DocPackage): void {
  for (const name of dp.pkg.names()) {
    if (/\.(xml|rels)$/i.test(name) && !name.startsWith("customXml/")) parseXml(dp.pkg.text(name) ?? "", name);
  }
}

function hasDrawing(xml: string | undefined): boolean {
  return !!xml && /<w:drawing[\s>]|<w:pict[\s>]|<w:object[\s>]/.test(xml);
}

function analyseDocx(dp: DocPackage, sourceFormat: "docx" | "dotx" | "docm", stripped: string[], storedBytes: Uint8Array): TemplateAnalysis {
  const warnings: string[] = [];
  const mainXml = dp.mainXml();
  const split = splitDocument(mainXml);
  const stylesPart = dp.partOf(REL.styles);
  const styles = stylesPart ? StyleTable.parse(dp.pkg.text(stylesPart) ?? "") : new StyleTable();
  const numPart = dp.partOf(REL.numbering);
  const numbering = parseNumbering(numPart ? dp.pkg.text(numPart) : undefined);
  const { outline } = classifyBody(split, styles, numbering);
  const page = pageFromSectPr(split.sectPr);

  const headings: NonNullable<TemplateAnalysis["styles"]>["headings"] = [];
  for (let level = 1; level <= 9; level++) {
    const s = styles.find(`heading ${level}`, "paragraph");
    if (s) headings.push({ level, styleId: s.id, name: s.name, numbered: styles.numbered(s.id) });
  }
  const pick = (name: string, type = "paragraph") => styles.find(name, type)?.id;
  const styleInfo = {
    headings,
    ...(pick("Normal") ? { normal: pick("Normal") } : {}),
    ...(pick("Title") ? { title: pick("Title") } : {}),
    ...(pick("Table Grid", "table") ? { table: pick("Table Grid", "table") } : {}),
    ...(pick("List Paragraph") ? { listParagraph: pick("List Paragraph") } : {}),
  };

  const missing = ["Title", "heading 1", "heading 2", "heading 3", "List Paragraph"].filter((n) => !styles.find(n, "paragraph"));
  if (!styles.find("Table Grid", "table")) missing.push("Table Grid");
  if (missing.length) warnings.push(`The template has no style named ${missing.map((m) => `"${m}"`).join(", ")}. The tool adds its own matching style when it needs one.`);
  if (!outline.length) warnings.push("No headings were found in this template. \"Map to their headings\" would put all tool content at the end under one heading.");
  if (/<w:(ins|del)\s/.test(mainXml)) warnings.push("The template contains tracked changes. They are kept as they are in \"Map to their headings\" and dropped in \"Their look\".");

  const sect = split.sectPr ?? "";
  const partsOf = (type: string) => dp.mainRels.filter((r) => r.type === type && !r.external).map((r) => resolveTarget(dp.mainName, r.target));
  const headerParts = partsOf(REL.header);
  const footerParts = partsOf(REL.footer);
  const hasHeader = /<w:headerReference\b/.test(sect) || headerParts.length > 0;
  const hasFooter = /<w:footerReference\b/.test(sect) || footerParts.length > 0;
  const hasLogo = [...headerParts, ...footerParts].some((p) => hasDrawing(dp.pkg.text(p)));

  const inspection = inspectTags(storedBytes);
  const hasTags = inspection.found.length > 0;
  const tags = hasTags || inspection.errors.length ? inspection : undefined;
  if (tags?.errors.length) warnings.push("The template has problems with its tags (see the tag report). It cannot be used with placeholder tags until they are fixed.");

  const usableModes: TemplateMode[] = ["their_look", "mapped", ...(hasTags ? (["tags"] as const) : [])];
  return {
    sourceFormat,
    stripped,
    styles: styleInfo,
    page: { orientation: page.orientation, widthTwips: page.widthTwips, heightTwips: page.heightTwips },
    hasHeader,
    hasFooter,
    hasLogo,
    outline,
    ...(tags ? { tags } : {}),
    usableModes,
    warnings,
  };
}

/**
 * Reads an uploaded template. Word files (.docx, .dotx, .docm) are cleaned of macros, toolbars, ActiveX, outside links
 * and review comments and kept as a plain .docx package; a PDF is kept as it is for its outline. Anything else is refused with advice.
 * Nothing in the file is run or evaluated.
 */
export async function importTemplateFile(fileName: string, bytes: Uint8Array): Promise<ImportedTemplate> {
  const n = nameWith(fileName);
  if (!bytes.length) throw new TemplateError(`"${n}" is empty.`);
  if (bytes.length > MAX_FILE_BYTES) throw new TemplateError(`"${n}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Remove large pictures or save a smaller copy and try again.`);
  const sha256 = await sha256Hex(bytes);
  const kind = detect(bytes);

  if (kind === "pdf") {
    const outline = await readOutlineFromPdf(bytes);
    const warnings = outline.length
      ? ["A PDF has no text the tool can keep. Tool content replaces the headings' content, and headings without tool content are marked as still to be completed."]
      : ["No headings were found in the PDF (it has no bookmarks and no numbered heading lines). Upload a Word version of the template, or use the built-in layout."];
    return {
      bytes: bytes.slice(),
      sha256,
      storedSha256: sha256,
      analysis: { sourceFormat: "pdf", stripped: [], hasHeader: false, hasFooter: false, hasLogo: false, outline, usableModes: ["mapped"], warnings },
    };
  }
  if (kind === "ole") {
    if (isEncryptedOle(bytes)) {
      throw new TemplateError(
        `"${n}" is password protected (encrypted), so the tool cannot read it. In Word open it, choose File > Info > Protect Document > Encrypt with Password, clear the password, save as .docx, and upload that copy.`,
      );
    }
    throw new TemplateError(`"${n}" is an old Word file (.doc). ${HOW_TO_DOCX}`);
  }
  if (kind === "rtf") throw new TemplateError(`"${n}" is a Rich Text Format file (.rtf). ${HOW_TO_DOCX}`);
  if (kind !== "zip") {
    throw new TemplateError(`"${n}" is not a file the tool can read as a template. Upload a Word file (.docx, .dotx or .docm) or a PDF. Other formats (for example .odt or .pages) need to be saved as .docx first.`);
  }

  const pkg = Pkg.fromBytes(bytes);
  const other = nonWordZip(pkg, n);
  if (other) throw other;
  let dp: DocPackage;
  try {
    dp = DocPackage.open(pkg);
  } catch (e) {
    if (e instanceof TemplateError) throw new TemplateError(`"${n}": ${e.message}`);
    throw e;
  }
  const sourceFormat = MAIN_CONTENT_TYPES[dp.ct.typeOf(dp.mainName) ?? ""] ?? "docx";
  const stripped = sanitizePackage(dp);
  checkParts(dp);
  const stored = dp.commit();
  const analysis = analyseDocx(dp, sourceFormat, stripped, stored);
  return { bytes: stored, sha256, storedSha256: await sha256Hex(stored), analysis };
}
