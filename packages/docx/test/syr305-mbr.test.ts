/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildMbrDocument, CMO_PLACEHOLDER } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";
import { renderDocx } from "../src/index";
import { BANNER, GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * The SYR-305 demo master batch record in Word and HTML (samples go to gap-docx-samples/syr305-mbr), and the ARX-217 one again after the
 * step-block wording changes (gap-docx-samples/arx217-mbr), to see that it still reads right.
 */
describe("Syringe demo batch record in Word and HTML", () => {
  const syr = buildDemoProject(content, demos["syr-305"], undefined, undefined, undefined, { library: mbrLibrary }, { writeups: trdWriteups });
  const syrDoc = buildMbrDocument(syr, syr.mbr.records[0]!, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
  const arx = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
  const arxDoc = buildMbrDocument(arx, arx.mbr.records[0]!, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });

  it("renders the syringe record with the banner, the 12 h critical limit with its stage targets and the CMO placeholders", async () => {
    const out = await renderDocx({ doc: syrDoc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    expect(text).toContain("SYR-305 master batch record");
    expect(text).toContain(CMO_PLACEHOLDER);
    expect(text).toContain("Tighter than the TRD");
    expect(text).toContain("Maximum total time out of refrigeration");
    expect(text).toContain("Targets add up to 12 h");
    expect(text).toContain("Requires regulatory affairs assessment");
    // A study point reads as such in the Choice column, never as an undecided row; the sterile filtration step refers to the integrity test steps.
    expect(text).toContain("Study point (not a limit)");
    expect(text).not.toContain("Not decided; study point");
    expect(text).toMatch(/Run the filter integrity test \(Step 6\.\d+\) before use/);
    expect(text).not.toMatch(/filter integrity block/);
    expect(text).not.toMatch(/\bvials?\b|crimp|capping|holding vessel/i);
    expect(text).not.toMatch(/\b(violation|non-compliant)\b|filing category/i);
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
    const dir = join(tmpdir(), "gap-docx-samples", "syr305-mbr");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mbr.docx"), out.bytes);
    writeFileSync(join(dir, "mbr.html"), renderHtml(syrDoc));
    writeFileSync(join(dir, "mbr.txt"), text);
  });

  it("html carries the banner and the placeholder", () => {
    const html = renderHtml(syrDoc);
    expect(html).toContain(BANNER);
    expect(html).toContain(CMO_PLACEHOLDER);
    expect(html).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
  });

  it("still renders the vial record, and writes it for a look", async () => {
    const out = await renderDocx({ doc: arxDoc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    expect(text).toContain("ARX-217 master batch record");
    expect(text).toContain("Tighter than the TRD");
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
    const dir = join(tmpdir(), "gap-docx-samples", "arx217-mbr");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mbr.docx"), out.bytes);
    writeFileSync(join(dir, "mbr.html"), renderHtml(arxDoc));
    writeFileSync(join(dir, "mbr.txt"), text);
  });
});
