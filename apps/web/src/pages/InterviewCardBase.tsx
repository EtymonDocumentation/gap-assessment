import { glossary } from "@gap/content";
import { useId, useRef, useState, type ReactNode, type Ref } from "react";
import { href } from "../router";

/*
 * The shared interview card. One question: the prompt, the reason beside it (always visible), a hint with a glossary link, the input, and
 * the same exits everywhere ("Don't know yet", "Not applicable here", "Mark as to be decided (TBD)"). Nothing is filled in for the person:
 * boxes start empty, lists start on "Choose...", a yes/no on neither.
 *
 * It was the technical requirements document's card (M12) and moved here for the excipient assessment (M13), so the two interviews look and
 * behave the same and a first-time user learns the card once. What differs between the two is handed in as `kit`: how an answer is built from
 * what was typed, how the status reads, and the few slots only one of them has (a project value to keep, the set point / NOR / PAR fields).
 * The test ids, labels and behaviour are exactly what M12 had.
 */

export interface CardChoice {
  value: string;
  label: string;
}

/** What the card needs to know about a question. The technical requirements document's and the excipient assessment's questions both fit. */
export interface CardQuestion {
  key: string;
  prompt: string;
  why: string;
  hint?: string;
  glossary: string[];
  input: string;
  units: string[];
  choices: CardChoice[];
  state: string;
  canTbd: boolean;
  canNotApplicable: boolean;
  /** A choice question that also takes the person's own words (the excipient's class). */
  allowOwnWords?: boolean;
}

export interface CardStatus {
  /** A symbol plus the words: the state never rests on colour. */
  icon: string;
  text: string;
  tone: "open" | "done" | "project";
}

/** What has been typed or chosen in the card so far. */
export interface CardDraft {
  value: string;
  unit: string;
  values: string[];
  min: string;
  max: string;
  ownWords: string;
  reason: string;
  performed: "" | "yes" | "no";
}

/** What has been typed in the "Not applicable here" and "To be decided" panels. */
export interface CardExitDraft {
  /** Why it is not applicable. */
  reason: string;
  guess: string;
  owner: string;
  due: string;
  /** The part chosen in a panel that asks "Which one is this about?" (set point, NOR, PAR). */
  part: string;
}

/** What a slot may use of the card's state. */
export interface CardCtx {
  ids: { h: string; why: string; hint: string; err: string; input: string; saved: string };
  describedBy: string;
  large: boolean;
  draft: CardDraft;
  /** Changes the draft and marks the card as changed, not saved yet. */
  set: (patch: Partial<CardDraft>) => void;
  /** Marks the card as changed, not saved yet (for a field the card does not hold). */
  touch: () => void;
  changing: boolean;
  setChanging: (f: (v: boolean) => boolean) => void;
  exit: null | "na" | "tbd";
  exitDraft: CardExitDraft;
  setExitDraft: (patch: Partial<CardExitDraft>) => void;
}

/** What differs between the interviews. */
export interface CardKit<Q extends CardQuestion, A> {
  status: (q: Q, kept: boolean) => CardStatus;
  /** The whole "Now in the ..." sentence after the status, or nothing. */
  nowText?: (q: Q) => string | undefined;
  /** Text typed earlier that is shown in the box to be edited. Everything else starts empty. */
  prefill?: (q: Q) => string;
  /** Builds the answer from what was typed, or says in words what is wrong with it. */
  build: (q: Q, d: CardDraft) => A | string;
  /** Builds the answer of the "Not applicable here" and "To be decided" panels. */
  exitAnswer: (q: Q, kind: "na" | "tbd", d: CardExitDraft) => A | string;
  /** The wording of the "Not applicable here" box. */
  naLabel: string;
  /** False hides the "Best guess" box of the to-be-decided panel. */
  tbdGuess: boolean;
  /** True: the question already holds a value from elsewhere and the box shows it to keep or change; the input shows after "Change it". */
  fromElsewhere?: (q: Q) => boolean;
  /** Shown between the status and the input (the project value with Keep and Change, the value beside). */
  before?: (q: Q, ctx: CardCtx) => ReactNode;
  /** Replaces the input of a question the card has no input for (a yes/no about presence, the set point, NOR and PAR). */
  customInput?: (q: Q, ctx: CardCtx) => ReactNode | undefined;
  /** Shown under the input, before Save (the "Where is this written?" box). */
  afterInput?: (q: Q, ctx: CardCtx) => ReactNode;
  /** Shown at the top of the exit panel (the "Which one is this about?" list). */
  exitBefore?: (q: Q, ctx: CardCtx) => ReactNode;
  /** Shown at the end of the side column. */
  asideExtra?: (q: Q) => ReactNode;
  /** One more way out beside "Not applicable here" that writes an answer at once (the excipient's "Same as the sending site"). */
  extraExit?: { label: string; testId: string; applies: (q: Q) => boolean; answer: (q: Q) => A | string };
}

