import type { DocumentTagData, SamplingTagData, TagData, TemplateAnalysis, TemplateMode } from "@gap/docx";
import { BUILTIN_TEMPLATE_VERSION } from "@gap/docx/src/version";
import { optionalSectionTitle, rematchTrdMapping, resolveHeadingTexts, trdLeftOut, trdUnitsOf, type Assessment, type ContentBundle, type DocModel, type TrdUnitInfo } from "@gap/engine";
import type { DocumentExport, Project, TemplateRecord, TrdDocument } from "@gap/process-model";
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
  /** Set when the choice stored on the TRD names a template that is no longer in the library (the name, as it was stored). */
  missingTemplate?: string;
}

/** The choice stored on a TRD (M15): the kind of Word document and, for a template, which one. */
export interface StoredWordChoice {
  kind: "later" | TemplateMode;
  templateId?: string;
  templateName?: string;
}

/** What `useWordChoice` tells the page when the person changes the stored choice. Only a complete choice is passed on. */
export interface WordPick {
  kind: "builtin" | "their_look" | "mapped" | "tags";
  templateId?: string;
  templateName?: string;
  templateVersion?: string;
}

/**
 * The Word choice of a download panel. With `stored` (a TRD's own choice) the panel starts on it and `onPick` is told about every change, so the TRD
 * keeps the choice. "Decide later" has no kind of Word document, so the panel starts on the built-in layout (what a download needs) but says nothing is chosen.
 */
export function useWordChoice(stored?: StoredWordChoice, onPick?: (pick: WordPick) => void): WordChoice {
  const items = useTemplates((s) => s.items);
  const loaded = useTemplates((s) => s.ready);
  useEffect(() => {
    void useTemplates.getState().load();
  }, []);
  const [mode, setModeState] = useState<TemplateMode>(stored && stored.kind !== "later" ? stored.kind : "builtin");
  const [pick, setPick] = useState(stored?.templateId ?? "");
  const candidates = useMemo(() => (mode === "builtin" ? [] : items.filter((t) => t.analysis.usableModes.includes(mode))), [items, mode]);
  // Nothing is chosen for the person: the list starts on "Choose a template" even when it holds only one (EOU-38).
  const template = candidates.find((t) => t.id === pick);
  const record = mode === "builtin" ? BUILTIN_RECORD : template ? recordOf(mode, template) : undefined;
  const missing = !!stored?.templateId && mode === stored.kind && pick === stored.templateId && loaded && !items.some((t) => t.id === stored.templateId);
  const tell = (m: TemplateMode, t: StoredTemplate | undefined) => {
    if (!onPick) return;
    if (m === "builtin") onPick({ kind: "builtin" });
    else if (t) onPick({ kind: m, templateId: t.id, templateName: t.name, templateVersion: t.version });
  };
  const setMode = (m: TemplateMode) => {
    setModeState(m);
    setPick("");
    tell(m, undefined);
  };
  const setTemplateId = (id: string) => {
    setPick(id);
    tell(mode, items.find((t) => t.id === id));
  };
  return { mode, setMode, candidates, template, setTemplateId, record, ...(missing && stored?.templateName ? { missingTemplate: stored.templateName } : {}) };
}
// ------------------------------------------------------------------ Word document panel

export interface Checks {
  blockers: string[];
  warnings: string[];
  notes: string[];
}

/**
 * The template warnings that matter for the kind of Word document chosen. The analysis is made once, when the template is added, so it
 * names every kind; a tagged template was being told about a missing "Heading 3" that only a template's look or headings (or a body tag) use.
 */
function warningsFor(mode: TemplateMode, a: TemplateAnalysis): string[] {
  const usesBody = a.tags?.found.includes("@body") ?? false;
  return a.warnings.filter((w) => {
    if (w.startsWith("The template does not define these Word styles")) return mode !== "tags" || usesBody;
    if (w.startsWith("No headings were found")) return mode === "mapped";
    if (w.startsWith("The template contains tracked changes")) return mode === "mapped" || mode === "their_look";
    if (w.startsWith("The template has problems with its tags")) return mode === "tags";
    return true;
  });
}

/**
 * What the TRD's Word download needs to follow a template's own headings (M15): the TRD itself (the text written under headings and the
 * sections added at the end are kept on it) and the TRD regrouped into units (`trdUnitModel`), which is what gets placed.
 */
export interface TrdWordInput {
  d: TrdDocument;
  unitDoc: DocModel;
}

/** The stored match of a template against the TRD as it is now: re-matched by heading text, with what is left out and what has no content. */
export function trdMatchState(t: StoredTemplate, trd: TrdWordInput) {
  const outline = t.analysis.outline;
  const rematched = rematchTrdMapping(outline, t.trdMapping);
  const units: TrdUnitInfo[] = trdUnitsOf(trd.unitDoc);
  const known = new Set(units.map((u) => u.id));
  const written = resolveHeadingTexts(outline, trd.d.headingTexts);
  const leftOut = trdLeftOut(units, rematched.mapping, trd.d.addedBack);
  // A heading with nothing of Cascade's under it shows the text written for it, else its own text, else "[To be completed.]".
  const toComplete = outline.filter((h) => !h.hasBody && !written.byIndex.has(h.index) && !(rematched.mapping.headings.find((p) => p.headingIndex === h.index)?.units.some((u) => known.has(u)) ?? false));
  return { rematched, units, leftOut, toComplete, empty: !t.trdMapping || (!rematched.mapping.headings.length && !trd.d.addedBack?.length) };
}

