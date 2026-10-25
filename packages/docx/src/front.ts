import type { DocModel } from "@gap/engine";
import { field } from "./builtin";
import { ACCENT, BANNER_COLOR, BANNER_FILL, BORDER_COLOR, LABEL_FILL } from "./palette";
import { WriterCtx, headingPara, para, tableXml, textRuns } from "./writer";
import { esc } from "./xml";

/** The front pages of the upgraded built-in look: cover page, table of contents, document control. */

const NOT_RECORDED = "[not recorded]";
export const DOCUMENT_ID_PLACEHOLDER = "[to be assigned]";
export const NO_SIGNATURE_TEXT =
  "This tool does not capture approvals or electronic signatures. The names, roles and dates above are placeholders to be completed outside the tool.";
export const NAMED_SIGNATURE_TEXT =
  "This tool does not capture approvals or electronic signatures. The names and roles above were entered by the team; signatures and any missing dates are completed outside the tool.";
export const TOC_PLACEHOLDER = "Table of contents. Word fills this in when the document is opened; if it stays empty, right-click here and choose Update Field.";
export const TOC_INSTRUCTION = 'TOC \\o "1-3" \\h \\z \\u';

/** Labels of the cover facts that name the two sites (data keys stay source and target; only the wording is SU and RU). */
export const COVER_LABELS = {
  suSite: "Sending unit (SU) site",
  suStage: "Sending unit (SU) program stage",
  ruSite: "Receiving unit (RU) site",
  ruStage: "Receiving unit (RU) program stage",
} as const;

function metaValue(doc: DocModel, label: string): string {
  return doc.meta.find(([k]) => k === label)?.[1] ?? "";
}

/** `count` equal column widths that add up to `total`. */
function equalWidths(total: number, count: number): number[] {
  const w = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - w * (count - 1) : w));
}

/** A two-column label / value table across the whole text width: shaded label cells, no header row, no zebra. */
function factsTable(ctx: WriterCtx, rows: [string, string][], o: { sz: number; labelWidth: number; pad: number }): string {
  const total = ctx.tableWidth(true);
  const widths = [o.labelWidth, total - o.labelWidth];
  const text = ctx.style("tableText");
  const border = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="${BORDER_COLOR}"/>`;
  const trs = rows.map(
    ([k, v]) =>
      `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
      `<w:tc><w:tcPr><w:tcW w:w="${widths[0]}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${LABEL_FILL}"/></w:tcPr>${para(textRuns(k, { b: true, sz: o.sz }), { style: text })}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="${widths[1]}" w:type="dxa"/></w:tcPr>${para(textRuns(v, { sz: o.sz }), { style: text })}</w:tc></w:tr>`,
  );
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="${esc(ctx.style("tableGrid"))}"/><w:tblW w:w="${total}" w:type="dxa"/>` +
    `<w:tblBorders>${border("top")}${border("left")}${border("bottom")}${border("right")}${border("insideH")}${border("insideV")}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${o.pad}" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="${o.pad}" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>` +
    `<w:tblLook w:val="0480" w:firstRow="0" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${trs.join("")}</w:tbl>` +
    para("", { spacing: { before: 0, after: 80 } })
  );
}

