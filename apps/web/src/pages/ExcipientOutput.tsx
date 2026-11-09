import { DocPreview } from "../DocPreview";
import { buildExcipientAssessmentDocument, documentFingerprint, EXCIPIENT_OPTIONAL_SECTIONS, excipientBasisText, projectLabel, recordExport, stampDocument, type ExcipientOptionalSection } from "@gap/engine";
import { excipientClasses, excipientWording } from "@gap/content";
import { EXCIPIENT_FORMAT_VERSION, PROCESS_MODEL_VERSION, type DocumentExport, type ExcipientAssessment, type TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlPreview, renderMarkdown } from "@gap/renderers";
import { useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { APP_VERSION, download, projectFileStem, today } from "../lib";
import { useContent, useStore } from "../store";
import { useVersionStamp } from "../version-ui";
import { BUILTIN_RECORD, ExportHistory, exportsOfDocument, GENERIC_MODES, useWordChoice, WordPanel } from "./document-panels";

const WORD_NOTE =
  "\"A template's headings\" is offered for the gap assessment document only: a saved heading placement names the gap document's sections. For a tagged template, {title}, {banner}, {status}, {generated}, {meta}, {sections} and the project tags ({program}, {modality}, {sourceSite}, {targetSite} and the like) are filled, and {@body} brings in the excipient assessment in your template's styles.";

/**
 * The Document tab of an excipient assessment: Word, HTML and Markdown from the same document, with a preview. The same rules as the other
 * documents: the drafting-aid notice is in every output, a download with open items is allowed after the person has seen the count, and
 * each download is written to the export history with the id of this assessment and the versions behind it. Nothing blocks a download.
 */
export function ExcipientOutput({ a }: { a: ExcipientAssessment }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  // Fixed when the tab opens so the preview and every download of this visit carry the same time.
  const [generatedAt] = useState(() => new Date().toISOString());
  const [done, setDone] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [omit, setOmit] = useState<ExcipientOptionalSection[]>([]);

  const choice = useWordChoice();
  const versionStamp = useVersionStamp();
  const doc = useMemo(
    () => stampDocument(buildExcipientAssessmentDocument(content, project, a, { generatedAt, appVersion: APP_VERSION, wording: excipientWording, classes: excipientClasses, omit }), versionStamp),
    [content, project, a, generatedAt, omit, versionStamp],
  );
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
          ...(omit.length ? { omittedSections: [...omit] } : {}),
          versions: { processModel: PROCESS_MODEL_VERSION, catalog: content.versions.catalog, format: EXCIPIENT_FORMAT_VERSION },
        }),
      "Download recorded in the export history",
    );
  // "Recorded" is only said when the history really took the entry; a problem is shown in its place.
  const saved = (file: string, problem?: string | null) => setDone(problem ? `Saved ${file}. This download is not in the export history. ${problem}` : `Saved ${file}. The download is recorded in the export history below.`);

  const exports = exportsOfDocument(project.document.exports, (f) => f.startsWith("excipient-"), a.id, (project.excipients?.assessments.length ?? 0) === 1);

  return (
    <>
      <section className="card stack no-print" aria-labelledby="ex-doc-h" data-testid="ex-document">
        <h2 id="ex-doc-h">Excipient assessment document</h2>
        <p>
          {excipientBasisText(projectLabel(project.meta))} It lists every excipient with what is known at the sending and the receiving site, where the two sites differ, the specification comparison, the links and the open items. It states no filing category.
        </p>
        <fieldset className="fs stack" data-testid="ex-doc-sections">
          <legend>Optional sections in this download</legend>
          <p className="muted small">The summary, the excipients and the open items are always in the document.</p>
          {EXCIPIENT_OPTIONAL_SECTIONS.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={!omit.includes(s.id)} data-testid={`ex-doc-section-${s.id}`} onChange={(e) => setOmit(e.target.checked ? omit.filter((x) => x !== s.id) : [...omit, s.id])} /> <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            data-testid="ex-download-html"
            onClick={() =>
              guard(() => {
                const file = `excipient-assessment-${stamp}.html`;
                download(file, renderHtml(doc), "text/html;charset=utf-8");
                saved(file, record("excipient-html", BUILTIN_RECORD));
              })
            }
          >
            Download excipient assessment (HTML)
          </button>
          <button
            type="button"
            className="btn"
            data-testid="ex-download-markdown"
            onClick={() =>
              guard(() => {
                const file = `excipient-assessment-${stamp}.md`;
                download(file, renderMarkdown(doc), "text/markdown;charset=utf-8");
                saved(file, record("excipient-markdown", BUILTIN_RECORD));
              })
            }
          >
            Download excipient assessment (Markdown)
          </button>
          <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)} data-testid="ex-preview-toggle">
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <p className="small muted" data-testid="ex-open-count">
          {tbd === 0 ? "No open items." : `${tbd} open ${tbd === 1 ? "item" : "items"} will be listed in the document.`} The drafting-aid notice is in every output.
        </p>
        <div role="status" aria-live="polite">
          {done && <p data-testid="ex-done">{done}</p>}
        </div>
      </section>

      <WordPanel
        choice={choice}
        doc={doc}
        content={content}
        project={project}
        generatedAt={generatedAt}
        fileBase={`excipient-assessment-${stamp}`}
        guard={guard}
        onExported={(template) => record("excipient-docx", template)}
        modes={GENERIC_MODES}
        tagData={(m) => m.buildDocumentTagData(doc, content, project)}
        testIdPrefix="ex"
        buttonLabel="Download excipient assessment (Word)"
        note={WORD_NOTE}
      />

      <ExportHistory exports={exports} idPrefix="ex-export-history" title="Export history" />

      {showPreview && (
        <section className="stack" aria-labelledby="ex-preview-h">
          <h2 id="ex-preview-h" className="no-print">
            Document preview
          </h2>
          <style>{DOCUMENT_CSS}</style>
          {/* Built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
          <DocPreview html={body} testId="ex-preview" />
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
            <p data-testid="ex-tbd-warning">
              The download will record that <strong>{tbd} open {tbd === 1 ? "item was" : "items were"}</strong> listed when it was made.
            </p>
            <div className="row end">
              <button type="button" className="btn" autoFocus onClick={() => setPending(null)}>
                Go back
              </button>
              <button
                type="button"
                className="btn primary"
                data-testid="ex-tbd-go"
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
