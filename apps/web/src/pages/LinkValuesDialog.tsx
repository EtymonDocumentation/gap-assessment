import { citeEntries, filterLinkCandidates, linkCandidates, locationText, sourceShort, type LinkFilter } from "@gap/engine";
import type { Source } from "@gap/process-model";
import { useMemo, useState } from "react";
import { Modal } from "../components";
import { useContent, useStore } from "../store";

/**
 * "Link values…" on a document of the Sources page: cite that document for many entries at once.
 *
 * Only entries that hold a value are listed (a citation says "this document supports this value"), entries that already cite
 * the document are shown as such and cannot be ticked, and every entry cited gets its own change-log record.
 */
export function LinkValuesDialog({ source, onClose, restoreFocus }: { source: Source; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const rows = useMemo(() => linkCandidates(content, project, source.id), [content, project, source.id]);

  const [side, setSide] = useState<NonNullable<LinkFilter["side"]>>("all");
  const [sectionId, setSectionId] = useState("");
  const [onlyUncited, setOnlyUncited] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [section, setSection] = useState("");
  const [page, setPage] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const sections = useMemo(() => [...new Map(rows.filter((r) => r.label.sectionId).map((r) => [r.label.sectionId!, r.label.sectionTitle])).entries()], [rows]);
  const shown = useMemo(() => filterLinkCandidates(rows, { side, ...(sectionId ? { sectionId } : {}), onlyUncited, text }), [rows, side, sectionId, onlyUncited, text]);
  const tickable = shown.filter((r) => !r.citedHere);
  // Only ticks that are still on screen count: a filter that hides a row also leaves it out of "Cite selected".
  const chosen = tickable.filter((r) => picked.has(r.ref));
  const alreadyHere = rows.filter((r) => r.citedHere).length;

  const toggle = (ref: string, on: boolean) =>
    setPicked((cur) => {
      const n = new Set(cur);
      if (on) n.add(ref);
      else n.delete(ref);
      return n;
    });

  const cite = () => {
    setError("");
    setResult("");
    const loc = { ...(section.trim() ? { section: section.trim() } : {}), ...(page.trim() ? { page: page.trim() } : {}) };
    let cited = 0;
    let already = 0;
    const err = update((p, actor) => {
      const r = citeEntries(p, chosen.map((c) => c.ref), source.id, loc, actor);
      cited = r.cited.length;
      already = r.skipped.filter((s) => s.reason === "already_cited").length;
      return r.project;
    }, "Values linked to the document");
    if (err) {
      setError(err);
      return;
    }
    setPicked(new Set());
    const msg = `Cited ${cited} ${cited === 1 ? "entry" : "entries"} to ${sourceShort(source)}${already ? `. ${already} already cited, left as they were` : ""}.`;
    setResult(msg);
    useStore.setState({ status: msg });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Link values to ${sourceShort(source)}`} description="Cite this document for the values it supports. Entries without a value are not listed." restoreFocus={restoreFocus} wide>
      <div className="stack">
        <div className="filters" role="search" aria-label="Filter the values">
          <label className="field">
            <span>Side</span>
            <select value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
              <option value="all">SU and RU</option>
              <option value="source">SU</option>
              <option value="target">RU</option>
            </select>
          </label>
          <label className="field">
            <span>Section</span>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">All sections</option>
              {sections.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Search</span>
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. mixing speed" />
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyUncited} onChange={(e) => setOnlyUncited(e.target.checked)} />
            <span>Not yet cited to any document</span>
          </label>
        </div>

        <p className="small muted" role="status" aria-live="polite">
          {shown.length} {shown.length === 1 ? "value" : "values"} shown, {chosen.length} selected, {alreadyHere} already cited to this document.
        </p>

        <div className="row wrap">
          <button type="button" className="btn small" onClick={() => setPicked((cur) => new Set([...cur, ...tickable.map((r) => r.ref)]))} disabled={tickable.length === 0}>
            Select all shown
          </button>
          <button type="button" className="btn small" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
            Select none
          </button>
        </div>

        <div className="table-scroll link-list" role="region" aria-label="Values to link" tabIndex={0}>
          {shown.length === 0 ? (
            <p className="muted">No value matches the filters.</p>
          ) : (
            <ul className="link-values">
              {shown.map((r) => (
                <li key={r.ref}>
                  <label className="row inline cite-option">
                    <input type="checkbox" checked={r.citedHere || picked.has(r.ref)} disabled={r.citedHere} onChange={(e) => toggle(r.ref, e.target.checked)} />
                    <span>
                      <span>{r.label.text}</span>: <strong>{r.display}</strong>
                      {r.citedHere && (
                        <span className="tag">
                          Already cited{r.location ? ` (${r.location})` : ""}
                        </span>
                      )}
                      {!r.citedHere && r.citedToDocument && <span className="tag">Cites another document</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="row wrap">
          <label className="field compact">
            <span>Section (optional)</span>
            <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. 4.2" />
          </label>
          <label className="field compact">
            <span>Page (optional)</span>
            <input value={page} onChange={(e) => setPage(e.target.value)} placeholder="e.g. 12" />
          </label>
          <p className="small muted">
            {section.trim() || page.trim() ? `Recorded as ${locationText({ section: section.trim(), page: page.trim() })} on each entry cited.` : "No place in the document is recorded unless you enter one."}
          </p>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="notice" role="status">
            {result}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={chosen.length === 0} onClick={cite}>
            Cite selected ({chosen.length})
          </button>
        </div>
      </div>
    </Modal>
  );
}