/** Cover page: the permanent banner in a box, the title, and the facts of the transfer. */
export function coverXml(ctx: WriterCtx): string {
  const d = ctx.doc;
  const side = (n: string) => `<w:${n} w:val="single" w:sz="18" w:space="8" w:color="${BANNER_COLOR}"/>`;
  const banner = para(textRuns(d.banner, { b: true, color: BANNER_COLOR, sz: 28 }), {
    keepLines: true,
    pBdr: `<w:pBdr>${side("top")}${side("left")}${side("bottom")}${side("right")}</w:pBdr>`,
    shd: BANNER_FILL,
    // The box border sits 8 pt outside the text; the indents bring it level with the facts table below.
    ind: { left: 160, right: 160 },
    spacing: { before: 900, after: 900 },
    jc: "center",
  });
  const title = para(textRuns(d.title, { sz: 60 }), {
    style: ctx.style("title"),
    keepNext: true,
    pBdr: `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${ACCENT}"/></w:pBdr>`,
    spacing: { before: 0, after: 420 },
  });
  const c = d.cover;
  // A one-sided document (the TRD outline describes the RU only) leaves the SU cover fields empty, and those rows are
  // dropped rather than printed blank. The gap assessment always fills them (at worst "[site not established]").
  const su: [string, string][] = c.sourceSite || c.sourceStage ? [[COVER_LABELS.suSite, c.sourceSite], [COVER_LABELS.suStage, c.sourceStage]] : [];
  const facts: [string, string][] = [
    ["Program", c.program],
    ["Product", c.product],
    // The cover spells the two terms out once; the tables in the rest of the document use the short forms SU and RU.
    ...su,
    [COVER_LABELS.ruSite, c.targetSite],
    [COVER_LABELS.ruStage, c.targetStage],
    ["Status", d.status],
    ["Generated", metaValue(d, "Generated") || NOT_RECORDED],
  ];
  return banner + title + factsTable(ctx, facts, { sz: 22, labelWidth: 4900, pad: 80 });
}

/** The table of contents: a real TOC field (headings 1 to 3) with a short placeholder; settings.xml asks Word to update it on open. */
export function tocXml(): string {
  return para(textRuns("Contents"), { style: "TOCHeading", pageBreakBefore: true }) + para(field(TOC_INSTRUCTION, esc(TOC_PLACEHOLDER)));
}

/** Document control: identifiers, a table of placeholders for author, reviewer and approver (no signatures), and the remaining facts. */
export function documentControlXml(ctx: WriterCtx): string {
  const d = ctx.doc;
  const known = d.control;
  const control: [string, string][] = [
    ["Document ID", known?.documentId?.trim() || DOCUMENT_ID_PLACEHOLDER],
    ...(known?.version?.trim() ? ([["Version", known.version.trim()]] as [string, string][]) : []),
    ["Status", d.status],
  ];
  // A document that holds its own named roles prints them (a role written "Author (MSAT, receiving unit)" splits into the
  // responsibility and the role); a missing name stays a placeholder and a missing date is an empty cell to write in. Without any, the three placeholder rows remain.
  const people = known?.people.length
    ? known.people.map((p) => {
        const m = /^(.*?)\s*\((.*)\)\s*$/.exec(p.role.trim());
        return [m ? m[1]! : p.role.trim(), p.name?.trim() || "[name]", m ? m[2]! : "Not given", p.date?.trim() || ""];
      })
    : ["Author", "Reviewer", "Approver"].map((r) => [r, "[name]", "[role]", "[date]"]);
  const signatureNote = known?.people.length ? NAMED_SIGNATURE_TEXT : NO_SIGNATURE_TEXT;
  // The cover already shows these two lines; the rest of the document details keep their own table here, so no fact is lost.
  const rest = d.meta.filter(([k]) => k !== "Generated" && !(known && (k === "Document reference" || k === "Version")));
  return (
    headingPara(ctx, 1, "Document control", { noNumber: true, pageBreakBefore: true }) +
    factsTable(ctx, control, { sz: 20, labelWidth: 3800, pad: 60 }) +
    tableXml(ctx, ["Responsibility", "Name", "Role", "Date"], people, { widths: equalWidths(ctx.tableWidth(true), 4) }) +
    para(textRuns(signatureNote), { spacing: { before: 60, after: 160 } }) +
    (rest.length ? headingPara(ctx, 2, "Document summary", { noNumber: true }) + tableXml(ctx, ["Item", "Value"], rest.map(([k, v]) => [k, v]), { firstColumnBold: true }) : "")
  );
}

/** Everything that comes before section 1. */
export function builtinFrontXml(ctx: WriterCtx): string {
  return coverXml(ctx) + tocXml() + documentControlXml(ctx);
}
