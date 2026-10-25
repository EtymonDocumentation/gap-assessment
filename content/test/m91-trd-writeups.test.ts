import {
  addPart,
  addWriteupFromLibrary,
  buildDemoProject,
  buildTrdDocument,
  differenceIsEmpty,
  duplicateLibraryWriteup,
  editLibraryWriteup,
  effectiveWriteupLibrary,
  openBlankCount,
  parseTrdWriteupLibrary,
  removePart,
  removeWriteup,
  resolveBlank,
  segmentsOf,
  setBlankValue,
  setNotApplicable,
  setPartIncluded,
  setPartText,
  updateWriteupFromLibrary,
  writeupDifference,
  writeupLibraryStatus,
  writeupsAvailable,
  type Block,
} from "@gap/engine";
import { parseProject, type Project, type TrdDocument, type TrdLibraryWriteup } from "@gap/process-model";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos, trdWriteups } from "../index";

const T1 = "2026-10-24T09:00:00.000Z";
const T2 = "2026-10-25T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T2 };

const withLib = buildDemoProject(content, demos["arx-217"], undefined, undefined, undefined, undefined, { writeups: trdWriteups });
const without = buildDemoProject(content, demos["arx-217"]);
const docOf = (p: Project): TrdDocument => p.trd.documents[0]!;
const byLib = (d: TrdDocument, id: string) => d.writeups!.find((w) => w.libraryId === id)!;
const exportOf = (p: Project) => buildTrdDocument(p, docOf(p), { generatedAt: T1, content });
const section = (p: Project, id: string) => exportOf(p).sections.find((s) => s.id === id);
const textOf = (blocks: Block[]) =>
  JSON.stringify(blocks.map((b) => ("runs" in b ? b.runs.map((r) => r.text).join("") : "items" in b ? b.items.map((i) => (typeof i === "string" ? i : i.map((r) => r.text).join(""))).join("|") : "text" in b ? b.text : "")));

describe("the shipped write-up library", () => {
  it("holds the reviewed write-ups with unique ids, and names only known unit operations", () => {
    expect(trdWriteups).toHaveLength(35);
    expect(new Set(trdWriteups.map((w) => w.id)).size).toBe(35);
    expect(trdWriteups.filter((w) => w.kind === "unitOp")).toHaveLength(15);
    const keys = content.catalog.unitOperations.map((u) => u.key);
    for (const w of trdWriteups.filter((x) => x.kind === "unitOp")) expect(keys).toContain(w.key);
  });

  it("carries no client names, codes or supplier brands", () => {
    const all = JSON.stringify(trdWriteups);
    expect(all).not.toMatch(/CTP\d|QC\d{3}|VV-IOPS|C2P2/);
  });

  it("is refused when it names an unknown unit operation", () => {
    const bad = { formatVersion: "1.0.0", writeups: [{ id: "wu_x", version: 1, kind: "unitOp", key: "no_such_op", title: "X", parts: [] }] };
    expect(() => parseTrdWriteupLibrary(bad, ["compounding"])).toThrow(/unknown unit operation/);
  });
});

describe("a TRD with process descriptions", () => {
  it("starts from the library: sections first, then one description per included step, optional parts off", () => {
    const d = docOf(withLib);
    const keys = d.writeups!.filter((w) => w.kind === "unitOp").map((w) => w.key);
    // Steps come in process order, so the three the demo scripts appear in that order among the others.
    expect(keys.filter((k) => ["compounding", "sterile_filtration", "aseptic_filling"].includes(k))).toEqual(["compounding", "sterile_filtration", "aseptic_filling"]);
    expect(d.writeups!.findIndex((w) => w.kind === "unitOp")).toBeGreaterThan(d.writeups!.findIndex((w) => w.kind === "section"));
    expect(d.writeups!.some((w) => w.libraryId === "sec_purpose")).toBe(false);
    const sf = byLib(d, "wu_sterile_filtration");
    expect(sf.parts.find((p) => p.id === "flush")!.included).toBeFalsy();
    expect(sf.parts.find((p) => p.id === "pupsit_required")!.included).toBe(true);
  });

  it("a TRD made without the library has none and exports exactly as before", () => {
    expect(docOf(without).writeups).toBeUndefined();
    const out = exportOf(without);
    expect(out.sections.some((s) => s.id === "manufacturing-overview" || s.id.startsWith("writeup-"))).toBe(false);
  });

  it("an older project (schema 1.18.0) opens and exports with no process descriptions", () => {
    const old = JSON.parse(JSON.stringify({ ...without, schemaVersion: "1.18.0" }));
    const p = parseProject(old);
    expect(p.trd.documents).toHaveLength(1);
    expect(exportOf(p).sections.some((s) => s.id === "manufacturing-overview")).toBe(false);
  });
});

