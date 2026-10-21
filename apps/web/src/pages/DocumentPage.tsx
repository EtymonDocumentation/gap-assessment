import { buildDocument, documentFingerprint, OPTIONAL_SECTIONS, omittedSectionIds, recordExport, revisionState, setOmittedSections, verificationSummary } from "@gap/engine";
import type { DocumentExport, TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody, renderMarkdown } from "@gap/renderers";
import { useMemo, useState } from "react";
import { PageBanner } from "../art";
import { download, sideText, slug, today } from "../lib";
import { href } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";
import { BUILTIN_RECORD, CommentsPanel, ExportHistory, RevisionsPanel, useWordChoice, WordPanel } from "./document-panels";

/** Live preview of the generated document, with downloads (Markdown, HTML, Word), revisions, reviewer comments and the export history. */
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
  const by = useStore((s) => s.lastPerson?.name);
  const choice = useWordChoice();
  const wording = useStageWording();
  const state = useMemo(() => revisionState(project, doc), [project, doc]);
  const omitted = omittedSectionIds(project);
  const [sectionError, setSectionError] = useState("");

  /** Ticks or unticks one optional section. The choice is stored with the project and applies to every format. */
  const toggleSection = (id: string, include: boolean) => {
    const title = OPTIONAL_SECTIONS.find((x) => x.id === id)?.title ?? id;
    // Worked out from the stored project, not from this render, so two quick clicks both count.
    const err = update(
      (p) => {
        const current = omittedSectionIds(p);
        return setOmittedSections(p, include ? current.filter((x) => x !== id) : [...current, id]);
      },
      include ? `${title} included in the document` : `${title} left out of the document`,
    );
    setSectionError(err ?? "");
  };

  /** Every download is written to the export history, with the revision it was made at and whether the content has changed since. */
  const recordDownload = (format: DocumentExport["format"], template: TemplateRecord) =>
    update(
      (p) =>
        recordExport(p, {
          at: new Date().toISOString(),
          ...(by ? { by } : {}),
          format,
          template,
          ...(state.latest ? { revision: state.latest.number } : {}),
          fingerprint: documentFingerprint(doc),
          tbdCount: doc.tbdCount,
          ...(omitted.length ? { omittedSections: omitted } : {}),
          changedSinceRevision: state.changedSinceIssue,
        }),
      "Download recorded in the export history",
    );

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Document</h1>
      </PageBanner>
      <div className="row between wrap no-print">
        <div className="row wrap">
          <button
            className="btn"
            onClick={() => {
              download(`${base}.md`, renderMarkdown(doc), "text/markdown;charset=utf-8");
              recordDownload("markdown", BUILTIN_RECORD);
            }}
          >
            Download Markdown
          </button>
          <button
            className="btn"
            onClick={() => {
              download(`${base}.html`, renderHtml(doc), "text/html;charset=utf-8");
              recordDownload("html", BUILTIN_RECORD);
            }}
          >
            Download HTML
          </button>
          <button className="btn primary" onClick={() => window.print()}>
            Print / save as PDF
          </button>
        </div>
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
      <section className="card no-print" aria-labelledby="sections-title">
        <h2 id="sections-title">Sections to include</h2>
        <p className="small">
          Untick a section to leave it out of the preview and of every download (Markdown, HTML, Word and print). Numbering and appendix letters close up, and the document
          lists what was left out. Purpose, Scope, the SU and RU summaries, the Detailed gap table and Open information items are always included.
        </p>
        <fieldset className="stack">
          <legend className="small">Optional sections</legend>
          <ul className="section-choice">
            {OPTIONAL_SECTIONS.map((sec) => (
              <li key={sec.id}>
                <label>
                  <input type="checkbox" checked={!omitted.includes(sec.id)} onChange={(e) => toggleSection(sec.id, e.target.checked)} />
                  <span>{sec.appendix ? `${sec.title} (appendix)` : sec.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <p className="small muted" role="status">
          {sectionError || (omitted.length ? `${omitted.length} optional ${omitted.length === 1 ? "section is" : "sections are"} left out.` : "All optional sections are included.")}
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
        onExported={(template) => recordDownload("docx", template)}
      />
      <RevisionsPanel project={project} state={state} doc={doc} choice={choice} />
      <CommentsPanel project={project} doc={doc} assessment={a} />
      <ExportHistory exports={project.document.exports} />
      <style>{DOCUMENT_CSS}</style>
      {/* Content is built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
      <div className="doc-preview" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
