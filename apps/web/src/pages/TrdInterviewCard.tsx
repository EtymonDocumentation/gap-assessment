import { checkLimits, type InterviewAnswer, type InterviewQuestion } from "@gap/engine";
import { glossary } from "@gap/content";
import type { Source, TrdDocument, TrdItem, TrdLimits } from "@gap/process-model";
import { useId, useRef, useState, type ReactNode, type Ref } from "react";
import { href } from "../router";
import { projectValueText, sourceText, statusOf } from "../trd-interview-lib";
import { SourcePicker, type Where } from "./TrdSourcePicker";

type Part = "setPoint" | "nor" | "par";
const PARTS: Part[] = ["setPoint", "nor", "par"];
const PART_LABEL: Record<Part, string> = { setPoint: "Set point", nor: "Normal operating range (NOR)", par: "Proven acceptable range (PAR)" };

export interface CardProps {
  q: InterviewQuestion;
  d: TrdDocument;
  /** The person has looked at the project value and kept it (a mark in this browser only). */
  kept: boolean;
  /** One-at-a-time: a large card whose heading takes the focus when the question changes. */
  large?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  sources: Source[];
  /** Writes one answer. Returns the engine's own message when it refuses, or null. */
  onSave: (q: InterviewQuestion, a: InterviewAnswer) => string | null;
  onKeep: (q: InterviewQuestion) => void;
  /** "Don't know yet": nothing is written. The one-at-a-time view moves on. */
  onDontKnow?: (q: InterviewQuestion) => void;
  /** One-at-a-time only: move on for this sitting. */
  onSkip?: (q: InterviewQuestion) => void;
  onFocusCard?: (q: InterviewQuestion) => void;
}

const numOf = (t: string): number | undefined => {
  const s = t.trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** A unit control: the catalog's units as a list that starts on "Choose...", or a plain box when the catalog gives none. Never pre-chosen. */
function UnitControl({ id, label, units, value, onChange, describedBy }: { id: string; label: string; units: string[]; value: string; onChange: (v: string) => void; describedBy?: string }) {
  return (
    <label className="field compact iv-unit">
      <span>{label}</span>
      {units.length > 0 ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy}>
          <option value="">Choose...</option>
          {value && !units.includes(value) && <option value={value}>{value}</option>}
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} />
      )}
    </label>
  );
}

/**
 * One question: the prompt, the reason beside it (always visible), a hint with a glossary link, the input, and the same exits everywhere
 * ("Don't know yet", "Not applicable here", "Mark as to be decided (TBD)"). Nothing is filled in for the person: boxes start empty, lists
 * start on "Choose...", a yes/no on neither. A project value is shown as such and counts only after "Keep this" or a change.
 */
