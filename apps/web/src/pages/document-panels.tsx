import type { DocumentTagData, SamplingTagData, TagData, TemplateMode } from "@gap/docx";
import { BUILTIN_TEMPLATE_VERSION } from "@gap/docx/src/version";
import { optionalSectionTitle, type Assessment, type ContentBundle, type DocModel } from "@gap/engine";
import type { DocumentExport, Project, TemplateRecord } from "@gap/process-model";
import { useEffect, useMemo, useState } from "react";
import { Empty } from "../components";
import { loadDocx, useDocx, type DocxModule } from "../docx-loader";
import { browserRasteriser } from "../figureRasteriser";
import { dateTime, download, FORMAT_LABEL, MODE_HELP, MODE_LABEL, shortHash } from "../lib";
import { HelpTip } from "../HelpTip";
import { href } from "../router";
import { recordOf, useTemplates, type StoredTemplate } from "../templates-store";

export const BUILTIN_RECORD: TemplateRecord = { mode: "builtin", name: "Built-in default", version: BUILTIN_TEMPLATE_VERSION };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function templateText(t: TemplateRecord): string {
  return `${t.name} ${t.version}`;
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

export interface Checks {
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

/** The help tip next to the Word download button (the Document page shows the button beside the other downloads, so it needs the text too). */
export const WORD_EXPORT_HELP = "Creates a .docx in your browser from the document above, in the template style you chose. Check it in Word before you use it. Each download is recorded in the export history.";

const MODES: TemplateMode[] = ["builtin", "their_look", "mapped", "tags"];

/**
 * The kinds of Word document that work for any tool document. "A template's headings" is left out for the risk assessment: a
 * saved mapping names the sections of the gap document, so it cannot place the risk sections (the page says so).
 */
export const GENERIC_MODES: TemplateMode[] = ["builtin", "their_look", "tags"];

/** Everything the Word download needs. The Document page builds its own so the download button can sit beside the other downloads. */
export interface WordExportInput {
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
  /** Writes the download to the export history. Returns the problem in plain words when it could not be written (the page then says so instead of "recorded"). */
  onExported: (template: TemplateRecord) => string | null | void;
  /** Tag data for a document other than the gap assessment. Default: the gap assessment's tags. */
  tagData?: (m: DocxModule) => TagData | DocumentTagData | SamplingTagData;
  /** Data that travels inside the Word file (the TRD export carries its record, so the file can be uploaded again). Made at download time. */
  dataPart?: () => { kind: "trd-data" | "trd-form" | "sampling-data" | "sampling-form" | "gap-data" | "gap-form"; json: string };
}

/** The words on every Word download button while the file is being made (the same on every page). */
export const WORD_BUILDING_LABEL = "Building the Word file…";
/** A download that took longer than this many seconds gets a "takes about N s" note the next time (measured, never guessed). */
const SLOW_AFTER_SECONDS = 5;
const measuredSeconds = new Map<string, number>();

export interface WordExporter {
  checks: Checks | null;
  busy: boolean;
  /** "This one takes about N s" while busy, once an earlier download of this document took longer than 5 s; otherwise "". */
  slowNote: string;
  error: string;
  result: { file: string; template: TemplateRecord; warnings: string[]; omitted: string[]; historyProblem?: string } | null;
  /** True while a blocker (or the template check still running) means the download cannot be made. */
  blocked: boolean;
  /** The download itself: the TBD warning first when the document still lists TBD values, then the .docx. */
  run: () => void;
  /** Forget the last result and error (the person changed the kind of Word document). */
  reset: () => void;
}

export function useWordExport({ choice, doc, content, project, assessment, generatedAt, fileBase, guard, onExported, tagData, dataPart }: WordExportInput): WordExporter {
  const checks = usePreExportChecks(choice, doc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WordExporter["result"]>(null);
  const t = choice.template;

  async function exportWord() {
    const started = performance.now();
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
          ...(dataPart ? { dataPart: dataPart() } : {}),
          // Flow figures (sampling plan) are drawn as pictures by the browser; other documents have none.
          rasteriser: browserRasteriser,
          ...(choice.mode !== "builtin" && t
            ? { template: { name: t.name, version: t.version, sha256: t.sha256, fileName: t.fileName, bytes: t.bytes, analysis: t.analysis, ...(t.mapping ? { mapping: t.mapping } : {}) } }
            : {}),
        });
        const file = `${fileBase}.docx`;
        download(file, res.bytes, DOCX_MIME);
        const historyProblem = onExported(res.templateRecord);
        setResult({ file, template: res.templateRecord, warnings: res.warnings, omitted: res.omittedBlocks, ...(historyProblem ? { historyProblem } : {}) });
      } catch (e) {
        setError(e instanceof m.TemplateError ? e.message : `The Word document could not be created: ${(e as Error).message}`);
      }
    } catch (e) {
      setError(`The Word tools could not be loaded: ${(e as Error).message}. Check your connection and reload the page.`);
    } finally {
      measuredSeconds.set(fileBase, Math.round((performance.now() - started) / 1000));
      setBusy(false);
    }
  }

  const lastSeconds = measuredSeconds.get(fileBase) ?? 0;
  return {
    checks,
    busy,
    slowNote: busy && lastSeconds > SLOW_AFTER_SECONDS ? `This one takes about ${lastSeconds} s.` : "",
    error,
    result,
    blocked: !checks || checks.blockers.length > 0,
    run: () => guard(() => void exportWord()),
    reset: () => {
      setResult(null);
      setError("");
    },
  };
}

