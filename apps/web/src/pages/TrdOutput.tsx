import { DocPreview } from "../DocPreview";
import { buildTrdData, buildTrdDocument, documentFingerprint, clearTrdTemplateChoice, projectLabel, recordExport, setTrdTemplateChoice, stampDocument, TRD_OPTIONAL_SECTIONS, trdBasisText, trdTemplateChoiceText, type TrdOptionalSection, updateTrd } from "@gap/engine";
import type { DocModel } from "@gap/engine";
import { PROCESS_MODEL_VERSION, TRD_FORMAT_VERSION, type DocumentExport, type TemplateRecord, type TrdApproval, type TrdDocument } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlPreview } from "@gap/renderers";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { APP_VERSION, download, projectFileStem, today } from "../lib";
import { useRoute } from "../router";
import { useContent, useStore } from "../store";
import { useVersionStamp } from "../version-ui";
import { BUILTIN_RECORD, ExportHistory, exportsOfDocument, GENERIC_MODES, useWordChoice, WordPanel } from "./document-panels";
import { ReasonDialog } from "./ReasonDialog";
import type { Run } from "./SamplingFlow";
import { TrdFormButton } from "./TrdUploadButton";

/**
 * Step 4 of a TRD: the Word or HTML draft, with a preview. The same rules as the other documents: the banner is in every output, a
 * download with open items is allowed only after the person has seen the count, and each download is written to the export
 * history with the versions behind it. The overrides list and the open items are never optional, so an export cannot hide them.
 */
