// Regenerates the fictional sample templates in packages/docx/fixtures.
//   node packages/docx/scripts/make-fixtures.mjs
// Everything here is fictional ("Brightwater Biologics (fictional)"). The output is the same on every run.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from "pdf-lib";

const require = createRequire(import.meta.url);
const PizZip = require("pizzip");

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "fixtures");
mkdirSync(outDir, { recursive: true });

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const COMPANY = "Brightwater Biologics (fictional)";
const HEADER_TEXT = `${COMPANY} \u2014 Controlled template BB-TPL-0042 (fictional)`;
const FIXED_DATE = new Date(2000, 0, 1, 0, 0, 0);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ------------------------------------------------------------------ a small PNG logo (generated, no binary asset)

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function logoPng() {
  const w = 120;
  const h = 40;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const inLetter = (x >= 10 && x <= 16 && y >= 8 && y <= 32) || (x >= 16 && x <= 30 && (y === 8 || y === 20 || y === 32)) || (x >= 28 && x <= 32 && ((y >= 8 && y <= 20) || (y >= 20 && y <= 32)));
      const wave = y > 28 && (x + y) % 12 < 6;
      const [r, g, b] = inLetter ? [255, 255, 255] : wave ? [60, 130, 190] : [31, 58, 95];
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ the Brightwater parts

const STYLES = `${DECL}<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Verdana" w:hAnsi="Verdana" w:eastAsia="Verdana" w:cs="Verdana"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="BBNormal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:default="1" w:styleId="BBDefaultFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="table" w:default="1" w:styleId="BBTableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="numbering" w:default="1" w:styleId="BBNoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="paragraph" w:styleId="BBTitle"><w:name w:val="Title"/><w:basedOn w:val="BBNormal"/><w:next w:val="BBNormal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="240" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/><w:b/><w:bCs/><w:color w:val="1F3A5F"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="BBHeading1"><w:name w:val="heading 1"/><w:basedOn w:val="BBNormal"/><w:next w:val="BBNormal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/><w:b/><w:bCs/><w:color w:val="1F3A5F"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="BBHeading2"><w:name w:val="heading 2"/><w:basedOn w:val="BBNormal"/><w:next w:val="BBNormal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/><w:b/><w:bCs/><w:color w:val="2E5C8A"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="BBInstruction"><w:name w:val="Instruction Text"/><w:basedOn w:val="BBNormal"/><w:qFormat/><w:rPr><w:i/><w:iCs/><w:color w:val="7F7F7F"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="BBList"><w:name w:val="List Paragraph"/><w:basedOn w:val="BBNormal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="BBHeader"><w:name w:val="header"/><w:basedOn w:val="BBNormal"/><w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="BBFooter"><w:name w:val="footer"/><w:basedOn w:val="BBNormal"/><w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="BBTable"><w:name w:val="Table Grid"/><w:basedOn w:val="BBTableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const NUMBERING = `${DECL}<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="BBHeading1"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="432" w:hanging="432"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="BBHeading2"/><w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="576" w:hanging="576"/></w:pPr></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana" w:hint="default"/></w:rPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const SETTINGS = `${DECL}<w:settings xmlns:w="${W}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:themeFontLang w:val="en-US"/><w:decimalSymbol w:val="."/><w:listSeparator w:val=","/></w:settings>`;

const run = (text, rpr = "") => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const p = (style, inner) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inner}</w:p>`;
const heading = (level, text) => p(`BBHeading${level}`, run(text));
const instruction = (text) => p("BBInstruction", run(text));
const normal = (text) => p("BBNormal", run(text));
const bullet = (inner) => `<w:p><w:pPr><w:pStyle w:val="BBList"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${inner}</w:p>`;

function table(widths, rows, headerRow = true) {
  const tc = (w, text, head) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="DCE6F1"/>' : ""}</w:tcPr><w:p><w:pPr><w:pStyle w:val="BBNormal"/><w:spacing w:after="40"/></w:pPr>${text ? run(text, head ? "<w:b/><w:bCs/>" : "") : ""}</w:p></w:tc>`;
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="BBTable"/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
    rows.map((r, ri) => `<w:tr>${headerRow && ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${r.map((c, i) => tc(widths[i], c, headerRow && ri === 0)).join("")}</w:tr>`).join("") +
    "</w:tbl>"
  );
}

