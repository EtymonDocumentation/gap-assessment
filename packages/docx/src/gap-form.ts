import { compactGapFormSpec, gapFieldId, GAP_SIDE_LABEL, GAP_TITLE_ID, NOTICE_DOCUMENT, type DocModel, type GapFormSpec } from "@gap/engine";
import { createBuiltin, documentOpen, DOCUMENT_CLOSE } from "./builtin";
import { finalisePackage } from "./finalise";
import { control, formTable, label } from "./form-parts";
import { bannerPara, headingPara, notePara, para, textRuns } from "./writer";
import { BUILTIN_TEMPLATE_VERSION } from "./version";

/**
 * The gap assessment fill-in form (Word): one table per section, one row per question, a column for the sending unit (SU) and one for
 * the receiving unit (RU). Every answer cell is a content control tagged gap.q.<question>.<side>; Cascade reads the tags back on upload.
 * An empty control shows "Not established" and becomes an open item. A question asked of both units together has one box, under SU.
 */

export const GAP_FORM_INTRO = [
  "Answer each question for the sending unit (SU) and the receiving unit (RU). Leave a box alone when you do not know the answer: it stays \"Not established\" and becomes an open item. Nothing is filled in for you.",
  "Write a choice exactly as it is listed under the question. Write numbers with a unit and a decimal point, for example \"10 mL\". Write TBD when the answer is not decided yet, \"Not applicable: <reason>\" when it does not apply (a reason is needed), and \"Same as SU\" in an RU box when the receiving unit does the same.",
  "Then upload this file back on the Gap assessment page of Cascade (Upload a document you have). You check every answer on a review screen first.",
];

export function buildGapFormDocx(spec: GapFormSpec, o: { generatedAt: string; title?: string }): Uint8Array {
  const title = o.title ?? (spec.source === "blank" ? "Blank gap assessment form" : `Gap assessment form with what we know so far${spec.title ? ` (${spec.title})` : ""}`);
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
  for (const t of GAP_FORM_INTRO) out.push(para(textRuns(t)));
  out.push(notePara("Do not delete or rename the grey-boxed cells: Cascade finds your answers by them. Text elsewhere is not read."));
  out.push(headingPara(ctx, 2, "Project", { noNumber: true }));
  const two = [Math.round(total * 0.3), total - Math.round(total * 0.3)];
  out.push(formTable(grid, two, ["Field", "Entry"], [[label("Project title"), control(GAP_TITLE_ID, "Project title", spec.title)]]));

  const q = Math.round(total * 0.4);
  const a = Math.floor((total - q) / 2);
  const widths = [q, a, total - q - a];
  for (const s of spec.sections) {
    out.push(headingPara(ctx, 2, s.title, { noNumber: true }));
    out.push(
      formTable(
        grid,
        widths,
        ["Question", GAP_SIDE_LABEL.source, GAP_SIDE_LABEL.target],
        s.questions.map((qu) => {
          const name = qu.label ?? qu.id;
          const box = (side: "source" | "target" | "shared", col: "source" | "target") => {
            if (qu.sides.includes(side)) return control(gapFieldId(qu.id, side), `${name}, ${GAP_SIDE_LABEL[side]}`, qu.values[side] ?? "", true);
            return para(textRuns(qu.sides.includes("shared") && col === "target" ? "(one answer for both units, in the SU box)" : "(not asked of this unit)", { i: true, color: "595959" }));
          };
          return [para(textRuns(name, { b: true })) + (qu.hint ? para(textRuns(qu.hint, { i: true, color: "595959" })) : ""), box(qu.sides.includes("shared") ? "shared" : "source", "source"), box("target", "target")];
        }),
      ),
    );
  }
  out.push(bannerPara(doc.banner));
  dp.setMainXml(documentOpen() + out.join("") + sectPr + DOCUMENT_CLOSE);
  finalisePackage(
    dp,
    ctx,
    { doc, mode: "builtin", templateName: "Built-in default", templateVersion: BUILTIN_TEMPLATE_VERSION, generatedAt: o.generatedAt, dataPart: { kind: "gap-form", json: JSON.stringify(compactGapFormSpec(spec)) } },
    numbering,
  );
  return dp.commit();
}
