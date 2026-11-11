import {
  addTrdAddedBack,
  buildTrdDocument,
  clearTrdHeadingText,
  draftFromMapping,
  draftMissingPicks,
  mappingFromDraft,
  rematchTrdMapping,
  removeTrdAddedBack,
  resolveHeadingTexts,
  stampDocument,
  suggestTrdMatch,
  trdLibraryUnits,
  trdMatchCountLine,
  trdMatchCounts,
  trdUnitHints,
  trdUnitModel,
  trdUnitsOf,
  type TrdDraftRow,
  type TrdHeadingPick,
  type TrdUnitInfo,
} from "@gap/engine";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../PageHeader";
import { Empty } from "../components";
import { APP_VERSION } from "../lib";
import { href } from "../router";
import { useContent, useStore } from "../store";
import { useTemplates, type StoredTemplate } from "../templates-store";
import { useTrdWriteupLibrary } from "../trd-writeups-store";
import { useVersionStamp } from "../version-ui";
import { ReasonDialog } from "./ReasonDialog";

const TITLE = "Match your headings";

/** The warning for a template with no headings: one text for this screen and for step 1 of the start path, so they never drift apart. */
export const noHeadingsText = (name: string): string =>
  `${name} has no headings to put the TRD's sections under. Use it with "A template's look" or "Placeholder tags" instead, or add a Word version of the template that has headings.`;

/**
 * The match screen as step 3 of the TRD start path (M15, job 3A): the same screen, in the step bar. `backHref` is step 2, `onDone` opens the interview.
 * The screen itself is not copied; only its header and its footer change.
 */
export interface MatchStart {
  backHref: string;
  onDone: () => void;
}

/** Match drafts that were not saved when the person went Back to step 2, so Back never loses a pick (kept in memory for this visit only). */
const startDrafts = new Map<string, TrdDraftRow[]>();

/**
 * Match the sections of the TRD to the headings of one of the user's own Word templates (M15). The gap assessment has its own, older
 * heading placement page; this is the TRD's. Nothing is stored until it is saved, and a suggestion is only a suggestion until it is confirmed.
 */
export function TrdMatchPage({ id, params, start }: { id: string; params: URLSearchParams; start?: MatchStart }) {
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
        {start ? <h2>{TITLE}</h2> : <h1>{TITLE}</h1>}
        <Empty>This template is not in the library any more.</Empty>
        <p>
          {start ? (
            <a className="btn" href={start.backHref} data-testid="start-back">
              Back
            </a>
          ) : (
            <a href={href("/templates")}>Back to templates</a>
          )}
        </p>
      </div>
    );
  }
  if (!t.analysis.usableModes.includes("mapped") || t.analysis.outline.length === 0) {
    return (
      <div className="stack">
        {start ? <h2>{TITLE}</h2> : <h1>{TITLE}</h1>}
        <p className="notice" data-testid="trd-match-no-headings">
          {noHeadingsText(t.name)}
        </p>
        <p className="row wrap">
          {start ? (
            <>
              <a className="btn" href={start.backHref} data-testid="start-back">
                Back
              </a>
              {/* Nothing blocks leaving: the questions then stay in Cascade's own order. */}
              <button type="button" className="btn primary" data-testid="start-next" onClick={start.onDone}>
                Continue to the questions
              </button>
            </>
          ) : (
            <a href={href("/templates")}>Back to templates</a>
          )}
        </p>
      </div>
    );
  }
  return <Editor key={`${t.id}:${params.get("trd") ?? ""}`} t={t} trdId={params.get("trd")} {...(start ? { start } : {})} />;
}