const SECT_PR = `<w:sectPr><w:headerReference w:type="default" r:id="rId5"/><w:footerReference w:type="default" r:id="rId6"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

const field = (code) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

const HEADER = `${DECL}<w:hdr xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:p><w:pPr><w:pStyle w:val="BBHeader"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="304800"/><wp:docPr id="1" name="Brightwater logo" descr="${COMPANY} logo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png" descr="${COMPANY} logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="304800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:p><w:pPr><w:pStyle w:val="BBHeader"/></w:pPr>${run(HEADER_TEXT)}</w:p></w:hdr>`;

const FOOTER = `${DECL}<w:ftr xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr><w:pStyle w:val="BBFooter"/></w:pPr>${run("Page ")}${field("PAGE")}</w:p></w:ftr>`;

const CORE = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Technology transfer report template BB-TPL-0042 (fictional)</dc:title><dc:creator>${COMPANY}</dc:creator><cp:lastModifiedBy>${COMPANY}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-05T09:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-05T09:00:00Z</dcterms:modified></cp:coreProperties>`;
const APP = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Fictional fixture generator</Application><Company>${COMPANY}</Company></Properties>`;

// ------------------------------------------------------------------ bodies

function sopBody() {
  return (
    p("BBTitle", run("Technology Transfer Report")) +
    instruction("[Replace this line with the title of the transfer and the product name.]") +
    heading(1, "Objective") +
    instruction("Describe the objective of this document in one or two sentences.") +
    heading(1, "Applicability") +
    instruction("State which products, sites and processes this document applies to.") +
    heading(1, "Definitions") +
    instruction("List the terms and abbreviations used. Delete this instruction before the document is issued.") +
    heading(1, "Comparison of Source and Receiving Processes") +
    heading(2, "Process Description") +
    instruction("Summarise the source process and the receiving process side by side.") +
    heading(2, "Identified Differences") +
    instruction("List each identified difference, its impact and the proposed action.") +
    table([2600, 3400, 3360], [["Difference", "Impact", "Proposed action"], ["[example difference]", "[example impact]", "[example action]"]]) +
    normal("") +
    heading(1, "Required Actions") +
    instruction("List the actions that are needed before the transfer can proceed.") +
    heading(1, "Outstanding Information") +
    instruction("List information that is still missing, with the person who will provide it.") +
    heading(1, "Document Sign-off") +
    instruction("The document owner completes the sign-off table. Approval is outside this template.")
  );
}

function tagsBody() {
  return (
    p("BBNormal", run("{banner}", "<w:b/><w:bCs/><w:color w:val=\"8A1C1C\"/>")) +
    p("BBTitle", run("{title}")) +
    normal("Status: {status}. Revision: {revision}. Generated: {generated}.") +
    heading(1, "Objective") +
    normal("Transfer of {program} ({modality}, {dosageForm}) from {sourceSite} to {targetSite}.") +
    heading(1, "Applicability") +
    normal("Presentation: {presentation}. Markets: {markets}. Type of transfer: {transferType}.") +
    heading(1, "Definitions") +
    instruction("Terms are defined in the company glossary. Delete this instruction before the document is issued.") +
    heading(1, "Comparison of Source and Receiving Processes") +
    heading(2, "Process Description") +
    normal("{differencesCount} differences were identified; {openItemsCount} information items are open; {verifiedSummary} entries are verified.") +
    heading(2, "Identified Differences") +
    table(
      [900, 1700, 1700, 1700, 1800, 1560],
      [
        ["ID", "Attribute", "Source", "Target", "Category", "Regulatory"],
        ["{#gaps}{id}", "{attribute}", "{source}", "{target}", "{category}", "{regulatory}{/gaps}"],
      ],
    ) +
    normal("{regulatoryStatement}") +
    heading(1, "Required Actions") +
    p("BBNormal", run("{#activities}")) +
    bullet(run("{activity}: {description}")) +
    p("BBNormal", run("{/activities}")) +
    heading(1, "Outstanding Information") +
    p("BBNormal", run("{#openItems}")) +
    bullet(run("{no}. {question} ({section}, {side}, {status})")) +
    p("BBNormal", run("{/openItems}")) +
    heading(1, "Document Sign-off") +
    table(
      [2400, 2400, 2400, 2160],
      [
        ["Role", "Name", "Signature", "Date"],
        ["{#approvals}{role}", "{name}", "{signature}", "{date}{/approvals}"],
      ],
    ) +
    normal("{verificationStatement}")
  );
}

// ------------------------------------------------------------------ packaging

const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function pack(files) {
  const zip = new PizZip();
  for (const [name, data] of files) zip.file(name, data, { date: FIXED_DATE, binary: typeof data !== "string" });
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "DOS" });
}

function relsXml(rels) {
  return `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ""}/>`)
    .join("")}</Relationships>`;
}

