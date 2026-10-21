import { OPTIONAL_SECTIONS, type DocModel } from "@gap/engine";
import { DOCUMENT_CLOSE, createBuiltin, documentOpen } from "./builtin";
import { finalisePackage } from "./finalise";
import { BUILTIN_TEMPLATE_VERSION } from "./version";
import { TAG_REFERENCE } from "./tags";
import { WriterCtx, bannerPara, headingPara, notePara, para, tableXml, textRuns } from "./writer";

/** A table with a heading row and one repeating row: `{#loop}` in the first cell and `{/loop}` in the last. */
function loopTable(ctx: WriterCtx, loop: string, columns: string[], fields: string[]): string {
  const cells = fields.map((f, i) => `${i === 0 ? `{#${loop}}` : ""}{${f}}${i === fields.length - 1 ? `{/${loop}}` : ""}`);
  return tableXml(ctx, columns, [cells]);
}

function fieldsOf(loop: string): string[] {
  return (TAG_REFERENCE.find((t) => t.tag === loop)?.fields ?? []).map((f) => f.name);
}

const COLUMNS: Record<string, string[]> = {
  gaps: ["ID", "Section", "Attribute", "SU", "RU", "Category", "Detail", "Why it matters", "Activities implied", "Severity", "Regulatory", "Owner", "Status", "Rule", "SU verification", "RU verification"],
  activities: ["Activity", "Description", "Implied by gaps", "Severity", "Regulatory", "SU studies", "RU studies", "Readiness"],
  equipment: ["Unit operation", "Equipment", "SU qualification", "RU qualification", "Qualified range (RU)", "Required by RU process", "Related gaps"],
  risks: ["Rank", "ID", "Attribute", "Category", "Severity", "Regulatory"],
  sources: ["ID", "Type", "Identifier, title, version", "Responder", "Date", "State", "Cited by"],
  approvals: ["Role", "Name", "Signature", "Date"],
};

/** An empty document model: the starter template only needs the shell of the built-in look. */
const SHELL: DocModel = { title: "{title}", banner: "{banner}", status: "{status}", meta: [],
  cover: { program: "{program}", product: "", sourceSite: "{sourceSite}", targetSite: "{targetSite}", sourceStage: "", targetStage: "" },
  sections: [], tbdCount: 0 };

/** The appendices of a document, in order, with their letters. Without a document, those of a document that leaves nothing out. */
function appendicesOf(doc?: Pick<DocModel, "sections">): { id: string; number: string; title: string }[] {
  if (doc) return doc.sections.filter((s) => s.appendix).map((s) => ({ id: s.id, number: s.number, title: s.title }));
  return OPTIONAL_SECTIONS.filter((s) => s.appendix).map((s, i) => ({ id: s.id, number: String.fromCharCode(65 + i), title: s.title }));
}

/** Appendices that have a loop tag in the starter template: the appendix id, the loop, and the table columns. */
const APPENDIX_LOOPS: Record<string, string> = { "source-register": "sources" };

/**
 * A valid .docx in the built-in look that uses every main tag, to start a placeholder-tag template from.
 * Fill it in with the "Placeholder tags" option; edit it in Word to change the look.
 * The appendix letters come from the document model (`doc`, after any omitted sections); without one, from a document that leaves nothing out.
 */
export function buildStarterTemplate(doc?: Pick<DocModel, "sections">): Uint8Array {
  const { dp, ctx, sectPr, numbering } = createBuiltin(SHELL);
  const h = (text: string) => headingPara(ctx, 1, text);
  const list = (text: string) => para(textRuns(text), { style: ctx.style("listParagraph"), numPr: { ilvl: 0, numId: ctx.bulletNumId() } });
  const loopPara = (tag: string) => para(textRuns(tag));
  const loop = (name: string, itemText: string) => loopPara(`{#${name}}`) + list(itemText) + loopPara(`{/${name}}`);
  const appendices = appendicesOf(doc);
  const pair = (rows: [string, string][]) => tableXml(ctx, ["Item", "Value"], rows, { headerRow: false, firstColumnBold: true });

  const body =
    bannerPara("{banner}") +
    para(textRuns("{title}"), { style: ctx.style("title") }) +
    para(textRuns("{status}", { b: true }), { spacing: { after: 160 } }) +
    h("Document details") +
    tableXml(ctx, ["Item", "Value"], [["{#meta}{label}", "{value}{/meta}"]], { headerRow: false, firstColumnBold: true }) +
    pair([
      ["Program", "{program}"],
      ["Modality", "{modality}"],
      ["Dosage form", "{dosageForm}"],
      ["Presentation", "{presentation}"],
      ["Type of transfer", "{transferType}"],
      ["Markets", "{markets}"],
      ["Sending unit (SU) site", "{sourceSite}"],
      ["Receiving unit (RU) site", "{targetSite}"],
      ["Generated", "{generated}"],
      ["Differences identified", "{differencesCount}"],
      ["Open information items", "{openItemsCount}"],
      ["Entries verified", "{verifiedSummary}"],
    ]) +
    h("Contents") +
    loop("sections", "{number}. {title}") +
    h("Detailed gap table") +
    loopTable(ctx, "gaps", COLUMNS.gaps!, fieldsOf("gaps")) +
    notePara("{regulatoryStatement}") +
    h("Validation plan") +
    loopTable(ctx, "activities", COLUMNS.activities!, fieldsOf("activities")) +
    h("Equipment qualification comparison") +
    loopTable(ctx, "equipment", COLUMNS.equipment!, fieldsOf("equipment")) +
    h("Open information items") +
    loop("openItems", "{no}. {section} ({side}): {question} [{status}]") +
    h("Risk ranking") +
    loopTable(ctx, "risks", COLUMNS.risks!, fieldsOf("risks")) +
    h("Verification status") +
    para(textRuns("{verificationStatement}")) +
    notePara("{identityStatement}") +
    h("Approval") +
    loopTable(ctx, "approvals", COLUMNS.approvals!, fieldsOf("approvals")) +
    appendices
      .filter((a) => APPENDIX_LOOPS[a.id])
      .map((a) => {
        const lp = APPENDIX_LOOPS[a.id]!;
        return h(`Appendix ${a.number}. ${a.title}`) + loopTable(ctx, lp, COLUMNS[lp]!, fieldsOf(lp));
      })
      .join("") +
    bannerPara("{banner}");

  dp.setMainXml(documentOpen() + body + sectPr + DOCUMENT_CLOSE);
  finalisePackage(
    dp,
    ctx,
    { doc: SHELL, mode: "tags", templateName: "Starter tag template", templateVersion: BUILTIN_TEMPLATE_VERSION, generatedAt: "2000-01-01T00:00:00Z" },
    numbering,
  );
  return dp.commit();
}
