import type { DocumentTagData, SamplingTagData, TagData, TemplateMode } from "@gap/docx";
import { BUILTIN_TEMPLATE_VERSION } from "@gap/docx/src/version";
import { optionalSectionTitle, type Assessment, type ContentBundle, type DocModel } from "@gap/engine";
import type { DocumentExport, Project, TemplateRecord } from "@gap/process-model";
import { useEffect, useMemo, useState } from "react";
import { Empty } from "../components";
import { loadDocx, useDocx, type DocxModule } from "../docx-loader";
import { browserRasteriser } from "../figureRasteriser";
import { dateTime, download, FORMAT_LABEL, MODE_HELP, MODE_LABEL, shortHash } from "../lib";
import { href } from "../router";
import { recordOf, useTemplates, type StoredTemplate } from "../templates-store";

export const BUILTIN_RECORD: TemplateRecord = { mode: "builtin", name: "Built-in default", version: BUILTIN_TEMPLATE_VERSION };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function templateText(t: TemplateRecord): string {
  return `${t.name} ${t.version}${t.sha256 ? ` (${shortHash(t.sha256)})` : ""}`;
}

// ------------------------------------------------------------------ the Word choice

export interface WordChoice {
  mode: TemplateMode;
  setMode(m: TemplateMode): void;
  /** Library templates that can be used for the chosen kind of Word document. */
  candidates: StoredTemplate[];
  template: StoredTemplate | undefined;
  setTemplateId(id: string): void;
  /** What an export records about the chosen template. */
  record: TemplateRecord | undefined;
}

export function useWordChoice(): WordChoice {
  const items = useTemplates((s) => s.items);
  useEffect(() => {
    void useTemplates.getState().load();
  }, []);
  const [mode, setMode] = useState<TemplateMode>("builtin");
  const [pick, setPick] = useState("");
  const candidates = useMemo(() => (mode === "builtin" ? [] : items.filter((t) => t.analysis.usableModes.includes(mode))), [items, mode]);
  const template = candidates.find((t) => t.id === pick) ?? candidates[0];
  const record = mode === "builtin" ? BUILTIN_RECORD : template ? recordOf(mode, template) : undefined;
  return { mode, setMode, candidates, template, setTemplateId: setPick, record };
}

// ------------------------------------------------------------------ Word document panel

interface Checks {
  blockers: string[];
  warnings: string[];
  notes: string[];
}

/** Everything worth knowing before a download. A blocker disables the button; the rest is information. */
function usePreExportChecks(choice: WordChoice, doc: DocModel): Checks | null {
  const { docx } = useDocx(choice.mode !== "builtin");
  const t = choice.template;
  return useMemo(() => {
    const out: Checks = { blockers: [], warnings: [], notes: [] };
    if (choice.mode === "builtin") return out;
    if (!t) {
      out.blockers.push("No template in the library works with this option. Add one on the Templates page.");
      return out;
    }
    if (!docx) return null;
    out.warnings.push(...t.analysis.warnings);
    if (choice.mode === "mapped") {
      if (!t.mapping) {
        out.blockers.push("This template has no saved heading mapping yet. Open the mapping editor, choose where the content goes, and save it.");
      } else {
        const r = docx.mappingReport(t.analysis, t.mapping, doc);
        out.blockers.push(...r.errors);
        if (r.unmappedBlocks.length) {
          const titles = r.unmappedBlocks.map((b) => b.title).join("; ");
          if (t.mapping.unmappedBlocks === "append") {
            out.notes.push(`${r.unmappedBlocks.length} ${r.unmappedBlocks.length === 1 ? "part" : "parts"} of the content ${r.unmappedBlocks.length === 1 ? "is" : "are"} not mapped to a heading and will be added at the end: ${titles}.`);
          } else {
            out.warnings.push(`${r.unmappedBlocks.length} ${r.unmappedBlocks.length === 1 ? "part" : "parts"} of the content will be left out of the Word document, as you chose in the mapping: ${titles}.`);
          }
        }
        if (r.flaggedHeadings.length) {
          out.notes.push(`${r.flaggedHeadings.length} ${r.flaggedHeadings.length === 1 ? "heading" : "headings"} will be marked "to be completed": ${r.flaggedHeadings.map((h) => h.text).join("; ")}.`);
        }
      }
    }
    if (choice.mode === "tags") {
      const tags = t.analysis.tags;
      if (!tags || !tags.found.length) out.warnings.push("The template contains no tags, so only the banner is filled in.");
      for (const e of tags?.errors ?? []) out.blockers.push(`Tag problem: ${e}`);
      for (const u of tags?.unknown ?? []) out.warnings.push(`The template has a tag that is not in the tag reference: {${u}}. It will show [not available].`);
      for (const m of tags?.missingRecommended ?? []) out.warnings.push(`The template does not use the recommended tag {${m}}.`);
    }
    return out;
  }, [choice.mode, t, docx, doc]);
}

