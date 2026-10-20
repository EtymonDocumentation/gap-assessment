import { buildDocument } from "@gap/engine";
import type { HeadingMapping, OutlineHeading, TemplateMapping } from "@gap/docx";
import { useEffect, useMemo, useState } from "react";
import { Empty } from "../components";
import { useDocx } from "../docx-loader";
import { href } from "../router";
import { useAssessment, useContent, useStore } from "../store";
import { useTemplates, type StoredTemplate } from "../templates-store";

/** One row per heading, no content assigned yet: the customer's own text stays as it is. */
function blankMapping(outline: OutlineHeading[]): TemplateMapping {
  return { headings: outline.map((h) => ({ headingIndex: h.index, blocks: [], existing: "keep" })), unmappedBlocks: "append" };
}

/** A saved mapping with a row for every current heading (in case the saved one is older than the outline). */
function completeMapping(outline: OutlineHeading[], saved?: TemplateMapping): TemplateMapping {
  if (!saved) return blankMapping(outline);
  const byIndex = new Map(saved.headings.map((h) => [h.headingIndex, h]));
  return {
    unmappedBlocks: saved.unmappedBlocks,
    headings: outline.map((h) => byIndex.get(h.index) ?? { headingIndex: h.index, blocks: [], existing: "keep" }),
  };
}

/** Choose which tool content goes under each heading of a template. Nothing is applied until it is saved. */
export function MappingPage({ id }: { id: string }) {
  const items = useTemplates((s) => s.items);
  const ready = useTemplates((s) => s.ready);
  useEffect(() => {
    void useTemplates.getState().load();
  }, []);
  const t = items.find((x) => x.id === id);

  if (!ready) return <p className="muted">Loading…</p>;
  if (!t) {
    return (
      <div className="stack">
        <h1>Heading mapping</h1>
        <Empty>This template is not in the library any more.</Empty>
        <p>
          <a href={href("/templates")}>Back to templates</a>
        </p>
      </div>
    );
  }
  if (!t.analysis.usableModes.includes("mapped")) {
    return (
      <div className="stack">
        <h1>Heading mapping</h1>
        <p className="notice">
          {t.name} has no headings that can be mapped. Use it with "Their look" or "Placeholder tags" instead.
        </p>
        <p>
          <a href={href("/templates")}>Back to templates</a>
        </p>
      </div>
    );
  }
  return <Editor key={t.id} t={t} />;
}

