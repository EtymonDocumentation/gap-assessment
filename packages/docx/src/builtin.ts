import type { DocModel } from "@gap/engine";
import { DocPackage } from "./docpkg";
import { CT, REL } from "./package";
import { BUILTIN_STYLE_ID, StyleTable, builtinStylesXml, withBulletList } from "./styles";
import { BANNER_COLOR, WriterCtx, para, textRuns, type PageGeom } from "./writer";
import { R_NS, W_NS, XML_DECL } from "./xml";

/** A4 landscape with 15 mm margins. */
export const BUILTIN_PAGE_W = 16838;
export const BUILTIN_PAGE_H = 11906;
export const BUILTIN_MARGIN = 850;

export const BUILTIN_GEOM: PageGeom = {
  portraitWidth: BUILTIN_PAGE_H - 2 * BUILTIN_MARGIN,
  landscapeWidth: BUILTIN_PAGE_W - 2 * BUILTIN_MARGIN,
  startsLandscape: true,
};

const SETTINGS_XML =
  `${XML_DECL}<w:settings xmlns:w="${W_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>` +
  `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
  `<w:themeFontLang w:val="en-US"/><w:decimalSymbol w:val="."/><w:listSeparator w:val=","/></w:settings>`;

/** A complex field (not w:fldSimple) so Word shows the right number straight away and updates it on print. */
function field(code: string, placeholder: string): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${placeholder}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

/** "Page X of Y" paragraph. */
export function pageNumberPara(style: string): string {
  return para(textRuns("Page ") + field("PAGE", "1") + textRuns(" of ") + field("NUMPAGES", "1"), { style, jc: "center", spacing: { before: 160, after: 60 } });
}

function bannerLine(text: string, style: string): string {
  const side = (n: string) => `<w:${n} w:val="single" w:sz="8" w:space="2" w:color="${BANNER_COLOR}"/>`;
  return para(textRuns(text, { b: true, color: BANNER_COLOR, sz: 18 }), {
    style,
    pBdr: `<w:pBdr>${side("top")}${side("left")}${side("bottom")}${side("right")}</w:pBdr>`,
    spacing: { before: 0, after: 60 },
    jc: "center",
  });
}

export interface BuiltinParts {
  dp: DocPackage;
  ctx: WriterCtx;
  sectPr: string;
  /** numbering.xml before the writer added anything (the builtin one already holds the bullets). */
  numbering: string;
}

/** The complete built-in package, generated in code: styles, numbering, settings, header, footer and an A4 landscape section. */
export function createBuiltin(doc: DocModel): BuiltinParts {
  const dp = DocPackage.fresh();
  const stylesXml = builtinStylesXml();
  const bullets = withBulletList(undefined);
  dp.setPart("word/styles.xml", stylesXml, CT.styles, REL.styles);
  dp.setPart("word/numbering.xml", bullets.xml, CT.numbering, REL.numbering);
  dp.setPart("word/settings.xml", SETTINGS_XML, CT.settings, REL.settings);

  const hdrStyle = BUILTIN_STYLE_ID.header;
  const ftrStyle = BUILTIN_STYLE_ID.footer;
  dp.setPart(
    "word/header1.xml",
    `${XML_DECL}<w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${bannerLine(doc.banner, hdrStyle)}${para(textRuns(doc.title, { color: "595959", sz: 16 }), { style: hdrStyle, spacing: { before: 0, after: 240 } })}</w:hdr>`,
    CT.header,
    REL.header,
  );
  dp.setPart("word/footer1.xml", `${XML_DECL}<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${pageNumberPara(ftrStyle)}${bannerLine(doc.banner, ftrStyle)}</w:ftr>`, CT.footer, REL.footer);

  const headerId = dp.mainRels.find((r) => r.type === REL.header)!.id;
  const footerId = dp.mainRels.find((r) => r.type === REL.footer)!.id;
  const sectPr =
    `<w:sectPr><w:headerReference w:type="default" r:id="${headerId}"/><w:footerReference w:type="default" r:id="${footerId}"/>` +
    `<w:pgSz w:w="${BUILTIN_PAGE_W}" w:h="${BUILTIN_PAGE_H}" w:orient="landscape"/>` +
    `<w:pgMar w:top="${BUILTIN_MARGIN}" w:right="${BUILTIN_MARGIN}" w:bottom="${BUILTIN_MARGIN}" w:left="${BUILTIN_MARGIN}" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>`;

  const ctx = new WriterCtx({ doc, styles: StyleTable.parse(stylesXml), page: BUILTIN_GEOM, numberingXml: bullets.xml, bulletNumId: bullets.numId });
  return { dp, ctx, sectPr, numbering: bullets.xml };
}

/** Opening of word/document.xml for generated documents. */
export function documentOpen(): string {
  return `${XML_DECL}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`;
}

export const DOCUMENT_CLOSE = "</w:body></w:document>";
