import { loadDocx } from "./docx-loader";
import { newTemplateId, useTemplates, type StoredTemplate } from "./templates-store";

/** The words the Templates page and step 1 of the TRD start path both use for the sample, so the two never drift apart. */
export const SAMPLE_BUTTON_TEXT = "Add a sample template (fictional)";
export const SAMPLE_BUTTON_HELP = "A made-up company's Word template with seven headings, to try \"A template's headings\" without a file of your own. It is fictional.";

export type SampleResult = { added: true; name: string } | { added: false; name: string; version: string };

/**
 * Adds the fictional sample template ("Harbourlight SOP (fictional)") to the library. Adding it twice leaves one copy: the file is the same every
 * time, so the library's checksum test (the one every upload goes through) finds it and says it is already there. Nothing is chosen for the person:
 * they still pick the template in step 1 and confirm the match.
 */
export async function addSampleHeadingsTemplate(): Promise<SampleResult> {
  const m = await loadDocx();
  const imp = await m.importTemplateFile(m.SAMPLE_HEADINGS_FILE_NAME, m.buildSampleHeadingsTemplate());
  const store = useTemplates.getState();
  await store.load();
  const dup = useTemplates.getState().items.find((i) => i.sha256 === imp.sha256);
  if (dup) return { added: false, name: dup.name, version: dup.version };
  const stored: StoredTemplate = {
    id: newTemplateId(),
    name: m.SAMPLE_HEADINGS_NAME,
    version: "1",
    fileName: m.SAMPLE_HEADINGS_FILE_NAME,
    sourceFormat: imp.analysis.sourceFormat,
    sha256: imp.sha256,
    storedSha256: imp.storedSha256,
    addedAt: new Date().toISOString(),
    bytes: imp.bytes,
    analysis: imp.analysis,
  };
  await useTemplates.getState().add(stored);
  return { added: true, name: stored.name };
}

/** The line shown after the button was used. */
export const sampleNotice = (r: SampleResult): string =>
  r.added ? `Sample template "${r.name}" added to the library. It is fictional.` : `The sample template is already in the library as "${r.name}" (version ${r.version}).`;
