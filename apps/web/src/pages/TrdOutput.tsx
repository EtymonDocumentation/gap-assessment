import { buildTrdDocument, documentFingerprint, recordExport, trdBasisText, TRD_OPTIONAL_SECTIONS, updateTrd, type TrdOptionalSection } from "@gap/engine";
import { PROCESS_MODEL_VERSION, TRD_FORMAT_VERSION, type DocumentExport, type TemplateRecord, type TrdApproval, type TrdDocument } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody } from "@gap/renderers";
import { useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { APP_VERSION, download, today } from "../lib";
import { useContent, useStore } from "../store";
import { BUILTIN_RECORD, ExportHistory, GENERIC_MODES, useWordChoice, WordPanel } from "./document-panels";
import type { Run } from "./SamplingFlow";

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

  const choice = useWordChoice();
  const doc = useMemo(() => buildTrdDocument(project, d, { generatedAt, appVersion: APP_VERSION, catalogVersion: content.versions.catalog, omit }), [project, d, content, generatedAt, omit]);
  const body = useMemo(() => (showPreview ? renderHtmlBody(doc) : ""), [doc, showPreview]);
  const stamp = `${project.meta.id}-${d.id}-${today()}`;
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
          fingerprint: documentFingerprint(doc),
          tbdCount: tbd,
          versions: { processModel: PROCESS_MODEL_VERSION, catalog: content.versions.catalog, format: TRD_FORMAT_VERSION },
        }),
      "Download recorded in the export history",
    );
  const saved = (file: string) => setDone(`Saved ${file}. The download is recorded in the export history below.`);

  const exports = project.document.exports.filter((x) => x.format === "trd-docx" || x.format === "trd-html");

  return (
    <>
      <ApprovalsCard d={d} run={run} />
      <section className="card stack no-print" aria-labelledby="trd-doc" data-testid="trd-output">
        <h2 id="trd-doc">Technology transfer document</h2>
        <p>
          {trdBasisText(project.meta.id, d)} The document shows the process sections you have, each parameter with its set point, NOR and PAR and their sources, a check of those numbers, every override with the project value beside it, and the open items. It states no filing category: the only wording is "Requires regulatory affairs assessment".
        </p>
        <fieldset className="fs stack" data-testid="trd-sections">
          <legend>Optional sections in this download</legend>
          <p className="muted small">The process sections, the PAR and NOR check, the overrides, the open items and the versions are always in the document.</p>
          {TRD_OPTIONAL_SECTIONS.map((s) => (
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
                record("trd-html", BUILTIN_RECORD);
                saved(file);
              })
            }
          >
            Download HTML
          </button>
          <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)} data-testid="trd-preview-toggle">
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <p className="small muted" data-testid="trd-open-count">
          {tbd === 0 ? "No open items." : `${tbd} open ${tbd === 1 ? "item" : "items"} will be listed in the document.`} The banner "Proof of concept. Not validated. Not for GMP use." is in every output.
        </p>
        <div role="status" aria-live="polite">
          {done && <p data-testid="trd-done">{done}</p>}
        </div>
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
        tagData={(m) => m.buildDocumentTagData(doc)}
        testIdPrefix="trd"
        note={'"Map to their headings" is offered for the gap assessment document only: a saved mapping names the gap document\'s sections. For a tagged template, {title}, {banner}, {status}, {generated}, {meta} and {sections} are filled, and {@body} or a section tag such as {@section_par_nor} brings in the TRD in your template\'s styles. The sections of each process step have their own tags, for example {@section_step_TS_01}.'}
      />

      <ExportHistory exports={exports} idPrefix="trd-export-history" title="Export history" />

      {showPreview && (
        <section className="stack" aria-labelledby="trd-preview-h">
          <h2 id="trd-preview-h" className="no-print">
            Document preview
          </h2>
          <style>{DOCUMENT_CSS}</style>
          {/* Built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
          <div className="doc-preview" data-testid="trd-preview" dangerouslySetInnerHTML={{ __html: body }} />
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
