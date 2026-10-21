import { buildDocument, documentFingerprint, omittedSectionIds, recordExport, verificationSummary } from "@gap/engine";
import type { DocumentExport, TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody, renderMarkdown } from "@gap/renderers";
import { useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Modal } from "../components";
import { download, sideText, slug, today } from "../lib";
import { href } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";
import { BUILTIN_RECORD, ExportHistory, useWordChoice, WordPanel } from "./document-panels";
import { DocumentSectionsBlock, ProcessStepsBlock, useScopeSummary } from "./ScopeEditor";

/** Live preview of the generated document, with the scope panel, downloads (Markdown, HTML, Word) and the export history. */
export function DocumentPage() {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  // Generation time is fixed when the page opens so the preview and downloads match.
  const [generatedAt] = useState(() => new Date().toISOString());
  const doc = useMemo(() => buildDocument(content, project, a, generatedAt), [project, a, generatedAt]);
  const body = useMemo(() => renderHtmlBody(doc), [doc]);
  const vs = useMemo(() => verificationSummary(content, project), [content, project]);
  const base = `${slug(project.meta.title)}-gap-assessment-${today()}`;
  const update = useStore((s) => s.update);
  const choice = useWordChoice();
  const wording = useStageWording();
  const summary = useScopeSummary();
  const omitted = omittedSectionIds(project);
  const [scopeOpen, setScopeOpen] = useState(false);

  // Downloading with TBD values still open is allowed, but only after the person has seen the count. The count is
  // recorded in the export history. (GMP: a document with open TBD values must not leave the tool without that being plain.)
  const [pending, setPending] = useState<(() => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const guard = (run: () => void) => {
    if (doc.tbdCount > 0) {
      opener.current = document.activeElement as HTMLElement | null;
      setPending(() => run);
    } else run();
  };

  /** Every download is written to the export history: who, when, format, template, fingerprint, TBD count, omitted sections. */
  const recordDownload = (format: DocumentExport["format"], template: TemplateRecord) =>
    update(
      (p, actor) =>
        recordExport(p, {
          at: new Date().toISOString(),
          by: actor.name,
          format,
          template,
          fingerprint: documentFingerprint(doc),
          tbdCount: doc.tbdCount,
          ...(omitted.length ? { omittedSections: omitted } : {}),
        }),
      "Download recorded in the export history",
    );

  const n = doc.tbdCount;
  const included = summary.steps.included;
  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Document</h1>
      </PageBanner>

      <section className="card stack no-print" aria-labelledby="doc-scope-title" data-testid="doc-scope-panel">
        <div className="row between wrap">
          <h2 id="doc-scope-title">What this document covers</h2>
          <button type="button" className="btn" aria-expanded={scopeOpen} aria-controls="doc-scope-body" onClick={() => setScopeOpen(!scopeOpen)}>
            {scopeOpen ? "Done" : "Change"}
          </button>
        </div>
        <p data-testid="doc-scope-summary">
          <strong>{summary.text}.</strong>{" "}
          <a href={href("/scope")}>Open the Scope step</a>
        </p>
        <div id="doc-scope-body" hidden={!scopeOpen} className="stack">
          <h3>Process steps</h3>
          <ProcessStepsBlock idPrefix="doc" />
          <h3>Document sections</h3>
          <DocumentSectionsBlock idPrefix="doc" />
        </div>
      </section>

      <div className="stack no-print">
        <div className="row between wrap">
          <div className="row wrap">
            <button
              className="btn"
              onClick={() =>
                guard(() => {
                  download(`${base}.md`, renderMarkdown(doc), "text/markdown;charset=utf-8");
                  recordDownload("markdown", BUILTIN_RECORD);
                })
              }
            >
              Download Markdown
            </button>
            <button
              className="btn"
              onClick={() =>
                guard(() => {
                  download(`${base}.html`, renderHtml(doc), "text/html;charset=utf-8");
                  recordDownload("html", BUILTIN_RECORD);
                })
              }
            >
              Download HTML
            </button>
            <button className="btn primary" onClick={() => guard(() => window.print())}>
              Print / save as PDF
            </button>
          </div>
        </div>
        <p className="small" data-testid="download-contents">
          Downloads include {included} process {included === 1 ? "step" : "steps"} and {summary.sectionsIncluded} of {summary.sectionsTotal} document sections
          {omitted.length ? ` (${omitted.length} optional ${omitted.length === 1 ? "section" : "sections"} left out)` : ""}. They match the preview below.
        </p>
      </div>
      <p className="muted no-print">
        Draft generated from the current answers. It updates as answers change. The table of differences cites the rule and version that produced
        each classification.
      </p>
      <section className="card no-print" aria-labelledby="verif-summary-title">
        <h2 id="verif-summary-title">Verification status</h2>
        <p className="small">
          {vs.all.verified} of {vs.all.total} entries are verified. {vs.all.withdrawn} {vs.all.withdrawn === 1 ? "verification is" : "verifications are"} withdrawn
          after a change, {vs.all.unverified} {vs.all.unverified === 1 ? "entry is" : "entries are"} unverified and {vs.all.notVerifiable}{" "}
          {vs.all.notVerifiable === 1 ? "has" : "have"} no value to verify yet (TBD or Not established). Verify entries in the{" "}
          <a href={href("/builder")}>Builder</a>.
        </p>
        <div className="table-scroll" role="region" aria-label="Verification counts by side" tabIndex={0}>
          <table className="data vs-table">
            <thead>
              <tr>
                <th scope="col">Side</th>
                <th scope="col">Entries</th>
                <th scope="col">Verified</th>
                <th scope="col">Verification withdrawn</th>
                <th scope="col">Unverified</th>
                <th scope="col">Not verifiable</th>
              </tr>
            </thead>
            <tbody>
              {(["shared", "source", "target"] as const)
                .filter((sd) => vs.bySide[sd].total > 0)
                .map((sd) => (
                  <tr key={sd}>
                    <th scope="row">{sideText(wording)[sd]}</th>
                    <td className="num">{vs.bySide[sd].total}</td>
                    <td className="num">{vs.bySide[sd].verified}</td>
                    <td className="num">{vs.bySide[sd].withdrawn}</td>
                    <td className="num">{vs.bySide[sd].unverified}</td>
                    <td className="num">{vs.bySide[sd].notVerifiable}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Names are free text without a login, so verification is not attributable in a GMP sense. The full breakdown by section is in the document.
        </p>
      </section>
      <WordPanel
        choice={choice}
        doc={doc}
        content={content}
        project={project}
        assessment={a}
        generatedAt={generatedAt}
        fileBase={base}
        guard={guard}
        onExported={(template) => recordDownload("docx", template)}
      />
      <ExportHistory exports={project.document.exports} />
      <style>{DOCUMENT_CSS}</style>
      {/* Content is built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
      <div className="doc-preview" dangerouslySetInnerHTML={{ __html: body }} />

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with TBD values?"
          description={`This document still lists ${n} TBD ${n === 1 ? "value" : "values"}. They are open items, not confirmed values, and every result that uses a best guess is labelled Provisional.`}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            <p data-testid="tbd-warning">
              The download will record that <strong>{n} TBD {n === 1 ? "value was" : "values were"}</strong> open when it was made.
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
    </div>
  );
}
