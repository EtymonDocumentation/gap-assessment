/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildTrdOutline, buildTrdSeed } from "@gap/engine";
import { parseTrdSeed } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** Milestone 6: the draft TRD outline goes through the same Word renderer, with the built-in style only. */
describe("Word draft TRD outline", () => {
  const seed = parseTrdSeed(JSON.stringify(buildTrdSeed(content, buildDemoProject(content, demos["arx-217"]), { exportedAt: GENERATED_AT, appVersion: "0.0.0-test" })));

  it("renders with the banner, the title, the basis line and the outline sections, and writes a sample", async () => {
    const out = await renderDocx({ doc: buildTrdOutline(seed), mode: "builtin", generatedAt: GENERATED_AT });
    const res = strictDocx(out.bytes);
    const text = plainText(res);
    expect(text).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(text).toContain("Technology transfer document — draft outline");
    expect(text).toContain("Not an approved TRD");
    for (const h of ["Purpose and scope", "Product and presentation", "Receiving site and line", "Process overview", "Open items", "Source register", "Traceability to the gap assessment", "Versions"]) {
      expect(text, h).toContain(h);
    }
    expect(text).not.toMatch(/filing category/i);
    const dir = join(tmpdir(), "gap-docx-samples", "m6");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sample-trd-outline-arx-217.docx"), out.bytes);
  });

  it("leaves the Traceability section out when asked", async () => {
    const out = await renderDocx({ doc: buildTrdOutline(seed, { traceability: false }), mode: "builtin", generatedAt: GENERATED_AT });
    expect(plainText(strictDocx(out.bytes))).not.toContain("Traceability to the gap assessment");
  });
});
