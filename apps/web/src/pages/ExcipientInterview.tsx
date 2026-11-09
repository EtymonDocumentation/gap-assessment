import { excipientClasses } from "@gap/content";
import { answerExcipientQuestion, excipientInterviewProgress, excipientOpenItems, filterExcipientQuestions, type ExcipientAnswer, type ExcipientQuestion } from "@gap/engine";
import type { ExcipientAssessment } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { EXCIPIENT_EMPTY_TEXT, EXCIPIENT_PATH, readLastQuestion, useExcipientQuestions, writeLastQuestion } from "../excipient-ui";
import { HelpTip } from "../HelpTip";
import { openItemsCount } from "../open-count";
import { href } from "../router";
import { StageRow, useProjectStage } from "../stage-ui";
import { useStore } from "../store";
import { nextIndex } from "../trd-interview-lib";
import { AddExcipientForm } from "./ExcipientAdd";
import { ExcipientCard } from "./ExcipientCard";

export type ExcipientShow = "all" | "open";
const SHOW_TEXT: Record<ExcipientShow, string> = { all: "Everything", open: "Only what is still open" };

const PROGRESS_HELP =
  "The first number is the questions you have answered. The open items are everything still to fill in this assessment: facts not established or to be decided, tests not compared yet, and excipients with no document cited. The Open items tab lists them. Anything you do not know stays open.";

/**
 * The Questions tab: plain questions that fill the same assessment the other tabs show. The list is derived from the excipients every time
 * (nothing is stored but the place you were at, in this browser), and each answer goes through the module's own edit functions, one
 * change-log entry each. The group heading is the excipient's name, so one excipient is one "step" of the interview.
 * Nothing here blocks saving, leaving or the document.
 */