export function TrdOutput({ d, run }: { d: TrdDocument; run: Run }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  // Fixed when the page opens so the preview and every download of this visit carry the same time.
  const [generatedAt] = useState(() => new Date().toISOString());
  const [done, setDone] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [omit, setOmit] = useState<TrdOptionalSection[]>([]);
  const [omitEvidence, setOmitEvidence] = useState<TrdOptionalSection[]>([]);

  // The standard document starts on the Word template stored on the TRD (chosen when it was started) and keeps it up to date; the evidence record keeps its own, unsaved choice.
  const choice = useWordChoice(d.templateChoice, (pick) => {
    const err = update((p, actor) => setTrdTemplateChoice(p, d.id, pick, actor), "Word template of the TRD saved");
    if (err) setDone(err);
  });
  const [removing, setRemoving] = useState(false);
  const evidenceChoice = useWordChoice();
  // Two documents from the same record: the short standard TRD for approval, and the evidence record for audit and inspection.
  const versionStamp = useVersionStamp();
  const doc = useMemo(() => stampDocument(buildTrdDocument(project, d, { generatedAt, appVersion: APP_VERSION, catalogVersion: content.versions.catalog, omit, content }), versionStamp), [project, d, content, generatedAt, omit, versionStamp]);
  const evidenceDoc = useMemo(() => stampDocument(buildTrdDocument(project, d, { generatedAt, appVersion: APP_VERSION, catalogVersion: content.versions.catalog, omit: omitEvidence, content, variant: "evidence" }), versionStamp), [project, d, content, generatedAt, omitEvidence, versionStamp]);
  const body = useMemo(() => (showPreview ? renderHtmlPreview(doc) : ""), [doc, showPreview]);
  const stamp = `${projectFileStem(project.meta)}-${d.id}-${today()}`;
  const tbd = doc.tbdCount ?? 0;

  // "See it in the document" (Interview card): open the preview and scroll to the section.
  const route = useRoute();
  const section = route.params.get("section");
  useEffect(() => {
    if (!section) return;
    setShowPreview(true);
    const t = window.setTimeout(() => {
      const el = document.getElementById(`doc-${section}`);
      if (!el) return;
      el.scrollIntoView({ block: "start" });
      el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [section, d.id]);

  const [pending, setPending] = useState<(() => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const guard = (go: () => void) => {
    if (tbd > 0) {
      opener.current = document.activeElement as HTMLElement | null;
      setPending(() => go);
    } else go();
  };

  const record = (format: DocumentExport["format"], template: TemplateRecord, made: DocModel = doc) =>
    update(
      (p, actor) =>
        recordExport(p, {
          at: new Date().toISOString(),
          by: actor.name,
          format,
          template,
          documentId: d.id,
          fingerprint: documentFingerprint(made),
          tbdCount: tbd,
          versions: { processModel: PROCESS_MODEL_VERSION, catalog: content.versions.catalog, format: TRD_FORMAT_VERSION },
        }),
      "Download recorded in the export history",
    );
  // "Recorded" is only said when the history really took the entry; a problem is shown in its place.
  const saved = (file: string, problem?: string | null) => setDone(problem ? `Saved ${file}. This download is not in the export history. ${problem}` : `Saved ${file}. The download is recorded in the export history below.`);

  const exports = exportsOfDocument(project.document.exports, (f) => f === "trd-docx" || f === "trd-html" || f === "trd-evidence-docx" || f === "trd-evidence-html", d.id, project.trd.documents.length === 1);
  const standardOptions = TRD_OPTIONAL_SECTIONS.filter((s) => s.id === "overview");
  const evidenceOptions = TRD_OPTIONAL_SECTIONS.filter((s) => s.id !== "overview");

  return (
    <>
      <ApprovalsCard d={d} run={run} />
      <section className="card stack no-print" aria-labelledby="trd-doc" data-testid="trd-output">
        <h2 id="trd-doc">Technical requirements document</h2>
        <p>
          {trdBasisText(projectLabel(project.meta), d)} This is the short document for approval: document control, the numbered sections and process descriptions, one table of parameters for each process step (set point, NOR (normal operating range), PAR (proven acceptable range) and unit), the open items, the approval section and the documents referred to. Where each value came from is in the evidence record below. It states no filing category: the only wording is "Requires regulatory affairs assessment".
        </p>
        <fieldset className="fs stack" data-testid="trd-sections">
          <legend>Optional sections in this download</legend>
          <p className="muted small">The process sections, the parameter tables, the overrides, the open items and the references are always in the document.</p>
          {standardOptions.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={!omit.includes(s.id)} data-testid={`trd-section-${s.id}`} onChange={(e) => setOmit(e.target.checked ? omit.filter((x) => x !== s.id) : [...omit, s.id])} /> <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            data-testid="trd-download-html"
            onClick={() =>
              guard(() => {
                const file = `trd-${stamp}.html`;
                download(file, renderHtml(doc), "text/html;charset=utf-8");
                saved(file, record("trd-html", BUILTIN_RECORD));
              })
            }
          >
            Download TRD (HTML)
          </button>
          <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)} data-testid="trd-preview-toggle">
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <p className="small muted" data-testid="trd-open-count">
          {tbd === 0 ? "No open items." : `${tbd} open ${tbd === 1 ? "item" : "items"} will be listed in the document.`} The drafting-aid notice is in every output.
        </p>
        <div role="status" aria-live="polite">
          {done && <p data-testid="trd-done">{done}</p>}
        </div>
      </section>

      <section className="card stack no-print" aria-labelledby="trd-template-h" data-testid="trd-template-choice">
        <h2 id="trd-template-h">Word template for this TRD</h2>
        <p data-testid="trd-template-choice-text">{trdTemplateChoiceText(d.templateChoice)}</p>
        <p className="muted small">
          {d.templateChoice?.kind === "later" || !d.templateChoice
            ? "Nothing is chosen yet. You can choose below at any time. The built-in layout is used for a download until you do."
            : "The download below starts on this choice. Change the kind of Word document below to change it."}
        </p>
        {d.templateChoice && (
          <div className="row">
            <button className="btn" data-testid="trd-template-remove" onClick={() => setRemoving(true)}>
              Remove this choice
            </button>
          </div>
        )}
        {removing && (
          <ReasonDialog
            title="Remove the Word template choice?"
            description="The TRD will show no Word template as chosen. Nothing else changes."
            confirmLabel="Remove the choice"
            keepLabel="Keep it"
            testId="trd-template-remove-dialog"
            onClose={() => setRemoving(false)}
            onConfirm={(reason) => {
              const err = update((p, actor) => clearTrdTemplateChoice(p, d.id, reason, actor), "Word template choice removed");
              if (!err) setRemoving(false);
              return err ?? null;
            }}
          />
        )}
      </section>

      <WordPanel
        choice={choice}
        doc={doc}
        content={content}
        project={project}
        generatedAt={generatedAt}
        fileBase={`trd-${stamp}`}
        guard={guard}
        onExported={(template) => record("trd-docx", template)}
        modes={GENERIC_MODES}
        tagData={(m) => m.buildDocumentTagData(doc, content, project)}
        testIdPrefix="trd"
        dataPart={() => ({ kind: "trd-data", json: buildTrdData(project, d, doc, "standard") })}
        buttonLabel="Download TRD (Word)"
        note={'"A template\'s headings" is offered for the gap assessment document only: a saved heading placement names the gap document\'s sections. For a tagged template, {title}, {banner}, {status}, {generated}, {meta}, {sections} and the project tags ({program}, {modality}, {sourceSite}, {targetSite} and the like) are filled, and {@body} or a section tag such as {@section_par_nor} brings in the TRD in your template\'s styles. The sections of each process step have their own tags, for example {@section_step_TS_01}.'}
      />

      <section className="card stack no-print" aria-labelledby="trd-evidence" data-testid="trd-evidence-output">
        <h2 id="trd-evidence">Evidence record</h2>
        <p>
          A separate document for audit and inspection. It is not for approval. It holds what the short document leaves out: every value with its basis, sources, status and classification, the other recorded values, the check of the set points against the NOR and PAR, the values behind the process descriptions, the source register and the traceability.
        </p>
        <fieldset className="fs stack" data-testid="trd-evidence-sections">
          <legend>Optional sections in the evidence record</legend>
          {evidenceOptions.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={!omitEvidence.includes(s.id)} data-testid={`trd-evidence-section-${s.id}`} onChange={(e) => setOmitEvidence(e.target.checked ? omitEvidence.filter((x) => x !== s.id) : [...omitEvidence, s.id])} /> <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            data-testid="trd-evidence-download-html"
            onClick={() =>
              guard(() => {
                const file = `trd-evidence-${stamp}.html`;
                download(file, renderHtml(evidenceDoc), "text/html;charset=utf-8");
                saved(file, record("trd-evidence-html", BUILTIN_RECORD, evidenceDoc));
              })
            }
          >
            Download evidence record (HTML)
          </button>
        </div>
      </section>

      <section className="card stack" aria-labelledby="trd-form-h" data-testid="trd-form-card">
        <h2 id="trd-form-h">Fill-in form (Word)</h2>
        <p className="small">A Word form with the values this TRD holds so far. Anyone can fill in the rest offline and you upload it back with "Upload a TRD" on the TRD page. A cell left empty stays not established.</p>
        <div className="row wrap">
          <TrdFormButton d={d} testId="trd-form-so-far" />
        </div>
      </section>

      <WordPanel
        choice={evidenceChoice}
        doc={evidenceDoc}
        content={content}
        project={project}
        generatedAt={generatedAt}
        fileBase={`trd-evidence-${stamp}`}
        guard={guard}
        onExported={(template) => record("trd-evidence-docx", template, evidenceDoc)}
        modes={GENERIC_MODES}
        tagData={(m) => m.buildDocumentTagData(evidenceDoc, content, project)}
        testIdPrefix="trd-evidence"
        dataPart={() => ({ kind: "trd-data", json: buildTrdData(project, d, evidenceDoc, "evidence") })}
        idPrefix="trd-evidence-word"
        title="Evidence record (Word)"
        buttonLabel="Download evidence record (Word)"
      />

      <ExportHistory exports={exports} idPrefix="trd-export-history" title="Export history" />

      {showPreview && (
        <section className="stack" aria-labelledby="trd-preview-h">
          <h2 id="trd-preview-h" className="no-print">
            Document preview
          </h2>
          <style>{DOCUMENT_CSS}</style>
          {/* Built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
          <DocPreview html={body} testId="trd-preview" />
        </section>
      )}

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with open items?"
          description={`This TRD still lists ${tbd} open ${tbd === 1 ? "item" : "items"}. They are listed in the document as open, not as decided.`}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            <p data-testid="trd-tbd-warning">
              The download will record that <strong>{tbd} open {tbd === 1 ? "item was" : "items were"}</strong> listed when it was made.
            </p>
            <div className="row end">
              <button type="button" className="btn" autoFocus onClick={() => setPending(null)}>
                Go back
              </button>
              <button
                type="button"
                className="btn primary"
                data-testid="trd-download-anyway"
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
function ApprovalsCard({ d, run }: { d: TrdDocument; run: Run }) {
  const [rows, setRows] = useState<TrdApproval[]>(d.approvals ?? []);
  const dirty = JSON.stringify(rows.filter((r) => r.role.trim())) !== JSON.stringify(d.approvals ?? []);
  const set = (i: number, patch: Partial<TrdApproval>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section className="card stack no-print" aria-labelledby="trd-appr" data-testid="trd-approvals">
      <h2 id="trd-appr">Approval section (optional)</h2>
      <p className="muted small">Name the roles that approve this document, if your quality system asks for it. Left empty, the document has no approval section. The document is a draft and is never shown as signed.</p>
      {rows.map((r, i) => (
        <div key={i} className="row wrap end-align">
          <label className="field">
            <span>Role {i + 1}</span>
            <input value={r.role} onChange={(e) => set(i, { role: e.target.value })} data-testid={`trd-appr-role-${i}`} />
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
        <button type="button" className="btn small" data-testid="trd-appr-add" onClick={() => setRows([...rows, { role: "" }])}>
          Add a role
        </button>
        <button type="button" className="btn primary small" disabled={!dirty} data-testid="trd-appr-save" onClick={() => run((p, actor) => updateTrd(p, d.id, { approvals: rows }, actor), "Approval roles saved")}>
          Save approval roles
        </button>
      </div>
    </section>
  );
}