describe("blanks", () => {
  const ctx = (p: Project) => ({ project: p, doc: docOf(p), content });

  it("fill from the TRD record, with the source named", () => {
    const d = docOf(withLib);
    const r = resolveBlank(ctx(withLib), byLib(d, "wu_compounding"), "uo.compounding.param.batch_size.setPoint", "Batch size");
    expect(r.filled).toBe(true);
    expect(r.value).toContain("140");
    expect(r.origin).toBe("trd");
    expect(r.where).toMatch(/^TRD/);
  });

  it("a value typed in the demo fills its blank, and the same key is reused in other descriptions", () => {
    const d = docOf(withLib);
    const w = byLib(d, "wu_sterile_filtration");
    const r = resolveBlank(ctx(withLib), w, "trd.sterile_filtration.productTemperature", "Product temperature");
    expect(r).toMatchObject({ filled: true, origin: "entered", value: "2 to 8 °C (fictional)" });
    const other = resolveBlank(ctx(withLib), byLib(d, "wu_aseptic_filling"), "trd.sterile_filtration.productTemperature", "Product temperature");
    expect(other.filled).toBe(true);
  });

  it("stay open when nothing is known, and are never given a default", () => {
    const d = docOf(withLib);
    const r = resolveBlank(ctx(withLib), byLib(d, "wu_aseptic_filling"), "trd.aseptic_filling.clogDelayHours", "Delay (hours)");
    expect(r.filled).toBe(false);
    expect(r.value).toBeUndefined();
  });

  it("typing a value fills the blank and is change-logged; clearing it reopens the blank", () => {
    const d = docOf(withLib);
    const w = byLib(d, "wu_aseptic_filling");
    const key = "trd.aseptic_filling.clogDelayHours";
    const before = withLib.changeLog.length;
    const p1 = setBlankValue(withLib, d.id, w.id, key, "4", who);
    expect(resolveBlank(ctx(p1), byLib(docOf(p1), "wu_aseptic_filling"), key, "x")).toMatchObject({ filled: true, value: "4" });
    expect(p1.changeLog).toHaveLength(before + 1);
    expect(p1.changeLog.at(-1)).toMatchObject({ action: "trd_writeup_value" });
    const p2 = setBlankValue(p1, d.id, w.id, key, "", who);
    expect(resolveBlank(ctx(p2), byLib(docOf(p2), "wu_aseptic_filling"), key, "x").filled).toBe(false);
    expect(openBlankCount(ctx(p2), byLib(docOf(p2), "wu_aseptic_filling"))).toBeGreaterThan(0);
  });

  it("a choice label dropped mid-sentence loses its capital; acronyms, typed values and sentence starts keep theirs", () => {
    const fill = (origin: "project" | "trd" | "entered", value: string) => () => ({ key: "uo.x.param.y.z", label: "x", filled: true, value, origin, where: "w" }) as const;
    const val = (src: string, r: () => ReturnType<typeof resolveBlank>) =>
      segmentsOf(src, r).flatMap((s) => ("blank" in s ? [s.blank.value] : []))[0];
    expect(val("The buffer is {{k|x}}.", fill("project", "Received as ready-to-use liquid"))).toBe("received as ready-to-use liquid");
    expect(val("Membrane: {{k|x}}", fill("trd", "Polyethersulfone"))).toBe("Polyethersulfone");
    expect(val("{{k|x}} is used.", fill("trd", "Polyethersulfone"))).toBe("Polyethersulfone");
    expect(val("The filter is {{k|x}}.", fill("trd", "PES membrane"))).toBe("PES membrane");
    expect(val("Shipped to {{k|x}}.", fill("entered", "Example Labs"))).toBe("Example Labs");
  });
});