function typesXml(defaults, overrides) {
  return `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join("")}${overrides.map(([n, t]) => `<Override PartName="/${n}" ContentType="${t}"/>`).join("")}</Types>`;
}

const CT_BASE = "application/vnd.openxmlformats-officedocument.wordprocessingml";

function docXml(body) {
  return `${DECL}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${SECT_PR}</w:body></w:document>`;
}

function brightwater(body, opts = {}) {
  const macro = !!opts.macro;
  const docRels = [
    ["rId1", `${REL_BASE}/styles`, "styles.xml"],
    ["rId2", `${REL_BASE}/numbering`, "numbering.xml"],
    ["rId3", `${REL_BASE}/settings`, "settings.xml"],
    ["rId5", `${REL_BASE}/header`, "header1.xml"],
    ["rId6", `${REL_BASE}/footer`, "footer1.xml"],
  ];
  const defaults = [
    ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["xml", "application/xml"],
    ["png", "image/png"],
  ];
  const overrides = [
    ["word/document.xml", macro ? "application/vnd.ms-word.document.macroEnabled.main+xml" : `${CT_BASE}.document.main+xml`],
    ["word/styles.xml", `${CT_BASE}.styles+xml`],
    ["word/numbering.xml", `${CT_BASE}.numbering+xml`],
    ["word/settings.xml", `${CT_BASE}.settings+xml`],
    ["word/header1.xml", `${CT_BASE}.header+xml`],
    ["word/footer1.xml", `${CT_BASE}.footer+xml`],
    ["docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
  ];
  const files = [
    ["_rels/.rels", relsXml([["rId1", `${REL_BASE}/officeDocument`, "word/document.xml"], ["rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"], ["rId3", `${REL_BASE}/extended-properties`, "docProps/app.xml"]])],
    ["word/styles.xml", STYLES],
    ["word/numbering.xml", NUMBERING],
    ["word/header1.xml", HEADER],
    ["word/footer1.xml", FOOTER],
    ["word/_rels/header1.xml.rels", relsXml([["rId1", `${REL_BASE}/image`, "media/logo.png"]])],
    ["word/media/logo.png", logoPng()],
    ["docProps/core.xml", CORE],
    ["docProps/app.xml", APP],
  ];
  let settings = SETTINGS;
  let mainBody = body;
  if (macro) {
    // A macro-enabled copy with the kinds of content the importer must remove (all fictional, nothing runs).
    let seed = 12345;
    const junk = Buffer.alloc(2048);
    for (let i = 0; i < junk.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      junk[i] = seed & 0xff;
    }
    defaults.push(["bin", "application/vnd.ms-office.vbaProject"]);
    overrides.push(["word/vbaData.xml", "application/vnd.ms-word.vbaData+xml"], ["word/customizations.xml", "application/vnd.ms-word.keyMapCustomizations+xml"], ["word/comments.xml", `${CT_BASE}.comments+xml`]);
    docRels.push(
      ["rId7", "http://schemas.microsoft.com/office/2006/relationships/vbaProject", "vbaProject.bin"],
      ["rId8", "http://schemas.microsoft.com/office/2006/relationships/keyMapCustomizations", "customizations.xml"],
      ["rId9", `${REL_BASE}/comments`, "comments.xml"],
      ["rId10", `${REL_BASE}/oleObject`, "file:///C:/fictional-share/data.xlsx", true],
      ["rId11", `${REL_BASE}/hyperlink`, "https://example.com/brightwater-sop", true],
    );
    files.push(
      ["word/vbaProject.bin", junk],
      ["word/vbaData.xml", `${DECL}<wne:vbaSuppData xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"/>`],
      ["word/_rels/vbaProject.bin.rels", relsXml([["rId1", "http://schemas.microsoft.com/office/2006/relationships/wordVbaData", "vbaData.xml"]])],
      ["word/customizations.xml", `${DECL}<wne:tcg xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"/>`],
      ["word/comments.xml", `${DECL}<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Fictional Reviewer" w:initials="FR"><w:p><w:r><w:t>Fictional template comment.</w:t></w:r></w:p></w:comment></w:comments>`],
      ["word/_rels/settings.xml.rels", relsXml([["rId1", `${REL_BASE}/attachedTemplate`, "file:///C:/fictional-share/Brightwater.dotm", true]])],
    );
    settings = SETTINGS.replace('xmlns:w="' + W + '"', `xmlns:w="${W}" xmlns:r="${R}"`).replace('<w:defaultTabStop', '<w:attachedTemplate r:id="rId1"/><w:documentProtection w:edit="readOnly" w:enforcement="0"/><w:defaultTabStop');
    mainBody = body.replace(
      "</w:p>",
      `</w:p><w:p><w:pPr><w:pStyle w:val="BBNormal"/></w:pPr><w:commentRangeStart w:id="0"/><w:hyperlink r:id="rId11"><w:r><w:t>Brightwater SOP (fictional link)</w:t></w:r></w:hyperlink><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`,
    );
  }
  files.unshift(["[Content_Types].xml", typesXml(defaults, overrides)]);
  files.push(["word/document.xml", docXml(mainBody)], ["word/_rels/document.xml.rels", relsXml(docRels)], ["word/settings.xml", settings]);
  return pack(files);
}

// ------------------------------------------------------------------ the PDF with bookmarks

async function outlinePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle("Technology transfer report template BB-TPL-0042 (fictional)");
  doc.setAuthor(COMPANY);
  doc.setProducer("Fictional fixture generator");
  doc.setCreator("Fictional fixture generator");
  doc.setCreationDate(new Date(Date.UTC(2026, 0, 5)));
  doc.setModificationDate(new Date(Date.UTC(2026, 0, 5)));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const headings = [
    [1, "1", "Objective", 0],
    [1, "2", "Applicability", 0],
    [1, "3", "Definitions", 0],
    [1, "4", "Comparison of Source and Receiving Processes", 1],
    [2, "4.1", "Process Description", 1],
    [2, "4.2", "Identified Differences", 1],
    [1, "5", "Required Actions", 2],
    [1, "6", "Outstanding Information", 2],
    [1, "7", "Document Sign-off", 2],
  ];
  const pages = [doc.addPage([612, 792]), doc.addPage([612, 792]), doc.addPage([612, 792])];
  pages[0].drawText(`${COMPANY} \u2014 Technology Transfer Report`, { x: 56, y: 740, size: 18, font: bold, color: rgb(0.12, 0.23, 0.37) });
  const y = [700, 700, 700];
  const dests = [];
  for (const [level, num, title, pg] of headings) {
    const page = pages[pg];
    page.drawText(`${num} ${title}`, { x: 56 + (level - 1) * 18, y: y[pg], size: level === 1 ? 14 : 12, font: bold });
    dests.push({ level, title: `${num} ${title}`, page: page.ref, y: y[pg] + 14 });
    y[pg] -= 22;
    page.drawText("Instruction: replace this text with the content of the section.", { x: 56 + (level - 1) * 18, y: y[pg], size: 9, font, color: rgb(0.5, 0.5, 0.5) });
    y[pg] -= 34;
  }
  // Bookmarks: a two-level outline built with the low-level API.
  const ctx = doc.context;
  const outlinesRef = ctx.nextRef();
  const roots = [];
  for (const d of dests) {
    d.ref = ctx.nextRef();
    d.children = [];
    if (d.level === 1) roots.push(d);
    else roots[roots.length - 1].children.push(d);
  }
  const link = (list, parentRef) => {
    list.forEach((d, i) => {
      const dict = {
        Title: PDFHexString.fromText(d.title),
        Parent: parentRef,
        Dest: [d.page, "XYZ", 0, d.y, null],
      };
      if (list[i - 1]) dict.Prev = list[i - 1].ref;
      if (list[i + 1]) dict.Next = list[i + 1].ref;
      if (d.children.length) {
        dict.First = d.children[0].ref;
        dict.Last = d.children[d.children.length - 1].ref;
        dict.Count = d.children.length;
      }
      ctx.assign(d.ref, ctx.obj(dict));
      link(d.children, d.ref);
    });
  };
  link(roots, outlinesRef);
  ctx.assign(outlinesRef, ctx.obj({ Type: "Outlines", First: roots[0].ref, Last: roots[roots.length - 1].ref, Count: dests.length }));
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// ------------------------------------------------------------------ write

const targets = [
  ["brightwater-template.docx", brightwater(sopBody())],
  ["brightwater-tags.docx", brightwater(tagsBody())],
  ["brightwater-macro.docm", brightwater(sopBody(), { macro: true })],
  ["brightwater-outline.pdf", await outlinePdf()],
];
for (const [name, bytes] of targets) {
  writeFileSync(join(outDir, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
