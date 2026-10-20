import { buildDocument, verificationSummary } from "@gap/engine";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody, renderMarkdown } from "@gap/renderers";
import { useMemo, useState } from "react";
import { download, SIDE_TEXT as SIDE_NAME, slug, today } from "../lib";
import { href } from "../router";
import { useAssessment, useContent, useStore } from "../store";

/** Live preview of the generated document, with Markdown and print-ready HTML downloads. */
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

  return (
    <div className="stack-lg">
      <div className="row between wrap no-print">
        <h1>Document</h1>
        <div className="row wrap">
          <button className="btn" onClick={() => download(`${base}.md`, renderMarkdown(doc), "text/markdown;charset=utf-8")}>
            Download Markdown
          </button>
          <button className="btn" onClick={() => download(`${base}.html`, renderHtml(doc), "text/html;charset=utf-8")}>
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
          {vs.all.notVerifiable === 1 ? "has" : "have"} no value to verify yet (Unknown or Not established). Verify entries in the{" "}
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
                    <th scope="row">{SIDE_NAME[sd]}</th>
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
      <style>{DOCUMENT_CSS}</style>
      {/* Content is built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
      <div className="doc-preview" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
