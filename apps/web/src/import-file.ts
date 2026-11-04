import { classifyUpload, SCANNED_PDF_MESSAGE, type UploadRead } from "@gap/engine";
import { loadDocx } from "./docx-loader";

export type FileReadResult = { ok: true; read: UploadRead } | { ok: false; message: string; offerForm: boolean };

/**
 * Reads a file chosen for any "upload a finished document" feature: the file rules, then Word or PDF. The site finds out by itself what
 * the file is; the caller decides what the data part (if any) means. `blankHint` finishes the "no text" message for the caller's form.
 */
export async function readUploadFile(f: File, blankHint: string): Promise<FileReadResult> {
  const kind = classifyUpload(f.name, f.size);
  if (!kind.ok) return { ok: false, message: kind.message, offerForm: false };
  const m = await loadDocx();
  const bytes = new Uint8Array(await f.arrayBuffer());
  const read = kind.kind === "pdf" ? await m.readPdfUpload(bytes, f.name) : m.readUpload(bytes, f.name);
  if (read.noText) return { ok: false, message: SCANNED_PDF_MESSAGE, offerForm: true };
  if (!read.dataKind && read.blocks.length === 0) return { ok: false, message: `No text could be read from this file. Check that it is the right file, or ${blankHint}`, offerForm: true };
  return { ok: true, read };
}
