/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildMbrDocument, buildSamplingPlanDocument, buildTrdDocument, leftOutSentence, PROGRAM_STAGES, type ProgramStage } from "@gap/engine";
import type { Project } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 120000 });

/** Life stage, job L2: the Word files carry the same stage wording as the app. One sample of each document per stage goes to the temp folder. */
describe("Word documents follow the project stage (L2)", () => {
  const base = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
  const withStage = (stage: ProgramStage | undefined): Project => {
    const p = structuredClone(base);
    const f = p.processes.target.site.fields as Record<string, { value?: unknown }>;
    if (stage === undefined) delete f.programStage;
    else f.programStage = { ...(f.programStage ?? {}), value: stage } as never;
    return p;
  };
  const dir = join(tmpdir(), "gap-docx-samples", "lifestage-l2");
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };

  it("writes a TRD, a sampling plan and a batch record per stage, with the same words as the app", async () => {
    mkdirSync(dir, { recursive: true });
    for (const stage of [...PROGRAM_STAGES, undefined] as (ProgramStage | undefined)[]) {
      const p = withStage(stage);
      const name = stage ?? "not-set";
      const docs = {
        trd: buildTrdDocument(p, p.trd.documents[0]!, opts),
        sampling: buildSamplingPlanDocument(content, p, p.sampling.plans[0]!, samplingSuggestions, opts),
        mbr: buildMbrDocument(p, p.mbr.records[0]!, opts),
      };
      for (const [kind, doc] of Object.entries(docs)) {
        const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
        writeFileSync(join(dir, `${kind}-${name}.docx`), out.bytes);
        const text = plainText(strictDocx(out.bytes), "word/document.xml");
        expect(text).not.toContain("{{");
        if (kind === "mbr" && stage && stage !== "ppq") {
          const left = text.replace(/\s+/g, " ");
          expect(left).toContain(leftOutSentence(stage, Number(/(\d+) PPQ-only/.exec(left)![1])));
        }
        if (kind === "sampling" && stage === "clinical") expect(text).toContain("Clinical batch sampling plan");
      }
    }
  });
});
