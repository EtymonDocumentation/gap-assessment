import { addCheckedSteps, applyTrdAnswer, deriveTrdQuestions, filterInterviewQuestions, trdAnswerPlaces, trdFollowsChecklist, trdInterviewProgress, trdLeftOutSteps, trdStepsToAdd, type InterviewAnswer, type InterviewQuestion } from "@gap/engine";
import { interviewMapWording, trdInterviewWording } from "@gap/content";
import type { TrdDocument } from "@gap/process-model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "../HelpTip";
import { href } from "../router";
import { StageRow, useProjectStage } from "../stage-ui";
import { openItemsCount, trdOpenCount } from "../open-count";
import { useContent, useStore } from "../store";
import { useTrdWriteupLibrary, useTrdWriteups } from "../trd-writeups-store";
import { defaultInterviewShow, interviewSequence, nextIndex, readKept, readLast, sequencePosition, trdIsEmpty, writeKept, writeLast } from "../trd-interview-lib";
import { InterviewCard } from "./TrdInterviewCard";

export type InterviewShow = "all" | "open" | "confirm";
const SHOW_TEXT: Record<InterviewShow, string> = { all: "Everything", open: "Only what is still open", confirm: "Only what came from the project, to confirm" };

const PROGRESS_HELP =
  "The first number is the questions you have answered on this tab. The open items are everything still to fill in the TRD: entries still open plus blank fields in the process descriptions. The Open items tab lists them, and each one links to its question. Anything you do not know stays open. You can also print the blank form.";

/**
 * The Interview tab: plain questions that fill the same TRD the form fills. The list is derived from the TRD every time (nothing is stored
 * but the Keep marks and the place you were at, in this browser), and each answer goes through the same edit functions as the form, one
 * change-log event each. Nothing here blocks saving, leaving or the export.
 *
 * `initialQuestion` is the question an entry of the Open items tab links to: the view widens to hold it, then the page scrolls to its card
 * and the cursor goes to its heading (the same move as "Continue where you left off").
 */
