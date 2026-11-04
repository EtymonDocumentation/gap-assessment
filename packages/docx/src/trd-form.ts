import { NOTICE_DOCUMENT, TRD_PARTS, TRD_PART_LABEL, type DocModel, type TrdFormSpec } from "@gap/engine";
import { createBuiltin, documentOpen, DOCUMENT_CLOSE } from "./builtin";
import { finalisePackage } from "./finalise";
import { control, formTable, label } from "./form-parts";
export { FORM_PLACEHOLDER } from "./form-parts";
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