function Editor({ t }: { t: StoredTemplate }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  const { docx, error: docxError } = useDocx();
  const [generatedAt] = useState(() => new Date().toISOString());
  const doc = useMemo(() => buildDocument(content, project, a, generatedAt), [content, project, a, generatedAt]);

  const outline = t.analysis.outline;
  const [draft, setDraft] = useState<TemplateMapping>(() => completeMapping(outline, t.mapping));
  const [leaveOutOk, setLeaveOutOk] = useState(t.mapping?.unmappedBlocks === "omit");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const pdf = t.analysis.sourceFormat === "pdf";

  const blocks = useMemo(() => (docx ? docx.toolBlocks(doc) : []), [docx, doc]);
  const titleOf = (id: string) => blocks.find((b) => b.id === id)?.title ?? id;
  const report = useMemo(() => (docx ? docx.mappingReport(t.analysis, draft, doc) : null), [docx, t.analysis, draft, doc]);
  const used = useMemo(() => new Set(draft.headings.flatMap((h) => h.blocks)), [draft]);
  const free = blocks.filter((b) => !used.has(b.id));
  const dirty = JSON.stringify(draft) !== JSON.stringify(completeMapping(outline, t.mapping));

  const edit = (index: number, fn: (h: HeadingMapping) => HeadingMapping) => {
    setError("");
    setDraft((d) => ({ ...d, headings: d.headings.map((h) => (h.headingIndex === index ? fn(h) : h)) }));
  };

  /** The first block assigned to a heading replaces their text by default; removing the last one goes back to keeping it. */
  const withBlocks = (h: HeadingMapping, next: string[]): HeadingMapping => {
    let existing = h.existing;
    if (next.length && !h.blocks.length) existing = "replace";
    if (!next.length && existing !== "flag") existing = "keep";
    return { ...h, blocks: next, existing };
  };

  function save() {
    if (!report) return;
    if (report.errors.length) return setError("The mapping has problems (listed below). Fix them before saving.");
    if (draft.unmappedBlocks === "omit" && !leaveOutOk) return setError('Tick "I understand this content will be left out of the Word document", or choose to add the unmapped content at the end.');
    useTemplates
      .getState()
      .patch(t.id, { mapping: draft })
      .then(() => {
        setError("");
        setStatus("Mapping saved.");
      })
      .catch((e: Error) => setError(`The mapping could not be saved: ${e.message}`));
  }

  return (
    <div className="stack-lg">
      <div>
        <p className="small">
          <a href={href("/templates")}>Back to templates</a>
        </p>
        <h1>Heading mapping: {t.name}</h1>
        <p className="muted">
          For each heading of the template, choose which content from this project's gap assessment goes under it. Version {t.version}, {t.fileName}. The list of content comes from the open project
          ({project.meta.title}). Nothing changes until you save, and the same mapping is used for every Word document made with "Map to their headings".
        </p>
        {pdf && (
          <p className="notice">
            This template is a PDF, so only its headings are used. A PDF has no text the tool can keep: headings without content are flagged as to be completed.
          </p>
        )}
      </div>

      {docxError && (
        <p className="error" role="alert">
          {docxError}
        </p>
      )}
      <div className="row wrap">
        <button
          type="button"
          className="btn"
          disabled={!docx}
          onClick={() => {
            if (!docx) return;
            setDraft(docx.suggestMapping(t.analysis, doc));
            setLeaveOutOk(false);
            setError("");
            setStatus("A suggested mapping was filled in from the headings' titles. Review it, then save.");
          }}
        >
          Suggest a mapping
        </button>
        <button type="button" className="btn primary" disabled={!docx || !dirty} onClick={save}>
          Save mapping
        </button>
        <span className="small muted">{dirty ? "You have unsaved changes." : t.mapping ? "Saved." : "Nothing saved yet."}</span>
      </div>
      <p className="small" role="status" aria-live="polite">
        {status}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!docx ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="map-layout">
          <section className="stack" aria-labelledby="map-headings-title">
            <h2 id="map-headings-title">Template headings ({outline.length})</h2>
            <ol className="map-list">
              {outline.map((h) => {
                const hm = draft.headings.find((x) => x.headingIndex === h.index)!;
                const label = `${h.number ? `${h.number} ` : ""}${h.text}`;
                const addId = `map-add-${h.index}`;
                const options = free;
                return (
                  <li key={h.index} className="map-row" style={{ marginInlineStart: `${(h.level - 1) * 1.25}rem` }}>
                    <div className="card tight stack">
                      <h3 className="map-heading">
                        {label} <span className="muted small normal">(level {h.level}{h.hasBody ? ", has text under it" : ""})</span>
                      </h3>
                      {hm.blocks.length > 0 ? (
                        <ol className="map-blocks" aria-label={`Tool content under ${label}`}>
                          {hm.blocks.map((b, i) => (
                            <li key={b}>
                              <span>{titleOf(b)}</span>
                              <span className="row wrap">
                                <button
                                  type="button"
                                  className="btn small"
                                  aria-label={`Move ${titleOf(b)} up under ${label}`}
                                  aria-disabled={i === 0}
                                  onClick={() => {
                                    if (i === 0) return;
                                    edit(h.index, (x) => {
                                      const n = [...x.blocks];
                                      [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                                      return { ...x, blocks: n };
                                    });
                                    setStatus(`${titleOf(b)} moved up.`);
                                  }}
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  className="btn small"
                                  aria-label={`Move ${titleOf(b)} down under ${label}`}
                                  aria-disabled={i === hm.blocks.length - 1}
                                  onClick={() => {
                                    if (i === hm.blocks.length - 1) return;
                                    edit(h.index, (x) => {
                                      const n = [...x.blocks];
                                      [n[i + 1], n[i]] = [n[i]!, n[i + 1]!];
                                      return { ...x, blocks: n };
                                    });
                                    setStatus(`${titleOf(b)} moved down.`);
                                  }}
                                >
                                  Down
                                </button>
                                <button
                                  type="button"
                                  className="btn small danger"
                                  aria-label={`Remove ${titleOf(b)} from ${label}`}
                                  onClick={() => {
                                    edit(h.index, (x) => withBlocks({ ...x }, x.blocks.filter((y) => y !== b)));
                                    setStatus(`${titleOf(b)} removed from ${label}.`);
                                    document.getElementById(addId)?.focus();
                                  }}
                                >
                                  Remove
                                </button>
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="small muted">No tool content assigned.</p>
                      )}
                      <div className="row wrap">
                        <label className="field">
                          <span>Add tool content</span>
                          <select
                            id={addId}
                            value=""
                            disabled={options.length === 0}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) return;
                              edit(h.index, (x) => withBlocks(x, [...x.blocks, v]));
                              setStatus(`${titleOf(v)} added under ${label}.`);
                            }}
                          >
                            <option value="">{options.length ? "Choose content…" : "All content is assigned"}</option>
                            {options.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Their existing text under this heading</span>
                          <select value={hm.existing} onChange={(e) => edit(h.index, (x) => ({ ...x, existing: e.target.value as HeadingMapping["existing"] }))}>
                            {hm.blocks.length > 0 ? (
                              <>
                                <option value="replace">Replace their text</option>
                                <option value="keep">Keep their text and add ours after it</option>
                              </>
                            ) : (
                              <>
                                <option value="keep">{pdf ? "Keep (a PDF has no text, so this is flagged)" : "Keep their text"}</option>
                                <option value="flag">Flag as to be completed</option>
                              </>
                            )}
                          </select>
                        </label>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <div className="stack">
            <section className="card stack" aria-labelledby="map-report-title">
              <h2 id="map-report-title">What this mapping will do</h2>
              {report && (
                <>
                  {report.errors.length > 0 && (
                    <div>
                      <h3>Problems</h3>
                      <ul className="plain-list">
                        {report.errors.map((e) => (
                          <li key={e} className="error">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <h3>Tool content not mapped ({report.unmappedBlocks.length})</h3>
                    {report.unmappedBlocks.length === 0 ? (
                      <p className="small muted">Every piece of content is mapped to a heading.</p>
                    ) : (
                      <ul className="plain-list small">
                        {report.unmappedBlocks.map((b) => (
                          <li key={b.id}>{b.title}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3>Headings flagged as to be completed ({report.flaggedHeadings.length})</h3>
                    {report.flaggedHeadings.length === 0 ? (
                      <p className="small muted">None.</p>
                    ) : (
                      <ul className="plain-list small">
                        {report.flaggedHeadings.map((h) => (
                          <li key={h.index}>
                            {h.number ? `${h.number} ` : ""}
                            {h.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {!pdf && (
                    <div>
                      <h3>Headings keeping their own text ({report.keptHeadings.length})</h3>
                      {report.keptHeadings.length === 0 ? (
                        <p className="small muted">None.</p>
                      ) : (
                        <ul className="plain-list small">
                          {report.keptHeadings.map((h) => (
                            <li key={h.index}>
                              {h.number ? `${h.number} ` : ""}
                              {h.text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>

            <fieldset className="card stack">
              <legend>Content that is not mapped</legend>
              <label className="check">
                <input
                  type="radio"
                  name="unmapped"
                  checked={draft.unmappedBlocks === "append"}
                  onChange={() => {
                    setDraft((d) => ({ ...d, unmappedBlocks: "append" }));
                    setLeaveOutOk(false);
                  }}
                />
                <span>Add it at the end (recommended)</span>
              </label>
              <label className="check">
                <input type="radio" name="unmapped" checked={draft.unmappedBlocks === "omit"} onChange={() => setDraft((d) => ({ ...d, unmappedBlocks: "omit" }))} />
                <span>Leave it out</span>
              </label>
              {draft.unmappedBlocks === "omit" && (
                <div className="na-box">
                  <label className="check">
                    <input type="checkbox" checked={leaveOutOk} onChange={(e) => setLeaveOutOk(e.target.checked)} />
                    <span>I understand this content will be left out of the Word document</span>
                  </label>
                  <p className="small muted">Each export lists what was left out, and the Word document ends with a note saying so.</p>
                </div>
              )}
            </fieldset>
          </div>
        </div>
      )}
    </div>
  );
}
