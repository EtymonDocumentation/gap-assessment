/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROVISIONAL_LABEL } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { renderDocx } from "../src/index";
import { GENERATED_AT, buildModel, buildModelWithLocation } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

async function text(m: ReturnType<typeof buildModel>) {
  const out = await renderDocx({ doc: m.doc, tagData: m.tagData, mode: "builtin", generatedAt: GENERATED_AT });
  return plainText(strictDocx(out.bytes));
}

describe("Word output of the drafting features", () => {
  it("shows the provisional label and the TBD count in Document control and the open items", async () => {
    const m = buildModel();
    const t = await text(m);
    expect(t).toContain(PROVISIONAL_LABEL);
    expect(t).toMatch(/TBD values/);
    expect(m.doc.tbdCount).toBe(2);
    expect(t).toContain("Best guess:");
  });

  it("shows a citation location in the in-table source text and the source register appendix", async () => {
    const m = buildModelWithLocation();
    const t = await text(m);
    // At least twice: once next to the value in a table, once in the register appendix's citing list.
    expect(t.split(m.location).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("writes a sample for a visual check (demo with a TBD best guess and a location citation)", async () => {
    const m = buildModelWithLocation();
    const out = await renderDocx({ doc: m.doc, tagData: m.tagData, mode: "builtin", generatedAt: GENERATED_AT });
    const dir = join(tmpdir(), "gap-docx-samples", "m54");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "demo-drafting.docx"), out.bytes);
    expect(out.bytes.length).toBeGreaterThan(1000);
  });
});
