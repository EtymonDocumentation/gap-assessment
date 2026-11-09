import { DocPreview } from "../DocPreview";
import { buildDocument, buildGapData, documentFingerprint, omittedSectionIds, openItemsText, recordExport, stampDocument, verificationSummary } from "@gap/engine";
import type { DocumentExport, TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlPreview, renderMarkdown } from "@gap/renderers";
import { useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { HelpTip } from "../HelpTip";
import { PageHeader } from "../PageHeader";
import { download, projectFileStem, sideText, today } from "../lib";
import { href } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";
import { useVersionStamp } from "../version-ui";
import { BUILTIN_RECORD, ExportHistory, useWordChoice, useWordExport, WORD_BUILDING_LABEL, WORD_EXPORT_HELP, WordPanelView } from "./document-panels";
import { DocumentSectionsBlock, ProcessStepsBlock, useScopeSummary } from "./ScopeEditor";

/** Live preview of the generated document, with the scope panel, downloads (Markdown, HTML, Word) and the export history. */
export function DocumentPage() {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  // Generation time is fixed when the page opens so the preview and downloads match.
  const [generatedAt] = useState(() => new Date().toISOString());
  const versionStamp = useVersionStamp();
  const doc = useMemo(() => stampDocument(buildDocument(content, project, a, generatedAt), versionStamp), [project, a, generatedAt, versionStamp]);
  const body = useMemo(() => renderHtmlPreview(doc), [doc]);
  const vs = useMemo(() => verificationSummary(content, project), [content, project]);
  const base = `${projectFileStem(project.meta)}-gap-assessment-${today()}`;
  const update = useStore((s) => s.update);
  const choice = useWordChoice();
  const wording = useStageWording();
  const summary = useScopeSummary();
  const omitted = omittedSectionIds(project);
  const [scopeOpen, setScopeOpen] = useState(false);

  // Downloading with open items is allowed, but only after the person has seen the count (EOU-10). The question used to appear only for values marked
  // TBD, so a Word file with 42 open items and none marked TBD left without it, while the TRD, the plan and the batch record asked. Now it asks
  // whenever the document lists open items, with the same count as the page header, Home and the interview (open-count rule). The number marked TBD
  // is recorded in the export history. (GMP: a document with open items must not leave the tool without that being plain.)
  const open = a.openItems.length;
  const [pending, setPending] = useState<(() => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const guard = (run: () => void) => {
    if (open > 0) {
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

  const word = useWordExport({ choice, doc, content, project, assessment: a, generatedAt, fileBase: base, guard, onExported: (template) => recordDownload("docx", template), dataPart: () => ({ kind: "gap-data" as const, json: buildGapData(content, project, doc) }) });
  const downloadMarkdown = () =>
    guard(() => {
      download(`${base}.md`, renderMarkdown(doc), "text/markdown;charset=utf-8");
      recordDownload("markdown", BUILTIN_RECORD);
    });
  const downloadHtml = () =>
    guard(() => {
      download(`${base}.html`, renderHtml(doc), "text/html;charset=utf-8");
      recordDownload("html", BUILTIN_RECORD);
    });
  const printPdf = () => guard(() => window.print());

  const n = doc.tbdCount;
  const included = summary.steps.included;
  return (
    <div className="stack-lg">
      <PageHeader
        title="Document"
        purpose="Draft the gap assessment document from your answers and gap decisions."
        // Both counts, with how they relate (every value marked TBD is an open item). The pill shows whenever anything is open, not only for TBD.
        pills={open > 0 ? [{ label: openItemsText(open, n), warning: true, testId: "doc-tbd-pill" }] : []}
        about={{
          art: "page-document",
          children: (
            <>
              <p>Check what it covers, add your own text where asked, then download it.</p>
              <p>
                Draft generated from the current answers. It updates as answers change. The table of differences cites the rule and version that produced each classification.
              </p>
            </>
          ),
        }}
        // No Export menu here (EOU-09): the four downloads are the row of buttons right under this header, so a menu would only repeat them.
      />

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
        <div className="row wrap" data-testid="downloads-row">
          <span className="row inline">
            <button
              type="button"
              className="btn primary"
              disabled={word.blocked || word.busy}
              aria-live="polite"
              aria-describedby={word.checks?.blockers.length ? "word-blockers" : undefined}
              onClick={word.run}
            >
              {word.busy ? WORD_BUILDING_LABEL : "Download gap assessment (Word)"}
            </button>
            {word.slowNote && <span className="small muted" role="status">{word.slowNote}</span>}
            <HelpTip label="the Word export" text={WORD_EXPORT_HELP} />
          </span>
          <button className="btn" onClick={downloadHtml}>
            Download gap assessment (HTML)
          </button>
          <button className="btn" onClick={downloadMarkdown}>
            Download gap assessment (Markdown)
          </button>
          <button className="btn" onClick={printPdf}>
            Print / save as PDF
          </button>
        </div>
        <p className="small" data-testid="download-contents">
          Downloads include {included} process {included === 1 ? "step" : "steps"} and {summary.sectionsIncluded} of {summary.sectionsTotal} document sections
          {omitted.length ? ` (${omitted.length} optional ${omitted.length === 1 ? "section" : "sections"} left out)` : ""}. They match the preview below.
        </p>
      </div>
      <WordPanelView choice={choice} exporter={word} showButton={false} />
      <section className="card no-print" aria-labelledby="verif-summary-title">
        <h2 id="verif-summary-title">Verification status</h2>
        <p className="small">
          {vs.all.verified} of {vs.all.total} entries are verified. {vs.all.withdrawn} {vs.all.withdrawn === 1 ? "verification is" : "verifications are"} withdrawn
          after a change, {vs.all.unverified} {vs.all.unverified === 1 ? "entry is" : "entries are"} unverified and {vs.all.notVerifiable}{" "}
          {vs.all.notVerifiable === 1 ? "has" : "have"} no value to verify yet (TBD). Verify entries in the{" "}
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
          Names are free text, not an electronic signature, so verification is not attributable in a GMP sense. The full breakdown by section is in the document.
        </p>
      </section>
      <ExportHistory exports={project.document.exports} />
      <style>{DOCUMENT_CSS}</style>
      {/* Content is built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
      <DocPreview html={body} />

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with open items?"
          description={`This document still lists ${openItemsText(open, n)}. None of them is a confirmed value, and every result that uses a best guess is labelled Provisional.`}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            <p data-testid="tbd-warning">
              The download will record <strong>{n} marked TBD</strong> in the export history. Go back to answer them first, or download now; nothing stops you.
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
