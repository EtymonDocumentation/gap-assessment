import PizZip from "pizzip";
import {
  applySamplingImport,
  buildBlankSamplingFormSpec,
  buildDemoProject,
  buildSamplingData,
  buildSamplingFormSpec,
  buildSamplingPlanDocument,
  importSummaryText,
  samplingCounts,
  samplingSessionFromData,
  samplingSessionFromForm,
  samplingSessionFromOther,
  stepNamesFor,
  unitOpLabels,
  SCANNED_PDF_MESSAGE,
  type SamplingDecisions,
  type SamplingImportSession,
} from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingImportSynonyms, samplingSuggestions } from "../../../content/index";
import { buildSamplingFormDocx, readPdfUpload, readUpload, renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { foreignSamplingBodyXml, foreignSamplingPdf } from "./i3-foreign";
import { foreignDocx, pictureOnlyPdf } from "./i2-foreign";
import { strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

// Sampling plan upload (job I3), all three levels. Every file is fictional and built here.
const actor = { name: "Test reviewer", at: GENERATED_AT };
const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
const plan = project.sampling.plans[0]!;
const labels = unitOpLabels(content, project);
const syn = samplingImportSynonyms;
// Two real catalogue step names for the foreign fixtures.
const [stepA, stepB] = content.catalog.unitOperations.slice(0, 2).map((u) => u.label) as [string, string];
const ctx3 = { syn, steps: content.catalog.unitOperations.map((u) => ({ key: u.key, label: u.label })), tests: samplingSuggestions.candidates };

function editDocument(bytes: Uint8Array, edit: (xml: string) => string): Uint8Array {
  const zip = new PizZip(bytes);
  zip.file("word/document.xml", edit(zip.file("word/document.xml")!.asText()));
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

async function exportPlan(): Promise<Uint8Array> {
  const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
  return (await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT, dataPart: { kind: "sampling-data", json: buildSamplingData(content, project, plan, doc) } })).bytes;
}

/** Fills the content control with this tag. */
function fill(xml: string, tag: string, text: string): string {
  const at = xml.indexOf(`<w:tag w:val="${tag}"/>`);
  if (at < 0) throw new Error(`no control ${tag}`);
  const open = xml.lastIndexOf("<w:sdt>", at);
  const end = xml.indexOf("</w:sdt>", at) + "</w:sdt>".length;
  const block = xml
    .slice(open, end)
    .replace("<w:showingPlcHdr/>", "")
    .replace(/<w:sdtContent>[\s\S]*<\/w:sdtContent>/, `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent>`);
  return xml.slice(0, open) + block + xml.slice(end);
}

const get = (s: SamplingImportSession, id: string) => s.fields.find((f) => f.id === id)!;
const all = (s: SamplingImportSession, kinds: string[]): SamplingDecisions =>
  Object.fromEntries(s.fields.filter((f) => kinds.includes(f.confidence) && f.value && !f.unreadable && !f.change).map((f) => [f.id, { value: f.value }]));

describe("sampling plan upload, level 1: our own Word export (I3)", () => {
  it("carries the plan in a data part and reads it back as Exact values", async () => {
    expect(plan.points.length).toBeGreaterThan(2);
    const bytes = await exportPlan();
    expect(strictDocx(bytes).names).toContain("customXml/cascade-data.xml");
    const read = readUpload(bytes, "plan.docx");
    expect(read.dataKind).toBe("sampling-data");
    const s = samplingSessionFromData(read, syn);
    expect(s.level).toBe(1);
    expect(s.rows).toHaveLength(plan.points.length);
    expect(s.title.value).toBe(plan.title);
    const p0 = plan.points[0]!;
    expect(get(s, "sampling.row.1.attribute").value).toBe(p0.attribute.trim());
    expect(get(s, "sampling.row.1.attribute").confidence).toBe("exact");
    expect(s.fields.filter((f) => f.change)).toHaveLength(0);
    // Nothing is taken until it is accepted.
    expect(samplingCounts(s, {}).taken).toBe(0);
  });

  it("shows a cell typed over in Word as a Changed row that stays open, and applies only what is accepted", async () => {
    const bytes = await exportPlan();
    const attr = plan.points.find((p) => p.attribute.trim().length > 3 && p.type !== "stability" && p.type !== "retain_reserve")!;
    const edited = editDocument(bytes, (xml) => {
      const needle = `>${attr.attribute.trim()}`;
      const i = xml.indexOf(needle);
      expect(i).toBeGreaterThan(0);
      return xml.slice(0, i) + `>Edited in Word ${attr.attribute.trim()}` + xml.slice(i + needle.length);
    });
    const s = samplingSessionFromData(readUpload(edited, "edited.docx"), syn);
    const f = s.fields.find((x) => x.change?.new.startsWith("Edited in Word"))!;
    expect(f).toBeDefined();
    expect(f.confidence).toBe("changed");
    expect(f.change!.old).toBe(attr.attribute.trim());
    const target = { kind: "update", planId: plan.id } as const;
    // Default: neither accepted nor rejected, so nothing changes and the plan keeps its value.
    const none = applySamplingImport(project, s, {}, { actor, content, syn, target });
    expect(none.updated).toBe(0);
    expect(none.project.sampling.plans[0]!.points.find((p) => p.id === attr.id)!.attribute).toBe(attr.attribute);
    // Accepting the changed row puts the new text in and logs the evidence.
    const r = applySamplingImport(project, s, { [f.id]: { value: f.change!.new } }, { actor, content, syn, target });
    expect(r.updated).toBe(1);
    expect(r.project.sampling.plans[0]!.points.find((p) => p.id === attr.id)!.attribute).toBe(f.change!.new);
    const ev = r.project.changeLog.at(-1)!;
    expect(ev.action).toBe("sampling_import");
    expect(ev.detail).toContain("Imported from edited.docx");
    expect(JSON.stringify(ev.after)).toContain("Word table");
    // Keeping the value of the plan (an empty decision) changes nothing as well.
    const kept = applySamplingImport(project, s, { [f.id]: { value: "" } }, { actor, content, syn, target });
    expect(kept.updated).toBe(0);
  });

  it("makes a new plan from the exact values and leaves the original alone", async () => {
    const s = samplingSessionFromData(readUpload(await exportPlan(), "plan.docx"), syn);
    const r = applySamplingImport(project, s, all(s, ["exact"]), { actor, content, syn, target: { kind: "new", title: "Copy of the plan" } });
    const made = r.project.sampling.plans.find((p) => p.id === r.planId)!;
    expect(made.title).toBe("Copy of the plan");
    expect(made.points.length).toBeGreaterThan(0);
    expect(r.project.sampling.plans).toHaveLength(project.sampling.plans.length + 1);
    expect(r.project.sampling.plans[0]).toEqual(project.sampling.plans[0]);
  });
});

describe("sampling plan upload, level 2: the fill-in form (I3)", () => {
  it("the blank form is a valid Word file with no rows filled and nothing taken", () => {
    const bytes = buildSamplingFormDocx(buildBlankSamplingFormSpec(stepNamesFor(content, project)), { generatedAt: GENERATED_AT });
    strictDocx(bytes);
    const read = readUpload(bytes, "blank.docx");
    expect(read.dataKind).toBe("sampling-form");
    const s = samplingSessionFromForm(read, syn);
    expect(s.level).toBe(2);
    expect(s.rows).toHaveLength(0);
    expect(s.notUsed.join(" ")).toContain("empty");
  });

  it("a filled row gives Exact values; a cell left empty is not established; a row nobody touched is not a point", () => {
    const base = buildSamplingFormDocx(buildBlankSamplingFormSpec([stepA]), { generatedAt: GENERATED_AT });
    const filled = editDocument(base, (xml) => {
      let x = fill(xml, "sampling.title", "My form plan");
      x = fill(x, "sampling.row.1.step", stepA);
      x = fill(x, "sampling.row.1.attribute", "pH");
      x = fill(x, "sampling.row.1.amount", "10");
      x = fill(x, "sampling.row.2.step", stepA);
      x = fill(x, "sampling.row.2.attribute", "Osmolality");
      x = fill(x, "sampling.row.2.amount", "5 mL");
      x = fill(x, "sampling.row.2.type", "In-process control");
      return x;
    });
    const s = samplingSessionFromForm(readUpload(filled, "mine.docx"), syn);
    expect(s.rows.map((r) => r.n)).toEqual([1, 2]);
    expect(s.title.value).toBe("My form plan");
    expect(get(s, "sampling.row.1.attribute")).toMatchObject({ value: "pH", confidence: "exact" });
    expect(get(s, "sampling.row.1.test")).toMatchObject({ value: "", confidence: "not_found" });
    // An amount without a unit is refused with a reason and cannot be accepted as it stands.
    expect(get(s, "sampling.row.1.amount").unreadable).toMatch(/unit/);
    expect(get(s, "sampling.row.2.amount").unreadable).toBeUndefined();
    expect(importSummaryText(samplingCounts(s, {}), 2)).toMatch(/^0 values taken, \d+ still open$/);

    const dec = all(s, ["exact"]);
    dec["sampling.row.1.amount"] = { value: "10" };
    const r = applySamplingImport(project, s, dec, { actor, content, syn, target: { kind: "new", title: "Form plan" } });
    const made = r.project.sampling.plans.find((p) => p.id === r.planId)!;
    expect(made.points).toHaveLength(2);
    expect(made.points[0]!.quantity).toBeUndefined();
    expect(made.points[1]!.quantity).toEqual({ value: 5, unit: "mL" });
    expect(made.points[1]!.type).toBe("ipc");
    expect(r.warnings.join(" ")).toMatch(/Amount per sample was not put in/);
  });

  it("the form with what we know holds a row per point and reads back the same values", () => {
    const spec = buildSamplingFormSpec(project, plan, labels, stepNamesFor(content, project, plan));
    expect(spec.rows.length).toBe(plan.points.length + 5);
    const s = samplingSessionFromForm(readUpload(buildSamplingFormDocx(spec, { generatedAt: GENERATED_AT }), "sofar.docx"), syn);
    expect(s.rows).toHaveLength(plan.points.length);
    expect(s.rows[0]!.pointId).toBe(plan.points[0]!.id);
    expect(get(s, "sampling.row.1.attribute").value).toBe(plan.points[0]!.attribute.trim());
  });
});

describe("sampling plan upload, level 3: another layout (I3)", () => {
  const word = () => samplingSessionFromOther(readUpload(foreignDocx(foreignSamplingBodyXml(stepA, stepB)), "foreign.docx"), ctx3);

  it("finds the points tables by their header words; every value is only Matched", () => {
    const s = word();
    expect(s.level).toBe(3);
    expect(s.rows).toHaveLength(6);
    expect(s.title.value).toBe("Sampling Overview for the Receiving Unit (fictional)");
    expect(s.fields.every((f) => f.confidence === "matched" || f.confidence === "not_found")).toBe(true);
    // Table 1: the step comes from the heading above it, the attribute and test from their columns.
    expect(get(s, "sampling.row.1.step").value).toBe(stepA);
    expect(get(s, "sampling.row.1.attribute").value).toBe("Fill volume");
    expect(get(s, "sampling.row.1.test").value).toBe("Gravimetric check");
    expect(get(s, "sampling.row.1.amount").value).toBe("10 mL");
    expect(get(s, "sampling.row.1.timing").value).toBe("Beginning, middle, end");
    expect(get(s, "sampling.row.1.type").value).toBe("In-process control (IPC)");
    expect(get(s, "sampling.row.2.type").value).toBe("In-process control (IPC)");
    // A bare number with no unit is refused; table 2 gives its bare number the unit of its heading.
    expect(get(s, "sampling.row.3.amount").unreadable).toMatch(/unit/);
    expect(get(s, "sampling.row.4.amount").value).toBe("100 mL");
    expect(get(s, "sampling.row.4.amount").source).toContain("column heading");
    expect(get(s, "sampling.row.4.step").value).toBe(stepB);
    // An unclear type never becomes a type: it is Not found, with the reason, and its words are listed under "Not used yet".
    expect(get(s, "sampling.row.5.type")).toMatchObject({ value: "", confidence: "not_found" });
    expect(get(s, "sampling.row.5.type").notUsedWhy).toMatch(/something unclear.*not one of the study types/);
    expect(s.notUsed.join("\n")).toContain('Study type "something unclear" was not used');
    // A step that is no step of this project is Not found too, never Matched.
    expect(get(s, "sampling.row.6.step")).toMatchObject({ value: "", confidence: "not_found" });
    expect(get(s, "sampling.row.6.step").notUsedWhy).toContain("no process step of this project is called this");
    expect(s.notUsed.join("\n")).toContain('Process step "Some step of our own" was not used: no process step of this project is called this');
    expect(get(s, "sampling.row.6.timing")).toMatchObject({ value: "", confidence: "not_found" });
    expect(s.matchedTables).toHaveLength(2);
  });

  it("lists what it did not use", () => {
    const text = word().notUsed.join("\n");
    expect(text).toContain("Table 3");
    expect(text).toContain("24 hours");
  });

  it("uses the level-3 summary wording and takes nothing until accepted", () => {
    expect(importSummaryText(samplingCounts(word(), {}), 3)).toMatch(/^0 values taken, \d+ found and waiting for you, \d+ not in this document \(left open\)$/);
  });

  it("a new plan from accepted values; unreadable ones are not put in; the log keeps per-value evidence", () => {
    const s = word();
    const r = applySamplingImport(project, s, all(s, ["matched"]), { actor, content, syn, target: { kind: "new", title: "From another layout" } });
    const made = r.project.sampling.plans.find((p) => p.id === r.planId)!;
    expect(made.points).toHaveLength(5);
    const first = made.points[0]!;
    expect(first.attribute).toBe("Fill volume");
    expect(first.testMethodRef).toBe("Gravimetric check");
    expect(first.quantity).toEqual({ value: 10, unit: "mL" });
    expect(first.type).toBe("ipc");
    expect(first.timing.options).toEqual(["beginning", "middle", "end"]);
    // Timing text that is not a position in the run is kept word for word as Other.
    expect(made.points[1]!.timing.options).toEqual(["other"]);
    expect(made.points[1]!.timing.other).toBe("Every 30 minutes");
    // No study type was invented for the unclear row, and the unit was not converted.
    expect(made.points[4]!.type).toBeUndefined();
    expect(made.points[3]!.quantity).toEqual({ value: 100, unit: "mL" });
    const ev = r.project.changeLog.at(-1)!;
    expect(ev.detail).toContain("Imported from foreign.docx");
    expect(JSON.stringify(ev.after)).toContain("Table 1");
  });

  it("a row whose process step was not accepted is not added, and says so", () => {
    const s = word();
    const dec = all(s, ["matched"]);
    delete dec["sampling.row.1.step"];
    const r = applySamplingImport(project, s, dec, { actor, content, syn, target: { kind: "new", title: "X" } });
    expect(r.project.sampling.plans.find((p) => p.id === r.planId)!.points).toHaveLength(4);
    expect(r.warnings.join(" ")).toMatch(/Row 1 was not added/);
  });

  it("updating a plan changes nothing that was not accepted", () => {
    const before = JSON.stringify(plan);
    const r = applySamplingImport(project, word(), {}, { actor, content, syn, target: { kind: "update", planId: plan.id } });
    expect(JSON.stringify(r.project.sampling.plans[0])).toBe(before);
    expect(r.added + r.updated).toBe(0);
  });

  it("reads a PDF the same way", async () => {
    const s = samplingSessionFromOther(await readPdfUpload(await foreignSamplingPdf(stepA), "foreign.pdf"), ctx3);
    expect(s.rows.length).toBe(2);
    expect(get(s, "sampling.row.1.attribute").value).toBe("Fill volume");
    expect(get(s, "sampling.row.2.type").value).toBe("In-process control (IPC)");
  });

  it("a picture-only PDF gives the plain scan message and no rows", async () => {
    const read = await readPdfUpload(await pictureOnlyPdf(), "scan.pdf");
    expect(read.noText).toBe(true);
    const s = samplingSessionFromOther(read, { syn, steps: [] });
    expect(s.rows).toHaveLength(0);
    expect(s.notUsed).toContain(SCANNED_PDF_MESSAGE);
  });
});
