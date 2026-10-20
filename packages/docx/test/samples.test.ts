/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importTemplateFile, renderDocx, suggestMapping, type RenderDocxInput, type TemplateMapping } from "../src/index";
import { BANNER, GENERATED_AT, buildModelWithComments, fixture } from "./fixtures";
import { customProps, plainText, strictDocx } from "./strict";

/** One sample per mode, written where a person can open them in Word (and checked with the strict package check first). */
describe("sample output files", () => {
  const dir = join(tmpdir(), "gap-docx-samples");
  mkdirSync(dir, { recursive: true });
  const m = buildModelWithComments();

  const cases: { file: string; mode: RenderDocxInput["mode"]; template?: string; mapped?: boolean; omit?: boolean }[] = [
    { file: "sample-builtin.docx", mode: "builtin" },
    { file: "sample-their-look.docx", mode: "their_look", template: "brightwater-template.docx" },
    { file: "sample-mapped-docx.docx", mode: "mapped", template: "brightwater-template.docx", mapped: true },
    { file: "sample-mapped-omit.docx", mode: "mapped", template: "brightwater-template.docx", mapped: true, omit: true },
    { file: "sample-mapped-pdf.docx", mode: "mapped", template: "brightwater-outline.pdf", mapped: true },
    { file: "sample-tags.docx", mode: "tags", template: "brightwater-tags.docx" },
    { file: "sample-from-macro-template.docx", mode: "their_look", template: "brightwater-macro.docm" },
  ];

  for (const c of cases) {
    it(`writes ${c.file}`, async () => {
      const t = c.template ? await importTemplateFile(c.template, fixture(c.template)) : undefined;
      let mapping: TemplateMapping | undefined;
      if (t && c.mapped) {
        mapping = suggestMapping(t.analysis, m.doc);
        if (c.omit) mapping = { ...mapping, unmappedBlocks: "omit" };
      }
      const out = await renderDocx({
        doc: m.doc,
        tagData: m.tagData,
        mode: c.mode,
        generatedAt: GENERATED_AT,
        ...(t ? { template: { name: "Brightwater Biologics (fictional)", version: "1.0", sha256: t.sha256, fileName: c.template, bytes: t.bytes, analysis: t.analysis, ...(mapping ? { mapping } : {}) } } : {}),
      });
      const res = strictDocx(out.bytes);
      expect(plainText(res)).toContain(BANNER);
      expect(customProps(res).templateMode).toBe(c.mode);
      writeFileSync(join(dir, c.file), out.bytes);
    });
  }
});
