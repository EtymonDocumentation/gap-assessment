import { NOTICE_DOCUMENT, TRD_PARTS, TRD_PART_LABEL, type DocModel, type TrdFormSpec } from "@gap/engine";
import { createBuiltin, documentOpen, DOCUMENT_CLOSE } from "./builtin";
import { finalisePackage } from "./finalise";
import { esc } from "./xml";
import { bannerPara, headingPara, notePara, para, textRuns } from "./writer";
import { BUILTIN_TEMPLATE_VERSION } from "./version";

/**
 * The TRD fill-in form (Word). Every cell a person may fill is a Word content control (a "plain text" control) whose tag is the field
 * id, for example trd.step.<unit operation>.param.<parameter>.nor_low. Cascade reads the tags back on upload, so the form can be filled
 * offline, by a colleague with no account, and in any order.
 *
 * An empty control shows "Not established": the form never carries a blank that could be mistaken for a value, and a control left
 * empty is an open item after the upload, never a value.
 */

export const FORM_PLACEHOLDER = "Not established";
// Dark enough on white for the WCAG AA contrast ratio.
const PLACEHOLDER_COLOR = "595959";

let sdtId = 1000;

function control(tag: string, alias: string, value: string, multiline = false): string {
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

function cell(w: number, inner: string, o: { head?: boolean; fill?: string } = {}): string {
  const fill = o.head ? "1F3864" : o.fill;
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>${inner}</w:tc>`;
}

function formTable(styleId: string, widths: number[], head: string[], rows: string[][]): string {
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

const label = (t: string) => para(textRuns(t, { b: true }));

/** The words at the top of the form, the same in the app, in the web form page and here. */
export const FORM_INTRO = [
  "Fill in what you know. Leave a cell alone when you do not know the value: it stays \"Not established\" and becomes an open item.",
  "Write numbers with a decimal point and keep the unit you work in. Use the Unit column when one unit fits the whole row, or write the unit after the number.",
  "Then upload this file back on the TRD page of Cascade (Upload a TRD). Nothing is decided for you: you check every value on a review screen first.",
];

/** The form as a Word file. Pre-filled controls hold the TRD's own values; everything else is "Not established". */
export function buildTrdFormDocx(spec: TrdFormSpec, o: { generatedAt: string; title?: string }): Uint8Array {
  const title = o.title ?? (spec.source === "blank" ? "Blank TRD form" : `TRD form with what we know so far${spec.trdId ? ` (${spec.trdId})` : ""}`);
  const doc: DocModel = {
    title,
    banner: NOTICE_DOCUMENT,
    status: "Form",
    meta: [],
    cover: { program: "", product: "", sourceSite: "", targetSite: "", sourceStage: "", targetStage: "", stageShort: "" },
    sections: [],
    tbdCount: 0,
  };
  const { dp, ctx, sectPr, numbering } = createBuiltin(doc);
  const grid = ctx.style("tableGrid");
  const total = ctx.tableWidth(true);
  const two = [Math.round(total * 0.3), total - Math.round(total * 0.3)];
  const out: string[] = [bannerPara(doc.banner), headingPara(ctx, 1, title, { noNumber: true })];
  for (const t of FORM_INTRO) out.push(para(textRuns(t)));
  out.push(notePara("Do not delete or rename the grey-boxed cells: Cascade finds your entries by them. You may add text elsewhere; it is not read."));

  out.push(headingPara(ctx, 2, "Document", { noNumber: true }));
  out.push(formTable(grid, two, ["Field", "Entry"], spec.document.map((c) => [label(c.label), control(c.id, c.label, c.value, c.multiline)])));
  out.push(headingPara(ctx, 2, "Product and site", { noNumber: true }));
  out.push(formTable(grid, two, ["Field", "Entry"], spec.details.map((c) => [label(c.label), control(c.id, c.label, c.value)])));

  const widths = (() => {
    const first = Math.round(total * 0.25);
    const rest = Math.floor((total - first) / 6);
    return [first, ...Array.from({ length: 5 }, () => rest), total - first - rest * 5];
  })();
  const head = ["Parameter", ...TRD_PARTS.map((p) => TRD_PART_LABEL[p])];
  for (const s of spec.steps) {
    out.push(headingPara(ctx, 2, s.label, { noNumber: true }));
    out.push(
      formTable(
        grid,
        widths,
        head,
        s.params.map((p) => [label(p.label), ...TRD_PARTS.map((part) => control(`trd.step.${s.ref}.param.${p.key}.${part}`, `${s.label}, ${p.label}, ${TRD_PART_LABEL[part]}`, p.values[part] ?? ""))]),
      ),
    );
  }
  out.push(bannerPara(doc.banner));
  dp.setMainXml(documentOpen() + out.join("") + sectPr + DOCUMENT_CLOSE);
  finalisePackage(
    dp,
    ctx,
    { doc, mode: "builtin", templateName: "Built-in default", templateVersion: BUILTIN_TEMPLATE_VERSION, generatedAt: o.generatedAt, dataPart: { kind: "trd-form", json: JSON.stringify(spec) } },
    numbering,
  );
  return dp.commit();
}
