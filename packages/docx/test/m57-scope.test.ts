/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assess, buildDemoProject, buildDocument, excludeStep, setOmittedSections } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos } from "../../../content/index";
import { renderDocx } from "../src/index";
import { buildTagData } from "../src/tags";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * Milestone 5.7: a process step left out of the assessment, and a document section left out of the download, must show in
 * the Word file as well as on screen, because the Word file is what a reviewer signs. The review workflow is gone: the Word
 * file has no revision history, no reviewer comments and no comments part. The sample is written where a person can open it.
 */
describe("Word scope lists left-out process steps, and the review workflow is gone", () => {
  const actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-04T09:00:00.000Z" };
  const later = { name: "Sam Sample (fictional)", role: "QA", at: "2026-10-05T10:30:00.000Z" };
  let p = buildDemoProject(content, demos["arx-217"]);
  p = excludeStep(content, p, "capping", "Capped at a partner site under their own quality system (fictional)", actor);
  p = excludeStep(content, p, "storage_shipping", undefined, later);
  p = setOmittedSections(p, ["risk"]);
  const a = assess(content, p);
  const doc = buildDocument(content, p, a, GENERATED_AT);

  const render = () => renderDocx({ doc, tagData: buildTagData(content, p, a, doc), mode: "builtin", generatedAt: GENERATED_AT });

  it("lists each left-out step with its reason or 'No reason recorded', who and when", async () => {
    const out = await render();
    const res = strictDocx(out.bytes);
    const text = plainText(res);
    expect(text).toContain("Process step left out");
    expect(text).toContain("Capping");
    expect(text).toContain("Capped at a partner site under their own quality system (fictional)");
    expect(text).toContain("Storage and shipping");
    expect(text).toContain("No reason recorded");
    expect(text).toContain("Pat Placeholder (fictional)");
    expect(text).toContain("Sam Sample (fictional)");
    expect(text).toContain("2026-10-04");
    expect(text).toContain("2026-10-05");
    // The omitted optional section is named, and not present.
    expect(text).toContain("Sections omitted");
    expect(text).not.toMatch(/\bRisk ranking\b.*\n.*Rank/);
    const dir = join(tmpdir(), "gap-docx-samples", "m57");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sample-scope-step-excluded.docx"), out.bytes);
  });

  it("has no revision history, no reviewer comments and no Word comments part", async () => {
    const res = strictDocx((await render()).bytes);
    expect(plainText(res)).not.toMatch(/Revision history|Reviewer comments|Not yet issued/);
    expect(res.names).not.toContain("word/comments.xml");
  });
});