/** Everything worth knowing before a download. A blocker disables the button; the rest is information. */
function usePreExportChecks(choice: WordChoice, doc: DocModel, trd?: TrdWordInput): Checks | null {
  const { docx } = useDocx(choice.mode !== "builtin");
  const t = choice.template;
  return useMemo(() => {
    const out: Checks = { blockers: [], warnings: [], notes: [] };
    if (choice.mode === "builtin") return out;
    if (!t) {
      out.blockers.push(choice.candidates.length === 0 ? "No template in the library works with this option. Add one on the Templates page." : "Choose a template above, or go back to the built-in layout.");
      return out;
    }
    if (!docx) return null;
    out.warnings.push(...warningsFor(choice.mode, t.analysis));
    if (choice.mode === "mapped" && trd) {
      // The TRD has its own match (the gap assessment's heading placement names the gap document's sections, so it is not used here).
      const s = trdMatchState(t, trd);
      if (s.empty) {
        out.blockers.push("This template has no match for the TRD yet. Choose \"Match your headings\" below, then download.");
      } else {
        if (s.rematched.again.length) out.warnings.push(`${s.rematched.again.length} ${s.rematched.again.length === 1 ? "heading" : "headings"} you matched earlier ${s.rematched.again.length === 1 ? "is" : "are"} not in the template any more, so their content is not placed: ${s.rematched.again.map((p) => p.headingText).join("; ")}.`);
        if (s.leftOut.length) out.warnings.push(`${s.leftOut.length} ${s.leftOut.length === 1 ? "section is" : "sections are"} not in your template and will be left out of the Word file: ${s.leftOut.map((u) => u.title).join("; ")}.`);
        if (s.toComplete.length) out.notes.push(`${s.toComplete.length} ${s.toComplete.length === 1 ? "heading has" : "headings have"} no content and no text of your own. ${s.toComplete.length === 1 ? "It" : "They"} will say "[To be completed.]" in the Word file: ${s.toComplete.map((h) => h.text).join("; ")}.`);
      }
    } else if (choice.mode === "mapped") {
      if (!t.mapping) {
        out.blockers.push("This template has no heading placement yet. Choose where the content goes under its headings, and save it.");
      } else {
        const r = docx.mappingReport(t.analysis, t.mapping, doc);
        out.blockers.push(...r.errors);
        if (r.unmappedBlocks.length) {
          const titles = r.unmappedBlocks.map((b) => b.title).join("; ");
          if (t.mapping.unmappedBlocks === "append") {
            out.notes.push(`${r.unmappedBlocks.length} ${r.unmappedBlocks.length === 1 ? "part" : "parts"} of the content ${r.unmappedBlocks.length === 1 ? "is" : "are"} not placed under a heading and will be added at the end: ${titles}.`);
          } else {
            out.warnings.push(`${r.unmappedBlocks.length} ${r.unmappedBlocks.length === 1 ? "part" : "parts"} of the content will be left out of the Word document, as you chose in the heading placement: ${titles}.`);
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
  }, [choice.mode, t, docx, doc, trd]);
}

/** The help tip next to the Word download button (the Document page shows the button beside the other downloads, so it needs the text too). */
export const WORD_EXPORT_HELP = "Creates a .docx in your browser from the document above, in the template style you chose. Check it in Word before you use it. Each download is recorded in the export history.";

/**
 * Every kind of Word document, in the order the Document page offers them. The TRD's start path offers the same four, in the same order, with the same
 * words (MODE_LABEL and MODE_HELP in lib.ts are the one source), so "A template's headings" reads the same wherever it is chosen.
 */
export const WORD_MODES: TemplateMode[] = ["builtin", "their_look", "mapped", "tags"];
const MODES = WORD_MODES;

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
  /** The TRD, for "A template's headings": its own match of the template's headings is used instead of the gap assessment's heading placement. */
  trd?: TrdWordInput;
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
  result: { file: string; template: TemplateRecord; warnings: string[]; omitted: string[]; toComplete: string[]; historyProblem?: string } | null;
  /** True while a blocker (or the template check still running) means the download cannot be made. */
  blocked: boolean;
  /** The download itself: the TBD warning first when the document still lists TBD values, then the .docx. */
  run: () => void;
  /** Forget the last result and error (the person changed the kind of Word document). */
  reset: () => void;
}

export function useWordExport({ choice, doc, content, project, assessment, generatedAt, fileBase, guard, onExported, tagData, dataPart, trd }: WordExportInput): WordExporter {
  const checks = usePreExportChecks(choice, doc, trd);
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
        // "A template's headings" for a TRD places the TRD's units (not the document's numbered sections) under the template's own headings.
        const byHeadings = !!trd && choice.mode === "mapped" && !!t;
        const res = await m.renderDocx({
          doc: byHeadings ? trd!.unitDoc : doc,
          ...(byHeadings ? { trd: { mapping: t!.trdMapping ?? { headings: [] }, ...(trd!.d.headingTexts ? { headingTexts: trd!.d.headingTexts } : {}), ...(trd!.d.addedBack ? { addedBack: trd!.d.addedBack } : {}) } } : {}),
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
        setResult({ file, template: res.templateRecord, warnings: res.warnings, omitted: res.omittedBlocks, toComplete: res.toComplete, ...(historyProblem ? { historyProblem } : {}) });
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
  /** The TRD (see `TrdWordInput`): "A template's headings" then uses the TRD's own match, and the panel links to it. */
  trd?: TrdWordInput;
}

/** The TRD's match of a template: how many sections the template has no heading for, and the link to the match screen. */
function TrdMatchLinks({ t, trd }: { t: StoredTemplate; trd: TrdWordInput }) {
  const s = trdMatchState(t, trd);
  return (
    <div className="stack" data-testid="trd-match-links">
      {!s.empty && (
        <p className="small" data-testid="trd-not-in-template">
          Not in your template: {s.leftOut.length} {s.leftOut.length === 1 ? "section" : "sections"}.{" "}
          {s.leftOut.length > 0 && <a href={href(`/templates/${t.id}/trd-match`, { trd: trd.d.id })}>See which and place them</a>}
        </p>
      )}
      <p className="small">
        <a href={href(`/templates/${t.id}/trd-match`, { trd: trd.d.id })}>{t.trdMapping ? "Edit the match of your headings" : "Match your headings"}</a> for {t.name}.
      </p>
    </div>
  );
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
  trd,
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
        <p className="small muted">Most people keep the built-in layout. The other kinds use a Word template of your own, added on the Templates page.</p>
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
        <details className="small" data-testid={testIdPrefix ? `${testIdPrefix}-word-note` : undefined}>
          <summary>About template headings and tags</summary>
          <p className="muted">{note}</p>
        </details>
      )}

      {choice.mode !== "builtin" && (
        <div className="stack">
          {choice.missingTemplate && (
            <p className="notice" role="status" data-testid="word-template-missing">
              The Word template chosen for this TRD, "{choice.missingTemplate}", is not in the library any more. Pick another one below, or choose the built-in layout. The built-in
              download still works.
            </p>
          )}
          {choice.candidates.length === 0 ? (
            <p className="notice">
              No template in the library works with "{MODE_LABEL[choice.mode]}".{hasPdf && choice.mode !== "mapped" ? " A PDF template can only be used with \"A template's headings\"." : ""} Add one on the{" "}
              <a href={href("/templates")}>Templates page</a>.
            </p>
          ) : (
            <label className="field">
              <span>Template</span>
              <select value={t?.id ?? ""} onChange={(e) => choice.setTemplateId(e.target.value)}>
                <option value="">Choose a template</option>
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
          {choice.mode === "mapped" && t && !trd && (
            <p className="small">
              <a href={href(`/templates/${t.id}/mapping`)}>{t.mapping ? "Edit the heading placement" : "Set the heading placement"}</a> for {t.name}.
            </p>
          )}
          {choice.mode === "mapped" && t && trd && <TrdMatchLinks t={t} trd={trd} />}
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
            {result.toComplete.length > 0 && (
              <p className="small" data-testid={testIdPrefix ? `${testIdPrefix}-to-complete` : undefined}>
                {result.toComplete.length} {result.toComplete.length === 1 ? "heading has" : "headings have"} no content and no text of your own. {result.toComplete.length === 1 ? "It says" : "They say"} "[To be completed.]" in the Word file: {result.toComplete.join("; ")}.
              </p>
            )}
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

/**
 * The downloads of ONE document of a kind (one TRD, one sampling plan, one risk assessment, one excipient assessment, one batch record
 * and its parts). Each download records the id of the document it was of; a record from before ids were kept has none, and is shown
 * for the document only when it is the only one of its kind (then it can only have been of that one).
 */
export function exportsOfDocument(all: readonly DocumentExport[], formats: (format: DocumentExport["format"]) => boolean, documentId: string, aloneOfItsKind: boolean): DocumentExport[] {
  return all.filter((x) => formats(x.format) && (x.documentId === undefined ? aloneOfItsKind : x.documentId === documentId || x.documentId.startsWith(`${documentId}:`)));
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
                                Process model {r.versions.processModel}; catalog {r.versions.catalog}; {r.format.startsWith("sampling-") ? "plan" : r.format.startsWith("risk-") ? "risk" : r.format.startsWith("excipient-") ? "excipient assessment" : r.format === "trd-docx" || r.format === "trd-html" || r.format === "trd-evidence-docx" || r.format === "trd-evidence-html" ? "TRD" : r.format.startsWith("mbr-") ? "batch record" : "seed"} format {r.versions.format}
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