/** The Word document card of a document's Output area: the kind of Word document, the checks, the download button and its result. */
export function WordPanel(props: WordPanelProps & WordExportInput) {
  const exporter = useWordExport(props);
  return <WordPanelView {...props} exporter={exporter} />;
}

export interface WordPanelProps {
  choice: WordChoice;
  /** The kinds of Word document offered. A document that cannot use one (see GENERIC_MODES) leaves it out. */
  modes?: TemplateMode[];
  /** Adds test ids to the download button and the result line, for pages with their own e2e tests. */
  testIdPrefix?: string;
  /** A short explanation shown under the choice of Word document (for a document that offers fewer kinds). */
  note?: string;
  /** Prefix of the element ids and of the radio group name. Needed when a page shows more than one Word panel. */
  idPrefix?: string;
  /** Heading of the panel; a page with two panels tells them apart here. */
  title?: string;
  /** The button label. A page with two Word panels names what each one downloads. */
  buttonLabel?: string;
  /** False where the page puts the download button elsewhere (the Document page puts it beside the other downloads). */
  showButton?: boolean;
}

export function WordPanelView({
  choice,
  exporter,
  modes = MODES,
  testIdPrefix,
  note,
  idPrefix = "word",
  title = "Word document",
  buttonLabel = "Download gap assessment (Word)",
  showButton = true,
}: WordPanelProps & { exporter: WordExporter }) {
  const { checks, busy, error, result, blocked } = exporter;
  const items = useTemplates((s) => s.items);
  const hasPdf = items.some((t) => t.analysis.sourceFormat === "pdf");
  const t = choice.template;

  return (
    <section className="card stack no-print" aria-labelledby={`${idPrefix}-title`}>
      <h2 id={`${idPrefix}-title`}>{title}</h2>
      <p className="small muted">
        Creates a .docx file in this browser with the same content as the document below. Word may lay it out slightly differently from this preview, so check it in Word before you use it. The
        drafting-aid notice is always included.
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
                exporter.reset();
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
              No template in the library works with "{MODE_LABEL[choice.mode]}".{hasPdf && choice.mode !== "mapped" ? " A PDF template can only be used with \"A template's headings\"." : ""} Add one on the{" "}
              <a href={href("/templates")}>Templates page</a>.
            </p>
          ) : (
            <label className="field">
              <span>Template</span>
              <select value={t?.id ?? ""} onChange={(e) => choice.setTemplateId(e.target.value)}>
                {choice.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (version {c.version}
                    {/* Two templates with the same name and version are told apart by the date they were added, not by a checksum. */}
                    {choice.candidates.some((o) => o !== c && o.name === c.name && o.version === c.version) ? `, added ${dateTime(c.addedAt)} (local time)` : ""})
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

      {showButton && (
        <div className="row wrap">
          <button type="button" className="btn primary" disabled={blocked || busy} aria-live="polite" aria-describedby={checks?.blockers.length ? `${idPrefix}-blockers` : undefined} data-testid={testIdPrefix ? `${testIdPrefix}-download-word` : undefined} onClick={exporter.run}>
            {busy ? WORD_BUILDING_LABEL : buttonLabel}
          </button>
          {exporter.slowNote && <span className="small muted" role="status">{exporter.slowNote}</span>}
          <HelpTip label="the Word export" text={WORD_EXPORT_HELP} />
        </div>
      )}
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
            {result.historyProblem && <p>The file is saved, but this download is not in the export history. {result.historyProblem}</p>}
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

/**
 * The gap document and the TRD seed record how many values were marked TBD; the sampling, risk, TRD and batch record documents record
 * their open items. The cell names the unit, so one column never mixes two kinds of number without saying which is which.
 */
const MARKED_TBD_FORMATS: ReadonlySet<string> = new Set(["markdown", "html", "docx", "trd-seed-json", "trd-outline-docx", "trd-outline-html"]);
function openWhenMade(r: DocumentExport): string {
  if (r.tbdCount === undefined) return "Not recorded";
  return MARKED_TBD_FORMATS.has(r.format) ? `${r.tbdCount} marked TBD` : `${r.tbdCount} open ${r.tbdCount === 1 ? "item" : "items"}`;
}

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
                <th scope="col">Date (local time) and person</th>
                <th scope="col">Format</th>
                <th scope="col">Template</th>
                <th scope="col">Open when made</th>
                <th scope="col">Sections left out</th>
                <th scope="col">Answers changed since previous download</th>
                <th scope="col">Details</th>
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
                  </td>
                  <td>{openWhenMade(r)}</td>
                  <td className="small">{((r.format.startsWith("trd-") && r.format !== "trd-docx" && r.format !== "trd-html" && r.format !== "trd-evidence-docx" && r.format !== "trd-evidence-html") || r.format.startsWith("sampling-") || r.format.startsWith("mbr-")) ? "Not applicable" : r.omittedSections?.length ? r.omittedSections.map((id) => optionalSectionTitle(id) ?? id).join("; ") : "None"}</td>
                  <td>{r.changedSincePrevious === undefined ? "No earlier download" : r.changedSincePrevious ? "Yes" : "No"}</td>
                  <td className="small">
                    {/* The codes an auditor may need, kept out of the way: a first-time reader found "Fingerprint" and "Process model 1.15.0" unexplained. */}
                    <details className="export-details" data-testid="export-details">
                      <summary>Details</summary>
                      <dl className="facts">
                        {r.version && (
                          <>
                            <dt>Version of the project</dt>
                            <dd data-testid="export-version">{r.version}</dd>
                          </>
                        )}
                        <dt>Fingerprint</dt>
                        <dd>
                          <code title={r.fingerprint}>{r.fingerprint}</code>
                          <span className="block muted">A short code made from the content. The same code means the same content.</span>
                        </dd>
                        {r.template.sha256 && (
                          <>
                            <dt>Template file checksum (SHA-256)</dt>
                            <dd>
                              <code title={r.template.sha256}>{shortHash(r.template.sha256)}</code>
                              <span className="block muted">Identifies the exact template file that was used.</span>
                            </dd>
                          </>
                        )}
                        {r.versions && (
                          <>
                            <dt>Versions used</dt>
                            <dd>
                              <span data-testid="export-versions">
                                Process model {r.versions.processModel}; catalog {r.versions.catalog}; {r.format.startsWith("sampling-") ? "plan" : r.format.startsWith("risk-") ? "risk" : r.format === "trd-docx" || r.format === "trd-html" || r.format === "trd-evidence-docx" || r.format === "trd-evidence-html" ? "TRD" : r.format.startsWith("mbr-") ? "batch record" : "seed"} format {r.versions.format}
                              </span>
                              <span className="block muted">The version of the project format, of the question catalog and of this file's layout that made it.</span>
                            </dd>
                          </>
                        )}
                      </dl>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