describe("editing a description", () => {
  it("an edited paragraph is marked edited and logged with before and after", () => {
    const d = docOf(withLib);
    const w = byLib(d, "wu_compounding");
    const p = setPartText(withLib, d.id, w.id, "p1", { text: "A new first paragraph (fictional)." }, who);
    const part = byLib(docOf(p), "wu_compounding").parts.find((x) => x.id === "p1")!;
    expect(part.text).toBe("A new first paragraph (fictional).");
    expect(part.edited).toBe(true);
    expect(p.changeLog.at(-1)).toMatchObject({ action: "trd_writeup_edit" });
    expect(p.changeLog.at(-1)!.before).toBeDefined();
    expect(p.changeLog.at(-1)!.after).toBeDefined();
  });

  it("an optional part is off until switched on, and only a part that is on is exported", () => {
    const d = docOf(without);
    const lib = trdWriteups.find((w) => w.id === "wu_sterile_filtration")!;
    const r = addWriteupFromLibrary(without, d.id, lib, d.steps.find((s) => s.key === "sterile_filtration")!.id, who);
    const off = textOf(section(r.project, "manufacturing-overview")!.blocks);
    expect(off).not.toContain("flushed to waste");
    const wid = r.writeupId;
    const on = setPartIncluded(r.project, d.id, wid, "flush", true, who);
    expect(textOf(section(on, "manufacturing-overview")!.blocks)).toContain("flushed to waste");
    expect(on.changeLog.at(-1)).toMatchObject({ action: "trd_writeup_toggle" });
  });

  it("a removed paragraph leaves the export, and stays removed after an update from the library", () => {
    const d = docOf(withLib);
    const w = byLib(d, "wu_compounding");
    const p = removePart(withLib, d.id, w.id, "n1", who);
    expect(byLib(docOf(p), "wu_compounding").parts.some((x) => x.id === "n1")).toBe(false);
    const lib = trdWriteups.find((x) => x.id === "wu_compounding")!;
    const u = updateWriteupFromLibrary(p, d.id, w.id, lib, who);
    expect(byLib(docOf(u), "wu_compounding").parts.some((x) => x.id === "n1")).toBe(false);
  });

  it("a not-applicable description shows only its not-applicable text", () => {
    const d = docOf(withLib);
    const w = docOf(withLib).writeups!.find((x) => x.notApplicable);
    expect(w).toBeDefined();
    const p = setNotApplicable(withLib, d.id, w!.id, true, who);
    expect(docOf(p).writeups!.find((x) => x.id === w!.id)!.notApplicable!.on).toBe(true);
  });

  it("a paragraph added by the author is kept when the description is updated", () => {
    const d = docOf(withLib);
    const w = byLib(d, "wu_compounding");
    const { project, partId } = addPart(withLib, d.id, w.id, { kind: "paragraph", text: "Added by the team (fictional)." }, who);
    const lib = trdWriteups.find((x) => x.id === "wu_compounding")!;
    const u = updateWriteupFromLibrary(project, d.id, w.id, lib, who);
    expect(byLib(docOf(u), "wu_compounding").parts.some((x) => x.id === partId)).toBe(true);
  });

  it("a description can be removed and added again from the picker", () => {
    const d = docOf(withLib);
    const w = byLib(d, "wu_aseptic_filling");
    const p = removeWriteup(withLib, d.id, w.id, who);
    const offered = writeupsAvailable(docOf(p), trdWriteups);
    const entry = offered.find((o) => o.lib.id === "wu_aseptic_filling");
    expect(entry?.step).toBeDefined();
    const back = addWriteupFromLibrary(p, d.id, entry!.lib, entry!.step!.id, who);
    expect(docOf(back.project).writeups!.some((x) => x.id === back.writeupId)).toBe(true);
  });
});