export function InterviewCard(props: CardProps) {
  const { q, d, kept, large, headingRef, sources, onSave, onKeep, onDontKnow, onSkip, onFocusCard } = props;
  const uid = useId().replace(/:/g, "");
  const ids = { h: `${uid}-h`, why: `${uid}-why`, hint: `${uid}-hint`, err: `${uid}-err`, input: `${uid}-in`, saved: `${uid}-saved` };
  const card = useRef<HTMLElement>(null);
  const t = q.target;
  // Typed text of the document and of a sentence blank is the person's own earlier answer, so it is shown to be edited; everything else starts empty.
  const prefill = q.state === "answered" && (t.kind === "document" || t.kind === "blank") && (q.input === "text" || q.input === "long_text" || q.input === "date") ? q.current ?? "" : "";
  const [value, setValue] = useState(prefill);
  const [unit, setUnit] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [reason, setReason] = useState("");
  const [performed, setPerformed] = useState<"" | "yes" | "no">("");
  const [changing, setChanging] = useState(false);
  const [exit, setExit] = useState<null | "na" | "tbd">(null);
  const [exitPart, setExitPart] = useState("");
  const [naReason, setNaReason] = useState("");
  const [guess, setGuess] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const limitsAnswer = useRef<() => InterviewAnswer | string>(() => "");

  const status = statusOf(q, kept);
  const projectNow = q.state === "from_project";
  const showInput = !projectNow || changing;
  const typedOver = projectValueText(d, q);
  const describedBy = [ids.why, q.hint ? ids.hint : "", error ? ids.err : ""].filter(Boolean).join(" ");
  const label = q.blankLabel ?? q.stepLabel;
  const touch = () => {
    setDirty(true);
    setSaved(false);
    setNote("");
  };

  function build(): InterviewAnswer | string {
    if (q.input === "limits") return limitsAnswer.current();
    if (t.kind === "presence") return performed ? { kind: "presence", performed: performed === "yes" } : "Please choose Yes or No, or choose Don't know yet.";
    const why = t.kind === "field" || t.kind === "detail" ? (reason.trim() ? { reason: reason.trim() } : {}) : {};
    if (q.input === "range") {
      const lo = numOf(min);
      const hi = numOf(max);
      if (Number.isNaN(lo)) return "Please enter the lowest value as a number, for example 12.5.";
      if (Number.isNaN(hi)) return "Please enter the highest value as a number, for example 12.5.";
      return { kind: "range", ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}), ...(unit ? { unit } : {}), ...why };
    }
    if (q.input === "multi_choice") return { kind: "value", values, ...why };
    const numeric = q.input === "number" || q.input === "quantity";
    return { kind: "value", value: numeric ? value.trim().replace(",", ".") : value, ...(unit ? { unit } : {}), ...why };
  }

  function submit(a: InterviewAnswer | string) {
    const err = typeof a === "string" ? a : onSave(q, a);
    if (err) {
      setError(`${label}: ${err}`);
      setSaved(false);
      return;
    }
    setError("");
    setSaved(true);
    setDirty(false);
    setExit(null);
    setNote("");
  }

  // "Save on leaving a finished box": only when focus leaves the whole card, so the buttons inside it (Don't know yet, Save) stay the person's choice.
  const autoSave = dirty && showInput && exit === null && ((q.input === "text" && value.trim()) || (q.input === "long_text" && value.trim()) || (q.input === "date" && value) || (q.input === "number" && value.trim() && !q.units.length));

  const Heading = large ? "h2" : "h3";
  const choicesOf = q.choices;

  function input(): ReactNode {
    if (q.input === "limits") return <LimitsFields q={q} d={d} sources={sources} labelledBy={ids.h} describedBy={describedBy} onChange={touch} expose={(f) => (limitsAnswer.current = f)} />;
    if (t.kind === "presence" || q.input === "yes_no") {
      const opts = choicesOf.length ? choicesOf : [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
      const cur = t.kind === "presence" ? performed : value;
      return (
        <div role="radiogroup" aria-labelledby={ids.h} aria-describedby={describedBy} className="row wrap iv-radios">
          {opts.map((o) => (
            <label key={o.value} className="check">
              <input
                type="radio"
                name={ids.input}
                checked={cur === o.value}
                data-testid={`iv-option-${o.value}`}
                onChange={() => {
                  if (t.kind === "presence") setPerformed(o.value === "yes" ? "yes" : "no");
                  else setValue(o.value);
                  touch();
                }}
              />{" "}
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }
    if (q.input === "choice") {
      return (
        <select id={ids.input} value={value} aria-labelledby={ids.h} aria-describedby={describedBy} data-testid="iv-input" onChange={(e) => (setValue(e.target.value), touch())}>
          <option value="">Choose...</option>
          {choicesOf.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (q.input === "multi_choice") {
      return (
        <div role="group" aria-labelledby={ids.h} aria-describedby={describedBy} className="stack">
          {choicesOf.map((o) => (
            <label key={o.value} className="check">
              <input
                type="checkbox"
                checked={values.includes(o.value)}
                data-testid={`iv-option-${o.value}`}
                onChange={(e) => (setValues(e.target.checked ? [...values, o.value] : values.filter((v) => v !== o.value)), touch())}
              />{" "}
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }
    if (q.input === "range") {
      return (
        <div className="row wrap end-align">
          <label className="field compact">
            <span>Lowest value</span>
            <input inputMode="decimal" value={min} aria-describedby={describedBy} data-testid="iv-min" onChange={(e) => (setMin(e.target.value), touch())} />
          </label>
          <label className="field compact">
            <span>Highest value</span>
            <input inputMode="decimal" value={max} aria-describedby={describedBy} data-testid="iv-max" onChange={(e) => (setMax(e.target.value), touch())} />
          </label>
          <UnitControl id={`${ids.input}-u`} label="Unit" units={q.units} value={unit} onChange={(v) => (setUnit(v), touch())} describedBy={describedBy} />
        </div>
      );
    }
    if (q.input === "long_text") {
      return <textarea id={ids.input} rows={large ? 6 : 3} value={value} aria-labelledby={ids.h} aria-describedby={describedBy} data-testid="iv-input" onChange={(e) => (setValue(e.target.value), touch())} />;
    }
    if (q.input === "date") {
      return <input id={ids.input} type="date" value={value} aria-labelledby={ids.h} aria-describedby={describedBy} data-testid="iv-input" onChange={(e) => (setValue(e.target.value), touch())} />;
    }
    const numeric = q.input === "number" || q.input === "quantity";
    return (
      <div className="row wrap end-align">
        <input
          id={ids.input}
          className="iv-text"
          inputMode={numeric ? "decimal" : undefined}
          value={value}
          aria-labelledby={ids.h}
          aria-describedby={describedBy}
          data-testid="iv-input"
          onChange={(e) => (setValue(e.target.value), touch())}
        />
        {(q.input === "quantity" || (q.input === "number" && q.units.length > 0)) && <UnitControl id={`${ids.input}-u`} label="Unit" units={q.units} value={unit} onChange={(v) => (setUnit(v), touch())} describedBy={describedBy} />}
      </div>
    );
  }

  const exitParts = t.kind === "limits" ? PARTS.filter((p) => t.parts.includes(p)) : [];
  const exitPartsAll = t.kind === "limits" ? (exitParts.length ? exitParts : PARTS) : [];
  function partProblem(): string | null {
    return t.kind === "limits" && !exitPart ? "Please choose which one this is about." : null;
  }

  return (
    <article
      ref={card}
      className={`iv-card${large ? " iv-card-large" : ""}`}
      data-testid={`iv-card-${q.key}`}
      data-state={q.state}
      aria-labelledby={ids.h}
      onFocus={() => onFocusCard?.(q)}
      onBlur={(e) => {
        if (autoSave && !card.current?.contains(e.relatedTarget as Node | null)) submit(build());
      }}
    >
      <div className="iv-grid">
        <div className="iv-main stack">
          <Heading id={ids.h} ref={headingRef} tabIndex={-1} className="iv-prompt" data-testid="iv-prompt">
            {q.prompt}
          </Heading>
          <p className="iv-status small" data-testid="iv-status" data-tone={status.tone}>
            <span aria-hidden="true">{status.icon}</span> <strong>{status.text}</strong>
            {q.state !== "open" && q.current !== undefined && !projectNow && q.state !== "tbd" && q.current && q.input !== "limits" && <span className="muted"> Now in the TRD: {q.current}</span>}
            {q.input === "limits" && q.current && <span className="muted"> Now in the TRD: {q.current}</span>}
          </p>

          {projectNow && (
            <div className="iv-project stack" data-testid="iv-project">
              <p>
                <strong>{sourceText(q) || "From the project"}:</strong> <span data-testid="iv-project-value">{q.current}</span>
              </p>
              <div className="row wrap">
                <button type="button" className="btn small" data-testid="iv-keep" disabled={kept} onClick={() => onKeep(q)}>
                  {kept ? "Kept" : "Keep this"}
                </button>
                <button type="button" className="btn small" data-testid="iv-change" aria-expanded={changing} onClick={() => setChanging((v) => !v)}>
                  {changing ? "Keep the project value" : "Change it"}
                </button>
              </div>
            </div>
          )}
          {!projectNow && q.source && q.source.kind === "uploaded file" && q.state === "answered" && <p className="small muted">{sourceText(q)}</p>}
          {typedOver !== undefined && (
            <p className="small muted" data-testid="iv-project-beside">
              Project value: {typedOver}
            </p>
          )}

          {showInput && (
            <div className="stack iv-input">
              {input()}
              {(t.kind === "field" || t.kind === "detail") && q.input !== "limits" && (
                <label className="field">
                  <span>Where is this written? (optional)</span>
                  <input value={reason} onChange={(e) => (setReason(e.target.value), touch())} data-testid="iv-reason" />
                </label>
              )}
              <div className="row wrap iv-save-row">
                <button type="button" className="btn primary" data-testid="iv-save" onClick={() => submit(build())}>
                  Save answer
                </button>
                {dirty && !saved && <span className="small muted">Changed, not saved yet.</span>}
              </div>
            </div>
          )}

          <div className="row wrap iv-exits" role="group" aria-label="If you cannot answer">
            <button
              type="button"
              className="btn small"
              data-testid="iv-dontknow"
              onClick={() => {
                setExit(null);
                setNote("Left open. It stays in the Open items list.");
                setSaved(false);
                onDontKnow?.(q);
              }}
            >
              Don't know yet
            </button>
            {q.canNotApplicable && (
              <button type="button" className="btn small" data-testid="iv-na" aria-expanded={exit === "na"} onClick={() => setExit(exit === "na" ? null : "na")}>
                Not applicable here
              </button>
            )}
            {q.canTbd && (
              <button type="button" className="btn small" data-testid="iv-tbd" aria-expanded={exit === "tbd"} onClick={() => setExit(exit === "tbd" ? null : "tbd")}>
                Mark as to be decided (TBD)
              </button>
            )}
            {onSkip && (
              <button type="button" className="btn small" data-testid="iv-skip" onClick={() => onSkip(q)}>
                Skip
              </button>
            )}
          </div>

          {exit && (
            <div className="iv-exit-panel stack" role="group" aria-label={exit === "na" ? "Not applicable here" : "To be decided"} data-testid="iv-exit-panel">
              {t.kind === "limits" && (
                <label className="field compact">
                  <span>Which one is this about?</span>
                  <select value={exitPart} onChange={(e) => setExitPart(e.target.value)} data-testid="iv-exit-part">
                    <option value="">Choose...</option>
                    {exitPartsAll.map((p) => (
                      <option key={p} value={p}>
                        {PART_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {exit === "na" ? (
                <label className="field">
                  <span>Why is it not applicable? (optional)</span>
                  <input value={naReason} onChange={(e) => setNaReason(e.target.value)} data-testid="iv-na-reason" />
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>Best guess (optional, shown as provisional)</span>
                    <input value={guess} onChange={(e) => setGuess(e.target.value)} data-testid="iv-tbd-guess" />
                  </label>
                  <div className="row wrap">
                    <label className="field">
                      <span>Owner (optional)</span>
                      <input value={owner} onChange={(e) => setOwner(e.target.value)} data-testid="iv-tbd-owner" />
                    </label>
                    <label className="field compact">
                      <span>Due date (optional)</span>
                      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="iv-tbd-due" />
                    </label>
                  </div>
                </>
              )}
              <div>
                <button
                  type="button"
                  className="btn small primary"
                  data-testid="iv-exit-save"
                  onClick={() => {
                    const p = partProblem();
                    if (p) return submit(p);
                    const part = exitPart ? { part: exitPart as Part } : {};
                    submit(exit === "na" ? { kind: "not_applicable", ...(naReason.trim() ? { reason: naReason.trim() } : {}), ...part } : { kind: "tbd", ...(guess.trim() ? { bestGuess: guess.trim() } : {}), ...(owner.trim() ? { owner: owner.trim() } : {}), ...(due ? { due } : {}), ...part });
                  }}
                >
                  {exit === "na" ? "Save as not applicable" : "Save as to be decided"}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="error" role="alert" id={ids.err} data-testid="iv-error">
              {error}
            </p>
          )}
          {saved && (
            <p className="iv-saved small" id={ids.saved} data-testid="iv-saved">
              <span aria-hidden="true">{"✓"}</span> Saved
            </p>
          )}
          {note && !saved && (
            <p className="small muted" data-testid="iv-note">
              {note}
            </p>
          )}
        </div>

        <aside className="iv-side stack" aria-label="About this question">
          <p id={ids.why} className="iv-why" data-testid="iv-why">
            <strong>Why we ask:</strong> {q.why}
          </p>
          {(q.hint || q.glossary.length > 0) && (
            <p id={ids.hint} className="small iv-hint" data-testid="iv-hint">
              {q.hint}
              {q.glossary.map((g, i) => {
                const term = glossary.find((x) => x.id === g)?.term;
                return (
                  <span key={g}>
                    {" "}
                    <a href={href("/glossary", { term: g })} data-testid="iv-glossary">
                      {/* Glossary terms are title-cased ("Set point"); mid-sentence they read lower-case, but
                          abbreviations ("NOR (...)") keep their capitals. */}
                      {q.glossary.length === 1
                        ? "What is this?"
                        : `What is ${term && /^[A-Z][a-z]/.test(term) ? term[0]!.toLowerCase() + term.slice(1) : (term ?? g)}?`}
                    </a>
                  </span>
                );
              })}
            </p>
          )}
          {q.usedIn.length > 0 && (
            <p className="small muted" data-testid="iv-used-in">
              Used in: {q.usedIn.map((u) => u.title).join("; ")}
            </p>
          )}
        </aside>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ the limits card

interface PartDraft {
  value: string;
  min: string;
  max: string;
  unit: string;
  sourceIds: string[];
  locations: Where;
}
const emptyPart = (): PartDraft => ({ value: "", min: "", max: "", unit: "", sourceIds: [], locations: {} });
const num = (n: number | undefined) => (n === undefined ? "" : String(n));

function itemOf(d: TrdDocument, q: InterviewQuestion): TrdItem | undefined {
  const t = q.target;
  if (t.kind !== "limits") return undefined;
  return d.steps.find((s) => s.key === t.unitOp)?.items.find((i) => i.collection === t.collection && i.key === t.itemKey);
}

function initialParts(limits: TrdLimits | undefined): Record<Part, PartDraft> {
  const sp = limits?.setPoint;
  return {
    setPoint: sp ? { ...emptyPart(), value: num(sp.value), unit: sp.unit ?? "", sourceIds: [...sp.sourceIds], locations: structuredClone(sp.locations ?? {}) } : emptyPart(),
    nor: limits?.nor ? { ...emptyPart(), min: num(limits.nor.min), max: num(limits.nor.max), unit: limits.nor.unit ?? "", sourceIds: [...limits.nor.sourceIds], locations: structuredClone(limits.nor.locations ?? {}) } : emptyPart(),
    par: limits?.par ? { ...emptyPart(), min: num(limits.par.min), max: num(limits.par.max), unit: limits.par.unit ?? "", sourceIds: [...limits.par.sourceIds], locations: structuredClone(limits.par.locations ?? {}) } : emptyPart(),
  };
}

const cleanWhere = (loc: Where, ids: string[]): Where => {
  const out: Where = {};
  for (const id of ids) {
    const l = loc[id];
    const c = { ...(l?.section?.trim() ? { section: l.section.trim() } : {}), ...(l?.page?.trim() ? { page: l.page.trim() } : {}) };
    if (c.section || c.page) out[id] = c;
  }
  return out;
};

/**
 * Set point, NOR and PAR as three small labelled groups (stacked on a phone), each with "Where is this from?" using the same source picker
 * as the form. The check beside them is the form's own (`checkLimits`): it reports and never blocks. Only the parts the person changed are
 * sent, so a part they did not touch (and its basis) stays exactly as it is.
 */
function LimitsFields({ q, d, sources, labelledBy, describedBy, onChange, expose }: { q: InterviewQuestion; d: TrdDocument; sources: Source[]; labelledBy: string; describedBy: string; onChange: () => void; expose: (build: () => InterviewAnswer | string) => void }) {
  const item = itemOf(d, q);
  const start = useRef(initialParts(item?.limits));
  const [parts, setParts] = useState<Record<Part, PartDraft>>(start.current);
  const set = (p: Part, patch: Partial<PartDraft>) => {
    setParts((x) => ({ ...x, [p]: { ...x[p], ...patch } }));
    onChange();
  };
  const units = q.units;

  const changed = (p: Part) => JSON.stringify(parts[p]) !== JSON.stringify(start.current[p]);
  const empty = (p: Part) => (p === "setPoint" ? !parts.setPoint.value.trim() : !parts[p].min.trim() && !parts[p].max.trim());

  expose(() => {
    const a: Extract<InterviewAnswer, { kind: "limits" }> = { kind: "limits" };
    for (const p of PARTS) {
      if (!changed(p)) continue;
      const x = parts[p];
      if (empty(p)) {
        a[p] = null;
        continue;
      }
      const cite = x.sourceIds.length || JSON.stringify(x.sourceIds) !== JSON.stringify(start.current[p].sourceIds) ? { sourceIds: x.sourceIds, locations: cleanWhere(x.locations, x.sourceIds) } : {};
      if (p === "setPoint") {
        const v = numOf(x.value);
        if (v === undefined || Number.isNaN(v)) return "Please enter the set point as a number, for example 12.5.";
        a.setPoint = { value: v, ...(x.unit.trim() ? { unit: x.unit.trim() } : {}), ...cite };
      } else {
        const lo = numOf(x.min);
        const hi = numOf(x.max);
        if (Number.isNaN(lo) || Number.isNaN(hi)) return `Please enter the ${p === "nor" ? "NOR" : "PAR"} values as numbers, for example 12.5.`;
        const have = item?.limits?.[p];
        a[p] = { ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}), ...(x.unit.trim() ? { unit: x.unit.trim() } : {}), ...(have?.basis ? { basis: have.basis } : {}), ...cite };
      }
    }
    if (a.setPoint === undefined && a.nor === undefined && a.par === undefined) return "Please enter a value, or choose Don't know yet.";
    return a;
  });

  // The form's own check, run on what is typed. It never stops a save and never decides anything.
  const draft: TrdLimits = {};
  const sp = numOf(parts.setPoint.value);
  if (sp !== undefined && !Number.isNaN(sp)) draft.setPoint = { value: sp, ...(parts.setPoint.unit ? { unit: parts.setPoint.unit } : {}), sourceIds: parts.setPoint.sourceIds };
  for (const p of ["nor", "par"] as const) {
    const lo = numOf(parts[p].min);
    const hi = numOf(parts[p].max);
    const okLo = lo !== undefined && !Number.isNaN(lo);
    const okHi = hi !== undefined && !Number.isNaN(hi);
    if (okLo || okHi) draft[p] = { ...(okLo ? { min: lo } : {}), ...(okHi ? { max: hi } : {}), ...(parts[p].unit ? { unit: parts[p].unit } : {}), sourceIds: parts[p].sourceIds };
  }
  const findings = Object.keys(draft).length ? checkLimits(draft).findings : [];
  const uid = useId().replace(/:/g, "");

  return (
    <div className="iv-limits stack" data-testid="iv-limits" role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <div className="iv-limits-grid">
        {PARTS.map((p) => {
          const isRange = p !== "setPoint";
          return (
            <fieldset key={p} className="fs stack iv-limit" data-testid={`iv-limit-${p}`}>
              <legend>{PART_LABEL[p]}</legend>
              <div className="row wrap end-align">
                {isRange ? (
                  <>
                    <label className="field compact">
                      <span>Lowest value</span>
                      <input inputMode="decimal" value={parts[p].min} onChange={(e) => set(p, { min: e.target.value })} data-testid={`iv-${p}-min`} />
                    </label>
                    <label className="field compact">
                      <span>Highest value</span>
                      <input inputMode="decimal" value={parts[p].max} onChange={(e) => set(p, { max: e.target.value })} data-testid={`iv-${p}-max`} />
                    </label>
                  </>
                ) : (
                  <label className="field compact">
                    <span>Value</span>
                    <input inputMode="decimal" value={parts[p].value} onChange={(e) => set(p, { value: e.target.value })} data-testid={`iv-${p}-value`} />
                  </label>
                )}
                <UnitControl id={`${uid}-${p}-u`} label="Unit" units={units} value={parts[p].unit} onChange={(v) => set(p, { unit: v })} />
              </div>
              <details className="small" data-testid={`iv-${p}-source`}>
                <summary>Where is this from?{parts[p].sourceIds.length ? ` (${parts[p].sourceIds.length} cited)` : " (optional)"}</summary>
                <SourcePicker testId={`iv-${p}`} newKey={`iv-${p}`} label={p === "setPoint" ? "set point" : p.toUpperCase()} sources={sources} selected={parts[p].sourceIds} locations={parts[p].locations} onChange={(n) => set(p, { sourceIds: n.sourceIds, locations: n.locations })} />
              </details>
            </fieldset>
          );
        })}
      </div>
      {findings.length > 0 && (
        <ul className="plain-list small" data-testid="iv-limits-findings" aria-label="What the check found">
          {findings.map((f, i) => (
            <li key={i}>
              <strong>{f.level === "problem" ? "Check: " : f.level === "open" ? "Open item: " : "Note: "}</strong>
              {f.text}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
