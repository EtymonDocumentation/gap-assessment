/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import {
  applyImport,
  buildBlankFormSpec,
  buildDemoProject,
  buildTrdData,
  buildTrdDocument,
  buildTrdFormSpec,
  importCounts,
  importSummaryText,
  parseFieldId,
  parseNumberText,
  parseRangeText,
  sessionFromData,
  sessionFromForm,
  trdOpenItems,
  type ImportDecisions,
} from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { buildTrdFormDocx, readTrdUpload, renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

const actor = { name: "Test reviewer", at: GENERATED_AT };
const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
const d = project.trd.documents[0]!;
const dir = join(tmpdir(), "gap-docx-samples", "i1");

/** Replaces text in word/document.xml of a docx. */
function editDocument(bytes: Uint8Array, edit: (xml: string) => string): Uint8Array {
  const zip = new PizZip(bytes);
  zip.file("word/document.xml", edit(zip.file("word/document.xml")!.asText()));
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

async function exportTrd(variant: "standard" | "evidence" = "standard"): Promise<Uint8Array> {
  const doc = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", variant });
  const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT, dataPart: { kind: "trd-data", json: buildTrdData(project, d, doc, variant) } });
  return out.bytes;
}

const RANGE = /^\d+(\.\d+)? to \d+(\.\d+)?/;

describe("TRD upload, level 1: a Word export read back exactly (I1)", () => {
  it("carries the data in a custom XML part, and the package stays valid", async () => {
    const bytes = await exportTrd();
    const res = strictDocx(bytes);
    expect(res.names).toContain("customXml/cascade-data.xml");
    const read = readTrdUpload(bytes, "export.docx");
    expect(read.dataKind).toBe("trd-data");
    const s = sessionFromData(read);
    expect(s.level).toBe(1);
    expect(s.record!.record.id).toBe(d.id);
    expect(s.record!.fingerprint).toMatch(/\w+/);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd-export-with-data.docx"), bytes);
  });

  it("an untouched export has no Changed in Word row", async () => {
    const s = sessionFromData(readTrdUpload(await exportTrd(), "export.docx"));
    expect(s.fields.filter((f) => f.change)).toHaveLength(0);
    expect(s.fields.some((f) => f.confidence === "exact")).toBe(true);
    const c = importCounts(s, {});
    expect(c.taken).toBe(0);
    expect(c.changed).toBe(0);
  });

  it("the evidence variant also reads back", async () => {
    const s = sessionFromData(readTrdUpload(await exportTrd("evidence"), "evidence.docx"));
    expect(s.fields.filter((f) => f.change)).toHaveLength(0);
  });

  it("a cell edited in Word becomes a Changed in Word row that stays open until decided", async () => {
    const bytes = await exportTrd();
    const base = sessionFromData(readTrdUpload(bytes, "export.docx"));
    const table = base.record!.tables.find((t) => t.rows.some((r) => RANGE.test(r[2] ?? "")))!;
    const row = table.rows.find((r) => RANGE.test(r[2] ?? ""))!;
    const oldNor = row[2]!;
    const m = /^(\d+(?:\.\d+)?) to (.*)$/.exec(oldNor)!;
    const newNor = `${Number(m[1]) + 1} to ${m[2]}`;
    const edited = editDocument(bytes, (xml) => {
      const at = xml.indexOf(`>${oldNor}<`);
      expect(at).toBeGreaterThan(0);
      return xml.slice(0, at) + `>${newNor}<` + xml.slice(at + oldNor.length + 2);
    });
    const s = sessionFromData(readTrdUpload(edited, "edited.docx"));
    const changed = s.fields.filter((f) => f.change);
    expect(changed).toHaveLength(1);
    expect(changed[0]!.change).toMatchObject({ old: oldNor, new: newNor, column: "NOR" });
    expect(changed[0]!.confidence).toBe("changed");
    // Neither accepted nor rejected: it is open, and the values inside the cell wait for the choice.
    expect(importCounts(s, {}).changed).toBe(1);
    expect(s.fields.filter((f) => f.lockedBy === changed[0]!.id).length).toBeGreaterThan(0);
    // Accepting the Word text puts the new range into a new TRD.
    const decisions: ImportDecisions = {};
    for (const f of s.fields) if (!f.change && !f.lockedBy && f.value) decisions[f.id] = { value: f.value };
    decisions[changed[0]!.id] = { value: newNor };
    const r = applyImport(project, s, decisions, { actor, target: { kind: "new", title: "Imported copy" } });
    const made = r.project.trd.documents.find((x) => x.id === r.trdId)!;
    const p = parseFieldId(changed[0]!.id)!;
    const step = made.steps.find((x) => x.key === p.ref || x.id === p.ref)!;
    const nor = step.items.find((i) => i.key === p.key)!.limits!.nor!;
    expect(nor.min).toBe(Number(m[1]) + 1);
    expect(r.project.changeLog.some((e) => e.action === "trd_import" && (e.detail ?? "").includes("Imported from edited.docx"))).toBe(true);
    expect(importSummaryText(r.counts, 1)).toMatch(/^\d+ values taken, \d+ still open, 1 changed in Word$/);
    writeFileSync(join(dir, "trd-export-edited-cell.docx"), edited);
  });

  it("a decimal comma is refused rather than read as a thousands separator", () => {
    expect(parseNumberText("1,5 mL")).toBeUndefined();
    expect(parseRangeText("1,5 to 2")).toBeUndefined();
    expect(parseRangeText("up to 25 °C")).toEqual({ high: 25, unit: "°C" });
    expect(parseNumberText("-80")).toEqual({ value: -80 });
  });

  it("units are never converted: two different units in one range stay open", async () => {
    const bytes = await exportTrd();
    const base = sessionFromData(readTrdUpload(bytes, "export.docx"));
    const table = base.record!.tables.find((t) => t.rows.some((r) => RANGE.test(r[2] ?? "")))!;
    const row = table.rows.find((r) => RANGE.test(r[2] ?? ""))!;
    const edited = editDocument(bytes, (xml) => xml.replace(`>${row[2]}<`, ">1 mL to 2 L<"));
    const s = sessionFromData(readTrdUpload(edited, "units.docx"));
    const ch = s.fields.find((f) => f.change)!;
    const r = applyImport(project, s, { [ch.id]: { value: "1 mL to 2 L" } }, { actor, target: { kind: "new", title: "Units" } });
    expect(r.warnings.join(" ")).toMatch(/never converted|two different units/);
  });
});

