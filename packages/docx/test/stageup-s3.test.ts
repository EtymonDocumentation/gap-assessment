/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDemoProject,
  buildMbrDocument,
  buildSamplingPlanDocument,
  buildTrdDocument,
  documentHeaderLine,
  NO_VERSION_HISTORY,
  savedVersionStamp,
  stampDocument,
  workingCopyStamp,
  ensureStartVersion,
  type DocModel,
} from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { BUILTIN_TEMPLATE_VERSION, buildDocumentTagData, renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { customProps, plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 180_000 });

/**
 * STAGEUP S3: every Word file says which saved copy of the project it was made from, on the cover, in the page header and in the file
 * properties. Samples (working copy and viewed version of three documents) go to the temp folder for a look in Word.
 */
const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
const dir = join(tmpdir(), "gap-docx-samples", "stageup");
const VIEWED = savedVersionStamp({ label: "v2", at: "2026-11-04T09:00:00.000Z", stage: "clinical" });

let project: ReturnType<typeof buildDemoProject>;
let working: ReturnType<typeof workingCopyStamp>;
beforeAll(async () => {
  const demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
  project = await ensureStartVersion(demo, { name: "A. Tester (fictional)", at: "2026-11-04T09:00:00.000Z" });
  working = workingCopyStamp(project);
}, 180_000);

const builders: Record<string, () => DocModel> = {
  trd: () => buildTrdDocument(project, project.trd.documents[0]!, opts),
  sampling: () => buildSamplingPlanDocument(content, project, project.sampling.plans[0]!, samplingSuggestions, opts),
  mbr: () => buildMbrDocument(project, project.mbr.records[0]!, opts),
};

describe("the version on every Word file (S3)", () => {
  it("is a new minor version of the built-in look", () => {
    expect(BUILTIN_TEMPLATE_VERSION).toBe("1.4.0");
  });

  for (const [name, build] of Object.entries(builders)) {
    it(`${name}: working copy and viewed version carry their own stamp, in the cover, header and properties`, async () => {
      mkdirSync(dir, { recursive: true });
      for (const [kind, stamp] of [["working", working], ["viewed", VIEWED]] as const) {
        const doc = stampDocument(build(), stamp);
        const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
        const res = strictDocx(out.bytes);
        const text = plainText(res);
        // Cover row: label "Version" and the full wording, once on the cover.
        expect(text).toContain("Version");
        expect(text).toContain(stamp.row);
        // Header line on pages 2 and up: title, project stage, and the short version label.
        const headers = res.names.filter((n) => /^word\/header\d*\.xml$/.test(n)).map((n) => plainText(res, n)).join("\n");
        expect(headers).toContain(documentHeaderLine(doc));
        expect(headers).toContain(` · ${stamp.label}`);
        const props = customProps(res);
        expect(props.cascadeVersion).toBe(stamp.label);
        expect(props.cascadeVersionSaved).toBe(stamp.saved || "not saved as a version");
        // No tag left unfilled anywhere in the package.
        for (const n of res.names.filter((x) => x.endsWith(".xml"))) expect(res.text(n), n).not.toContain("{{");
        writeFileSync(join(dir, `${name}-${kind}.docx`), out.bytes);
        writeFileSync(join(dir, `${name}-${kind}.html`), renderHtml(doc));
      }
    });
  }

  it("a document with no version history says so, and the file property says the same", async () => {
    const doc = builders.trd!();
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const res = strictDocx(out.bytes);
    expect(plainText(res)).toContain(NO_VERSION_HISTORY);
    expect(customProps(res).cascadeVersion).toBe(NO_VERSION_HISTORY);
    expect(documentHeaderLine(doc)).not.toContain("v1");
  });

  it("offers the version to the user's own template as two tags", () => {
    const doc = stampDocument(builders.trd!(), VIEWED);
    const tags = buildDocumentTagData(doc);
    expect(tags.version).toBe(VIEWED.row);
    expect(tags.versionLabel).toBe("v2");
    const none = buildDocumentTagData(builders.trd!());
    expect(none.version).toBe(NO_VERSION_HISTORY);
    expect(none.versionLabel).toBe("");
  });
});