export function TrdInterview({ d, initialShow, initialQuestion }: { d: TrdDocument; initialShow?: InterviewShow; initialQuestion?: string }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const library = useTrdWriteupLibrary();
  const { stage } = useProjectStage();
  const projectId = project.meta.id;

  const [show, setShow] = useState<InterviewShow>(() => initialShow ?? defaultInterviewShow(d));
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState("");
  const [kept, setKept] = useState<Set<string>>(() => readKept(projectId, d.id));
  // Where the person was when they opened this page. Fixed for the visit: if it followed every click, the "Continue" button would appear under the pointer
  // on the first mousedown and push the cards down, and the click would miss its button.
  const [last] = useState<string | undefined>(() => readLast(projectId, d.id));
  // Questions answered in this sitting stay on screen under "Only what is still open", so the card you just filled does not vanish under you.
  const [stay, setStay] = useState<Set<string>>(() => new Set());
  const [saved, setSaved] = useState("");
  const [one, setOne] = useState(false);
  const [seq, setSeq] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | undefined>();
  const jumped = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const endRef = useRef<HTMLHeadingElement>(null);

  const all = useMemo(() => deriveTrdQuestions(project, d.id, { content, wording: trdInterviewWording }), [project, d.id, content]);
  const sources = useMemo(() => project.sources.filter((s) => !s.supersededBy), [project.sources]);
  const level = more ? "all" : "essentials";

  // The interview follows the project's checklist of process steps (a TRD started on the start path). A ticked step that is not in the TRD yet is added once, after the
  // person's own process descriptions have been read, so an edited description is never replaced by the shipped one. A step left out gets no questions and is listed below.
  const writeupsReady = useTrdWriteups((s) => s.ready);
  const toAdd = useMemo(() => trdStepsToAdd(content, project, d.id), [content, project, d.id]);
  useEffect(() => {
    if (toAdd.length === 0 || !writeupsReady) return;
    update((p, actor) => addCheckedSteps(p, d.id, actor, { content, library }), "Steps added to the TRD");
  }, [toAdd, writeupsReady, update, d.id, content, library]);
  const leftOut = useMemo(() => trdLeftOutSteps(content, project, d.id), [content, project, d.id]);
  // Where each answer lands in the document: the section number and heading, with a link that opens the Document tab there. Built once for the whole list.
  const places = useMemo(() => trdAnswerPlaces(project, d, all, content), [project, d, all, content]);

  const filter = useCallback((q: InterviewQuestion, withShow: boolean) => filterInterviewQuestions([q], { show: withShow ? show : "all", level, search, kept }).length > 0, [show, level, search, kept]);
  const visible = useMemo(() => all.filter((q) => filter(q, true) || (stay.has(q.key) && filter(q, false))), [all, filter, stay]);

  // Progress is counted over the level in view (Essentials, or everything with More detail on), not over the filter, so "N of M" does not jump around.
  const progress = useMemo(() => trdInterviewProgress(all.filter((q) => (more ? true : q.essential)), kept), [all, more, kept]);
  const counts = (c: { essentials: { total: number; answered: number; open: number }; moreDetail: { total: number; answered: number; open: number } }) => ({
    total: c.essentials.total + (more ? c.moreDetail.total : 0),
    answered: c.essentials.answered + (more ? c.moreDetail.answered : 0),
    open: c.essentials.open + (more ? c.moreDetail.open : 0),
  });
  const overall = counts(progress.overall);
  // The one open-items number of the TRD (open-count.ts): the same words as the chain strip, the page header and the Home card (EOU-14, EOU-15).
  const openCount = useMemo(() => trdOpenCount(project, d), [project, d]);
  const hiddenMore = more ? 0 : all.filter((q) => !q.essential).length;

  const groups = useMemo(() => {
    const out: { stepKey: string; label: string; qs: InterviewQuestion[] }[] = [];
    for (const q of visible) {
      const g = out[out.length - 1];
      if (g && g.stepKey === q.stepKey) g.qs.push(q);
      else out.push({ stepKey: q.stepKey, label: q.stepLabel, qs: [q] });
    }
    return out;
  }, [visible]);

  const save = (q: InterviewQuestion, a: InterviewAnswer): string | null => {
    const err = update((p, actor) => {
      const r = applyTrdAnswer(p, d.id, q, a, actor, { content, library });
      // The engine's own words are shown beside the question; nothing the person typed is thrown away.
      if (r.error) throw new Error(r.error);
      return r.project;
    }, "Answer saved");
    if (err) return err;
    setStay((s) => new Set(s).add(q.key));
    setSaved("Saved.");
    return null;
  };
  const keep = (q: InterviewQuestion) => {
    const next = new Set(kept).add(q.key);
    setKept(next);
    writeKept(projectId, d.id, next);
    setStay((s) => new Set(s).add(q.key));
    setSaved("Kept.");
  };
  const seen = (q: InterviewQuestion) => {
    writeLast(projectId, d.id, q.key);
  };

  // ---- one question at a time
  const oneQs = useMemo(() => seq.map((k) => all.find((q) => q.key === k)).filter((q): q is InterviewQuestion => Boolean(q)), [seq, all]);
  const ended = one && idx >= oneQs.length;
  const startOne = (fromKey?: string) => {
    const keys = interviewSequence(visible);
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

  // ---- a link from the Open items tab: show everything (and More detail when the question is one), then go to the question
  useEffect(() => {
    if (!initialQuestion || jumped.current) return;
    const q = all.find((x) => x.key === initialQuestion);
    if (!q) return;
    jumped.current = true;
    setShow("all");
    setSearch("");
    if (!q.essential) setMore(true);
    setFocusKey(q.key);
  }, [initialQuestion, all]);

  // ---- continue where you left off, and the "first step" start: scroll to the card and put the cursor on it
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
    if (!visible.some((q) => q.key === lastQ.key)) {
      setShow("all");
      setSearch("");
      if (!lastQ.essential) setMore(true);
    }
    if (one) {
      const keys = oneQs.some((q) => q.key === lastQ.key) ? seq : [...seq, lastQ.key];
      setSeq(keys);
      setIdx(keys.indexOf(lastQ.key));
    } else setFocusKey(lastQ.key);
  };

  const empty = trdIsEmpty(d);
  const position = sequencePosition(oneQs, idx);

  return (
    <div className="stack iv" data-testid="trd-interview">
      <section className="card stack" aria-labelledby="iv-h">
        <h2 id="iv-h">Answer questions to fill the TRD</h2>
        <p className="small" data-testid="iv-intro">
          Each answer goes straight into the TRD (technical requirements document), the same one the other tabs show. Anything you don't know stays open; nothing here stops you from saving or leaving.
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
            {overall.answered} of {overall.total} answered
          </strong>{" "}
          <span aria-hidden="true">·</span>{" "}
          <a href={href("/trd", { trd: d.id, tab: "open" })} data-testid="iv-open-count">
            {openItemsCount(openCount.total)}
          </a>
          {hiddenMore > 0 && (
            <span className="muted small" data-testid="iv-more-count">
              {" "}
              (plus {hiddenMore} more in More detail)
            </span>
          )}{" "}
          <HelpTip label="About these counts" text={PROGRESS_HELP} />
          {saved && (
            <span className="iv-live small" data-testid="iv-live">
              {" "}
              <span aria-hidden="true">{"✓"}</span> {saved}
            </span>
          )}
        </div>
        <progress className="iv-bar" value={overall.answered} max={Math.max(overall.total, 1)} aria-label="Questions answered" />
        {trdFollowsChecklist(d) && (
          <div className="iv-left-out" data-testid="iv-left-out">
            {leftOut.length > 0 ? (
              <>
                <p data-testid="iv-left-out-line">
                  <strong>{interviewMapWording.status.leftOut}:</strong> {leftOut.map((s) => (s.reason ? `${s.label} (${s.reason})` : s.label)).join("; ")}.
                </p>
                {leftOut.some((s) => s.hasAnswers) && (
                  <p className="muted small" data-testid="iv-left-out-kept">
                    Answers you already gave for a left-out step are kept. They come back if you tick the step again.
                  </p>
                )}
              </>
            ) : (
              <p className="muted small">Every step of your process is in this interview.</p>
            )}
            <p className="small">
              <a href={href("/trd", { trd: d.id, step: "2" })} data-testid="iv-change-steps">
                Change which steps are in your process
              </a>
            </p>
          </div>
        )}
        {lastQ && (
          <div>
            <button type="button" className="btn small" onClick={resume} data-testid="iv-resume">
              Continue where you left off
            </button>
          </div>
        )}
      </section>

      {empty && !one && (
        <section className="card stack" aria-labelledby="iv-empty-h" data-testid="iv-empty">
          <h2 id="iv-empty-h">Start here</h2>
          <p>Answer a few questions and the TRD fills itself in. Anything you don't know stays open.</p>
          <div className="row wrap">
            <button type="button" className="btn primary" data-testid="iv-empty-first" onClick={() => all[0] && setFocusKey(all[0].key)}>
              Start with the first step
            </button>
            <button type="button" className="btn" data-testid="iv-empty-one" onClick={() => startOne()}>
              Answer one question at a time
            </button>
          </div>
          {/* "Show only what is still open" used to be a third button here. In an empty TRD every question is open, so it did nothing, and the
              Show options below already say it. Two ways to start are enough: the whole list, or one question at a time. */}
        </section>
      )}

      <section className="card stack iv-controls" aria-label="How to see the questions" data-tour="trd-one-at-a-time">
        <label className="check iv-switch">
          <input
            type="checkbox"
            role="switch"
            checked={one}
            onChange={(e) => (e.target.checked ? startOne() : setOne(false))}
            data-testid="iv-one"
          />{" "}
          <span>Show one question at a time</span>
        </label>
        {!one && (
          <>
            <fieldset className="fs stack iv-filters" data-testid="iv-filters">
              <legend>Show</legend>
              {(Object.keys(SHOW_TEXT) as InterviewShow[]).map((k) => (
                <label key={k} className="check">
                  <input type="radio" name="iv-show" checked={show === k} onChange={() => setShow(k)} data-testid={`iv-show-${k}`} /> <span>{SHOW_TEXT[k]}</span>
                </label>
              ))}
            </fieldset>
            <div className="row wrap end-align">
              <label className="field">
                <span>Find a question</span>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="iv-search" />
              </label>
              <label className="check iv-switch">
                <input type="checkbox" role="switch" checked={more} onChange={(e) => setMore(e.target.checked)} data-testid="iv-more" /> <span>Show More detail (the questions the text does not need)</span>
              </label>
            </div>
          </>
        )}
      </section>

      {!one && (
        <>
          {groups.length === 0 && (
            <p className="empty" data-testid="iv-none">
              {all.length === 0 ? "There are no questions." : "No question fits this view. Choose Everything to see them all."}
            </p>
          )}
          {groups.map((g) => {
            const sp = progress.steps.find((s) => s.stepKey === g.stepKey);
            const c = sp ? counts(sp) : { total: 0, answered: 0, open: 0 };
            return (
              <section key={g.stepKey} className="card stack" aria-labelledby={`iv-g-${g.stepKey}`} data-testid={`iv-step-${g.stepKey}`}>
                <h2 id={`iv-g-${g.stepKey}`}>
                  {g.label} <span className="muted small iv-count" data-testid="iv-step-count">{c.answered} of {c.total} answered</span>
                  {!more && sp && sp.moreDetail.total > 0 && <span className="muted small"> (plus {sp.moreDetail.total} more in More detail)</span>}
                </h2>
                <div className="stack iv-cards">
                  {g.qs.map((q) => (
                    <InterviewCard key={q.key} q={q} d={d} place={places.get(q.key)} kept={kept.has(q.key)} sources={sources} onSave={save} onKeep={keep} onFocusCard={seen} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {one && (
        <section className="iv-one stack" aria-label="One question at a time" data-testid="iv-one-mode">
          {current && position ? (
            <>
              <p className="small" role="status" data-testid="iv-position">
                Question {position.n} of {position.of} in {position.stepLabel}
              </p>
              <InterviewCard
                key={current.key}
                q={current}
                d={d}
                place={places.get(current.key)}
                large
                kept={kept.has(current.key)}
                headingRef={headingRef}
                sources={sources}
                onSave={save}
                onKeep={keep}
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
                That was the last open question. {openItemsCount(openCount.total)} left.
              </h2>
              <div className="row wrap">
                <a className="btn" href={href("/trd", { trd: d.id, tab: "open" })} data-testid="iv-end-open">
                  See the Open items tab
                </a>
                <a className="btn" href={href("/trd", { trd: d.id, tab: "output" })} data-testid="iv-end-document">
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