describe("TRD upload, level 2: the fill-in form (I1)", () => {
  it("the blank form has a content control per field and every one is Not established", () => {
    const spec = buildBlankFormSpec(content.catalog);
    const bytes = buildTrdFormDocx(spec, { generatedAt: GENERATED_AT });
    const res = strictDocx(bytes);
    const xml = res.text("word/document.xml");
    expect((xml.match(/<w:sdt>/g) ?? []).length).toBeGreaterThan(100);
    expect(xml).toContain('w:val="trd.title"');
    expect(plainText(res)).toContain("Not established");
    const read = readTrdUpload(bytes, "form.docx");
    expect(read.dataKind).toBe("trd-form");
    const s = sessionFromForm(read);
    expect(s.fields.every((f) => f.confidence === "not_found" && f.value === "")).toBe(true);
    const c = importCounts(s, {});
    expect(c.taken).toBe(0);
    expect(c.open).toBe(s.fields.length);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd-blank-form.docx"), bytes);
  });

  it("a form filled in programmatically gives values, and the cells left empty become open items", () => {
    const spec = buildBlankFormSpec(content.catalog);
    const step = spec.steps.find((s) => s.params.length >= 2)!;
    const [a, b] = step.params;
    const fill = (xml: string, tag: string, text: string) => {
      const start = xml.indexOf(`<w:tag w:val="${tag}"/>`);
      expect(start).toBeGreaterThan(0);
      const open = xml.lastIndexOf("<w:sdt>", start);
      const end = xml.indexOf("</w:sdt>", start) + "</w:sdt>".length;
      const block = xml.slice(open, end);
      const filled = block.replace("<w:showingPlcHdr/>", "").replace(/<w:sdtContent>[\s\S]*<\/w:sdtContent>/, `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent>`);
      return xml.slice(0, open) + filled + xml.slice(end);
    };
    const base = buildTrdFormDocx(spec, { generatedAt: GENERATED_AT });
    const id = (p: string, part: string) => `trd.step.${step.ref}.param.${p}.${part}`;
    const filled = editDocument(base, (xml) => {
      let x = fill(xml, "trd.purpose", "Move the process to the receiving site.");
      x = fill(x, id(a!.key, "set"), "10");
      x = fill(x, id(a!.key, "nor_low"), "8");
      x = fill(x, id(a!.key, "nor_high"), "12");
      x = fill(x, id(a!.key, "unit"), "mL");
      return x;
    });
    const s = sessionFromForm(readTrdUpload(filled, "my-form.docx"));
    const got = s.fields.filter((f) => f.value);
    expect(got.map((f) => f.id).sort()).toEqual(["trd.purpose", id(a!.key, "nor_high"), id(a!.key, "nor_low"), id(a!.key, "set"), id(a!.key, "unit")].sort());
    expect(got.every((f) => f.confidence === "exact")).toBe(true);
    // Nothing is taken until it is accepted.
    expect(importCounts(s, {}).taken).toBe(0);
    const dec: ImportDecisions = {};
    for (const f of got) dec[f.id] = { value: f.value };
    const r = applyImport(project, s, dec, { actor, target: { kind: "new", title: "From the form" } });
    expect(r.counts.taken).toBe(5);
    expect(importSummaryText(r.counts, 2)).toBe(`5 values taken, ${s.fields.length - 5} still open`);
    const made = r.project.trd.documents.find((x) => x.id === r.trdId)!;
    const item = made.steps.find((x) => x.key === step.key)!.items.find((i) => i.key === a!.key)!;
    expect(item.limits).toMatchObject({ setPoint: { value: 10, unit: "mL" }, nor: { min: 8, max: 12, unit: "mL" } });
    expect(item.limits?.par).toBeUndefined();
    expect(made.purpose).toBe("Move the process to the receiving site.");
    // The other parameter was not filled: it is not in the TRD with a value, and the TRD lists open items.
    expect(made.steps.find((x) => x.key === step.key)!.items.find((i) => i.key === b!.key)).toBeUndefined();
    expect(trdOpenItems(made).length).toBeGreaterThan(0);
    const log = r.project.changeLog.find((e) => e.action === "trd_import")!;
    expect(log.detail).toContain("Imported from my-form.docx");
    expect(JSON.stringify(log.after)).toContain("Form cell");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd-form-filled.docx"), filled);
  });

  it("the form with what we know so far carries the TRD's own values", () => {
    const spec = buildTrdFormSpec(d);
    const bytes = buildTrdFormDocx(spec, { generatedAt: GENERATED_AT });
    const s = sessionFromForm(readTrdUpload(bytes, "known.docx"));
    expect(s.fields.find((f) => f.id === "trd.title")!.value).toBe(d.title);
    expect(s.fields.filter((f) => f.value).length).toBeGreaterThan(5);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd-form-so-far.docx"), bytes);
  });

  it("a file without our data part is not read as level 1 or 2", async () => {
    const doc = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    expect(readTrdUpload(out.bytes, "plain.docx").dataKind).toBeUndefined();
  });
});

