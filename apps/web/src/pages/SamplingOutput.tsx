import { DocPreview } from "../DocPreview";
import { buildCmoInstructionsDocument, buildSamplingBomDocument, buildSamplingData, buildSamplingPlanDocument, CMO_INSTRUCTIONS_TITLE, documentFingerprint, projectLabel, recordExport, samplingBasisText, stampDocument } from "@gap/engine";
import { PROCESS_MODEL_VERSION, SAMPLING_PLAN_FORMAT_VERSION, type DocumentExport, type SamplingPlan, type TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlPreview } from "@gap/renderers";
import { FIGURE_STYLE_LABEL, FIGURE_STYLES, SAMPLING_STATS_VERSION, type FigureStyle } from "@gap/sampling";
import { useEffectiveSuggestions } from "../expected-studies-store";
import { useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { APP_VERSION, download, projectFileStem, today } from "../lib";
import { useContent, useStore } from "../store";
import { useVersionStamp } from "../version-ui";
import { SamplingBomView } from "./SamplingBomView";
import { BUILTIN_RECORD, ExportHistory, exportsOfDocument, GENERIC_MODES, useWordChoice, WordPanel } from "./document-panels";

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

/** The sampling bill of materials: a document of its own, with its own page (a tab of the plan), downloads and export history. */
export function SamplingBomOutput({ plan }: { plan: SamplingPlan }) {
  return <OutputCard plan={plan} variant="bom" />;
}

const SAMPLING_WORD_NOTE =
  `"A template's headings" is offered for the gap assessment document only: a saved heading placement names the gap document's sections. For a tagged template, {title}, {banner}, {status}, {generated}, {meta}, {sections} and the project tags ({program}, {modality}, {sourceSite}, {targetSite} and the like) are filled, and {@body} brings in the document in your template's styles. The parties from "Who does what" are available as {#parties}, {#fromParties}, {#toParties} and {#ccParties} (name, role, department), and as {sendingUnit}, {receivingSite}, {cmoName} and {sponsorName}; the Templates page lists every tag.`;

/** One document card. The CMO reporting instructions are a second output of the same plan, with their own export-history kinds. */
function OutputCard({ plan, variant }: { plan: SamplingPlan; variant: "plan" | "cmo" | "bom" }) {
  const cmo = variant === "cmo";
  const bom = variant === "bom";
  const p = bom ? "bom" : cmo ? "cmo" : "sampling";
  const kindPrefix = bom ? "sampling-bom-" : cmo ? "sampling-cmo-instructions-" : "sampling-plan-";
  const filePrefix = bom ? "sampling-bom" : cmo ? "cmo-instructions" : "sampling-plan";
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  // Fixed when the page opens so the preview and every download of this visit carry the same time.
  const [generatedAt] = useState(() => new Date().toISOString());
  const [done, setDone] = useState("");
  const choice = useWordChoice();
  const [showPreview, setShowPreview] = useState(false);
  // One figure style per export (Word and HTML alike); it is an export choice, not stored in the plan.
  const [figureStyle, setFigureStyle] = useState<FigureStyle>("time_scale");

  const versionStamp = useVersionStamp();
  const samplingSuggestions = useEffectiveSuggestions();
  const doc = useMemo(() => stampDocument((bom ? buildSamplingBomDocument : cmo ? buildCmoInstructionsDocument : buildSamplingPlanDocument)(content, project, plan, samplingSuggestions, { generatedAt, appVersion: APP_VERSION, ...(cmo || bom ? {} : { figureStyle }) }), versionStamp), [content, project, plan, samplingSuggestions, generatedAt, cmo, bom, figureStyle, versionStamp]);
  const body = useMemo(() => (showPreview ? renderHtmlPreview(doc) : ""), [doc, showPreview]);
  // The plan can be downloaded with each flow figure style; the style is in the name so the three files do not overwrite one another.
  const stamp = `${projectFileStem(project.meta)}-${plan.id}${cmo || bom ? "" : `-${figureStyle.replace(/_/g, "-")}`}-${today()}`;
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
          documentId: plan.id,
          fingerprint: documentFingerprint(doc),
          tbdCount: tbd,
          versions: { processModel: PROCESS_MODEL_VERSION, catalog: content.versions.catalog, format: SAMPLING_PLAN_FORMAT_VERSION, stats: SAMPLING_STATS_VERSION, suggestions: samplingSuggestions.catalog.version },
        }),
      "Download recorded in the export history",
    );

  // "Recorded" is only said when the history really took the entry; a problem is shown in its place.
  const saved = (file: string, problem?: string | null) => setDone(problem ? `Saved ${file}. This download is not in the export history. ${problem}` : `Saved ${file}. The download is recorded in the export history below.`);

  const exports = exportsOfDocument(project.document.exports, (f) => f.startsWith(kindPrefix), plan.id, project.sampling.plans.length === 1);

  return (
    <>
      {bom && <SamplingBomView doc={doc} />}
      <section className="card stack no-print" aria-labelledby={`${p}-doc`} data-testid={`${p}-output`}>
        <h2 id={`${p}-doc`}>{bom ? "Download the bill of materials" : cmo ? CMO_INSTRUCTIONS_TITLE : "Sampling plan document"}</h2>
        {bom ? (
          <p>The same list as above, as a Word or an HTML file. It carries the drafting-aid notice and the plan version, and it is added to the export history.</p>
        ) : cmo ? (
          <p>The reporting instructions of every sampling point, in plan order, with the custom subsections marked for the CMO and the agency requests the points answer. It carries the plan fingerprint so the CMO can see which plan version it belongs to. It contains no sample-size working.</p>
        ) : (
          <p>
            {samplingBasisText(projectLabel(project.meta))} The document shows each sample size with its working and the source of the method. It states no filing category; where a filing question arises it reads "Requires regulatory affairs assessment".
          </p>
        )}
        {!cmo && !bom && (
          <fieldset className="stack" data-testid="figure-style-choice">
            <legend>Document figure in the downloaded file</legend>
            {/* One option per line: the options are inline, so "No figure" used to run into the hint that followed. */}
            {FIGURE_STYLES.map((s) => (
              <div key={s}>
                <label className="check">
                  <input type="radio" name="export-figure-style" value={s} checked={figureStyle === s} onChange={() => setFigureStyle(s)} data-testid={`export-figure-${s}`} />
                  <span>{FIGURE_STYLE_LABEL[s]}</span>
                </label>
              </div>
            ))}
            <p className="muted small">One choice per download. It applies to the Word and the HTML file and is not stored in the plan.</p>
          </fieldset>
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
                saved(file, record(`${kindPrefix}html` as DocumentExport["format"], BUILTIN_RECORD));
              })
            }
          >
            {bom ? "Download bill of materials (HTML)" : cmo ? "Download reporting instructions (HTML)" : "Download sampling plan (HTML)"}
          </button>
          {!bom && <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)} data-testid={`${p}-preview-toggle`}>
            {showPreview ? "Hide preview" : "Show preview"}
          </button>}
        </div>
        <p className="small muted" data-testid={`${p}-open-count`}>
          {bom
            ? tbd === 0
              ? "Nothing is still to be stated."
              : `${tbd} ${tbd === 1 ? "item" : "items"} still to be stated will be listed in the document.`
            : tbd === 0
              ? "No open items."
              : `${tbd} open ${tbd === 1 ? "item" : "items"} will be listed in the document.`}{" "}
          The drafting-aid notice is in every output.
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
        tagData={(m) => m.buildSamplingTagData(doc, project, plan, content)}
        {...(cmo || bom ? {} : { dataPart: () => ({ kind: "sampling-data" as const, json: buildSamplingData(content, project, plan, doc) }) })}
        testIdPrefix={p}
        idPrefix={`${p}-word`}
        title={bom ? "Word document: bill of materials" : cmo ? "Word document: reporting instructions" : "Word document: sampling plan"}
        buttonLabel={bom ? "Download bill of materials (Word)" : cmo ? "Download reporting instructions (Word)" : "Download sampling plan (Word)"}
        note={SAMPLING_WORD_NOTE}
      />

      <ExportHistory exports={exports} idPrefix={`${p}-export-history`} title={bom ? "Bill of materials export history" : cmo ? "CMO instructions export history" : "Export history"} />

      {showPreview && (
        <section className="stack" aria-labelledby={`${p}-preview`}>
          <h2 id={`${p}-preview`} className="no-print">
            Document preview
          </h2>
          <style>{DOCUMENT_CSS}</style>
          {/* Built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
          <DocPreview html={body} testId={`${p}-preview`} />
        </section>
      )}

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with open items?"
          description={bom ? `This list still has ${tbd} ${tbd === 1 ? "item" : "items"} to be stated, so it is not complete. They are listed in the document as open.` : `This plan still lists ${tbd} open ${tbd === 1 ? "item" : "items"}. They are listed in the document as open, not as decided.`}
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
