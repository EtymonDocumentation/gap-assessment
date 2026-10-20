import { buildDocument } from "@gap/engine";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody, renderMarkdown } from "@gap/renderers";
import { useMemo, useState } from "react";
import { download, slug, today } from "../lib";
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
      <style>{DOCUMENT_CSS}</style>
      {/* Content is built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
      <div className="doc-preview" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
