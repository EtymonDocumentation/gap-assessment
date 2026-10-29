/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildMbrDocument, mergeMbr, updateSplit, WRITE_IN } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";
import { renderDocx } from "../src/index";
import { BANNER, GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** The split SYR-305 demo record in Word: one document per part, each with its own document number and its hold entry. */
describe("split batch record in Word", () => {
  const demo = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
  const rec = demo.mbr.records[0]!;
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
  const part1 = buildMbrDocument(demo, rec, { ...opts, part: 1 });
  const part2 = buildMbrDocument(demo, rec, { ...opts, part: 2 });
  const whole = buildMbrDocument(demo, rec, opts);
  const text = async (doc: typeof part1) => plainText(strictDocx((await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT })).bytes));
  const refOf = (doc: typeof part1) => doc.meta.find(([k]) => k === "Document reference")![1];

  it("gives each part its own document number and title", () => {
    expect(refOf(part1)).toBe("DEMO-MBR-305-01-P1");
    expect(refOf(part2)).toBe("DEMO-MBR-305-01-P2");
    expect(part1.title).toBe("Master batch record, Part 1 of 2 (draft)");
    expect(part2.title).toBe("Master batch record, Part 2 of 2 (draft)");
    expect(part1.meta).toContainEqual(["Other part (Part 2)", "DEMO-MBR-305-01-P2"]);
    expect(part2.meta).toContainEqual(["Other part (Part 1)", "DEMO-MBR-305-01-P1"]);
  });

  it("splits the sections between the parts, keeps the numbers running on and adds the hold entry to each", () => {
    const process = (d: typeof part1) => d.sections.filter((s) => !s.appendix && !s.id.startsWith("hold-"));
    expect(process(part1).map((s) => s.number)).toEqual(["1", "2", "3", "4", "5"]);
    expect(process(part2).map((s) => s.number)).toEqual(["6", "7", "8", "9", "10", "11", "12"]);
    expect(part1.sections.filter((s) => !s.appendix).at(-1)!.id).toBe("hold-start");
    expect(part2.sections.filter((s) => !s.appendix)[0]!.id).toBe("hold-end");
    expect(part1.sections.some((s) => s.id === "hold-end")).toBe(false);
    expect(part2.sections.some((s) => s.id === "hold-start")).toBe(false);
  });

  it("writes the hold-start entry in Part 1 and the hold-end entry in Part 2, with write-in lines, the limit and its source", async () => {
    const t1 = await text(part1);
    const t2 = await text(part2);
    expect(t1).toContain(BANNER);
    expect(t2).toContain(BANNER);
    expect(t1).toContain("Hold start (end of Part 1)");
    expect(t1).toContain("DEMO-MBR-305-01-P1");
    expect(t1).toContain("Date and time the hold started");
    expect(t1).toContain("Vessel or bag ID");
    expect(t1).toContain("Storage temperature");
    expect(t1).toContain("Room or location");
    expect(t1).toContain("Done by (signature and date)");
    expect(t1).toContain("Checked by (signature and date)");
    expect(t1).toContain(WRITE_IN);
    expect(t1).toContain("SP-007");
    expect(t1).not.toContain("Hold end (start of Part 2)");
    expect(t2).toContain("Hold end (start of Part 2)");
    expect(t2).toContain("DEMO-MBR-305-01-P2");
    expect(t2).toContain("Elapsed hold time (written by the operator");
    expect(t2).toContain("Maximum hold of the bioburden-reduced bulk in cold storage: 24 h");
    expect(t2).toContain("source [");
    expect(t2).toContain("SP-009");
    expect(t2).not.toContain("Hold start (end of Part 1)");
    // The site fills no batch execution value and gives no verdict on the hold time.
    expect(JSON.stringify(part2.sections.find((x) => x.id === "hold-end"))).not.toMatch(/within the limit\.|acceptable|compliant/i);
    expect(t1 + t2).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
  });

  it("says 'No limit stated' on the hold-end entry when the record names no limit row", async () => {
    const none = updateSplit(demo, rec.id, { holdLimitId: null }, { name: "Alex Example (fictional)", at: "2026-10-20T09:00:00.000Z" });
    const t = await text(buildMbrDocument(none, none.mbr.records[0]!, { ...opts, part: 2 }));
    expect(t).toContain("No limit stated");
  });

  it("the whole-record export of a split record carries both entries and both document numbers", () => {
    expect(whole.sections.filter((s) => s.id.startsWith("hold-")).map((s) => s.id)).toEqual(["hold-start", "hold-end"]);
    expect(whole.meta).toContainEqual(["Part 1 document reference", expect.stringContaining("DEMO-MBR-305-01-P1")]);
    expect(refOf(whole)).toBe("DEMO-MBR-305-01");
  });

  it("an unsplit record exports exactly as before: no hold entry, no part rows, same document", () => {
    const merged = mergeMbr(demo, rec.id, { name: "Alex Example (fictional)", at: "2026-10-20T09:00:00.000Z" });
    const doc = buildMbrDocument(merged, merged.mbr.records[0]!, opts);
    expect(doc.sections.some((s) => s.id.startsWith("hold-"))).toBe(false);
    expect(doc.meta.some(([k]) => /part/i.test(k))).toBe(false);
    expect(doc.title).toBe("Master batch record (draft)");
    // A part asked of an unsplit record is ignored: the whole record comes out.
    expect(JSON.stringify(buildMbrDocument(merged, merged.mbr.records[0]!, { ...opts, part: 2 }))).toBe(JSON.stringify(doc));
  });

  it("writes both parts to the samples folder for a look", async () => {
    const dir = join(tmpdir(), "gap-docx-samples", "mbrsplit");
    mkdirSync(dir, { recursive: true });
    for (const [name, doc] of [["part1", part1], ["part2", part2], ["whole", whole]] as const) {
      const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
      writeFileSync(join(dir, `mbr-${name}.docx`), out.bytes);
      writeFileSync(join(dir, `mbr-${name}.html`), renderHtml(doc));
      writeFileSync(join(dir, `mbr-${name}.txt`), plainText(strictDocx(out.bytes)));
    }
  });
});
