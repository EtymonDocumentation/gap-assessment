import { DocPreview } from "../DocPreview";
import { NO_VALUE_YET, stampDocument, buildTrdOutline, buildTrdSeed, recordExport, trdSeedCounts, trdSeedFingerprint } from "@gap/engine";
import { PROCESS_MODEL_VERSION, TRD_SEED_VERSION, parseTrdSeed, type DocumentExport, type TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlPreview } from "@gap/renderers";
import { useMemo, useRef, useState } from "react";
import { PageHeader } from "../PageHeader";
import { Modal } from "../components";
import { loadDocx } from "../docx-loader";
import { APP_VERSION, download, projectFileStem, today } from "../lib";
import { href } from "../router";
import { useTrdAllowed } from "../risk-module";
import { useContent, useStore } from "../store";
import { useVersionStamp } from "../version-ui";
import { BUILTIN_RECORD, ExportHistory, WORD_BUILDING_LABEL } from "./document-panels";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The TRD seed: the receiving unit's planned process as JSON for a technical requirements document tool, and a draft outline of that
 * document in Word or HTML. The outline is built from the seed only, so what a person reads and what a tool reads cannot differ.
 */
export function TrdSeedPage() {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  // The export time is fixed when the page opens so the preview and every download match.
  const [generatedAt] = useState(() => new Date().toISOString());
  const trdAllowed = useTrdAllowed();
  const [traceability, setTraceability] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // Round-tripped through the schema: a seed this page offers is one the reader accepts, or the page says it is not.
  const built = useMemo(() => {
    try {
      const seed = parseTrdSeed(JSON.parse(JSON.stringify(buildTrdSeed(content, project, { exportedAt: generatedAt, appVersion: APP_VERSION }))));
      return { seed, problem: "" };
    } catch (e) {
      return { seed: null, problem: (e as Error).message };
    }
  }, [content, project, generatedAt]);
  const seed = built.seed;
  const versionStamp = useVersionStamp();
  const outline = useMemo(() => (seed ? stampDocument(buildTrdOutline(seed, { traceability }), versionStamp) : null), [seed, traceability, versionStamp]);
  const body = useMemo(() => (outline ? renderHtmlPreview(outline) : ""), [outline]);
  const counts = useMemo(() => (seed ? trdSeedCounts(seed) : null), [seed]);

  const stamp = `${projectFileStem(project.meta)}-${today()}`;

  // Downloading with TBD values open is allowed, after the person has seen the count (same rule as the gap document).
  const [pending, setPending] = useState<(() => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const tbd = outline?.tbdCount ?? 0;
  const guard = (run: () => void) => {
    if (tbd > 0) {
      opener.current = document.activeElement as HTMLElement | null;
      setPending(() => run);
    } else run();
  };

  /** All three outputs are written to the export history with the versions behind them and the fingerprint of the seed. */
  const record = (format: DocumentExport["format"], template: TemplateRecord) => {
    if (!seed) return null;
    return update(
      (p, actor) =>
        recordExport(p, {
          at: new Date().toISOString(),
          by: actor.name,
          format,
          template,
          fingerprint: trdSeedFingerprint(seed),
          tbdCount: tbd,
          versions: { processModel: PROCESS_MODEL_VERSION, catalog: content.versions.catalog, format: TRD_SEED_VERSION },
        }),
      "Download recorded in the export history",
    );
  };

  // "Recorded" is only said when the history really took the entry; a problem is shown in its place.
  const saved = (file: string, problem?: string | null) => setDone(problem ? `Saved ${file}. This download is not in the export history. ${problem}` : `Saved ${file}. The download is recorded in the export history below.`);

  // The same three downloads are in the Export menu at the top and in the Download section below (which also holds the Traceability choice).
  const downloadSeedJson = () =>
    guard(() => {
      const file = `trd-seed-${stamp}.json`;
      download(file, `${JSON.stringify(seed, null, 2)}\n`, "application/json;charset=utf-8");
      saved(file, record("trd-seed-json", BUILTIN_RECORD));
    });
  const downloadOutlineWord = () => {
    if (!busy) guard(() => void exportWord());
  };
  const downloadOutlineHtml = () =>
    guard(() => {
      if (!outline) return;
      const file = `trd-outline-${stamp}.html`;
      download(file, renderHtml(outline), "text/html;charset=utf-8");
      saved(file, record("trd-outline-html", BUILTIN_RECORD));
    });
  const exportItems =
    seed && outline
      ? [
          { label: "Download TRD seed (JSON)", onSelect: downloadSeedJson },
          { label: "Download draft outline (Word)", onSelect: downloadOutlineWord },
          { label: "Download draft outline (HTML)", onSelect: downloadOutlineHtml },
        ]
      : undefined;

  async function exportWord() {
    if (!outline) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const m = await loadDocx();
      try {
        const res = await m.renderDocx({ doc: outline, mode: "builtin", generatedAt });
        const file = `trd-outline-${stamp}.docx`;
        download(file, res.bytes, DOCX_MIME);
        saved(file, record("trd-outline-docx", res.templateRecord));
      } catch (e) {
        setError(`The Word document could not be created: ${(e as Error).message}`);
      }
    } catch (e) {
      setError(`The Word tools could not be loaded: ${(e as Error).message}. Check your connection and reload the page.`);
    } finally {
      setBusy(false);
    }
  }

  const sc = seed?.scope;
  return (
    <div className="stack-lg">
      <PageHeader
        title="TRD seed"
        purpose="A technical requirements document (TRD) describes how a process will run at the receiving unit (RU)."
        about={{
          art: "page-document",
          children: (
            <>
              <p>
                This page turns the RU side of your gap assessment into a starting point for it. The <strong>TRD seed</strong> is a JSON file that a TRD tool can read. The <strong>draft outline</strong> is the same content as a Word or HTML document that a person can read.
              </p>
              <ul className="plain-list">
                <li>Only values of the RU are exported as values. SU values appear only as a reference, and only in the optional Traceability section.</li>
                <li>Nothing is filled in for you. A value nobody recorded reads "TBD", and a best guess for a TBD is labelled "TBD best guess, provisional".</li>
                <li>Process steps and topics you left out in the Scope step are not exported.</li>
                <li>The outline is not an approved TRD, and it never names a regulatory filing category.</li>
                <li>The outline uses the built-in style only. Customer templates are not applied to it yet.</li>
              </ul>
            </>
          ),
        }}
        actions={
          trdAllowed ? (
            <a className="btn" href={href("/trd", { start: "project" })} data-testid="trd-start-from-project">
              Start a TRD from this project
            </a>
          ) : undefined
        }
        exports={exportItems}
      />

      {!seed || !sc || !counts || !outline ? (
        <section className="card stack" role="alert" data-testid="trd-problem">
          <h2>The TRD seed could not be built</h2>
          <p>The seed was checked against its format before it was offered, and it did not pass:</p>
          <pre className="small">{built.problem}</pre>
        </section>
      ) : (
        <>
          <section className="card stack no-print" aria-labelledby="trd-scope-title" data-testid="trd-scope">
            <div className="row between wrap">
              <h2 id="trd-scope-title">What the seed covers</h2>
              <a className="btn" href={href("/scope")}>
                Open the Scope step
              </a>
            </div>
            <p data-testid="trd-scope-summary">
              <strong>
                {sc.included.length} process {sc.included.length === 1 ? "step" : "steps"} in scope
              </strong>
              {sc.excluded.length ? `, ${sc.excluded.length} left out by the project` : ""}
              {sc.notApplicable.length ? `, ${sc.notApplicable.length} not applicable` : ""}
              {sc.topicsLeftOut.length ? `, ${sc.topicsLeftOut.length} ${sc.topicsLeftOut.length === 1 ? "topic" : "topics"} switched off` : ""}. Receiving unit:{" "}
              {[seed.meta.receivingSite.name.display, seed.meta.receivingSite.line.display].filter(Boolean).join(", ") || "TBD"}.
            </p>
            <div className="table-scroll" role="region" aria-label="RU values per process step" tabIndex={0}>
              <table className="data trd-counts" data-testid="trd-counts">
                <caption className="visually-hidden">Number of RU values per process step by status</caption>
                <thead>
                  <tr>
                    <th scope="col">Process step</th>
                    <th scope="col">Established</th>
                    <th scope="col">Marked TBD</th>
                    <th scope="col">{NO_VALUE_YET}</th>
                    <th scope="col">Not applicable</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      <td className="num">{r.established}</td>
                      <td className="num">{r.tbd}</td>
                      <td className="num">{r.notEstablished}</td>
                      <td className="num">{r.notApplicable}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">All values, including product and site</th>
                    <td className="num">{counts.total.established}</td>
                    <td className="num">{counts.total.tbd}</td>
                    <td className="num">{counts.total.notEstablished}</td>
                    <td className="num">{counts.total.notApplicable}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {(tbd > 0 || counts.total.notEstablished > 0) && (
              <p className="notice" data-testid="trd-open-note">
                {tbd > 0 && (
                  <>
                    <strong>
                      {tbd} TBD {tbd === 1 ? "value is" : "values are"} still open.
                    </strong>{" "}
                  </>
                )}
                {counts.total.notEstablished > 0 && (
                  <>
                    {counts.total.notEstablished} {counts.total.notEstablished === 1 ? "value has" : "values have"} no value yet. They are exported as open items without a value.{" "}
                  </>
                )}
                See the <a href={href("/tbd")}>Open items page</a>.
              </p>
            )}
          </section>

          <section className="card stack no-print" aria-labelledby="trd-download-title">
            <h2 id="trd-download-title">Download</h2>
            <label className="check">
              <input type="checkbox" checked={traceability} onChange={(e) => setTraceability(e.target.checked)} data-testid="trd-traceability" />
              <span>
                <strong>Include the Traceability section in the outline</strong>
                <span className="block muted small">Shows, for each RU value, the SU value it was compared with and the gap register rows. Untick it for a document that holds RU values only. The JSON always carries the reference.</span>
              </span>
            </label>
            <div className="row wrap">
              <button type="button" className="btn primary" onClick={downloadSeedJson}>
                Download TRD seed (JSON)
              </button>
              <button type="button" className="btn" disabled={busy} aria-live="polite" onClick={downloadOutlineWord}>
                {busy ? WORD_BUILDING_LABEL : "Download draft outline (Word)"}
              </button>
              <button type="button" className="btn" onClick={downloadOutlineHtml}>
                Download draft outline (HTML)
              </button>
            </div>
            <p className="small muted">
              Files are named with the project title and today's date. The drafting-aid notice is in every output. Seed format {TRD_SEED_VERSION}, process model {PROCESS_MODEL_VERSION}.
            </p>
            <div role="status" aria-live="polite">
              {done && <p data-testid="trd-done">{done}</p>}
            </div>
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
          </section>

          <ExportHistory exports={project.document.exports} />

          <section className="stack" aria-labelledby="trd-preview-title">
            <h2 id="trd-preview-title" className="no-print">
              Outline preview
            </h2>
            <style>{DOCUMENT_CSS}</style>
            {/* Content is built from escaped text by renderHtmlBody (every value passes through escapeHtml). */}
            <DocPreview html={body} testId="trd-preview" />
          </section>
        </>
      )}

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with open items?"
          description={`This seed still lists ${tbd} ${tbd === 1 ? "value" : "values"} marked TBD. They are open items, not confirmed values, and a best guess is labelled provisional.`}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            <p data-testid="tbd-warning">
              The download will record <strong>{tbd} marked TBD</strong> in the export history.
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