function Editor({ t, trdId, start }: { t: StoredTemplate; trdId: string | null; start?: MatchStart }) {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const content = useContent();
  const library = useTrdWriteupLibrary();
  const versionStamp = useVersionStamp();
  const [generatedAt] = useState(() => new Date().toISOString());
  const d = trdId && project ? project.trd.documents.find((x) => x.id === trdId) : undefined;

  const outline = t.analysis.outline;
  const pdf = t.analysis.sourceFormat === "pdf";

  // The pieces a person can place: those of the open TRD (the same text its Document page shows), or every piece a TRD can have.
  const units: TrdUnitInfo[] = useMemo(() => {
    if (!d || !project) return trdLibraryUnits(library);
    const doc = stampDocument(buildTrdDocument(project, d, { generatedAt, appVersion: APP_VERSION, catalogVersion: content.versions.catalog, omit: [], content }), versionStamp);
    return trdUnitsOf(trdUnitModel(doc, d));
  }, [d, project, library, content, generatedAt, versionStamp]);
  const hints = useMemo(() => (d ? trdUnitHints(d, content) : {}), [d, content]);
  const known = useMemo(() => new Set(units.map((u) => u.id)), [units]);
  const titleOf = (unit: string) => units.find((u) => u.id === unit)?.title ?? unit;

  const rematched = useMemo(() => rematchTrdMapping(outline, t.trdMapping), [outline, t.trdMapping]);
  const draftKey = `${t.id}:${trdId ?? ""}`;
  const [rows, setRows] = useState<TrdDraftRow[]>(() => (start && startDrafts.get(draftKey)) || draftFromMapping(outline, rematched.mapping, known));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(draftFromMapping(outline, rematched.mapping, known)));
  const [asked, setAsked] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<{ kind: "back"; unit: string } | { kind: "text"; headingIndex: number; headingText: string } | null>(null);
  const dirty = JSON.stringify(rows) !== savedJson;
  // Step 3 of the start path: an unsaved draft survives Back to step 2 (and is dropped once it is saved, or equals what is saved).
  useEffect(() => {
    if (!start) return;
    if (dirty) startDrafts.set(draftKey, rows);
    else startDrafts.delete(draftKey);
  }, [start, dirty, rows, draftKey]);
  const versionChanged = !!t.trdMapping?.templateVersion && t.trdMapping.templateVersion !== t.version;

  const rowOf = (index: number) => rows.find((r) => r.headingIndex === index)!;
  const edit = (index: number, fn: (r: TrdDraftRow) => TrdDraftRow) => {
    setError("");
    setRows((all) => all.map((r) => (r.headingIndex === index ? fn(r) : r)));
  };
  // A heading without content has nothing to decide about its own text, so the pick goes with the last piece of content.
  const withUnits = (r: TrdDraftRow, next: string[]): TrdDraftRow => ({
    headingIndex: r.headingIndex,
    headingText: r.headingText,
    units: next,
    ...(next.length && r.existing ? { existing: r.existing } : {}),
  });

  const placed = useMemo(() => new Set(rows.flatMap((r) => r.units)), [rows]);
  const free = units.filter((u) => !placed.has(u.id));
  const counts = trdMatchCounts(outline, rows, units);
  const addedBack = d?.addedBack ?? [];

  // Suggestions are for headings with nothing under them yet, from content nobody has placed yet. They are shown as "Suggested" and stored only once confirmed.
  const suggestions = useMemo(() => {
    const empty = outline.filter((h) => (rows.find((r) => r.headingIndex === h.index)?.units.length ?? 0) === 0);
    return suggestTrdMatch(empty, free, hints).filter((s) => s.units.length > 0);
  }, [outline, rows, free, hints]);
  const suggestionOf = (index: number) => suggestions.find((s) => s.headingIndex === index);

  const written = useMemo(() => resolveHeadingTexts(outline, d?.headingTexts), [outline, d?.headingTexts]);

  function confirm(index: number) {
    const s = suggestionOf(index);
    if (!s) return;
    edit(index, (r) => withUnits(r, [...r.units, ...s.units]));
    setStatus(`Confirmed: ${s.units.map(titleOf).join(", ")} under ${s.headingText}. Now choose what happens to your own text there.`);
  }
  function confirmAll() {
    const all = suggestions;
    setError("");
    setRows((cur) => cur.map((r) => {
      const s = all.find((x) => x.headingIndex === r.headingIndex);
      return s ? withUnits(r, [...r.units, ...s.units]) : r;
    }));
    setStatus(`${all.length} ${all.length === 1 ? "suggestion" : "suggestions"} confirmed. Now choose what happens to your own text under each heading that has content.`);
  }

  function place(unit: string, headingIndex: number) {
    edit(headingIndex, (r) => withUnits(r, [...r.units, unit]));
    const h = outline.find((x) => x.index === headingIndex);
    setStatus(`${titleOf(unit)} placed under ${h?.text ?? "the heading"}.`);
  }

  /** Says what is held back (a heading with content and no choice about the template's own text) and returns true when something is. */
  function heldBack(): boolean {
    const missing = draftMissingPicks(rows);
    if (!missing.length) return false;
    setStatus("");
    setError(`Choose "Replace it" or "Keep it above Cascade's content" for: ${missing.join("; ")}.`);
    return true;
  }

  async function save(): Promise<boolean> {
    if (heldBack()) return false;
    try {
      await useTemplates.getState().patch(t.id, { trdMapping: mappingFromDraft(rows, t.trdMapping, known, t.version) });
      setError("");
      setSavedJson(JSON.stringify(rows));
      setStatus(start ? "Saved. The questions will follow this match." : "Saved. The Word download of a TRD that uses this template now follows this match.");
      return true;
    } catch (e) {
      setError(`The match could not be saved: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * "Continue to the questions" (step 3 of the start path). Held back exactly as Save is, in the same words: a heading with content needs the choice
   * about the template's own text. Suggestions nobody confirmed are only a guess, so they get one plain reminder first (the second press goes on:
   * leaving a heading without content is allowed, it gets a writing box in the interview). A changed match is saved on the way, so the interview sees it.
   */
  async function goOn() {
    if (!start) return;
    if (heldBack()) return;
    if (suggestions.length > 0 && !asked) {
      setAsked(true);
      setStatus(`${suggestions.length} ${suggestions.length === 1 ? "heading has a suggestion" : "headings have a suggestion"} that is not confirmed yet. Choose Confirm all suggestions, or press Continue again to go on without ${suggestions.length === 1 ? "it" : "them"}.`);
      return;
    }
    if (dirty && !(await save())) return;
    start.onDone();
  }

  const label = (h: { number?: string; text: string }) => `${h.number ? `${h.number} ` : ""}${h.text}`;
  const backToTrd = d ? href("/trd", { trd: d.id, tab: "output" }) : null;

  return (
    <div className="stack-lg" {...(start ? { "data-testid": "start-step-match" } : {})}>
      {start ? (
        <section className="stack" aria-labelledby="sp3-h">
          <h2 id="sp3-h">Step 3 of 4: {TITLE}</h2>
          <p>
            For each heading of {t.name}, choose which sections of the TRD go under it. The questions then follow your headings, in your order. Version {t.version}, {t.fileName}.
          </p>
          <p className="small muted">Nothing changes until you save or continue. Cascade only places the content; it never changes your template's cover, headers, footers or styles.</p>
        </section>
      ) : (
        <PageHeader
          title={`${TITLE}: ${t.name}`}
          purpose="For each heading of your Word template, choose which sections of the TRD go under it."
          meta={
            <>
              Version {t.version}, {t.fileName}. {d ? `The list of sections comes from ${d.id}.` : "No TRD is open here, so the list holds every section a TRD can have."}
            </>
          }
          about={{
            art: "page-mapping",
            children: <p>Nothing changes until you save. The same match is used for every Word download of a TRD with "A template's headings". Cascade only places the content; it never changes your template's cover, headers, footers or styles.</p>,
          }}
        />
      )}
      {pdf && <p className="notice">This template is a PDF, so only its headings are used. A PDF has no text the tool can keep, so a heading without content is marked "[To be completed.]".</p>}
      {trdId && !d && (
        <p className="notice" role="status" data-testid="trd-match-missing-trd">
          The TRD "{trdId}" is not in the open project, so the list holds every section a TRD can have.
        </p>
      )}
      {versionChanged && (
        <p className="notice" role="status" data-testid="trd-match-version-changed">
          This template changed since you matched it (version {t.trdMapping?.templateVersion} then, {t.version} now). Headings were found again by their words.
        </p>
      )}

      <p data-testid="trd-match-count">
        <strong>{trdMatchCountLine(counts)}</strong>
      </p>

      <div className="row wrap">
        <button type="button" className="btn" disabled={suggestions.length === 0} onClick={confirmAll} data-testid="trd-match-confirm-all">
          Confirm all suggestions
        </button>
        <button type="button" className={start ? "btn" : "btn primary"} disabled={!dirty} onClick={() => void save()} data-testid="trd-match-save">
          Save this match
        </button>
        <span className="small muted">{dirty ? "You have unsaved changes." : t.trdMapping ? "Saved." : "Nothing saved yet."}</span>
        {backToTrd && !start && (
          <a href={backToTrd} className="small">
            Back to the TRD
          </a>
        )}
      </div>
      {suggestions.length > 0 && (
        <p className="small muted">
          {suggestions.length} {suggestions.length === 1 ? "heading has" : "headings have"} a suggestion, marked "Suggested". A suggestion is only a guess from the words in the headings. Nothing is placed until you confirm it.
        </p>
      )}
      <p className="small" role="status" aria-live="polite" data-testid="trd-match-status">
        {status}
      </p>
      {error && (
        <p className="error" role="alert" data-testid="trd-match-error">
          {error}
        </p>
      )}

      {rematched.again.length > 0 && (
        <section className="card stack" aria-labelledby="trd-match-again-h" data-testid="trd-match-again">
          <h2 id="trd-match-again-h">To match again ({rematched.again.length})</h2>
          <p className="small muted">These headings from your earlier match are not in the template as it is now. Their content is not placed until you place it again below.</p>
          <ul className="plain-list small">
            {rematched.again.map((p) => (
              <li key={`${p.headingIndex}-${p.headingText}`}>
                {p.headingText}: {p.units.map(titleOf).join("; ")}
              </li>
            ))}
          </ul>
        </section>
      )}
      {written.again.length > 0 && (
        <section className="card stack" aria-labelledby="trd-match-again-text-h" data-testid="trd-match-again-text">
          <h2 id="trd-match-again-text-h">Text you wrote under headings that are gone ({written.again.length})</h2>
          <ul className="plain-list small">
            {written.again.map((w) => (
              <li key={`${w.headingIndex}-${w.headingText}`} className="stack">
                <span>
                  <strong>{w.headingText}</strong>: {w.text}
                </span>
                <span>
                  <button type="button" className="btn small danger" aria-label={`Remove this text: ${w.headingText}`} onClick={() => setRemoving({ kind: "text", headingIndex: w.headingIndex, headingText: w.headingText })}>
                    Remove this text
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack" aria-labelledby="trd-match-headings-h">
        <h2 id="trd-match-headings-h">Template headings ({outline.length})</h2>
        <ol className="map-list">
          {outline.map((h) => {
            const row = rowOf(h.index);
            const name = label(h);
            const s = suggestionOf(h.index);
            const addId = `trd-add-${h.index}`;
            const text = written.byIndex.get(h.index);
            const open = free;
            return (
              <li key={h.index} className="map-row" style={{ marginInlineStart: `${(h.level - 1) * 1.25}rem` }} data-testid={`trd-match-row-${h.index}`}>
                <div className="card tight stack">
                  <h3 className="map-heading">
                    {name} <span className="muted small normal">(level {h.level}{h.hasBody ? ", has text under it" : ", no text under it"})</span>
                  </h3>
                  {row.units.length > 0 ? (
                    <ol className="map-blocks" aria-label={`Cascade content under ${name}`}>
                      {row.units.map((u, i) => (
                        <li key={u}>
                          <span>{titleOf(u)}</span>
                          <span className="row wrap">
                            <button
                              type="button"
                              className="btn small"
                              aria-label={`Move ${titleOf(u)} up under ${name}`}
                              aria-disabled={i === 0}
                              onClick={() => {
                                if (i === 0) return;
                                edit(h.index, (r) => {
                                  const n = [...r.units];
                                  [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                                  return { ...r, units: n };
                                });
                                setStatus(`${titleOf(u)} moved up.`);
                              }}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              className="btn small"
                              aria-label={`Move ${titleOf(u)} down under ${name}`}
                              aria-disabled={i === row.units.length - 1}
                              onClick={() => {
                                if (i === row.units.length - 1) return;
                                edit(h.index, (r) => {
                                  const n = [...r.units];
                                  [n[i + 1], n[i]] = [n[i]!, n[i + 1]!];
                                  return { ...r, units: n };
                                });
                                setStatus(`${titleOf(u)} moved down.`);
                              }}
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              className="btn small danger"
                              aria-label={`Take out: ${titleOf(u)}, from under ${name}`}
                              onClick={() => {
                                edit(h.index, (r) => withUnits(r, r.units.filter((x) => x !== u)));
                                setStatus(`${titleOf(u)} taken out from under ${name}. It is listed under "Not in your template" below.`);
                                document.getElementById(addId)?.focus();
                              }}
                            >
                              Take out
                            </button>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="small muted" data-testid={`trd-match-empty-${h.index}`}>
                      No Cascade content under this heading.
                    </p>
                  )}

                  {s && (
                    <div className="row wrap" data-testid={`trd-match-suggestion-${h.index}`}>
                      <span className="tag">Suggested</span>
                      <span className="small">{s.units.map(titleOf).join("; ")}</span>
                      <button type="button" className="btn small" aria-label={`Confirm the suggestion for ${name}: ${s.units.map(titleOf).join("; ")}`} onClick={() => confirm(h.index)}>
                        Confirm
                      </button>
                    </div>
                  )}

                  {row.units.length > 0 && (
                    <fieldset className="fs stack">
                      <legend className="small">What happens to the text your template already has under this heading?</legend>
                      {(["replace", "keep"] as TrdHeadingPick[]).map((v) => (
                        <label key={v} className="check">
                          <input
                            type="radio"
                            name={`trd-pick-${h.index}`}
                            value={v}
                            checked={row.existing === v}
                            onChange={() => {
                              edit(h.index, (r) => ({ ...r, existing: v }));
                              setStatus(`${name}: ${v === "replace" ? "your text is replaced" : "your text is kept above Cascade's content"}.`);
                            }}
                          />
                          <span>{v === "replace" ? "Replace it" : "Keep it above Cascade's content"}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}

                  {text && (
                    <div className="stack" data-testid={`trd-match-written-${h.index}`}>
                      <p className="small">
                        <strong>Text you wrote for this heading:</strong> {text.text}
                      </p>
                      <p>
                        <button type="button" className="btn small danger" aria-label={`Remove this text: ${name}`} onClick={() => setRemoving({ kind: "text", headingIndex: h.index, headingText: h.text })}>
                          Remove this text
                        </button>
                      </p>
                    </div>
                  )}

                  <label className="field">
                    <span>Add Cascade content</span>
                    <select
                      id={addId}
                      value=""
                      disabled={open.length === 0}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) place(v, h.index);
                      }}
                    >
                      <option value="">{open.length ? "Choose content…" : "All content is placed"}</option>
                      {open.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card stack" aria-labelledby="trd-match-not-h" data-testid="trd-match-not-in-template">
        <h2 id="trd-match-not-h">Not in your template ({counts.notInTemplate.length})</h2>
        {counts.notInTemplate.length === 0 ? (
          <p className="small muted">Every section of the TRD is placed under a heading.</p>
        ) : (
          <>
            <p className="small muted">These sections have no heading in your template yet. Place one under a heading, or add it at the end of the Word file. Anything you do neither with is left out of the Word file and listed there as left out.</p>
            <ul className="tm-left-list">
              {counts.notInTemplate.map((u) => {
                const back = addedBack.includes(u.id);
                return (
                  <li key={u.id} className="tm-left-item" data-testid={`trd-match-left-${u.id}`}>
                    <span className="tm-left-name">
                      <strong>{u.title}</strong>
                      {back && <span className="muted small"> Added at the end, under "Additional content".</span>}
                    </span>
                    <select
                      aria-label={`Place under a heading: ${u.title}`}
                      value=""
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value !== "") place(u.id, v);
                      }}
                    >
                      <option value="">Place under a heading…</option>
                      {outline.map((h) => (
                        <option key={h.index} value={h.index}>
                          {label(h)}
                        </option>
                      ))}
                    </select>
                    <span>
                      {d ? (
                        back ? (
                          <button type="button" className="btn small danger" aria-label={`Take it out again: ${u.title}`} onClick={() => setRemoving({ kind: "back", unit: u.id })}>
                            Take it out again
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn small"
                            aria-label={`Add at the end: ${u.title}`}
                            onClick={() => {
                              const err = update((p, actor) => addTrdAddedBack(p, d.id, u.id, actor), "Section added at the end of the Word file");
                              if (err) setError(err);
                              else setStatus(`${u.title} will be added at the end of the Word file, under "Additional content".`);
                            }}
                          >
                            Add at the end
                          </button>
                        )
                      ) : (
                        <span className="small muted">Open this page from a TRD to add it at the end.</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {start && (
        <div className="row wrap">
          <a className="btn" href={start.backHref} data-testid="start-back">
            Back
          </a>
          <button type="button" className="btn primary" data-testid="start-next" onClick={() => void goOn()}>
            Continue to the questions
          </button>
        </div>
      )}

      {removing && d && (
        <ReasonDialog
          title={removing.kind === "back" ? "Take this section out of the end of the Word file?" : "Remove the text you wrote?"}
          description={removing.kind === "back" ? `${titleOf(removing.unit)} will be left out of the Word file again unless you place it under a heading. Nothing else changes.` : `The text written under "${removing.headingText}" is removed from the TRD. Nothing else changes.`}
          confirmLabel={removing.kind === "back" ? "Take it out" : "Remove the text"}
          keepLabel="Keep it"
          testId={removing.kind === "back" ? "trd-match-back-remove" : "trd-match-text-remove"}
          onClose={() => setRemoving(null)}
          onConfirm={(reason) =>
            update(
              (p, actor) => (removing.kind === "back" ? removeTrdAddedBack(p, d.id, removing.unit, reason, actor) : clearTrdHeadingText(p, d.id, { headingIndex: removing.headingIndex, headingText: removing.headingText }, reason, actor)),
              removing.kind === "back" ? "Section taken out of the end of the Word file" : "Text under a template heading removed",
            )
          }
        />
      )}
    </div>
  );
}

