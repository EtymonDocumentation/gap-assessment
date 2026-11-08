import PizZip from "pizzip";
import {
  applyGapImport,
  assess,
  buildBlankGapFormSpec,
  buildDemoProject,
  buildDocument,
  buildGapData,
  buildGapFormSpec,
  gapCounts,
  gapSessionFromData,
  gapSessionFromForm,
  gapSessionFromOther,
  isProjectStageQuestion,
  optionsFor,
  parseGapAnswer,
  projectAnswerOf,
  projectStage,
  PROJECT_STAGE_UPLOAD_NOTE,
  visibleInstances,
  SCANNED_PDF_MESSAGE,
  type GapDecisions,
  type GapImportSession,
} from "@gap/engine";
import { emptyProject } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos, gapImportSynonyms as syn } from "../../../content/index";
import { buildGapFormDocx, readPdfUpload, readUpload, renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { foreignDocx, pictureOnlyPdf } from "./i2-foreign";
import { foreignGapBodyXml, foreignGapPdf, FOREIGN_GAP_TITLE, type ForeignGapQuestions } from "./i4-foreign";
import { strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

// Gap assessment upload (job I4), all three levels. Every file is fictional and built here.
const actor = { name: "Test reviewer", at: GENERATED_AT };
const project = buildDemoProject(content, demos["arx-217"]);
const a = assess(content, project);
const doc = buildDocument(content, project, a, GENERATED_AT);
const newProject = () => emptyProject({ title: "T", actor, contentRefs: content.versions });

async function exportGap(): Promise<Uint8Array> {
  return (await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT, dataPart: { kind: "gap-data", json: buildGapData(content, project, doc) } })).bytes;
}
function editDocument(bytes: Uint8Array, edit: (xml: string) => string): Uint8Array {
  const zip = new PizZip(bytes);
  zip.file("word/document.xml", edit(zip.file("word/document.xml")!.asText()));
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
function fill(xml: string, tag: string, text: string): string {
  const at = xml.indexOf(`<w:tag w:val="${tag}"/>`);
  if (at < 0) throw new Error(`no control ${tag}`);
  const open = xml.lastIndexOf("<w:sdt>", at);
  const end = xml.indexOf("</w:sdt>", at) + "</w:sdt>".length;
  const block = xml.slice(open, end).replace("<w:showingPlcHdr/>", "").replace(/<w:sdtContent>[\s\S]*<\/w:sdtContent>/, `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent>`);
  return xml.slice(0, open) + block + xml.slice(end);
}
const fieldOf = (s: GapImportSession, id: string) => s.fields.find((f) => f.id === id);
const acceptAll = (s: GapImportSession): GapDecisions => Object.fromEntries(s.fields.filter((f) => f.value && !f.unreadable && !f.change).map((f) => [f.id, { value: f.value }]));

function questions(): ForeignGapQuestions {
  const sharedChoice = content.questionById.get("scope.modality")!;
  const dos = content.questionById.get("scope.dosage_form")!;
  const paired = content.questions.find((q) => q.sides === "paired" && q.input.type === "choice" && q.section !== "scoping")!;
  const opts = optionsFor(content, paired);
  return {
    sharedChoice: { prompt: sharedChoice.prompt, option: optionsFor(content, sharedChoice)[0]!.label },
    sharedChoice2: { prompt: dos.prompt },
    paired: { prompt: paired.prompt, source: opts[0]!.label, target: opts[1]!.label },
  };
}

describe("gap assessment upload, level 1: our own Word export (I4)", () => {
  it("carries the answers in a data part and reads them back as Exact values", async () => {
    const bytes = await exportGap();
    expect(strictDocx(bytes).names).toContain("customXml/cascade-data.xml");
    const read = readUpload(bytes, "gap.docx");
    expect(read.dataKind).toBe("gap-data");
    const s = gapSessionFromData(read, content, syn);
    expect(s.level).toBe(1);
    const answered = visibleInstances(content, project, "paired").filter((i) => projectAnswerOf(content, project, i));
    expect(s.fields).toHaveLength(answered.length);
    expect(s.fields.every((f) => f.confidence === "exact")).toBe(true);
    expect(s.fields.filter((f) => f.change)).toHaveLength(0);
    expect(gapCounts(s, {}).taken).toBe(0);
  });

  it("round trips every answer into an empty project, with evidence in the change log", async () => {
    const s = gapSessionFromData(readUpload(await exportGap(), "gap.docx"), content, syn);
    const r = applyGapImport(newProject(), s, acceptAll(s), { actor, content, syn });
    expect(r.warnings).toEqual([]);
    for (const inst of visibleInstances(content, project, "paired")) {
      const want = projectAnswerOf(content, project, inst);
      if (!want || isProjectStageQuestion(inst.question.id, inst.side)) continue;
      expect(projectAnswerOf(content, r.project, inst)?.text, inst.key).toBe(want.text);
    }
    // The project stage is the one answer that does not travel: it changes only through the stage change on the Home page.
    expect(projectStage(r.project)).toBeUndefined();
    const ev = r.project.changeLog.at(-1)!;
    expect(ev.action).toBe("gap_import");
    expect(ev.detail).toContain("Imported from gap.docx");
  });

  it("shows a cell typed over in Word as a Changed row that stays open, and applies only what is accepted", async () => {
    const bytes = await exportGap();
    const target = visibleInstances(content, project, "paired").find((i) => i.question.input.type === "text" && projectAnswerOf(content, project, i))!;
    const old = projectAnswerOf(content, project, target)!.text;
    const edited = editDocument(bytes, (xml) => {
      const needle = `>${old}<`;
      expect(xml).toContain(needle);
      return xml.split(needle).join(`>Edited in Word<`);
    });
    const s = gapSessionFromData(readUpload(edited, "edited.docx"), content, syn);
    const f = s.fields.find((x) => x.change)!;
    expect(f.confidence).toBe("changed");
    expect(f.change).toEqual({ old, new: "Edited in Word" });
    expect(gapCounts(s, {}).changed).toBe(1);
    const same = applyGapImport(project, s, {}, { actor, content, syn });
    expect(same.applied).toBe(0);
    const r = applyGapImport(project, s, { [f.id]: { value: "Edited in Word" } }, { actor, content, syn });
    expect(r.applied).toBe(1);
    expect(projectAnswerOf(content, r.project, target)!.text).toBe("Edited in Word");
  });

  // CR-03: the project stage changes only through the stage change on the Home page (a reason, a major version, a stage review).
  // An upload must not set it, not even when somebody types a different stage on the review screen.
  it("never changes the project stage: the stage cell says why, and a typed stage is not put in", async () => {
    const s = gapSessionFromData(readUpload(await exportGap(), "gap.docx"), content, syn);
    const f = fieldOf(s, "gap.q.site.stage.target")!;
    expect(f.unreadable).toBe(PROJECT_STAGE_UPLOAD_NOTE);
    const stage = projectStage(project)!;
    const q = content.questionById.get("site.stage")!;
    const other = optionsFor(content, q).find((o) => o.value !== stage)!;
    const decisions: GapDecisions = { ...acceptAll(s), [f.id]: { value: other.label } };
    // A typed stage is not counted as taken, and the row on the screen has no way to take it.
    expect(gapCounts(s, decisions).taken).toBe(gapCounts(s, acceptAll(s)).taken);
    const stageRecords = (p: typeof project) => p.answers.filter((a) => a.questionId === "site.stage" && a.side === "target").length;
    const r = applyGapImport(project, s, decisions, { actor, content, syn });
    expect(r.warnings.some((w) => w.includes(PROJECT_STAGE_UPLOAD_NOTE))).toBe(true);
    expect(projectStage(r.project)).toBe(stage);
    expect(stageRecords(r.project)).toBe(stageRecords(project));
    expect(r.project.versionHistory).toEqual(project.versionHistory);
    // Into a project that has no stage yet it stays unset too.
    const fresh = applyGapImport(newProject(), s, decisions, { actor, content, syn });
    expect(projectStage(fresh.project)).toBeUndefined();
  });

  it("does not take a foreign file for one of ours", () => {
    expect(readUpload(foreignDocx(foreignGapBodyXml(questions())), "x.docx").dataKind).toBeUndefined();
  });
});

describe("gap assessment upload, level 2: the fill-in form (I4)", () => {
  it("has a control for every question side, and an empty form reads as nothing established", () => {
    const blank = buildGapFormDocx(buildBlankGapFormSpec(content), { generatedAt: GENERATED_AT });
    const read = readUpload(blank, "form.docx");
    expect(read.dataKind).toBe("gap-form");
    expect(Object.keys(read.controls).length).toBeGreaterThan(200);
    const s = gapSessionFromForm(read, content, syn);
    expect(s.level).toBe(2);
    expect(s.fields).toHaveLength(0);
    expect(s.unfilled).toBeGreaterThan(200);
  });

  it("reads filled boxes, keeps an unreadable one with its reason, and never defaults the rest", () => {
    const blank = buildGapFormDocx(buildBlankGapFormSpec(content), { generatedAt: GENERATED_AT });
    const mod = content.questionById.get("scope.modality")!;
    const opt = optionsFor(content, mod)[0]!;
    const filled = editDocument(blank, (xml) => fill(fill(fill(xml, "gap.q.scope.modality.shared", opt.label), "gap.q.scope.program.shared", "ARX-999"), "gap.q.scope.dosage_form.shared", "not a real choice"));
    const s = gapSessionFromForm(readUpload(filled, "form.docx"), content, syn);
    expect(fieldOf(s, "gap.q.scope.modality.shared")).toMatchObject({ value: opt.label, confidence: "exact" });
    expect(fieldOf(s, "gap.q.scope.program.shared")!.value).toBe("ARX-999");
    expect(fieldOf(s, "gap.q.scope.dosage_form.shared")!.unreadable).toContain("not one of the choices");
    const r = applyGapImport(newProject(), s, acceptAll(s), { actor, content, syn });
    const inst = visibleInstances(content, r.project, "paired").find((i) => i.key === "scope.modality@shared")!;
    expect(projectAnswerOf(content, r.project, inst)!.input).toEqual({ kind: "value", value: opt.value });
  });

  it("pre-fills a form with what the project holds, and it reads back the same", () => {
    const spec = buildGapFormSpec(content, project);
    const read = readUpload(buildGapFormDocx(spec, { generatedAt: GENERATED_AT }), "form.docx");
    const s = gapSessionFromForm(read, content, syn);
    // Everything the project answers, except the project stage: an upload never sets it (its cell says so and it is not put in).
    const answered = visibleInstances(content, project, "paired").filter((i) => projectAnswerOf(content, project, i) && !isProjectStageQuestion(i.question.id, i.side));
    expect(s.fields.filter((f) => !f.unreadable)).toHaveLength(answered.length);
    expect(fieldOf(s, "gap.q.site.stage.target")).toMatchObject({ unreadable: PROJECT_STAGE_UPLOAD_NOTE });
    const r = applyGapImport(newProject(), s, acceptAll(s), { actor, content, syn });
    // A form holds only the words "TBD", not the best guess behind it. The demo has a TBD best guess that makes a follow-up question
    // appear; without it the follow-up is honestly reported as not asked, never forced in.
    const notAsked = r.warnings.filter((w) => w.includes("does not ask this question"));
    expect(notAsked.length).toBe(r.warnings.length);
    expect(notAsked.length).toBeLessThanOrEqual(1);
    for (const inst of answered) if (!notAsked.some((w) => w.startsWith(inst.question.label ?? " "))) expect(projectAnswerOf(content, r.project, inst)?.text, inst.key).toBe(projectAnswerOf(content, project, inst)!.text);
  });
});

describe("gap assessment upload, level 3: a gap assessment from somebody else (I4)", () => {
  it("matches questions by their wording, suggests answers, and lists what it could not use", () => {
    const q = questions();
    const s = gapSessionFromOther({ ...readUpload(foreignDocx(foreignGapBodyXml(q)), "other.docx"), format: "docx" }, content, syn);
    expect(s.level).toBe(3);
    expect(s.title.value).toBe(FOREIGN_GAP_TITLE);
    expect(fieldOf(s, "gap.q.scope.modality.shared")).toMatchObject({ value: q.sharedChoice.option, confidence: "matched" });
    // An answer that does not fit the choices is Not found with the reason, and goes to Not used yet.
    const d = fieldOf(s, "gap.q.scope.dosage_form.shared")!;
    expect(d.confidence).toBe("not_found");
    expect(d.notUsedWhy).toContain("not one of the choices");
    const paired = content.questions.find((x) => x.prompt === q.paired.prompt)!;
    expect(fieldOf(s, `gap.q.${paired.id}.source`)!.value).toBe(q.paired.source);
    expect(fieldOf(s, `gap.q.${paired.id}.target`)!.value).toBe(q.paired.target);
    expect(s.notUsed.join("\n")).toContain("Colour of the building");
    expect(s.notUsed.join("\n")).toContain("Table 2");
    // Suggestions only: nothing taken until accepted.
    expect(gapCounts(s, {}).taken).toBe(0);
    const r = applyGapImport(newProject(), s, acceptAll(s), { actor, content, syn });
    expect(r.applied).toBeGreaterThan(0);
  });

  it("reads a PDF the same way and says so for a picture-only PDF", async () => {
    // The shortest question and answers, so the columns of the drawn table do not run into each other.
    const pq = content.questions.filter((x) => x.sides === "paired" && x.input.type === "choice" && x.section !== "scoping" && optionsFor(content, x).length >= 2).sort((x, y) => x.prompt.length - y.prompt.length)[0]!;
    const po = optionsFor(content, pq).sort((x, y) => x.label.length - y.label.length);
    const q = { ...questions(), paired: { prompt: pq.prompt, source: po[0]!.label, target: po[1]!.label } };
    const s = gapSessionFromOther(await readPdfUpload(await foreignGapPdf(q), "other.pdf"), content, syn);
    expect(fieldOf(s, `gap.q.${pq.id}.source`)?.value).toBe(q.paired.source);
    expect(fieldOf(s, `gap.q.${pq.id}.target`)?.value).toBe(q.paired.target);
    const pic = gapSessionFromOther(await readPdfUpload(await pictureOnlyPdf(), "scan.pdf"), content, syn);
    expect(pic.notUsed).toContain(SCANNED_PDF_MESSAGE);
  });

  it("never turns a bare number, a wrong unit or a missing reason into an answer", () => {
    const qty = content.questions.find((x) => x.input.type === "quantity")!;
    const unit = qty.input.units![0]!;
    const side = qty.sides === "shared" ? "shared" : qty.sides === "target" ? "target" : "source";
    expect(parseGapAnswer(content, qty, side, "12", syn).ok).toBe(false);
    expect(parseGapAnswer(content, qty, side, "12 furlongs", syn).ok).toBe(false);
    expect(parseGapAnswer(content, qty, side, `12 ${unit}`, syn).ok).toBe(true);
    expect(parseGapAnswer(content, qty, side, "N/A", syn).ok).toBe(false);
    expect(parseGapAnswer(content, qty, side, "Not applicable: not used here", syn).ok).toBe(true);
  });
});