const MODES: TemplateMode[] = ["builtin", "their_look", "mapped", "tags"];

/**
 * The kinds of Word document that work for any tool document. "Map to their headings" is left out for the risk assessment: a
 * saved mapping names the sections of the gap document, so it cannot place the risk sections (the page says so).
 */
export const GENERIC_MODES: TemplateMode[] = ["builtin", "their_look", "tags"];

export function WordPanel({
  choice,
  doc,
  content,
  project,
  assessment,
  generatedAt,
  fileBase,
  guard,
  onExported,
  modes = MODES,
  tagData,
  testIdPrefix,
  note,
  idPrefix = "word",
  title = "Word document",
}: {
  choice: WordChoice;
  doc: DocModel;
  content: ContentBundle;
  project: Project;
  /** The gap assessment: only needed for the gap document's own tags (the default tag data). */
  assessment?: Assessment;
  generatedAt: string;
  fileBase: string;
  /** Runs the download, after the TBD warning when the document still lists TBD values. */
  guard: (run: () => void) => void;
  onExported: (template: TemplateRecord) => void;
  /** The kinds of Word document offered. A document that cannot use one (see GENERIC_MODES) leaves it out. */
  modes?: TemplateMode[];
  /** Tag data for a document other than the gap assessment. Default: the gap assessment's tags. */
  tagData?: (m: DocxModule) => TagData | DocumentTagData | SamplingTagData;
  /** Adds test ids to the download button and the result line, for pages with their own e2e tests. */
  testIdPrefix?: string;
  /** A short explanation shown under the choice of Word document (for a document that offers fewer kinds). */
  note?: string;
  /** Prefix of the element ids and of the radio group name. Needed when a page shows more than one Word panel. */
  idPrefix?: string;
  /** Heading of the panel; a page with two panels tells them apart here. */
  title?: string;
}) {
  const checks = usePreExportChecks(choice, doc);
  const items = useTemplates((s) => s.items);
  const hasPdf = items.some((t) => t.analysis.sourceFormat === "pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ file: string; template: TemplateRecord; warnings: string[]; omitted: string[] } | null>(null);
  const t = choice.template;

  async function exportWord() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const m = await loadDocx();
      try {
        const res = await m.renderDocx({
          doc,
          tagData: tagData ? tagData(m) : m.buildTagData(content, project, assessment!, doc),
          mode: choice.mode,
          generatedAt,
          // Flow figures (sampling plan) are drawn as pictures by the browser; other documents have none.
          rasteriser: browserRasteriser,
          ...(choice.mode !== "builtin" && t
            ? { template: { name: t.name, version: t.version, sha256: t.sha256, fileName: t.fileName, bytes: t.bytes, analysis: t.analysis, ...(t.mapping ? { mapping: t.mapping } : {}) } }
            : {}),
        });
        const file = `${fileBase}.docx`;
        download(file, res.bytes, DOCX_MIME);
        onExported(res.templateRecord);
        setResult({ file, template: res.templateRecord, warnings: res.warnings, omitted: res.omittedBlocks });
      } catch (e) {
        setError(e instanceof m.TemplateError ? e.message : `The Word document could not be created: ${(e as Error).message}`);
      }
    } catch (e) {
      setError(`The Word tools could not be loaded: ${(e as Error).message}. Check your connection and reload the page.`);
    } finally {
      setBusy(false);
    }
  }

  const blocked = !checks || checks.blockers.length > 0;
  return (
    <section className="card stack no-print" aria-labelledby={`${idPrefix}-title`}>
      <h2 id={`${idPrefix}-title`}>{title}</h2>
      <p className="small muted">
        Creates a .docx file in this browser with the same content as the document below. Word may lay it out slightly differently from this preview, so check it in Word before you use it. The
        banner "Proof of concept. Not validated. Not for GMP use." is always included.
      </p>
      <fieldset className="stack">
        <legend>Kind of Word document</legend>
        {modes.map((m) => (
          <label key={m} className="check top">
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              value={m}
              checked={choice.mode === m}
              onChange={() => {
                choice.setMode(m);
                setResult(null);
                setError("");
              }}
            />
            <span>
              <strong>{MODE_LABEL[m]}</strong>
              <span className="block muted small">{MODE_HELP[m]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {note && (
        <p className="small muted" data-testid={testIdPrefix ? `${testIdPrefix}-word-note` : undefined}>
          {note}
        </p>
      )}

      {choice.mode !== "builtin" && (
        <div className="stack">
          {choice.candidates.length === 0 ? (
            <p className="notice">
              No template in the library works with "{MODE_LABEL[choice.mode]}".{hasPdf && choice.mode !== "mapped" ? " A PDF template can only be used with \"Map to their headings\"." : ""} Add one on the{" "}
              <a href={href("/templates")}>Templates page</a>.
            </p>
          ) : (
            <label className="field">
              <span>Template</span>
              <select value={t?.id ?? ""} onChange={(e) => choice.setTemplateId(e.target.value)}>
                {choice.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (version {c.version}, {shortHash(c.sha256)})
                  </option>
                ))}
              </select>
            </label>
          )}
          {choice.mode === "mapped" && t && (
            <p className="small">
              <a href={href(`/templates/${t.id}/mapping`)}>{t.mapping ? "Edit the heading mapping" : "Create the heading mapping"}</a> for {t.name}.
            </p>
          )}
        </div>
      )}

      <div className="stack" aria-live="polite">
        <h3>Before you download</h3>
        {!checks ? (
          <p className="small muted">Checking the template…</p>
        ) : (
          <>
            {checks.blockers.length > 0 && (
              <div id={`${idPrefix}-blockers`}>
                <p className="error">The Word document cannot be created yet:</p>
                <ul className="plain-list small">
                  {checks.blockers.map((b) => (
                    <li key={b} className="error">
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {checks.warnings.length > 0 && (
              <div>
                <p className="small">
                  <strong>Warnings</strong>
                </p>
                <ul className="plain-list small">
                  {checks.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {checks.notes.length > 0 && (
              <div>
                <p className="small">
                  <strong>Please note</strong>
                </p>
                <ul className="plain-list small">
                  {checks.notes.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {checks.blockers.length + checks.warnings.length + checks.notes.length === 0 && <p className="small muted">No problems found.</p>}
          </>
        )}
      </div>

      <div className="row wrap">
        <button type="button" className="btn primary" disabled={blocked || busy} aria-describedby={checks?.blockers.length ? `${idPrefix}-blockers` : undefined} data-testid={testIdPrefix ? `${testIdPrefix}-download-word` : undefined} onClick={() => guard(() => void exportWord())}>
          {busy ? "Creating…" : "Download Word document"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {result && (
          <div className="stack" data-testid={testIdPrefix ? `${testIdPrefix}-word-result` : undefined}>
            <p>
              Downloaded <strong>{result.file}</strong> using {MODE_LABEL[result.template.mode]}: {templateText(result.template)}.
            </p>
            {result.omitted.length > 0 && <p className="small">Left out by choice: {result.omitted.join("; ")}.</p>}
            {result.warnings.length > 0 && (
              <div>
                <p className="small">
                  <strong>Warnings from the export</strong>
                </p>
                <ul className="plain-list small">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ export history

/** What the document was downloaded with and when. Not a revision history: formal versions live in the company's document system. */
export function ExportHistory({ exports, idPrefix = "export-history", title = "Export history" }: { exports: DocumentExport[]; idPrefix?: string; title?: string }) {
  const rows = [...exports].reverse();
  return (
    <section className="card stack no-print" aria-labelledby={`${idPrefix}-title`}>
      <h2 id={`${idPrefix}-title`}>{title}</h2>
      {rows.length === 0 ? (
        <Empty>Nothing has been downloaded from this project yet.</Empty>
      ) : (
        <div className="table-scroll" role="region" aria-label={`${title} table`} tabIndex={0}>
          <table className="data export-table">
            <thead>
              <tr>
                <th scope="col">Date and person</th>
                <th scope="col">Format</th>
                <th scope="col">Template</th>
                <th scope="col">Fingerprint</th>
                <th scope="col">TBD values open</th>
                <th scope="col">Sections left out</th>
                <th scope="col">Answers changed since previous download</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.at}-${i}`}>
                  <td className="small">
                    {dateTime(r.at)}
                    {r.by && <div className="muted">{r.by}</div>}
                  </td>
                  <td>{FORMAT_LABEL[r.format]}</td>
                  <td className="small">
                    {r.template.name} {r.template.version}
                    {r.versions && (
                      <div className="muted" data-testid="export-versions">
                        Process model {r.versions.processModel}; catalog {r.versions.catalog}; {r.format.startsWith("sampling-") ? "plan" : r.format.startsWith("risk-") ? "risk" : r.format === "trd-docx" || r.format === "trd-html" ? "TRD" : r.format.startsWith("mbr-") ? "batch record" : "seed"} format {r.versions.format}
                      </div>
                    )}
                    {r.template.sha256 && (
                      <div className="muted">
                        SHA-256 <code title={r.template.sha256}>{shortHash(r.template.sha256)}</code>
                      </div>
                    )}
                  </td>
                  <td className="small">
                    <code title={r.fingerprint}>{r.fingerprint}</code>
                  </td>
                  <td>{r.tbdCount ?? "Not recorded"}</td>
                  <td className="small">{((r.format.startsWith("trd-") && r.format !== "trd-docx" && r.format !== "trd-html") || r.format.startsWith("sampling-") || r.format.startsWith("mbr-")) ? "Not applicable" : r.omittedSections?.length ? r.omittedSections.map((id) => optionalSectionTitle(id) ?? id).join("; ") : "None"}</td>
                  <td>{r.changedSincePrevious === undefined ? "No earlier download" : r.changedSincePrevious ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
