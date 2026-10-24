import { buildCmoInstructionsDocument, buildSamplingPlanDocument, CMO_INSTRUCTIONS_TITLE, documentFingerprint, recordExport, samplingBasisText } from "@gap/engine";
import { PROCESS_MODEL_VERSION, SAMPLING_PLAN_FORMAT_VERSION, type DocumentExport, type SamplingPlan, type TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody } from "@gap/renderers";
import { SAMPLING_STATS_VERSION } from "@gap/sampling";
import { samplingSuggestions } from "@gap/content";
import { useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { APP_VERSION, download, today } from "../lib";
import { useContent, useStore } from "../store";
import { BUILTIN_RECORD, ExportHistory, GENERIC_MODES, useWordChoice, WordPanel } from "./document-panels";

/**
 * The sampling plan as a Word or HTML protocol draft, with a preview. Same rules as the other documents: the banner is in every
 * output, downloading with open items is allowed only after the person has seen the count, and each download is written to the
 * export history with the versions behind it.
 */
export function SamplingOutput({ plan }: { plan: SamplingPlan }) {
  return (
    <>
      <OutputCard plan={plan} variant="plan" />
      <OutputCard plan={plan} variant="cmo" />
    </>
  );
}

const SAMPLING_WORD_NOTE =
  `"Map to their headings" is offered for the gap assessment document only: a saved mapping names the gap document's sections. For a tagged template, {title}, {banner}, {status}, {generated}, {meta} and {sections} are filled, and {@body} brings in the document in your template's styles. The parties from "Who does what" are available as {#parties}, {#fromParties}, {#toParties} and {#ccParties} (name, role, department), and as {sendingUnit}, {receivingSite}, {cmoName} and {sponsorName}; the Templates page lists every tag.`;

/** One document card. The CMO reporting instructions are a second output of the same plan, with their own export-history kinds. */
function OutputCard({ plan, variant }: { plan: SamplingPlan; variant: "plan" | "cmo" }) {
  const cmo = variant === "cmo";
  const p = cmo ? "cmo" : "sampling";
  const kindPrefix = cmo ? "sampling-cmo-instructions-" : "sampling-plan-";
  const filePrefix = cmo ? "cmo-instructions" : "sampling-plan";
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  // Fixed when the page opens so the preview and every download of this visit carry the same time.
  const [generatedAt] = useState(() => new Date().toISOString());
  const [done, setDone] = useState("");
  const choice = useWordChoice();
  const [showPreview, setShowPreview] = useState(false);

  const doc = useMemo(() => (cmo ? buildCmoInstructionsDocument : buildSamplingPlanDocument)(content, project, plan, samplingSuggestions, { generatedAt, appVersion: APP_VERSION }), [content, project, plan, generatedAt, cmo]);
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

  const exports = project.document.exports.filter((x) => x.format.startsWith(kindPrefix));

  return (
    <>
      <section className="card stack no-print" aria-labelledby={`${p}-doc`} data-testid={`${p}-output`}>
        <h2 id={`${p}-doc`}>{cmo ? CMO_INSTRUCTIONS_TITLE : "Sampling plan document"}</h2>
        {cmo ? (
          <p>The reporting instructions of every sampling point, in plan order, with the custom subsections marked for the CMO and the agency requests the points answer. It carries the plan fingerprint so the CMO can see which plan version it belongs to. It contains no sample-size working.</p>
        ) : (
          <p>
            {samplingBasisText(project.meta.id)} The document shows each sample size with its working and the source of the method. It states no filing category; where a filing question arises it reads "Requires regulatory affairs assessment".
          </p>
        )}
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            data-testid={`${p}-download-html`}
            onClick={() =>
              guard(() => {
                const file = `${filePrefix}-${stamp}.html`;
                download(file, renderHtml(doc), "text/html;charset=utf-8");
                record(`${kindPrefix}html` as DocumentExport["format"], BUILTIN_RECORD);
                saved(file);
              })
            }
          >
            Download HTML
          </button>
          <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)} data-testid={`${p}-preview-toggle`}>
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <p className="small muted" data-testid={`${p}-open-count`}>
          {tbd === 0 ? "No open items." : `${tbd} open ${tbd === 1 ? "item" : "items"} will be listed in the document.`} The banner "Proof of concept. Not validated. Not for GMP use." is in every output.
        </p>
        <div role="status" aria-live="polite">
          {done && <p data-testid={`${p}-done`}>{done}</p>}
        </div>
      </section>

      <WordPanel
        choice={choice}
        doc={doc}
        content={content}
        project={project}
        generatedAt={generatedAt}
        fileBase={`${filePrefix}-${stamp}`}
        guard={guard}
        onExported={(template) => record(`${kindPrefix}docx` as DocumentExport["format"], template)}
        modes={GENERIC_MODES}
        tagData={(m) => m.buildSamplingTagData(doc, project, plan)}
        testIdPrefix={p}
        idPrefix={`${p}-word`}
        title={cmo ? "Word document: reporting instructions" : "Word document: sampling plan"}
        note={SAMPLING_WORD_NOTE}
      />

      <ExportHistory exports={exports} idPrefix={`${p}-export-history`} title={cmo ? "CMO instructions export history" : "Export history"} />

      {showPreview && (
        <section className="stack" aria-labelledby={`${p}-preview`}>
          <h2 id={`${p}-preview`} className="no-print">
            Document preview
          </h2>
          <style>{DOCUMENT_CSS}</style>
          {/* Built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
          <div className="doc-preview" data-testid={`${p}-preview`} dangerouslySetInnerHTML={{ __html: body }} />
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
            <p data-testid={`${p}-tbd-warning`}>
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
