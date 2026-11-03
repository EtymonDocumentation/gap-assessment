import { buildBlankFormSpec, buildTrdFormSpec, classifyUpload, OTHER_LAYOUT_MESSAGE, sessionFromData, sessionFromForm, TrdImportError } from "@gap/engine";
import type { TrdDocument } from "@gap/process-model";
import { useRef, useState } from "react";
import { loadDocx } from "../docx-loader";
import { download } from "../lib";
import { navigate } from "../router";
import { content } from "../store";
import { holdImport } from "../trd-import-store";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The blank form (no TRD needed) or the form with what the TRD says so far. Both are the same Word file layout the upload reads back. */
export async function downloadTrdForm(d?: TrdDocument): Promise<void> {
  const m = await loadDocx();
  const spec = d ? buildTrdFormSpec(d) : buildBlankFormSpec(content.catalog);
  const bytes = m.buildTrdFormDocx(spec, { generatedAt: new Date().toISOString() });
  download(d ? `trd-form-${d.id}.docx` : "trd-blank-form.docx", bytes, DOCX_MIME);
}

export function TrdFormButton({ d, className = "btn", testId }: { d?: TrdDocument; className?: string; testId: string }) {
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={className}
        data-testid={testId}
        onClick={() => {
          setError("");
          downloadTrdForm(d).catch((e: Error) => setError(`The form could not be created: ${e.message}`));
        }}
      >
        {d ? "TRD form with what we know so far" : "Blank TRD form (Word)"}
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * "Upload a TRD": the one button for every kind of file. The site finds out by itself what the file is. A file it cannot read exactly
 * gets a plain message and the blank form as the way in (reading other layouts is a later step).
 */
export function TrdUploadButton({ className = "btn primary", testId = "trd-upload" }: { className?: string; testId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; offerForm: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    setMessage(null);
    if (!f) return;
    const kind = classifyUpload(f.name, f.size);
    if (!kind.ok) return setMessage({ text: kind.message, offerForm: false });
    if (kind.kind === "pdf") return setMessage({ text: OTHER_LAYOUT_MESSAGE, offerForm: true });
    setBusy(true);
    try {
      const m = await loadDocx();
      const read = m.readTrdUpload(new Uint8Array(await f.arrayBuffer()), f.name);
      if (!read.dataKind) return setMessage({ text: OTHER_LAYOUT_MESSAGE, offerForm: true });
      const session = read.dataKind === "trd-data" ? sessionFromData(read) : sessionFromForm(read);
      holdImport({ session, file: f });
      navigate("/trd/import");
    } catch (e) {
      const own = e instanceof TrdImportError || (e as Error).name === "TemplateError";
      setMessage({ text: own ? (e as Error).message : `The file could not be read: ${(e as Error).message}`, offerForm: true });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span className="upload-trd">
      <button type="button" className={className} onClick={() => input.current?.click()} disabled={busy} data-testid={testId}>
        {busy ? "Reading the file..." : "Upload a TRD"}
      </button>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept=".docx,.docm,.pdf,.doc,.rtf,.odt"
        aria-label="Choose a TRD file to upload (.docx or PDF, up to 25 MB)"
        tabIndex={-1}
        onChange={(e) => void onFile(e.target.files?.[0])}
        data-testid={`${testId}-input`}
      />
      {message && (
        <span className="notice upload-message block" role="alert" data-testid={`${testId}-message`}>
          {message.text}
          {message.offerForm && (
            <>
              {" "}
              <TrdFormButton className="btn small" testId={`${testId}-blank-form`} />
            </>
          )}
        </span>
      )}
    </span>
  );
}