export function ExcipientInterview({ a, initialShow, initialQuestion, onAdded }: { a: ExcipientAssessment; initialShow?: ExcipientShow; initialQuestion?: string; onAdded?: (lineId: string) => void }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const { stage } = useProjectStage();
  const projectId = project.meta.id;
  const all = useExcipientQuestions(a);
  const sources = useMemo(() => project.sources.filter((s) => !s.supersededBy), [project.sources]);

  const progress = useMemo(() => excipientInterviewProgress(all), [all]);
  const [show, setShow] = useState<ExcipientShow>(() => initialShow ?? (progress.overall.answered === 0 ? "all" : "open"));
  const [stay, setStay] = useState<Set<string>>(() => new Set());
  const [saved, setSaved] = useState("");
  const [one, setOne] = useState(false);
  const [seq, setSeq] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | undefined>();
  // Where the person was when they opened the tab. Fixed for the visit, so the "Continue" button does not appear under the pointer and move the cards.
  const [last] = useState<string | undefined>(() => readLastQuestion(projectId, a.id));
  const jumped = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const endRef = useRef<HTMLHeadingElement>(null);

  const openCount = useMemo(() => excipientOpenItems(project, a).length, [project, a]);
  // Questions answered in this sitting stay on screen under "Only what is still open", so the card you just filled does not vanish under you.
  const visible = useMemo(() => {
    const open = new Set(filterExcipientQuestions(all, show).map((q) => q.key));
    return all.filter((q) => open.has(q.key) || stay.has(q.key));
  }, [all, show, stay]);
  const groups = useMemo(() => {
    const out: { lineId: string; label: string; qs: ExcipientQuestion[] }[] = [];
    for (const q of visible) {
      const g = out[out.length - 1];
      if (g && g.lineId === q.lineId) g.qs.push(q);
      else out.push({ lineId: q.lineId, label: q.lineName, qs: [q] });
    }
    return out;
  }, [visible]);

  const save = (q: ExcipientQuestion, ans: ExcipientAnswer): string | null => {
    const err = update((p, actor) => answerExcipientQuestion(p, q, ans, actor, { classes: excipientClasses }), "Answer saved");
    if (err) return err;
    setStay((s) => new Set(s).add(q.key));
    setSaved("Saved.");
    return null;
  };
  const seen = (q: ExcipientQuestion) => writeLastQuestion(projectId, a.id, q.key);

  // ---- one question at a time
  const oneQs = useMemo(() => seq.map((k) => all.find((q) => q.key === k)).filter((q): q is ExcipientQuestion => Boolean(q)), [seq, all]);
  const ended = one && idx >= oneQs.length;
  const startOne = (fromKey?: string) => {
    const keys = visible.map((q) => q.key);
    const at = fromKey ? keys.indexOf(fromKey) : 0;
    setSeq(keys);
    setIdx(at < 0 ? 0 : at);
    setSkipped(new Set());
    setSaved("");
    setOne(true);
  };
  const go = (step: 1 | -1, skip?: ReadonlySet<string>) => {
    setSaved("");
    const j = nextIndex(oneQs, idx, step, skip ?? (step === 1 ? skipped : new Set()));
    if (j >= 0) setIdx(j);
    else if (step === 1) setIdx(oneQs.length);
  };
  const current = one && !ended ? oneQs[idx] : undefined;
  useEffect(() => {
    if (current) seen(current);
    // The heading takes the focus on each move, so a keyboard or screen reader user lands on the new question.
    if (one) (ended ? endRef.current : headingRef.current)?.focus();
  }, [one, idx, ended]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a link from the Open items tab: show everything, then go to the question
  useEffect(() => {
    if (!initialQuestion || jumped.current) return;
    const q = all.find((x) => x.key === initialQuestion);
    if (!q) return;
    jumped.current = true;
    setShow("all");
    setFocusKey(q.key);
  }, [initialQuestion, all]);

  // ---- continue where you left off: scroll to the card and put the cursor on it
  useEffect(() => {
    if (!focusKey || one) return;
    const card = document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(`iv-card-${focusKey}`)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.querySelector<HTMLElement>("h2, h3")?.focus();
    setFocusKey(undefined);
  }, [focusKey, one, visible]);
  const lastQ = last ? all.find((q) => q.key === last) : undefined;
  const resume = () => {
    if (!lastQ) return;
    if (!visible.some((q) => q.key === lastQ.key)) setShow("all");
    if (one) {
      const keys = oneQs.some((q) => q.key === lastQ.key) ? seq : [...seq, lastQ.key];
      setSeq(keys);
      setIdx(keys.indexOf(lastQ.key));
    } else setFocusKey(lastQ.key);
  };

  // An assessment with no excipient has no questions yet: the first step is to add one (the spec's empty state).
  if (a.lines.length === 0) {
    return (
      <section className="card stack" aria-labelledby="ex-empty-h" data-testid="ex-empty">
        <h2 id="ex-empty-h">Start here</h2>
        <p data-testid="ex-empty-text">{EXCIPIENT_EMPTY_TEXT}</p>
        <AddExcipientForm a={a} label="Name of the first excipient" testIdPrefix="ex-first" {...(onAdded ? { onAdded } : {})} />
      </section>
    );
  }

  const overall = progress.overall;
  const lineAt = current ? progress.lines.find((l) => l.lineId === current.lineId) : undefined;
  const nOf = current ? { n: oneQs.filter((q) => q.lineId === current.lineId).indexOf(current) + 1, of: oneQs.filter((q) => q.lineId === current.lineId).length } : undefined;

  return (
    <div className="stack iv" data-testid="ex-interview">
      <section className="card stack" aria-labelledby="iv-h">
        <h2 id="iv-h">Answer questions about the excipients</h2>
        <p className="small" data-testid="iv-intro">
          Each answer goes straight into the assessment, the same one the other tabs show. Anything you don't know stays open; nothing here stops you from saving or leaving.
        </p>
        <p data-testid="iv-stage">
          <strong>Project stage:</strong> <StageRow />
        </p>
        {!stage && (
          <p className="notice" data-testid="iv-stage-prompt">
            Set the project stage to get questions that fit.
          </p>
        )}
        <div className="iv-banner" role="status" aria-live="polite" data-testid="iv-banner">
          <strong data-testid="iv-progress">
            {overall.answered} of {overall.total} answered, {overall.open} left open
          </strong>{" "}
          <span aria-hidden="true">·</span>{" "}
          <a href={href(EXCIPIENT_PATH, { excipient: a.id, tab: "open" })} data-testid="iv-open-count">
            {openItemsCount(openCount)}
          </a>{" "}
          <HelpTip label="About these counts" text={PROGRESS_HELP} />
          {saved && (
            <span className="iv-live small" data-testid="iv-live">
              {" "}
              <span aria-hidden="true">{"✓"}</span> {saved}
            </span>
          )}
        </div>
        <progress className="iv-bar" value={overall.answered} max={Math.max(overall.total, 1)} aria-label="Questions answered" />
        {lastQ && (
          <div>
            <button type="button" className="btn small" onClick={resume} data-testid="iv-resume">
              Continue where you left off
            </button>
          </div>
        )}
      </section>

      <section className="card stack iv-controls" aria-label="How to see the questions" data-tour="excipient-one-at-a-time">
        <label className="check iv-switch">
          <input type="checkbox" role="switch" checked={one} onChange={(e) => (e.target.checked ? startOne() : setOne(false))} data-testid="iv-one" /> <span>Show one question at a time</span>
        </label>
        {!one && (
          <fieldset className="fs stack iv-filters" data-testid="iv-filters">
            <legend>Show</legend>
            {(Object.keys(SHOW_TEXT) as ExcipientShow[]).map((k) => (
              <label key={k} className="check">
                <input type="radio" name="iv-show" checked={show === k} onChange={() => setShow(k)} data-testid={`iv-show-${k}`} /> <span>{SHOW_TEXT[k]}</span>
              </label>
            ))}
          </fieldset>
        )}
      </section>

      {!one && (
        <>
          {groups.length === 0 && (
            <p className="empty" data-testid="iv-none">
              No question fits this view. Choose Everything to see them all.
            </p>
          )}
          {groups.map((g) => {
            const c = progress.lines.find((l) => l.lineId === g.lineId);
            return (
              <section key={g.lineId} className="card stack" aria-labelledby={`iv-g-${g.lineId}`} data-testid={`iv-step-${g.lineId}`}>
                <h2 id={`iv-g-${g.lineId}`}>
                  {g.label}{" "}
                  <span className="muted small iv-count" data-testid="iv-step-count">
                    {c ? `${c.answered} of ${c.total} answered` : ""}
                  </span>
                </h2>
                <div className="stack iv-cards">
                  {g.qs.map((q) => (
                    <ExcipientCard key={q.key} q={q} sources={sources} onSave={save} onFocusCard={seen} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {one && (
        <section className="iv-one stack" aria-label="One question at a time" data-testid="iv-one-mode">
          {current && nOf ? (
            <>
              <p className="small" role="status" data-testid="iv-position">
                Question {nOf.n} of {nOf.of} about {current.lineName}
                {lineAt ? ` (${lineAt.answered} of ${lineAt.total} answered)` : ""}
              </p>
              <ExcipientCard
                key={current.key}
                q={current}
                large
                headingRef={headingRef}
                sources={sources}
                onSave={save}
                onDontKnow={() => go(1)}
                onSkip={(q) => {
                  setSkipped((s) => new Set(s).add(q.key));
                  go(1, new Set([...skipped, q.key]));
                }}
              />
            </>
          ) : (
            <div className="card stack" data-testid="iv-end">
              <h2 ref={endRef} tabIndex={-1}>
                That was the last question in this view. {openItemsCount(openCount)} left.
              </h2>
              <div className="row wrap">
                <a className="btn" href={href(EXCIPIENT_PATH, { excipient: a.id, tab: "open" })} data-testid="iv-end-open">
                  See the Open items tab
                </a>
                <a className="btn" href={href(EXCIPIENT_PATH, { excipient: a.id, tab: "document" })} data-testid="iv-end-document">
                  Go to the Document tab
                </a>
              </div>
            </div>
          )}
          <div className="iv-nav" role="group" aria-label="Move between questions" data-testid="iv-nav">
            <button type="button" className="btn" data-testid="iv-back" disabled={nextIndex(oneQs, idx, -1, new Set()) < 0} onClick={() => go(-1)}>
              Back
            </button>
            <button type="button" className="btn primary" data-testid="iv-next" disabled={ended} onClick={() => go(1)}>
              Next
            </button>
            <button type="button" className="btn" data-testid="iv-to-list" onClick={() => setOne(false)}>
              Back to the list
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
