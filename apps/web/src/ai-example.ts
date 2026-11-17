import { overlayAiReading, sessionFromOther, type ImportSession } from "@gap/engine";
import { trdImportSynonyms } from "@gap/content";
import { loadDocx } from "./docx-loader";
import { content } from "./store";

/**
 * "Try the AI reading on an example TRD" (job AI1). The example finished TRD is a static Word file shipped with the site; the AI reading
 * of it was recorded in advance (content/ai-reading/example-trd.yaml). Nothing is sent anywhere and no AI runs: the file is fetched from
 * the site itself, read by the same reader and fixed rules as any upload (level 3), and the recorded suggestions are laid on top.
 * Works the same in the browser-only site and with the server.
 */
export const EXAMPLE_TRD_FILE = "example-finished-trd.docx";
export const EXAMPLE_TRD_URL = `${import.meta.env.BASE_URL}examples/${EXAMPLE_TRD_FILE}`;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The review session of the example, and the file it was read from (held like an uploaded file). */
export async function buildAiExample(): Promise<{ session: ImportSession; file: File }> {
  const res = await fetch(EXAMPLE_TRD_URL);
  if (!res.ok) throw new Error(`the example file could not be loaded (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // The recording is a separate download, only fetched when someone asks for the example.
  const [m, { exampleTrdReading }] = await Promise.all([loadDocx(), import("@gap/content/ai-reading/index")]);
  const read = m.readUpload(bytes, EXAMPLE_TRD_FILE);
  const base = sessionFromOther(read, content.catalog, trdImportSynonyms);
  const { session, skipped } = overlayAiReading(base, exampleTrdReading);
  // A recorded suggestion that cannot be shown with its passage is left out; a broken recording is worth knowing about.
  if (skipped.length > 0) console.warn("AI reading: suggestions left out", skipped);
  return { session, file: new File([bytes], EXAMPLE_TRD_FILE, { type: DOCX_MIME }) };
}
