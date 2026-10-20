import type { DocModel } from "@gap/engine";
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
  gaps: ["ID", "Section", "Attribute", "Source", "Target", "Category", "Detail", "Why it matters", "Activities implied", "Severity", "Regulatory", "Owner", "Status", "Rule", "Source verification", "Target verification"],
  activities: ["Activity", "Description", "Implied by gaps", "Severity", "Regulatory", "Source studies", "Target studies", "Readiness"],
  equipment: ["Unit operation", "Equipment", "Source qualification", "Target qualification", "Qualified range (target)", "Required by target process", "Related gaps"],
  risks: ["Rank", "ID", "Attribute", "Category", "Severity", "Regulatory"],
  sources: ["ID", "Type", "Identifier, title, version", "Responder", "Date", "State", "Cited by"],
  approvals: ["Role", "Name", "Signature", "Date"],
  revisions: ["Revision", "Status", "Date", "By", "Summary of change", "Template"],
  comments: ["ID", "Location", "Comment", "By", "Date", "Status", "Responses"],
};

/** An empty document model: the starter template only needs the shell of the built-in look. */
const SHELL: DocModel = { title: "{title}", banner: "{banner}", status: "{status}", meta: [], sections: [], revisions: [], comments: [] };

/**
 * A valid .docx in the built-in look that uses every main tag, to start a placeholder-tag template from.
 * Fill it in with the "Placeholder tags" option; edit it in Word to change the look.
 */
export function buildStarterTemplate(): Uint8Array {
  const { dp, ctx, sectPr, numbering } = createBuiltin(SHELL);
  const h = (text: string) => headingPara(ctx, 1, text);
  const list = (text: string) => para(textRuns(text), { style: ctx.style("listParagraph"), numPr: { ilvl: 0, numId: ctx.bulletNumId() } });
  const loopPara = (tag: string) => para(textRuns(tag));
  const loop = (name: string, itemText: string) => loopPara(`{#${name}}`) + list(itemText) + loopPara(`{/${name}}`);
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
      ["Source site", "{sourceSite}"],
      ["Target site", "{targetSite}"],
      ["Generated", "{generated}"],
      ["Revision", "{revision}"],
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
    h("Appendix A. Source register") +
    loopTable(ctx, "sources", COLUMNS.sources!, fieldsOf("sources")) +
    h("Appendix C. Revision history") +
    loopTable(ctx, "revisions", COLUMNS.revisions!, fieldsOf("revisions")) +
    h("Appendix D. Reviewer comments") +
    loopTable(ctx, "comments", COLUMNS.comments!, fieldsOf("comments")) +
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
