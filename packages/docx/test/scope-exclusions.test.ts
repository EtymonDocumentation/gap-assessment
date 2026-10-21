/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assess, buildDemoProject, buildDocument, excludeTopic } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos } from "../../../content/index";
import { renderDocx } from "../src/index";
import { buildTagData } from "../src/tags";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * Milestone 5.5: a topic left out of the assessment must show in the Word scope as well as on screen, because the
 * Word file is what a reviewer signs. The sample is written where a person can open it.
 */
describe("Word scope lists tailoring exclusions and the labelling location", () => {
  const actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-04T09:00:00.000Z" };
  const p = excludeTopic(content, buildDemoProject(content, demos["arx-217"]), "bulk_packaging", "hold", "Packed and labelled in one shift (fictional)", actor);
  const a = assess(content, p);
  const doc = buildDocument(content, p, a, GENERATED_AT);

  it("contains the exclusion table and the reason", async () => {
    const out = await renderDocx({ doc, tagData: buildTagData(content, p, a, doc), mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Scope exclusions");
    expect(text).toContain("Hold and temperature");
    expect(text).toContain("Packed and labelled in one shift (fictional)");
    expect(text).toContain("Labelling and secondary packaging");
    const dir = join(tmpdir(), "gap-docx-samples", "m55");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sample-scope-exclusion.docx"), out.bytes);
  });
});
