import { gapImportSynonyms } from "@gap/content";
import { buildBlankGapFormSpec, buildGapFormSpec, gapSessionFromData, gapSessionFromForm, gapSessionFromOther, GapImportError } from "@gap/engine";
import { useRef, useState } from "react";
import { loadDocx } from "../docx-loader";
import { holdGapImport } from "../gap-import-store";
import { readUploadFile } from "../import-file";
import { download } from "../lib";
import { navigate } from "../router";
import { content, useStore } from "../store";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The blank gap assessment form, or the form with the answers the open project holds so far: the same Word layout the upload reads back. */
export async function downloadGapForm(prefilled: boolean): Promise<void> {
  const project = useStore.getState().project;
  if (prefilled && !project) throw new Error("Open a project first.");
  const m = await loadDocx();
  const spec = prefilled && project ? buildGapFormSpec(content, project) : buildBlankGapFormSpec(content);
  const bytes = m.buildGapFormDocx(spec, { generatedAt: new Date().toISOString() });
  download(prefilled ? "gap-assessment-form.docx" : "gap-assessment-blank-form.docx", bytes, DOCX_MIME);
}

export function GapFormButton({ prefilled, className = "btn", testId }: { prefilled?: boolean; className?: string; testId: string }) {
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={className}
        data-testid={testId}
        onClick={() => {
          setError("");
          downloadGapForm(!!prefilled).catch((e: Error) => setError(`The form could not be created: ${e.message}`));
        }}
      >
        {prefilled ? "Gap assessment form with my answers so far" : "Blank gap assessment form (Word)"}
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
 * "Upload a gap assessment": one button for every kind of file, as on the TRD and sampling pages. Our own Word export and our fill-in form
 * are read exactly (levels 1 and 2); any other Word or PDF is read by fixed rules and every match is a suggestion (level 3). It works
 * with no project open (the upload then makes a new project) and with one open (the upload can update it).
 */
export function GapUploadButton({ className = "btn primary", testId = "gap-upload" }: { className?: string; testId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; offerForm: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    setMessage(null);
    if (!f) return;
    setBusy(true);
    try {
      const r = await readUploadFile(f, "fill in the blank gap assessment form (Word) with the answers from your document.");
      if (!r.ok) return setMessage({ text: r.message, offerForm: r.offerForm });
      const read = r.read;
      if (read.dataKind?.startsWith("trd")) return setMessage({ text: "This file is a TRD made by this tool. Upload it on the TRD page instead.", offerForm: false });
      if (read.dataKind?.startsWith("sampling")) return setMessage({ text: "This file is a sampling plan made by this tool. Upload it on the Sampling plan page instead.", offerForm: false });
      const session = !read.dataKind ? gapSessionFromOther(read, content, gapImportSynonyms) : read.dataKind === "gap-data" ? gapSessionFromData(read, content, gapImportSynonyms) : gapSessionFromForm(read, content, gapImportSynonyms);
      holdGapImport({ session, file: f });
      navigate("/gap/import");
    } catch (e) {
      const own = e instanceof GapImportError || (e as Error).name === "TemplateError";
      setMessage({ text: own ? (e as Error).message : `The file could not be read: ${(e as Error).message}`, offerForm: true });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span className="upload-trd">
      <button type="button" className={className} onClick={() => input.current?.click()} disabled={busy} data-testid={testId}>
        {busy ? "Reading the file..." : "Upload a gap assessment"}
      </button>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept=".docx,.docm,.pdf,.doc,.rtf,.odt"
        aria-label="Choose a gap assessment file to upload (.docx or PDF, up to 25 MB)"
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
              <GapFormButton className="btn small" testId={`${testId}-blank-form`} />
            </>
          )}
        </span>
      )}
    </span>
  );
}