export interface BaseCardProps<Q extends CardQuestion, A> {
  q: Q;
  kit: CardKit<Q, A>;
  kept?: boolean;
  /** One-at-a-time: a large card whose heading takes the focus when the question changes. */
  large?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Writes one answer. Returns the engine's own message when it refuses, or null. */
  onSave: (q: Q, a: A) => string | null;
  /** "Don't know yet": nothing is written. The one-at-a-time view moves on. */
  onDontKnow?: (q: Q) => void;
  /** One-at-a-time only: move on for this sitting. */
  onSkip?: (q: Q) => void;
  onFocusCard?: (q: Q) => void;
  /** The word that names the card in an error: the question's own label, else its heading. */
  errorLabel: string;
}

/** A unit control: the units as a list that starts on "Choose...", or a plain box when none are given. Never pre-chosen. */
export function UnitControl({ id, label, units, value, onChange, describedBy }: { id: string; label: string; units: string[]; value: string; onChange: (v: string) => void; describedBy?: string }) {
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

export function InterviewCardBase<Q extends CardQuestion, A>(props: BaseCardProps<Q, A>) {
  const { q, kit, kept = false, large = false, headingRef, onSave, onDontKnow, onSkip, onFocusCard, errorLabel } = props;
  const uid = useId().replace(/:/g, "");
  const ids = { h: `${uid}-h`, why: `${uid}-why`, hint: `${uid}-hint`, err: `${uid}-err`, input: `${uid}-in`, saved: `${uid}-saved` };
  const card = useRef<HTMLElement>(null);
  const [draft, setDraftState] = useState<CardDraft>(() => ({ value: kit.prefill?.(q) ?? "", unit: "", values: [], min: "", max: "", ownWords: "", reason: "", performed: "" }));
  const [changing, setChangingState] = useState(false);
  const [exit, setExit] = useState<null | "na" | "tbd">(null);
  const [exitDraft, setExitDraftState] = useState<CardExitDraft>({ reason: "", guess: "", owner: "", due: "", part: "" });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const status = kit.status(q, kept);
  const showInput = !(kit.fromElsewhere?.(q) ?? false) || changing;
  const describedBy = [ids.why, q.hint ? ids.hint : "", error ? ids.err : ""].filter(Boolean).join(" ");
  const touch = () => {
    setDirty(true);
    setSaved(false);
    setNote("");
  };
  const set = (patch: Partial<CardDraft>) => {
    setDraftState((d) => ({ ...d, ...patch }));
    touch();
  };
  const ctx: CardCtx = {
    ids,
    describedBy,
    large,
    draft,
    set,
    touch,
    changing,
    setChanging: (f) => setChangingState(f),
    exit,
    exitDraft,
    setExitDraft: (patch) => setExitDraftState((d) => ({ ...d, ...patch })),
  };

  function submit(a: A | string) {
    const err = typeof a === "string" ? a : onSave(q, a);
    if (err) {
      setError(`${errorLabel}: ${err}`);
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
  const value = draft.value;
  const autoSave = dirty && showInput && exit === null && ((q.input === "text" && value.trim()) || (q.input === "long_text" && value.trim()) || (q.input === "date" && value) || (q.input === "number" && value.trim() && !q.units.length));

  const Heading = large ? "h2" : "h3";
  const choicesOf = q.choices;

  function input(): ReactNode {
    const custom = kit.customInput?.(q, ctx);
    if (custom !== undefined) return custom;
    if (q.input === "yes_no") {
      const opts = choicesOf.length ? choicesOf : [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
      return (
        <div role="radiogroup" aria-labelledby={ids.h} aria-describedby={describedBy} className="row wrap iv-radios">
          {opts.map((o) => (
            <label key={o.value} className="check">
              <input type="radio" name={ids.input} checked={value === o.value} data-testid={`iv-option-${o.value}`} onChange={() => set({ value: o.value })} /> <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }
    if (q.input === "choice") {
      return (
        <>
          <select id={ids.input} value={value} aria-labelledby={ids.h} aria-describedby={describedBy} data-testid="iv-input" onChange={(e) => set({ value: e.target.value, ...(e.target.value ? { ownWords: "" } : {}) })}>
            <option value="">Choose...</option>
            {choicesOf.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {q.allowOwnWords && (
            <label className="field">
              <span>Or write your own words (if no option fits)</span>
              <input value={draft.ownWords} aria-describedby={describedBy} data-testid="iv-own-words" onChange={(e) => set({ ownWords: e.target.value, ...(e.target.value ? { value: "" } : {}) })} />
            </label>
          )}
        </>
      );
    }
    if (q.input === "multi_choice") {
      return (
        <div role="group" aria-labelledby={ids.h} aria-describedby={describedBy} className="stack">
          {choicesOf.map((o) => (
            <label key={o.value} className="check">
              <input
                type="checkbox"
                checked={draft.values.includes(o.value)}
                data-testid={`iv-option-${o.value}`}
                onChange={(e) => set({ values: e.target.checked ? [...draft.values, o.value] : draft.values.filter((v) => v !== o.value) })}
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
            <input inputMode="decimal" value={draft.min} aria-describedby={describedBy} data-testid="iv-min" onChange={(e) => set({ min: e.target.value })} />
          </label>
          <label className="field compact">
            <span>Highest value</span>
            <input inputMode="decimal" value={draft.max} aria-describedby={describedBy} data-testid="iv-max" onChange={(e) => set({ max: e.target.value })} />
          </label>
          <UnitControl id={`${ids.input}-u`} label="Unit" units={q.units} value={draft.unit} onChange={(v) => set({ unit: v })} describedBy={describedBy} />
        </div>
      );
    }
    if (q.input === "long_text") {
      return <textarea id={ids.input} rows={large ? 6 : 3} value={value} aria-labelledby={ids.h} aria-describedby={describedBy} data-testid="iv-input" onChange={(e) => set({ value: e.target.value })} />;
    }
    if (q.input === "date") {
      return <input id={ids.input} type="date" value={value} aria-labelledby={ids.h} aria-describedby={describedBy} data-testid="iv-input" onChange={(e) => set({ value: e.target.value })} />;
    }
    const numeric = q.input === "number" || q.input === "quantity";
    return (
      <div className="row wrap end-align">
        <input id={ids.input} className="iv-text" inputMode={numeric ? "decimal" : undefined} value={value} aria-labelledby={ids.h} aria-describedby={describedBy} data-testid="iv-input" onChange={(e) => set({ value: e.target.value })} />
        {(q.input === "quantity" || (q.input === "number" && q.units.length > 0)) && <UnitControl id={`${ids.input}-u`} label="Unit" units={q.units} value={draft.unit} onChange={(v) => set({ unit: v })} describedBy={describedBy} />}
      </div>
    );
  }

  const now = kit.nowText?.(q);

  return (
    <article
      ref={card}
      className={`iv-card${large ? " iv-card-large" : ""}`}
      data-testid={`iv-card-${q.key}`}
      data-state={q.state}
      aria-labelledby={ids.h}
      onFocus={() => onFocusCard?.(q)}
      onBlur={(e) => {
        if (autoSave && !card.current?.contains(e.relatedTarget as Node | null)) submit(kit.build(q, draft));
      }}
    >
      <div className="iv-grid">
        <div className="iv-main stack">
          <Heading id={ids.h} ref={headingRef} tabIndex={-1} className="iv-prompt" data-testid="iv-prompt">
            {q.prompt}
          </Heading>
          <p className="iv-status small" data-testid="iv-status" data-tone={status.tone}>
            <span aria-hidden="true">{status.icon}</span> <strong>{status.text}</strong>
            {now && <span className="muted"> {now}</span>}
          </p>

          {kit.before?.(q, ctx)}

          {showInput && (
            <div className="stack iv-input">
              {input()}
              {kit.afterInput?.(q, ctx)}
              <div className="row wrap iv-save-row">
                <button type="button" className="btn primary" data-testid="iv-save" onClick={() => submit(kit.build(q, draft))}>
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
            {kit.extraExit?.applies(q) && (
              <button type="button" className="btn small" data-testid={kit.extraExit.testId} onClick={() => submit(kit.extraExit!.answer(q))}>
                {kit.extraExit.label}
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
              {kit.exitBefore?.(q, ctx)}
              {exit === "na" ? (
                <label className="field">
                  <span>{kit.naLabel}</span>
                  <input value={exitDraft.reason} onChange={(e) => ctx.setExitDraft({ reason: e.target.value })} data-testid="iv-na-reason" />
                </label>
              ) : (
                <>
                  {kit.tbdGuess && (
                    <label className="field">
                      <span>Best guess (optional, shown as provisional)</span>
                      <input value={exitDraft.guess} onChange={(e) => ctx.setExitDraft({ guess: e.target.value })} data-testid="iv-tbd-guess" />
                    </label>
                  )}
                  <div className="row wrap">
                    <label className="field">
                      <span>Owner (optional)</span>
                      <input value={exitDraft.owner} onChange={(e) => ctx.setExitDraft({ owner: e.target.value })} data-testid="iv-tbd-owner" />
                    </label>
                    <label className="field compact">
                      <span>Due date (optional)</span>
                      <input type="date" value={exitDraft.due} onChange={(e) => ctx.setExitDraft({ due: e.target.value })} data-testid="iv-tbd-due" />
                    </label>
                  </div>
                </>
              )}
              <div>
                <button type="button" className="btn small primary" data-testid="iv-exit-save" onClick={() => submit(kit.exitAnswer(q, exit, exitDraft))}>
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
              {q.glossary.map((g) => {
                const term = glossary.find((x) => x.id === g)?.term;
                return (
                  <span key={g}>
                    {" "}
                    <a href={href("/glossary", { term: g })} data-testid="iv-glossary">
                      {/* Glossary terms are title-cased ("Set point"); mid-sentence they read lower-case, but
                          abbreviations ("NOR (...)") keep their capitals. */}
                      {q.glossary.length === 1 ? "What is this?" : `What is ${term && /^[A-Z][a-z]/.test(term) ? term[0]!.toLowerCase() + term.slice(1) : (term ?? g)}?`}
                    </a>
                  </span>
                );
              })}
            </p>
          )}
          {kit.asideExtra?.(q)}
        </aside>
      </div>
    </article>
  );
}
