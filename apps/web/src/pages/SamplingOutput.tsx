import { buildSamplingPlanDocument, documentFingerprint, recordExport, samplingBasisText } from "@gap/engine";
import { PROCESS_MODEL_VERSION, SAMPLING_PLAN_FORMAT_VERSION, type DocumentExport, type SamplingPlan, type TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody } from "@gap/renderers";
import { SAMPLING_STATS_VERSION } from "@gap/sampling";
import { samplingSuggestions } from "@gap/content";
import { useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { loadDocx } from "../docx-loader";
import { APP_VERSION, download, today } from "../lib";
import { useContent, useStore } from "../store";
import { BUILTIN_RECORD, ExportHistory } from "./document-panels";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The sampling plan as a Word or HTML protocol draft, with a preview. Same rules as the other documents: the banner is in every
 * output, downloading with open items is allowed only after the person has seen the count, and each download is written to the
 * export history with the versions behind it.
 */
export function SamplingOutput({ plan }: { plan: SamplingPlan }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  // Fixed when the page opens so the preview and every download of this visit carry the same time.
  const [generatedAt] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const doc = useMemo(() => buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { generatedAt, appVersion: APP_VERSION }), [content, project, plan, generatedAt]);
  const body = useMemo(() => (showPreview ? renderHtmlBody(doc) : ""), [doc, showPreview]);
  const stamp = `${project.meta.id}-${plan.id}-${today()}`;
  const tbd = doc.tbdCount ?? 0;

  const [pending, setPending] = useState<(() => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const guard = (run: () => void) => {
    if (tbd > 0) {
      opener.current = document.activeElement as HTMLElement | null;
      setPending(() => run);
    } else run();
  };

  const record = (format: DocumentExport["format"], template: TemplateRecord) =>
    update(
      (p, actor) =>
        recordExport(p, {
          at: new Date().toISOString(),
          by: actor.name,
          format,
          template,
          fingerprint: documentFingerprint(doc),
          tbdCount: tbd,
          versions: { processModel: PROCESS_MODEL_VERSION, catalog: content.versions.catalog, format: SAMPLING_PLAN_FORMAT_VERSION, stats: SAMPLING_STATS_VERSION, suggestions: samplingSuggestions.catalog.version },
        }),
      "Download recorded in the export history",
    );

  const saved = (file: string) => setDone(`Saved ${file}. The download is recorded in the export history below.`);

  async function exportWord() {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const m = await loadDocx();
      try {
        const res = await m.renderDocx({ doc, mode: "builtin", generatedAt });
        const file = `sampling-plan-${stamp}.docx`;
        download(file, res.bytes, DOCX_MIME);
        record("sampling-plan-docx", res.templateRecord);
        saved(file);
      } catch (e) {
        setError(`The Word document could not be created: ${(e as Error).message}`);
      }
    } catch (e) {
      setError(`The Word tools could not be loaded: ${(e as Error).message}. Check your connection and reload the page.`);
    } finally {
      setBusy(false);
    }
  }

  const exports = project.document.exports.filter((x) => x.format.startsWith("sampling-plan-"));

  return (
    <>
      <section className="card stack no-print" aria-labelledby="sp-doc" data-testid="sampling-output">
        <h2 id="sp-doc">Sampling plan document</h2>
        <p>
          {samplingBasisText(project.meta.id)} The document shows each sample size with its working and the source of the method. It states no filing category; where a filing question arises it reads "Requires regulatory affairs assessment".
        </p>
        <div className="row wrap">
          <button type="button" className="btn primary" disabled={busy} onClick={() => guard(() => void exportWord())} data-testid="sampling-download-word">
            {busy ? "Creating the Word document..." : "Download Word"}
          </button>
          <button
            type="button"
            className="btn"
            data-testid="sampling-download-html"
            onClick={() =>
              guard(() => {
                const file = `sampling-plan-${stamp}.html`;
                download(file, renderHtml(doc), "text/html;charset=utf-8");
                record("sampling-plan-html", BUILTIN_RECORD);
                saved(file);
              })
            }
          >
            Download HTML
          </button>
          <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)} data-testid="sampling-preview-toggle">
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <p className="small muted" data-testid="sampling-open-count">
          {tbd === 0 ? "No open items." : `${tbd} open ${tbd === 1 ? "item" : "items"} will be listed in the document.`} The banner "Proof of concept. Not validated. Not for GMP use." is in every output.
        </p>
        <div role="status" aria-live="polite">
          {done && <p data-testid="sampling-done">{done}</p>}
        </div>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
      </section>

      <ExportHistory exports={exports} />

      {showPreview && (
        <section className="stack" aria-labelledby="sp-preview">
          <h2 id="sp-preview" className="no-print">
            Document preview
          </h2>
          <style>{DOCUMENT_CSS}</style>
          {/* Built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
          <div className="doc-preview" data-testid="sampling-preview" dangerouslySetInnerHTML={{ __html: body }} />
        </section>
      )}

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with open items?"
          description={`This plan still lists ${tbd} open ${tbd === 1 ? "item" : "items"}. They are listed in the document as open, not as decided.`}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            <p data-testid="sampling-tbd-warning">
              The download will record that <strong>{tbd} open {tbd === 1 ? "item was" : "items were"}</strong> listed when it was made.
            </p>
            <div className="row end">
              <button type="button" className="btn" autoFocus onClick={() => setPending(null)}>
                Go back
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const run = pending;
                  setPending(null);
                  run();
                }}
              >
                Download anyway
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
