import { buildMbrDocument, documentFingerprint, mbrBasisText, recordExport } from "@gap/engine";
import { MBR_FORMAT_VERSION, PROCESS_MODEL_VERSION, type DocumentExport, type MbrRecord, type TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody } from "@gap/renderers";
import { useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { APP_VERSION, download, today } from "../lib";
import { useContent, useStore } from "../store";
import { BUILTIN_RECORD, ExportHistory, GENERIC_MODES, useWordChoice, WordPanel } from "./document-panels";

/**
 * The Word or HTML draft of a master batch record, with a preview. The same rules as the other documents: the banner is in every
 * output, a download with open items is allowed only after the person has seen the count, and each download is written to the export
 * history with the versions behind it. The open items and the "To be completed by the CMO" placeholders are never optional.
 */
export function MbrOutput({ rec }: { rec: MbrRecord }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  // Fixed when the page opens so the preview and every download of this visit carry the same time.
  const [generatedAt] = useState(() => new Date().toISOString());
  const [done, setDone] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const choice = useWordChoice();
  // A split record can be exported whole or one part at a time (each part has its own document number). "whole" is the default so an
  // unsplit record, and a split one nobody chose a part for, come out exactly as before.
  const [partChoice, setPartChoice] = useState<"whole" | "1" | "2">("whole");
  const part = rec.split && partChoice !== "whole" ? (Number(partChoice) as 1 | 2) : undefined;
  const doc = useMemo(() => buildMbrDocument(project, rec, { generatedAt, appVersion: APP_VERSION, catalogVersion: content.versions.catalog, part }), [project, rec, content, generatedAt, part]);
  const body = useMemo(() => (showPreview ? renderHtmlBody(doc) : ""), [doc, showPreview]);
  const stamp = `${project.meta.id}-${rec.id}${part ? `-part${part}` : ""}-${today()}`;
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
          versions: { processModel: PROCESS_MODEL_VERSION, catalog: content.versions.catalog, format: MBR_FORMAT_VERSION },
        }),
      "Download recorded in the export history",
    );
  const saved = (file: string) => setDone(`Saved ${file}. The download is recorded in the export history below.`);
  const exports = project.document.exports.filter((x) => x.format === "mbr-docx" || x.format === "mbr-html");

  return (
    <>
      <section className="card stack no-print" aria-labelledby="mbr-doc" data-testid="mbr-output">
        <h2 id="mbr-doc">Master batch record (draft)</h2>
        <p>
          {mbrBasisText(project.meta.id, rec)} The document has one section per unit operation in process order, with automatic step numbers, parameter tables that show the TRD value and its source beside the MBR value, a time-limit table, sample tables from the sampling plan, and a "To be completed by the CMO" place for everything only the CMO can state. It states no filing category: the only wording is "Requires regulatory affairs assessment".
        </p>
        {rec.split && (
          <fieldset className="field" data-testid="mbr-part-choice">
            <legend>Which document</legend>
            <div className="row wrap">
              {([["whole", "Whole record (both parts)"], ["1", `Part 1${rec.split.part1DocRef?.trim() ? ` (${rec.split.part1DocRef.trim()})` : ""}`], ["2", `Part 2${rec.split.part2DocRef?.trim() ? ` (${rec.split.part2DocRef.trim()})` : ""}`]] as const).map(([v, label]) => (
                <label key={v} className="row">
                  <input type="radio" name="mbr-part" value={v} checked={partChoice === v} onChange={() => setPartChoice(v)} data-testid={`mbr-part-${v}`} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            data-testid="mbr-download-html"
            onClick={() =>
              guard(() => {
                const file = `mbr-${stamp}.html`;
                download(file, renderHtml(doc), "text/html;charset=utf-8");
                record("mbr-html", BUILTIN_RECORD);
                saved(file);
              })
            }
          >
            Download HTML
          </button>
          <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)} data-testid="mbr-preview-toggle">
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <p className="small muted" data-testid="mbr-open-count">
          {tbd === 0 ? "No open items." : `${tbd} open ${tbd === 1 ? "item" : "items"} will be listed in the document.`} The banner "Proof of concept. Not validated. Not for GMP use." is in every output.
        </p>
        <div role="status" aria-live="polite">
          {done && <p data-testid="mbr-done">{done}</p>}
        </div>
      </section>

      <WordPanel
        choice={choice}
        doc={doc}
        content={content}
        project={project}
        generatedAt={generatedAt}
        fileBase={`mbr-${stamp}`}
        guard={guard}
        onExported={(template) => record("mbr-docx", template)}
        modes={GENERIC_MODES}
        tagData={(m) => m.buildDocumentTagData(doc)}
        testIdPrefix="mbr"
        note={'"Map to their headings" is offered for the gap assessment document only. For a tagged template, {title}, {banner}, {status}, {generated}, {meta} and {sections} are filled, and {@body} or a section tag such as {@section_basis} brings in the batch record in your template\'s styles. The sections of each unit operation have their own tags, for example {@section_section_SC_01}.'}
      />

      <ExportHistory exports={exports} idPrefix="mbr-export-history" title="Export history" />

      {showPreview && (
        <section className="stack" aria-labelledby="mbr-preview-h">
          <h2 id="mbr-preview-h" className="no-print">
            Document preview
          </h2>
          <style>{DOCUMENT_CSS}</style>
          {/* Built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
          <div className="doc-preview" data-testid="mbr-preview" dangerouslySetInnerHTML={{ __html: body }} />
        </section>
      )}

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with open items?"
          description={`This batch record still lists ${tbd} open ${tbd === 1 ? "item" : "items"}. They are listed in the document as open, not as decided.`}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            <p data-testid="mbr-tbd-warning">
              The download will record that <strong>{tbd} open {tbd === 1 ? "item was" : "items were"}</strong> listed when it was made.
            </p>
            <div className="row end">
              <button type="button" className="btn" autoFocus onClick={() => setPending(null)}>
                Go back
              </button>
              <button
                type="button"
                className="btn primary"
                data-testid="mbr-download-anyway"
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
