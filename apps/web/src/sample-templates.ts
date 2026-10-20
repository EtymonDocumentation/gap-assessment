import { FIXTURE_FILES, FIXTURE_LABELS, type FixtureKey } from "@gap/docx/src/fixtures";
import macroUrl from "../../../packages/docx/fixtures/brightwater-macro.docm?url";
import outlineUrl from "../../../packages/docx/fixtures/brightwater-outline.pdf?url";
import tagsUrl from "../../../packages/docx/fixtures/brightwater-tags.docx?url";
import templateUrl from "../../../packages/docx/fixtures/brightwater-template.docx?url";

/** The four fictional Brightwater sample templates. Only their addresses are imported here; the files load when asked for. */
export const SAMPLE_TEMPLATES: { key: FixtureKey; fileName: string; name: string; url: string }[] = [
  { key: "template", fileName: FIXTURE_FILES.template, name: FIXTURE_LABELS.template, url: templateUrl },
  { key: "tags", fileName: FIXTURE_FILES.tags, name: FIXTURE_LABELS.tags, url: tagsUrl },
  { key: "macro", fileName: FIXTURE_FILES.macro, name: FIXTURE_LABELS.macro, url: macroUrl },
  { key: "outline", fileName: FIXTURE_FILES.outline, name: FIXTURE_LABELS.outline, url: outlineUrl },
];

export async function fetchSample(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The sample file could not be loaded (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}