describe("the library: versions, copies and updates", () => {
  const lib0 = trdWriteups.find((w) => w.id === "wu_compounding")!;

  it("an edit makes version 2 and keeps version 1 in the history", () => {
    const parts = structuredClone(lib0.parts);
    parts[0]!.text = "Changed wording (fictional).";
    const v2 = editLibraryWriteup(lib0, { parts }, T2, "Alex Example (fictional)");
    expect(v2.version).toBe(lib0.version + 1);
    expect(v2.history!.at(-1)!.version).toBe(lib0.version);
    expect(v2.history!.at(-1)!.parts[0]!.text).toBe(lib0.parts[0]!.text);
  });

  it("a copy is a new write-up that is not added to new TRDs by itself", () => {
    const c = duplicateLibraryWriteup(lib0, "wu_compounding_copy", "Compounding, variant (fictional)", T2, "Alex Example (fictional)");
    expect(c).toMatchObject({ id: "wu_compounding_copy", version: 1, custom: true, autoAdd: false });
  });

  it("the user's copy wins over the shipped one; the user's own ones follow", () => {
    const v2 = editLibraryWriteup(lib0, { title: "Compounding (edited)" }, T2, "Alex Example (fictional)");
    const own = duplicateLibraryWriteup(lib0, "wu_mine", "Mine", T2, "Alex Example (fictional)");
    const eff = effectiveWriteupLibrary(trdWriteups, [v2, own]);
    expect(eff.find((w) => w.id === "wu_compounding")!.title).toBe("Compounding (edited)");
    expect(eff.at(-1)!.id).toBe("wu_mine");
    expect(eff).toHaveLength(trdWriteups.length + 1);
  });

  it("a record is told when the library has a newer version, and the difference is listed before updating", () => {
    const d = docOf(withLib);
    const w = byLib(d, "wu_compounding");
    expect(writeupLibraryStatus(w, trdWriteups)).toEqual({ kind: "current" });
    const parts = structuredClone(lib0.parts) as TrdLibraryWriteup["parts"];
    parts[0]!.text = "Changed wording (fictional).";
    const v2 = editLibraryWriteup(lib0, { parts }, T2, "Alex Example (fictional)");
    const lib = effectiveWriteupLibrary(trdWriteups, [v2]);
    expect(writeupLibraryStatus(w, lib)).toMatchObject({ kind: "newer", libraryVersion: 2, usedVersion: 1 });
    expect(writeupLibraryStatus(w, [])).toEqual({ kind: "missing" });
    const diff = writeupDifference(w, v2);
    expect(diff.changed.length).toBe(1);
    expect(differenceIsEmpty(diff)).toBe(false);
    const u = updateWriteupFromLibrary(withLib, d.id, w.id, v2, who);
    const w2 = byLib(docOf(u), "wu_compounding");
    expect(w2.libraryVersion).toBe(2);
    expect(w2.parts[0]!.text).toBe("Changed wording (fictional).");
    expect(u.changeLog.at(-1)).toMatchObject({ action: "trd_writeup_update" });
  });

  it("an update keeps the team's edited paragraph instead of overwriting it", () => {
    const d = docOf(withLib);
    const w = byLib(d, "wu_compounding");
    const mine = setPartText(withLib, d.id, w.id, "p1", { text: "Team wording (fictional)." }, who);
    const parts = structuredClone(lib0.parts) as TrdLibraryWriteup["parts"];
    parts[0]!.text = "Library changed this too (fictional).";
    const v2 = editLibraryWriteup(lib0, { parts }, T2, "Alex Example (fictional)");
    const diff = writeupDifference(byLib(docOf(mine), "wu_compounding"), v2);
    expect(diff.keptEdited.length).toBe(1);
    const u = updateWriteupFromLibrary(mine, d.id, w.id, v2, who);
    expect(byLib(docOf(u), "wu_compounding").parts.find((x) => x.id === parts[0]!.id)!.text).toBe("Team wording (fictional).");
  });
});

describe("the export", () => {
  const out = exportOf(withLib);
  const overview = out.sections.find((s) => s.id === "manufacturing-overview")!;

  it("has the section Manufacturing process overview with a numbered sub-section per step, in step order", () => {
    expect(overview.title).toBe("Manufacturing process overview");
    const heads = overview.blocks.filter((b) => b.type === "heading" && !b.level).map((b) => (b as { text: string }).text);
    expect(heads.length).toBeGreaterThanOrEqual(3);
    heads.forEach((h, i) => expect(h.startsWith(`${overview.number}.${i + 1} `)).toBe(true));
    const compounding = heads.findIndex((h) => /compounding/i.test(h));
    const filling = heads.findIndex((h) => /filling/i.test(h));
    expect(compounding).toBeGreaterThanOrEqual(0);
    expect(filling).toBeGreaterThan(compounding);
  });

  it("has lettered sub-steps, notes styled as notes and highlighted open blanks", () => {
    expect(overview.blocks.some((b) => b.type === "rich-list" && b.style === "letter")).toBe(true);
    expect(overview.blocks.some((b) => b.type === "rich" && b.style === "note")).toBe(true);
    const open = overview.blocks.flatMap((b) => (b.type === "rich" ? b.runs : b.type === "rich-list" ? b.items.flat() : [])).filter((r) => r.open);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((r) => r.text.startsWith("["))).toBe(true);
  });

  it("shows filled blanks as their value, and lists values and gaps with sources in an appendix", () => {
    expect(textOf(overview.blocks)).toContain("2 to 8 °C (fictional)");
    const appx = out.sections.find((s) => s.id === "writeup-values")!;
    expect(appx.appendix).toBe(true);
    const tables = appx.blocks.filter((b) => b.type === "table");
    expect(tables.length).toBeGreaterThanOrEqual(1);
  });

  it("carries the banner and marks open blanks in HTML (with a spoken cue) and markdown", () => {
    const html = renderHtml(out);
    expect(html).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(html).toContain('class="blank-open"');
    expect(html).toContain("Open blank: ");
    expect(html).toContain('<ol type="a" class="lettered">');
    expect(renderMarkdown(out)).toContain("Manufacturing process overview");
  });
});