describe("TRD upload: update mode and file rules (I1)", () => {
  it("updating an existing TRD changes only the accepted values and logs each one", async () => {
    const bytes = await exportTrd();
    const base = sessionFromData(readTrdUpload(bytes, "export.docx"));
    const table = base.record!.tables.find((t) => t.rows.some((r) => RANGE.test(r[2] ?? "")))!;
    const row = table.rows.find((r) => RANGE.test(r[2] ?? ""))!;
    const m = /^(\d+(?:\.\d+)?) to (.*)$/.exec(row[2]!)!;
    const newNor = `${Number(m[1]) + 2} to ${m[2]}`;
    const edited = editDocument(bytes, (xml) => xml.replace(`>${row[2]}<`, `>${newNor}<`));
    const s = sessionFromData(readTrdUpload(edited, "edited.docx"));
    const ch = s.fields.find((f) => f.change)!;
    const before = structuredClone(project);
    const r = applyImport(project, s, { [ch.id]: { value: newNor } }, { actor, target: { kind: "update", trdId: d.id } });
    expect(project).toEqual(before);
    const p = parseFieldId(ch.id)!;
    const after = r.project.trd.documents.find((x) => x.id === d.id)!;
    const item = after.steps.find((x) => x.key === p.ref || x.id === p.ref)!.items.find((i) => i.key === p.key)!;
    expect(item.limits!.nor!.min).toBe(Number(m[1]) + 2);
    const events = r.project.changeLog.filter((e) => e.action === "trd_import_value");
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => (e.detail ?? "").includes("Imported from edited.docx"))).toBe(true);
    // Nothing else in the TRD moved.
    const was = project.trd.documents.find((x) => x.id === d.id)!;
    expect(after.title).toBe(was.title);
    expect(after.steps.length).toBe(was.steps.length);
  });

  it("file rules: docx/docm/pdf in, old formats told what to do, 25 MB limit", async () => {
    const { classifyUpload } = await import("@gap/engine");
    expect(classifyUpload("a.docx", 10)).toEqual({ ok: true, kind: "docx" });
    expect(classifyUpload("a.DOCM", 10)).toEqual({ ok: true, kind: "docx" });
    expect(classifyUpload("a.pdf", 10)).toEqual({ ok: true, kind: "pdf" });
    for (const n of ["a.doc", "a.rtf", "a.odt"]) expect(classifyUpload(n, 10)).toEqual({ ok: false, message: "Save it as .docx or PDF first." });
    expect(classifyUpload("a.docx", 26 * 1024 * 1024).ok).toBe(false);
    expect(classifyUpload("a.docx", 25 * 1024 * 1024).ok).toBe(true);
  });
});
