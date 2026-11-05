import {
  COMPARE_DOC_NAME,
  COMPARE_DOCS,
  compareChangeWord,
  compareCounts,
  compareSummary,
  compareToCsv,
  compareVersions,
  historyOf,
  loggedBetween,
  openSide,
  WORKING_COPY_LABEL,
  type CompareRow,
} from "@gap/engine";
import type { ReviewDoc } from "@gap/process-model";
import { useEffect, useId, useMemo, useState } from "react";
import { PageHeader } from "../PageHeader";
import { Tabs, type TabDef } from "../Tabs";
import { Empty } from "../components";
import { download, projectFileStem, today } from "../lib";
import { href, navigate } from "../router";
import { useContent } from "../store";
import { useRealProject } from "../version-ui";

/** One sentence per document tab: what the rows in it are. */
const TAB_PURPOSE: Record<ReviewDoc, string> = {
  gap: "Questions of the gap assessment whose answer differs, for the sending and the receiving site, including the project stage.",
  trd: "Fields, ranges and texts of the technical requirements document that differ.",
  sampling: "Sampling points and plan settings that differ.",
  mbr: "Steps, parameter rows and sample rows of the batch record that differ.",
  risk: "Risk items, ratings and links that differ.",
};

/** Texts longer than this show their first part and a "Show all" button, so one long paragraph never pushes the table off the screen. */
const SHORT = 200;

function LongText({ text, absent }: { text: string; absent: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="muted">{absent}</span>;
  const long = text.length > SHORT || text.split("\n").length > 3;
  return (
    <>
      <span className="wrap-text" style={{ whiteSpace: "pre-wrap" }}>
        {open || !long ? text : `${text.slice(0, SHORT)}…`}
      </span>
      {long && (
        <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen(!open)} style={{ marginLeft: 8 }}>
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </>
  );
}

const fileLabel = (s: string) => s.replace(/[^A-Za-z0-9.]+/g, "-").replace(/^-|-$/g, "");

/**
 * Two versions of the project (or a version and the working copy) side by side: which answers and values differ, document by document.
 * Looking changes nothing. The change is always a word (Changed, Added in v2.1, Removed in v2.1), never colour alone.
 */
export function VersionComparePage({ params }: { params: URLSearchParams }) {
  const real = useRealProject()!;
  const content = useContent();
  const history = historyOf(real);
  const labels = [...history.entries].reverse().map((e) => e.label);
  const options = [...labels, WORKING_COPY_LABEL];
  const a = params.get("a") || labels[0] || WORKING_COPY_LABEL;
  const b = params.get("b") || WORKING_COPY_LABEL;
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [tab, setTab] = useState<ReviewDoc | null>(null);
  const [state, setState] = useState<{ rows: CompareRow[]; logged: number } | { error: string } | null>(null);
  const onlyId = useId();

  const known = options.includes(a) && options.includes(b);
  const same = a === b;

  useEffect(() => {
    if (!known || same) {
      setState(null);
      return;
    }
    let alive = true;
    setState(null);
    void (async () => {
      try {
        const [pa, pb] = await Promise.all([openSide(real, a), openSide(real, b)]);
        if (!alive) return;
        if (!pa || !pb) {
          setState({ error: "One of these versions is not in the history any more." });
          return;
        }
        setState({ rows: compareVersions(content, pa, pb, { includeSame: !onlyChanges }), logged: loggedBetween(pa, pb) });
      } catch (e) {
        if (alive) setState({ error: `The versions could not be compared. ${(e as Error).message}` });
      }
    })();
    return () => {
      alive = false;
    };
  }, [real, content, a, b, known, same, onlyChanges]);

  const go = (na: string, nb: string) => navigate("/versions/compare", { a: na, b: nb });
  const rows = state && "rows" in state ? state.rows : null;
  const counts = useMemo(() => (rows ? compareCounts(rows) : null), [rows]);
  const firstWithChanges = counts ? (COMPARE_DOCS.find((d) => counts[d] > 0) ?? "gap") : "gap";
  const current: ReviewDoc = tab ?? firstWithChanges;

  const tabs: TabDef<ReviewDoc>[] = COMPARE_DOCS.map((d) => ({
    id: d,
    label: `${COMPARE_DOC_NAME[d]}${counts ? ` ${counts[d]}` : ""}`,
    purpose: TAB_PURPOSE[d],
    testId: `compare-tab-${d}`,
  }));
  const shown = rows ? rows.filter((r) => r.doc === current) : [];

  return (
    <div className="stack-lg version-page compare-versions">
      <PageHeader
        title="Compare versions"
        purpose="See which answers and values differ between two versions of the project, or between a version and the working copy, one document at a time. Looking changes nothing."
        actions={
          rows ? (
            <button type="button" className="btn primary" onClick={() => download(`${projectFileStem(real.meta)}-compare-${fileLabel(a)}-${fileLabel(b)}-${today()}.csv`, compareToCsv(rows, a, b), "text/csv;charset=utf-8")}>
              Export CSV
            </button>
          ) : undefined
        }
      />

      <div className="filters" role="group" aria-label="Choose what to compare">
        <label className="field">
          <span>Compare</span>
          <select value={options.includes(a) ? a : ""} onChange={(e) => go(e.target.value, b)}>
            {!options.includes(a) && <option value="">Choose a version</option>}
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>with</span>
          <select value={options.includes(b) ? b : ""} onChange={(e) => go(a, e.target.value)}>
            {!options.includes(b) && <option value="">Choose a version</option>}
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <input id={onlyId} type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
          <label htmlFor={onlyId}>Only show changes</label>
        </div>
      </div>

      {!known ? (
        <Empty>These versions are not in the history. Choose two from the lists above, or go to the <a href={href("/versions")}>version history</a>.</Empty>
      ) : same ? (
        <Empty>Choose two different versions to compare.</Empty>
      ) : !state ? (
        <p className="muted" role="status">
          Reading the versions…
        </p>
      ) : "error" in state ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : (
        <>
          <p role="status" data-testid="compare-summary">
            <strong>
              {a} and {b}: {compareSummary(state.rows)}
            </strong>
          </p>
          <p data-testid="compare-logged">
            {state.logged} {state.logged === 1 ? "change was" : "changes were"} logged between these versions. <a href={href("/changes")}>Open the change log</a>
          </p>
          <Tabs label="Documents" tabs={tabs} selected={current} onSelect={setTab} testId="compare-tabs">
            {shown.length === 0 ? (
              <Empty>{onlyChanges ? "No differences in the answers and values of this document." : "Nothing to show in this document."}</Empty>
            ) : (
              <div className="table-scroll" role="region" aria-label={`${COMPARE_DOC_NAME[current]} differences`} tabIndex={0}>
                <table className="data history-table compare-table" data-testid="compare-table">
                  <caption className="visually-hidden">
                    {COMPARE_DOC_NAME[current]}: {shown.filter((r) => r.kind !== "same").length} differences between {a} and {b}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">{a}</th>
                      <th scope="col">{b}</th>
                      <th scope="col">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={`${r.area}|${r.item}|${i}`} data-testid="compare-row">
                        <th scope="row" data-label="Item" className="normal wrap-text">
                          {r.item}
                          <div className="small muted">{r.area}</div>
                        </th>
                        <td data-label={a}>
                          <LongText text={r.a} absent={`Not in ${a}`} />
                        </td>
                        <td data-label={b}>
                          <LongText text={r.b} absent={`Not in ${b}`} />
                        </td>
                        <td data-label="Change">
                          <span className="tag">{compareChangeWord(r.kind, b)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}
