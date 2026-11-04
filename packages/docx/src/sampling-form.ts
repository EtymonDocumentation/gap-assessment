import { NOTICE_DOCUMENT, SAMPLING_COLUMNS, SAMPLING_COLUMN_LABEL, SAMPLING_TITLE_ID, type DocModel, type SamplingFormSpec } from "@gap/engine";
import { SAMPLING_TYPES } from "@gap/process-model";
import { TYPE_LABEL } from "@gap/sampling";
import { createBuiltin, documentOpen, DOCUMENT_CLOSE } from "./builtin";
import { finalisePackage } from "./finalise";
import { control, formTable, label } from "./form-parts";
import { bannerPara, headingPara, notePara, para, textRuns } from "./writer";
import { BUILTIN_TEMPLATE_VERSION } from "./version";

/**
 * The sampling plan fill-in form (Word): one points table, one row per sampling point. Every cell a person fills is a content control
 * tagged sampling.row.<n>.<column>; Cascade reads the tags back on upload. An empty control shows "Not established" and becomes an
 * open item; a row with nothing written in it is not a point at all.
 */

export const SAMPLING_FORM_INTRO = [
  "Write one row for each sample you take: the process step, what is measured (the attribute), the test or method, the amount per sample with its unit, the timing and the study type. Leave a cell alone when you do not know it: it stays \"Not established\" and becomes an open item.",
  "Write the amount with its unit, for example \"10 mL\", and use a decimal point. Use the process step names and study types listed below when you can; anything else is shown to you on the review screen first.",
  "Then upload this file back on the Sampling plan page of Cascade (Upload a sampling plan). Nothing is decided for you: you check every value on a review screen first.",
];

export function buildSamplingFormDocx(spec: SamplingFormSpec, o: { generatedAt: string; title?: string }): Uint8Array {
  const title = o.title ?? (spec.source === "blank" ? "Blank sampling plan form" : `Sampling plan form with what we know so far${spec.planId ? ` (${spec.planId})` : ""}`);
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
  const out: string[] = [bannerPara(doc.banner), headingPara(ctx, 1, title, { noNumber: true })];
  for (const t of SAMPLING_FORM_INTRO) out.push(para(textRuns(t)));
  out.push(notePara("Do not delete or rename the grey-boxed cells: Cascade finds your entries by them. You may add rows by copying a row; text elsewhere is not read."));

  out.push(headingPara(ctx, 2, "Plan", { noNumber: true }));
  const two = [Math.round(total * 0.3), total - Math.round(total * 0.3)];
  out.push(formTable(grid, two, ["Field", "Entry"], [[label("Plan title"), control(SAMPLING_TITLE_ID, "Plan title", spec.title)]]));

  if (spec.steps.length) {
    out.push(headingPara(ctx, 2, "Process steps you can use", { noNumber: true }));
    out.push(para(textRuns(spec.steps.join("; "))));
  }
  out.push(headingPara(ctx, 2, "Study types you can use", { noNumber: true }));
  out.push(para(textRuns(SAMPLING_TYPES.map((k) => TYPE_LABEL[k]).join("; "))));

  out.push(headingPara(ctx, 2, "Sampling points", { noNumber: true }));
  const no = Math.round(total * 0.07);
  const rest = Math.floor((total - no) / SAMPLING_COLUMNS.length);
  const widths = [no, ...SAMPLING_COLUMNS.map((_c, i) => (i === SAMPLING_COLUMNS.length - 1 ? total - no - rest * (SAMPLING_COLUMNS.length - 1) : rest))];
  out.push(
    formTable(
      grid,
      widths,
      ["No.", ...SAMPLING_COLUMNS.map((c) => SAMPLING_COLUMN_LABEL[c])],
      spec.rows.map((r) => [
        label(r.pointId ? `${r.n} (${r.pointId})` : String(r.n)),
        ...SAMPLING_COLUMNS.map((c) => control(`sampling.row.${r.n}.${c}`, `Row ${r.n}, ${SAMPLING_COLUMN_LABEL[c]}`, r.values[c] ?? "")),
      ]),
    ),
  );
  out.push(bannerPara(doc.banner));
  dp.setMainXml(documentOpen() + out.join("") + sectPr + DOCUMENT_CLOSE);
  finalisePackage(
    dp,
    ctx,
    { doc, mode: "builtin", templateName: "Built-in default", templateVersion: BUILTIN_TEMPLATE_VERSION, generatedAt: o.generatedAt, dataPart: { kind: "sampling-form", json: JSON.stringify(spec) } },
    numbering,
  );
  return dp.commit();
}
