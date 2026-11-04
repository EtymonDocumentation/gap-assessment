import { samplingImportSynonyms, samplingSuggestions } from "@gap/content";
import { buildBlankSamplingFormSpec, buildSamplingFormSpec, samplingSessionFromData, samplingSessionFromForm, samplingSessionFromOther, SamplingImportError, stepNamesFor, unitOpLabels } from "@gap/engine";
import type { SamplingPlan } from "@gap/process-model";
import { useRef, useState } from "react";
import { loadDocx } from "../docx-loader";
import { readUploadFile } from "../import-file";
import { download } from "../lib";
import { navigate } from "../router";
import { content, useStore } from "../store";
import { holdSamplingImport } from "../sampling-import-store";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The blank form, or the form with what the plan says so far. Both are the same Word file layout the upload reads back. */
export async function downloadSamplingForm(plan?: SamplingPlan): Promise<void> {
  const project = useStore.getState().project;
  if (!project) throw new Error("Open a project first.");
  const m = await loadDocx();
  const steps = stepNamesFor(content, project, plan);
  const spec = plan ? buildSamplingFormSpec(project, plan, unitOpLabels(content, project), steps) : buildBlankSamplingFormSpec(steps);
  const bytes = m.buildSamplingFormDocx(spec, { generatedAt: new Date().toISOString() });
  download(plan ? `sampling-form-${plan.id}.docx` : "sampling-blank-form.docx", bytes, DOCX_MIME);
}

export function SamplingFormButton({ plan, className = "btn", testId }: { plan?: SamplingPlan; className?: string; testId: string }) {
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={className}
        data-testid={testId}
        onClick={() => {
          setError("");
          downloadSamplingForm(plan).catch((e: Error) => setError(`The form could not be created: ${e.message}`));
        }}
      >
        {plan ? "Sampling plan form with what we know so far" : "Blank sampling plan form (Word)"}
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
 * "Upload a sampling plan": one button for every kind of file, as on the TRD page. Our own export and our fill-in form are read exactly
 * (levels 1 and 2); any other Word or PDF is read by fixed rules and every match is a suggestion (level 3).
 */
export function SamplingUploadButton({ className = "btn primary", testId = "sampling-upload" }: { className?: string; testId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; offerForm: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    setMessage(null);
    if (!f) return;
    setBusy(true);
    try {
      const r = await readUploadFile(f, "fill in the blank sampling plan form (Word) with the values from your document.");
      if (!r.ok) return setMessage({ text: r.message, offerForm: r.offerForm });
      const read = r.read;
      if (read.dataKind?.startsWith("trd")) return setMessage({ text: "This file is a TRD made by this tool. Upload it on the TRD page instead.", offerForm: false });
      const session = !read.dataKind
        ? samplingSessionFromOther(read, { syn: samplingImportSynonyms, steps: content.catalog.unitOperations.map((u) => ({ key: u.key, label: u.label })), tests: samplingSuggestions.candidates })
        : read.dataKind === "sampling-data"
          ? samplingSessionFromData(read, samplingImportSynonyms)
          : samplingSessionFromForm(read, samplingImportSynonyms);
      holdSamplingImport({ session, file: f });
      navigate("/sampling/import");
    } catch (e) {
      const own = e instanceof SamplingImportError || (e as Error).name === "TemplateError";
      setMessage({ text: own ? (e as Error).message : `The file could not be read: ${(e as Error).message}`, offerForm: true });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span className="upload-trd">
      <button type="button" className={className} onClick={() => input.current?.click()} disabled={busy} data-testid={testId}>
        {busy ? "Reading the file..." : "Upload a sampling plan"}
      </button>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept=".docx,.docm,.pdf,.doc,.rtf,.odt"
        aria-label="Choose a sampling plan file to upload (.docx or PDF, up to 25 MB)"
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
              <SamplingFormButton className="btn small" testId={`${testId}-blank-form`} />
            </>
          )}
        </span>
      )}
    </span>
  );
}
