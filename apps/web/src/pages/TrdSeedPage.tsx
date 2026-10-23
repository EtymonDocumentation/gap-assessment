import { buildTrdOutline, buildTrdSeed, recordExport, trdSeedCounts, trdSeedFingerprint } from "@gap/engine";
import { PROCESS_MODEL_VERSION, TRD_SEED_VERSION, parseTrdSeed, type DocumentExport, type TemplateRecord } from "@gap/process-model";
import { DOCUMENT_CSS, renderHtml, renderHtmlBody } from "@gap/renderers";
import { useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Modal } from "../components";
import { loadDocx } from "../docx-loader";
import { APP_VERSION, download, today } from "../lib";
import { href } from "../router";
import { useTrdAllowed } from "../risk-module";
import { useContent, useStore } from "../store";
import { BUILTIN_RECORD, ExportHistory } from "./document-panels";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The TRD seed: the receiving unit's planned process as JSON for a technology transfer document tool, and a draft outline of that
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
  const outline = useMemo(() => (seed ? buildTrdOutline(seed, { traceability }) : null), [seed, traceability]);
  const body = useMemo(() => (outline ? renderHtmlBody(outline) : ""), [outline]);
  const counts = useMemo(() => (seed ? trdSeedCounts(seed) : null), [seed]);

  const id = project.meta.id;
  const stamp = `${id}-${today()}`;

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
    if (!seed) return;
    update(
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

  const saved = (file: string) => setDone(`Saved ${file}. The download is recorded in the export history below.`);

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
        record("trd-outline-docx", res.templateRecord);
        saved(file);
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
      <PageBanner art="page-document">
        <h1>TRD seed</h1>
      </PageBanner>

      <section className="card stack no-print" aria-labelledby="trd-about-title">
        <h2 id="trd-about-title">What this is</h2>
        <p>
          A technology transfer document (TRD) describes how a process will run at the receiving unit (RU). This page turns the RU side of your gap assessment into a starting point for it. The{" "}
          <strong>TRD seed</strong> is a JSON file that a TRD tool can read. The <strong>draft outline</strong> is the same content as a Word or HTML document that a person can read.
        </p>
        <ul className="plain-list">
          <li>Only values of the RU are exported as values. SU values appear only as a reference, and only in the optional Traceability section.</li>
          <li>Nothing is filled in for you. A value nobody recorded reads "Not established", and a best guess for a TBD is labelled "TBD best guess, provisional".</li>
          <li>Process steps and topics you left out in the Scope step are not exported.</li>
          <li>The outline is not an approved TRD, and it never names a regulatory filing category.</li>
          <li>The outline uses the built-in style only. Customer templates are not applied to it yet.</li>
        </ul>
        {trdAllowed && (
          <div>
            <a className="btn primary" href={href("/trd", { start: "project" })} data-testid="trd-start-from-project">
              Start a TRD from this project
            </a>
          </div>
        )}
      </section>

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
              {[seed.meta.receivingSite.name.display, seed.meta.receivingSite.line.display].filter(Boolean).join(", ") || "not established"}.
            </p>
            <div className="table-scroll" role="region" aria-label="RU values per process step" tabIndex={0}>
              <table className="data trd-counts" data-testid="trd-counts">
                <caption className="visually-hidden">Number of RU values per process step by status</caption>
                <thead>
                  <tr>
                    <th scope="col">Process step</th>
                    <th scope="col">Established</th>
                    <th scope="col">TBD</th>
                    <th scope="col">Not established</th>
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
                    {counts.total.notEstablished} {counts.total.notEstablished === 1 ? "value is" : "values are"} not established. They are exported as open items without a value.{" "}
                  </>
                )}
                See the <a href={href("/tbd")}>TBD page</a>.
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
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  guard(() => {
                    const file = `trd-seed-${stamp}.json`;
                    download(file, `${JSON.stringify(seed, null, 2)}\n`, "application/json;charset=utf-8");
                    record("trd-seed-json", BUILTIN_RECORD);
                    saved(file);
                  })
                }
              >
                Download TRD seed (JSON)
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => guard(() => void exportWord())}>
                {busy ? "Creating the Word document..." : "Download draft outline (Word)"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  guard(() => {
                    const file = `trd-outline-${stamp}.html`;
                    download(file, renderHtml(outline), "text/html;charset=utf-8");
                    record("trd-outline-html", BUILTIN_RECORD);
                    saved(file);
                  })
                }
              >
                Download draft outline (HTML)
              </button>
            </div>
            <p className="small muted">
              Files are named with the project id and today's date. The banner "Proof of concept. Not validated. Not for GMP use." is in every output. Seed format {TRD_SEED_VERSION}, process model {PROCESS_MODEL_VERSION}.
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
            <div className="doc-preview" data-testid="trd-preview" dangerouslySetInnerHTML={{ __html: body }} />
          </section>
        </>
      )}

      {pending && (
        <Modal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title="Download with TBD values?"
          description={`This seed still lists ${tbd} TBD ${tbd === 1 ? "value" : "values"}. They are open items, not confirmed values, and a best guess is labelled provisional.`}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            <p data-testid="tbd-warning">
              The download will record that <strong>{tbd} TBD {tbd === 1 ? "value was" : "values were"}</strong> open when it was made.
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
