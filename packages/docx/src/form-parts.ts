import { esc } from "./xml";
import { para, textRuns } from "./writer";

/**
 * The building blocks of every fill-in form (the TRD form and the sampling plan form): a plain-text content control tagged with the
 * field id, a table cell, and a bordered table. Shared so a second form does not copy the Word XML.
 */

export const FORM_PLACEHOLDER = "Not established";
// Dark enough on white for the WCAG AA contrast ratio.
const PLACEHOLDER_COLOR = "595959";

let sdtId = 1000;

export function control(tag: string, alias: string, value: string, multiline = false): string {
  const filled = value.trim() !== "";
  const rpr = filled ? "" : `<w:rPr><w:i/><w:color w:val="${PLACEHOLDER_COLOR}"/></w:rPr>`;
  const lines = filled ? value.split(/\r\n|\r|\n/) : [FORM_PLACEHOLDER];
  const runs = lines.map((l, i) => (i > 0 ? `<w:r>${rpr}<w:br/></w:r>` : "") + (l ? `<w:r>${rpr}<w:t xml:space="preserve">${esc(l)}</w:t></w:r>` : "")).join("");
  // A run-level control inside its own paragraph: a table cell has to end with a paragraph, and the control keeps its tag if Word edits it.
  return (
    `<w:p><w:sdt><w:sdtPr><w:alias w:val="${esc(alias)}"/><w:tag w:val="${esc(tag)}"/><w:id w:val="${sdtId++}"/>` +
    `${filled ? "" : "<w:showingPlcHdr/>"}<w:text${multiline ? ' w:multiLine="1"' : ""}/></w:sdtPr><w:sdtContent>${runs}</w:sdtContent></w:sdt></w:p>`
  );
}

export function cell(w: number, inner: string, o: { head?: boolean; fill?: string } = {}): string {
  const fill = o.head ? "1F3864" : o.fill;
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>${inner}</w:tc>`;
}

export function formTable(styleId: string, widths: number[], head: string[], rows: string[][]): string {
  const total = widths.reduce((a, b) => a + b, 0);
  const b = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const headRow = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${head.map((h, i) => cell(widths[i]!, para(textRuns(h, { b: true, color: "FFFFFF" })), { head: true })).join("")}</w:tr>`;
  const body = rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(widths[i]!, c)).join("")}</w:tr>`).join("");
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="${esc(styleId)}"/><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${b("top")}${b("left")}${b("bottom")}${b("right")}${b("insideH")}${b("insideV")}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>` +
    `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${headRow}${body}</w:tbl>` +
    para("", { spacing: { before: 0, after: 120 } })
  );
}

export const label = (t: string) => para(textRuns(t, { b: true }));
