import { DocPreview } from "../DocPreview";
import { buildRiskAssessmentDocument, documentFingerprint, projectLabel, recordExport, RISK_OPTIONAL_SECTIONS, riskBasisText, type RiskOptionalSection, stampDocument, updateAssessment } from "@gap/engine";
import { failureModes } from "@gap/content";
import { PROCESS_MODEL_VERSION, RISK_FORMAT_VERSION, type DocumentExport, type RiskApproval, type RiskAssessment, type TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlPreview } from "@gap/renderers";
import { RISK_SCORING_VERSION } from "@gap/risk";
import { useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { APP_VERSION, download, projectFileStem, today } from "../lib";
import { useContent, useStore } from "../store";
import { useVersionStamp } from "../version-ui";
import { BUILTIN_RECORD, ExportHistory, exportsOfDocument, GENERIC_MODES, useWordChoice, WordPanel } from "./document-panels";
import type { Run } from "./SamplingFlow";

/**
 * Step 4 of a risk assessment: the Word or HTML draft, with a preview. Same rules as the sampling plan document: the banner is in
 * every output, a download with open items is allowed only after the person has seen the count, and each download is written to the
 * export history with the versions behind it. The document never says a risk is acceptable and never approves itself.
 */
export function RiskOutput({ a, run }: { a: RiskAssessment; run: Run }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  // Fixed when the page opens so the preview and every download of this visit carry the same time.
  const [generatedAt] = useState(() => new Date().toISOString());
  const [done, setDone] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  // Optional sections are chosen per export. All are in unless the person leaves one out.
  const [omit, setOmit] = useState<RiskOptionalSection[]>([]);

  const choice = useWordChoice();
  const versionStamp = useVersionStamp();
  const doc = useMemo(() => stampDocument(buildRiskAssessmentDocument(content, project, a, failureModes, { generatedAt, appVersion: APP_VERSION, omit }), versionStamp), [content, project, a, generatedAt, omit, versionStamp]);
  const body = useMemo(() => (showPreview ? renderHtmlPreview(doc) : ""), [doc, showPreview]);
  const stamp = `${projectFileStem(project.meta)}-${a.id}-${today()}`;
  const tbd = doc.tbdCount ?? 0;

  const [pending, setPending] = useState<(() => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const guard = (go: () => void) => {
    if (tbd > 0) {
      opener.current = document.activeElement as HTMLElement | null;
      setPending(() => go);
    } else go();
  };

  const record = (format: DocumentExport["format"], template: TemplateRecord) =>
    update(
      (p, actor) =>
        recordExport(p, {
          at: new Date().toISOString(),
          by: actor.name,
          format,
          template,
          documentId: a.id,
          fingerprint: documentFingerprint(doc),
          tbdCount: tbd,
          versions: { processModel: PROCESS_MODEL_VERSION, catalog: content.versions.catalog, format: RISK_FORMAT_VERSION, stats: RISK_SCORING_VERSION, suggestions: failureModes.catalog.version },
        }),
      "Download recorded in the export history",
    );
  // "Recorded" is only said when the history really took the entry; a problem is shown in its place.
  const saved = (file: string, problem?: string | null) => setDone(problem ? `Saved ${file}. This download is not in the export history. ${problem}` : `Saved ${file}. The download is recorded in the export history below.`);

  const exports = exportsOfDocument(project.document.exports, (f) => f.startsWith("risk-assessment-"), a.id, project.risk.assessments.length === 1);

  return (
    <>
      <ApprovalsCard a={a} run={run} />
      <section className="card stack no-print" aria-labelledby="risk-doc" data-testid="risk-output">
        <h2 id="risk-doc">Risk assessment document</h2>
        <p>
          {riskBasisText(projectLabel(project.meta))} The document describes the method from your entries, lists every item with its working, the actions, the open items and the traceability. It says no risk is acceptable and states no filing category.
        </p>
        <fieldset className="fs stack" data-testid="risk-sections">
          <legend>Optional sections in this download</legend>
          <p className="muted small">The method, the register and the open items are always in the document.</p>
          {RISK_OPTIONAL_SECTIONS.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={!omit.includes(s.id)} data-testid={`risk-section-${s.id}`} onChange={(e) => setOmit(e.target.checked ? omit.filter((x) => x !== s.id) : [...omit, s.id])} /> <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            data-testid="risk-download-html"
            onClick={() =>
              guard(() => {
                const file = `risk-assessment-${stamp}.html`;
                download(file, renderHtml(doc), "text/html;charset=utf-8");
                saved(file, record("risk-assessment-html", BUILTIN_RECORD));
              })
            }
          >
            Download risk assessment (HTML)
          </button>
          <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)} data-testid="risk-preview-toggle">
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <p className="small muted" data-testid="risk-open-count">
          {tbd === 0 ? "No open items." : `${tbd} open ${tbd === 1 ? "item" : "items"} will be listed in the document.`} The drafting-aid notice is in every output.
        </p>
        <div role="status" aria-live="polite">
          {done && <p data-testid="risk-done">{done}</p>}
        </div>
      </section>

      <WordPanel
        choice={choice}
        doc={doc}
        content={content}
        project={project}
        generatedAt={generatedAt}
        fileBase={`risk-assessment-${stamp}`}
        guard={guard}
        onExported={(template) => record("risk-assessment-docx", template)}
        modes={GENERIC_MODES}
        tagData={(m) => m.buildDocumentTagData(doc, content, project)}
        testIdPrefix="risk"
        buttonLabel="Download risk assessment (Word)"
        note={'"A template\'s headings" is offered for the gap assessment document only: a saved heading placement names the gap document\'s sections. For a tagged template, {title}, {banner}, {status}, {generated}, {meta}, {sections} and the project tags ({program}, {modality}, {sourceSite}, {targetSite} and the like) are filled, and {@body} or a section tag such as {@section_register} brings in the risk assessment in your template\'s styles.'}
      />

      <ExportHistory exports={exports} idPrefix="risk-export-history" title="Export history" />

      {showPreview && (
        <section className="stack" aria-labelledby="risk-preview-h">
          <h2 id="risk-preview-h" className="no-print">
            Document preview
          </h2>
          <style>{DOCUMENT_CSS}</style>
          {/* Built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
          <DocPreview html={body} testId="risk-preview" />
        </section>
      )}

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with open items?"
          description={`This assessment still lists ${tbd} open ${tbd === 1 ? "item" : "items"}. They are listed in the document as open, not as decided.`}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            <p data-testid="risk-tbd-warning">
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
                  const go = pending;
                  setPending(null);
                  go();
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

/** The optional approval section: roles the team names. Nothing is signed here; the document says it is a draft. */
function ApprovalsCard({ a, run }: { a: RiskAssessment; run: Run }) {
  const [rows, setRows] = useState<RiskApproval[]>(a.approvals ?? []);
  const dirty = JSON.stringify(rows.filter((r) => r.role.trim())) !== JSON.stringify(a.approvals ?? []);
  const set = (i: number, patch: Partial<RiskApproval>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section className="card stack no-print" aria-labelledby="risk-appr" data-testid="risk-approvals">
      <h2 id="risk-appr">Approval section (optional)</h2>
      <p className="muted small">Name the roles that approve this assessment, if your quality system asks for it. Left empty, the document has no approval section. The document is a draft and is never shown as signed.</p>
      {rows.map((r, i) => (
        <div key={i} className="row wrap end-align">
          <label className="field">
            <span>Role {i + 1}</span>
            <input value={r.role} onChange={(e) => set(i, { role: e.target.value })} data-testid={`appr-role-${i}`} />
          </label>
          <label className="field">
            <span>Name (optional)</span>
            <input value={r.name ?? ""} onChange={(e) => set(i, { name: e.target.value })} />
          </label>
          <button type="button" className="btn small" aria-label={`Remove role ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div className="row wrap">
        <button type="button" className="btn small" data-testid="appr-add" onClick={() => setRows([...rows, { role: "" }])}>
          Add a role
        </button>
        <button type="button" className="btn primary small" disabled={!dirty} data-testid="appr-save" onClick={() => run((p, actor) => updateAssessment(p, a.id, { approvals: rows }, actor), "Approval roles saved")}>
          Save approval roles
        </button>
      </div>
    </section>
  );
}
