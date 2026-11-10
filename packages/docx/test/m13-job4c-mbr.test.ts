/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MBR_EXCIPIENTS_CHANGED,
  MBR_EXCIPIENTS_COLUMNS,
  MBR_EXCIPIENTS_NOT_ESTABLISHED,
  MBR_EXCIPIENTS_TITLE,
  buildDemoProject,
  buildMbrDocument,
  mbrExcipientTableRow,
  updateExcipientLine,
} from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { expectNoPrivateTerms } from "../../../test-support/private-terms";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * M13 job 4C: the optional "Excipients used" table of a batch record in Word and HTML, with the same words as the app. The SYR-305 demo
 * record lists its TRD-linked excipients; one line is edited afterwards so the changed note shows too. Sample in gap-docx-samples/m13-job4c.
 */
describe("The Excipients used table of a batch record in Word and HTML", () => {
  const demo = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
  const rec0 = demo.mbr.records[0]!;
  const a = demo.excipients!.assessments.find((x) => x.id === rec0.excipients![0]!.from.assessmentId)!;
  const edited = updateExcipientLine(demo, a.id, rec0.excipients![0]!.from.lineId, { name: `${rec0.excipients![0]!.name} renamed` }, { name: "Alex Example (fictional)", at: "2027-01-01T10:00:00.000Z" });
  const rec = edited.mbr.records[0]!;
  const doc = buildMbrDocument(edited, rec, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });

  it("prints the table with the same words as the app, the unknowns as Not established, and the changed note", async () => {
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(MBR_EXCIPIENTS_TITLE);
    for (const c of MBR_EXCIPIENTS_COLUMNS) expect(text).toContain(c);
    for (const x of rec.excipients!) for (const cell of mbrExcipientTableRow(x)) expect(text).toContain(cell);
    expect(text).toContain(MBR_EXCIPIENTS_NOT_ESTABLISHED);
    expect(text).toContain(MBR_EXCIPIENTS_CHANGED);
    // The bill of materials stays a CMO entry, and the table decides nothing.
    expect(text).toContain("The bill of materials stays an entry only the CMO makes.");
    expect(text).not.toMatch(/\b(violation|non-compliant)\b|filing category/i);
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}/);
    expectNoPrivateTerms(text);
    const dir = join(tmpdir(), "gap-docx-samples", "m13-job4c");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mbr-excipients.docx"), out.bytes);
    writeFileSync(join(dir, "mbr-excipients.html"), renderHtml(doc));
    writeFileSync(join(dir, "mbr-excipients.txt"), text);
  });

  it("the HTML says the same, and a record without the table prints nothing about it", () => {
    const html = renderHtml(doc);
    expect(html).toContain(MBR_EXCIPIENTS_TITLE);
    expect(html).toContain(MBR_EXCIPIENTS_CHANGED);
    for (const x of rec.excipients!) expect(html).toContain(x.name.replace(/&/g, "&amp;"));
    const bare = structuredClone(edited);
    delete bare.mbr.records[0]!.excipients;
    expect(renderHtml(buildMbrDocument(bare, bare.mbr.records[0]!, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" }))).not.toContain(MBR_EXCIPIENTS_TITLE);
  });
});
