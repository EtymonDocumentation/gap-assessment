/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assess, buildDemoProject, buildDocument } from "@gap/engine";
import { parseProject } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos } from "../../../content/index";
import { renderDocx } from "../src/index";
import { buildTagData } from "../src/tags";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * M5.6: a project converted from schema 1.8.0 (Unknown answers) reads as TBD in Word, lists the converted entries among
 * the open items, and counts the conversion records in the change-log summary. No "Unknown" or "to be confirmed" is
 * used for the not-known answer anywhere in the document except where an old record is quoted as it was written.
 */

function convertedProject() {
  const raw = JSON.parse(JSON.stringify(buildDemoProject(content, demos["arx-217"]))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  raw.schemaVersion = "1.8.0";
  const take = (fields: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const e of Object.values<any>(fields ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e.status === "tbd" && Object.keys(e.tbd ?? {}).length === 0) {
        e.status = "unknown";
        delete e.tbd;
      }
    }
  };
  take(raw.scope);
  for (const side of ["source", "target"]) {
    const m = raw.processes[side];
    take(m.site.fields);
    for (const uo of Object.values<any>(m.unitOperations)) { // eslint-disable-line @typescript-eslint/no-explicit-any
      take(uo.fields);
      for (const coll of Object.values<any>(uo.collections)) for (const item of Object.values<any>(coll)) take(item.fields); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
  return parseProject(raw, { now: "2026-10-21T08:00:00.000Z" });
}

async function render() {
  const project = convertedProject();
  const a = assess(content, project);
  const doc = buildDocument(content, project, a, GENERATED_AT);
  const tagData = buildTagData(content, project, a, doc);
  const out = await renderDocx({ doc, tagData, mode: "builtin", generatedAt: GENERATED_AT });
  return { project, doc, out, text: plainText(strictDocx(out.bytes)) };
}

describe("Word output of a project converted to TBD", () => {
  it("lists the converted entries as TBD open items and never calls the not-known answer Unknown or 'to be confirmed'", async () => {
    const { doc, text } = await render();
    expect(doc.tbdCount).toBe(4);
    expect(text).toMatch(/TBD values/);
    expect(text).not.toMatch(/to be confirmed/i);
    // "Unknown" may appear only inside a quoted old record ("Unknown converted to TBD ..."), never as an answer.
    const stripped = text.replace(/Unknown converted to TBD \(schema 1\.9\.0, no change in meaning\)/g, "");
    expect(stripped).not.toMatch(/\bUnknown\b/);
  });

  it("counts the conversion records in the change-log summary", async () => {
    const { project, text } = await render();
    const records = project.changeLog.filter((e) => e.action === "migrate_status");
    expect(records.length).toBe(2);
    // The Word change-log summary counts changes by kind, so the conversions appear as their own row.
    expect(text).toMatch(/Status converted \(file update\)/);
  });

  it("writes a sample for a visual check (converted project)", async () => {
    const { out } = await render();
    const dir = join(tmpdir(), "gap-docx-samples", "m56");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sample-converted-project.docx"), out.bytes);
    expect(out.bytes.length).toBeGreaterThan(1000);
  });
});
