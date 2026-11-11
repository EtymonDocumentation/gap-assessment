import {
  addCheckedSteps,
  addTrdAddedBack,
  applyTrdAnswer,
  clearTrdHeadingText,
  deriveTrdQuestions,
  filterInterviewQuestions,
  headingWritingMatches,
  removeTrdAddedBack,
  setTrdHeadingText,
  trdAnswerLandings,
  trdFollowsChecklist,
  trdHeadingInterview,
  trdInterviewProgress,
  trdLeftOutSteps,
  trdStepsToAdd,
  type AnswerPlace,
  type HeadingGroup,
  type HeadingWriting,
  type InterviewAnswer,
  type InterviewQuestion,
  type TrdUnitInfo,
} from "@gap/engine";
import { interviewMapWording, trdInterviewWording } from "@gap/content";
import type { TrdDocument } from "@gap/process-model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "../HelpTip";
import { href } from "../router";
import { StageRow, useProjectStage } from "../stage-ui";
import { openItemsCount, trdOpenCount } from "../open-count";
import { useContent, useStore } from "../store";
import { useHeadingFollow, useTrdUnits } from "../trd-heading-follow";
import { useTrdWriteupLibrary, useTrdWriteups } from "../trd-writeups-store";
import { defaultInterviewShow, interviewSequence, nextIndex, readKept, readLast, sequencePosition, trdIsEmpty, writeKept, writeLast } from "../trd-interview-lib";
import { ReasonDialog } from "./ReasonDialog";
import { AddedBackList, groupCountText, HeadingNotices, HeadingWritingCard, JumpList, NotInTemplate } from "./TrdHeadingParts";
import { InterviewCard } from "./TrdInterviewCard";

/**
 * One card of the interview, in the order it is asked. A question, or the writing box of a heading that has no Cascade content. `stepKey` and
 * `stepLabel` are the group the card is counted in: the process step in Cascade's own order, the template's heading when the interview follows it.
 */
interface Entry {
  key: string;
  stepKey: string;
  stepLabel: string;
  essential: boolean;
  q?: InterviewQuestion;
  w?: HeadingWriting;
}

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
  // Where each answer lands: the section of the document (number and heading, with a link that opens the Document tab there) and the piece of the TRD it is
  // read in, which is what a template heading holds. Built once for the whole list.
  const landings = useMemo(() => trdAnswerLandings(project, d, all, content), [project, d, all, content]);
  const places = useMemo(() => new Map<string, AnswerPlace>([...landings].flatMap(([k, l]) => (l.place ? [[k, l.place] as const] : []))), [landings]);

  // The interview follows the headings of the template the TRD uses ("A template's headings") once the template is matched (see trd-heading-follow.ts).
  // Otherwise it is in Cascade's own order, with a notice that says why. The groups only regroup the same questions: no answer is read or changed here.
  const follow = useHeadingFollow(d);
  const templateUnits = useTrdUnits(d, follow.status === "headings");
  const hi = useMemo(() => {
    if (follow.status !== "headings") return null;
    const unitOf = new Map<string, string>([...landings].flatMap(([k, l]) => (l.unitId ? [[k, l.unitId] as const] : [])));
    return trdHeadingInterview({
      questions: all,
      unitOf,
      units: templateUnits,
      headings: follow.template.analysis.outline,
      mapping: follow.template.trdMapping,
      ...(d.headingTexts ? { headingTexts: d.headingTexts } : {}),
      ...(d.addedBack ? { addedBack: d.addedBack } : {}),
      kept,
    });
  }, [follow, all, landings, templateUnits, d.headingTexts, d.addedBack, kept]);

  // Every card in the order it is asked: Cascade's own order, or the template's headings in the template's order.
  const entries = useMemo<Entry[]>(() => {
    if (!hi) return all.map((q) => ({ key: q.key, stepKey: q.stepKey, stepLabel: q.stepLabel, essential: q.essential, q }));
    return hi.groups.flatMap((g) => [
      ...g.subGroups.flatMap((s) => s.questions.map((q): Entry => ({ key: q.key, stepKey: g.id, stepLabel: g.title, essential: q.essential, q }))),
      ...(g.writing ? [{ key: g.writing.key, stepKey: g.id, stepLabel: g.title, essential: true, w: g.writing } as Entry] : []),
    ]);
  }, [all, hi]);
  const entryByKey = useMemo(() => new Map(entries.map((e) => [e.key, e] as const)), [entries]);

  const filter = useCallback((q: InterviewQuestion, withShow: boolean) => filterInterviewQuestions([q], { show: withShow ? show : "all", level, search, kept }).length > 0, [show, level, search, kept]);
  const entryMatches = useCallback((e: Entry, withShow: boolean) => (e.q ? filter(e.q, withShow) : headingWritingMatches(e.w!, { show: withShow ? show : "all", level, search, kept })), [filter, show, level, search, kept]);
  const visible = useMemo(() => entries.filter((e) => entryMatches(e, true) || (stay.has(e.key) && entryMatches(e, false))), [entries, entryMatches, stay]);
  const visibleKeys = useMemo(() => new Set(visible.map((e) => e.key)), [visible]);

  // Progress is counted over the level in view (Essentials, or everything with More detail on), not over the filter, so "N of M" does not jump around.
  const progress = useMemo(() => trdInterviewProgress(all.filter((q) => (more ? true : q.essential)), kept), [all, more, kept]);
  const counts = (c: { essentials: { total: number; answered: number; open: number }; moreDetail: { total: number; answered: number; open: number } }) => ({
    total: c.essentials.total + (more ? c.moreDetail.total : 0),
    answered: c.essentials.answered + (more ? c.moreDetail.answered : 0),
    open: c.essentials.open + (more ? c.moreDetail.open : 0),
  });
  // Following the headings, the count is over what is asked there (a piece with no heading is not asked) and a writing box counts as one open or answered.
  const overall = counts(hi ? hi.overall : progress.overall);
  // The one open-items number of the TRD (open-count.ts): the same words as the chain strip, the page header and the Home card (EOU-14, EOU-15).
  const openCount = useMemo(() => trdOpenCount(project, d), [project, d]);
  const hiddenMore = more ? 0 : hi ? hi.overall.moreDetail.total : all.filter((q) => !q.essential).length;

  const groups = useMemo(() => {
    const out: { stepKey: string; label: string; qs: InterviewQuestion[] }[] = [];
    for (const e of visible) {
      if (!e.q) continue;
      const g = out[out.length - 1];
      if (g && g.stepKey === e.q.stepKey) g.qs.push(e.q);
      else out.push({ stepKey: e.q.stepKey, label: e.q.stepLabel, qs: [e.q] });
    }
    return out;
  }, [visible]);

  // The groups of the heading view that have something to show in this view of the questions (the plain ones, with nothing to answer, only under "Everything").
  const plain = show === "all" && !search.trim();
  const shown = useMemo(() => {
    if (!hi) return [];
    return hi.groups
      .map((g) => {
        const subs = g.subGroups.map((s) => ({ ...s, questions: s.questions.filter((q) => visibleKeys.has(q.key)) })).filter((s) => s.questions.length > 0);
        const writing = g.writing && visibleKeys.has(g.writing.key) ? g.writing : undefined;
        const informational = (g.state === "nothing" || g.state === "kept_text" || g.kind === "additional") && plain;
        return subs.length > 0 || writing || informational ? { g, subs, writing } : null;
      })
      .filter((x): x is { g: HeadingGroup; subs: typeof hi.groups[number]["subGroups"]; writing: HeadingWriting | undefined } => x !== null);
  }, [hi, visibleKeys, plain]);
  const landsUnder = (key: string): string | undefined => {
    const l = hi?.landing.get(key);
    return l ? `Lands under ${l.title} (${l.headingIndex !== undefined ? "your template" : "not in your template"}).` : undefined;
  };
  const jump = (id: string) => {
    const el = document.getElementById(`iv-g-${id}`);
    el?.scrollIntoView({ block: "start" });
    el?.focus();
  };

  // ---- what the headings view can change: text under a heading, and pieces added at the end of the Word file. Both are the match screen's own edit functions.
  const [removing, setRemoving] = useState<{ kind: "back"; unit: TrdUnitInfo } | { kind: "text"; w: HeadingWriting } | null>(null);
  const [problem, setProblem] = useState("");
  const [textReset, setTextReset] = useState(0);
  const bannerRef = useRef<HTMLDivElement>(null);
  const saveText = (w: HeadingWriting, text: string): string | null => {
    const err = update((p, actor) => setTrdHeadingText(p, d.id, { headingIndex: w.headingIndex, headingText: w.headingText }, text, actor), "Text under a template heading saved");
    if (err) return err;
    setStay((s) => new Set(s).add(w.key));
    setSaved("Saved.");
    return null;
  };
  const addBack = (u: TrdUnitInfo) => {
    const err = update((p, actor) => addTrdAddedBack(p, d.id, u.id, actor), "Section added at the end of the Word file");
    setProblem(err ?? "");
    if (!err) {
      setSaved(`${u.title} added at the end, under Additional content.`);
      // The piece leaves the list, so the cursor would be lost with it: it goes to the line that says what happened.
      bannerRef.current?.focus();
    }
  };
  const notAskedCount = useMemo(() => {
    const n = new Map<string, number>();
    if (!hi) return n;
    for (const q of hi.notAsked) {
      const u = landings.get(q.key)?.unitId;
      if (u) n.set(u, (n.get(u) ?? 0) + 1);
    }
    return n;
  }, [hi, landings]);

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
  const oneQs = useMemo(() => seq.map((k) => entryByKey.get(k)).filter((e): e is Entry => Boolean(e)), [seq, entryByKey]);
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
    if (current) writeLast(projectId, d.id, current.key);
    // The heading takes the focus on each move, so a keyboard or screen reader user lands on the new question.
    if (one) (ended ? endRef.current : headingRef.current)?.focus();
  }, [one, idx, ended]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a link from the Open items tab: show everything (and More detail when the question is one), then go to the question
  useEffect(() => {
    if (!initialQuestion || jumped.current) return;
    const q = entryByKey.get(initialQuestion);
    if (!q) return;
    jumped.current = true;
    setShow("all");
    setSearch("");
    if (!q.essential) setMore(true);
    setFocusKey(q.key);
  }, [initialQuestion, entryByKey]);

  // ---- continue where you left off, and the "first step" start: scroll to the card and put the cursor on it
  useEffect(() => {
    if (!focusKey || one) return;
    const card = document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(`iv-card-${focusKey}`)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.querySelector<HTMLElement>("h2, h3")?.focus();
    setFocusKey(undefined);
  }, [focusKey, one, visible]);
  const lastQ = last ? entryByKey.get(last) : undefined;
  const resume = () => {
    if (!lastQ) return;
    if (!visibleKeys.has(lastQ.key)) {
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
        <div className="iv-banner" role="status" aria-live="polite" data-testid="iv-banner" ref={bannerRef} tabIndex={-1}>
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
        <HeadingNotices follow={follow} trdId={d.id} needMatching={hi?.needMatching ?? 0} />
        {hi && follow.status === "headings" && (
          <>
            <NotInTemplate units={hi.leftOut} questionCount={notAskedCount} trdId={d.id} templateId={follow.template.id} onAdd={addBack} />
            {problem && (
              <p className="error" role="alert" data-testid="iv-heading-problem">
                {problem}
              </p>
            )}
          </>
        )}
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
            <button type="button" className="btn primary" data-testid="iv-empty-first" onClick={() => entries[0] && setFocusKey(entries[0].key)}>
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

      {!one && hi && (
        <>
          {shown.length === 0 && (
            <p className="empty" data-testid="iv-none">
              {entries.length === 0 ? "There are no questions." : "No question fits this view. Choose Everything to see them all."}
            </p>
          )}
          {shown.length > 1 && (
            <nav aria-label="Jump to a heading" className="card">
              <JumpList items={shown.map(({ g }) => ({ id: g.id, title: g.title, text: groupCountText(counts(g.counts), g) }))} onJump={jump} />
            </nav>
          )}
          {shown.map(({ g, subs, writing }) => {
            const c = counts(g.counts);
            const labelled = subs.length > 1;
            return (
              <section key={g.id} className="card stack" aria-labelledby={`iv-g-${g.id}`} data-testid={`iv-group-${g.id}`}>
                <h2 id={`iv-g-${g.id}`} tabIndex={-1}>
                  {g.title}{" "}
                  <span className="muted small iv-count" data-testid="iv-group-count">
                    {groupCountText(c, g)}
                  </span>
                  {!more && g.counts.moreDetail.total > 0 && <span className="muted small"> (plus {g.counts.moreDetail.total} more in More detail)</span>}
                </h2>
                {g.state === "nothing" && !subs.length && !writing && (
                  <p className="muted small" data-testid="iv-group-nothing">
                    Nothing to answer here. Cascade's content under this heading has no questions.
                  </p>
                )}
                {g.state === "kept_text" && !writing && (
                  <p className="muted small" data-testid="iv-group-kept-text">
                    Your template's own text stays under this heading. Nothing to answer here.
                  </p>
                )}
                {g.kind === "additional" && <AddedBackList units={g.units} onRemove={(u) => setRemoving({ kind: "back", unit: u })} />}
                <div className="stack iv-cards">
                  {subs.map((s) => (
                    <div key={s.stepKey} className="stack iv-cards" {...(labelled ? { role: "group", "aria-label": s.stepLabel } : {})}>
                      {labelled && (
                        <p className="iv-subgroup" aria-hidden="true">
                          <strong>{s.stepLabel}</strong>
                        </p>
                      )}
                      {s.questions.map((q) => (
                        <InterviewCard key={q.key} q={q} d={d} place={places.get(q.key)} landsUnder={landsUnder(q.key)} kept={kept.has(q.key)} sources={sources} onSave={save} onKeep={keep} onFocusCard={seen} />
                      ))}
                    </div>
                  ))}
                  {writing && <HeadingWritingCard key={`${writing.key}:${textReset}`} w={writing} landsUnder={landsUnder(writing.key) ?? ""} onSave={saveText} onRemove={(w) => setRemoving({ kind: "text", w })} onFocusCard={(k) => writeLast(projectId, d.id, k)} />}
                </div>
              </section>
            );
          })}
        </>
      )}

      {!one && !hi && (
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
              {current.q ? (
                <InterviewCard
                  key={current.key}
                  q={current.q}
                  d={d}
                  place={places.get(current.key)}
                  landsUnder={landsUnder(current.key)}
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
              ) : (
                <HeadingWritingCard
                  key={`${current.key}:${textReset}`}
                  w={current.w!}
                  landsUnder={landsUnder(current.key) ?? ""}
                  large
                  headingRef={headingRef}
                  onSave={saveText}
                  onRemove={(w) => setRemoving({ kind: "text", w })}
                  onDontKnow={() => go(1)}
                  onSkip={(k) => {
                    setSkipped((s) => new Set(s).add(k));
                    go(1, new Set([...skipped, k]));
                  }}
                />
              )}
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

      {removing && (
        <ReasonDialog
          title={removing.kind === "back" ? "Take this section out of the end of the Word file?" : "Remove the text you wrote?"}
          description={
            removing.kind === "back"
              ? `${removing.unit.title} will be left out of the Word file again unless you place it under a heading. Your answers for it are kept.`
              : `The text written under "${removing.w.headingText}" is removed from the TRD. Nothing else changes.`
          }
          confirmLabel={removing.kind === "back" ? "Take it out" : "Remove the text"}
          keepLabel="Keep it"
          testId={removing.kind === "back" ? "iv-added-remove-dialog" : "iv-text-remove-dialog"}
          onClose={() => setRemoving(null)}
          onConfirm={(reason) => {
            const r = removing;
            const err = update(
              (p, actor) => (r.kind === "back" ? removeTrdAddedBack(p, d.id, r.unit.id, reason, actor) : clearTrdHeadingText(p, d.id, { headingIndex: r.w.headingIndex, headingText: r.w.headingText }, reason, actor)),
              r.kind === "back" ? "Section taken out of the end of the Word file" : "Text under a template heading removed",
            );
            if (!err) {
              // A removed text must also leave the box: the card keeps what was typed in it, so it is made again empty.
              if (r.kind === "text") setTextReset((n) => n + 1);
              setSaved(r.kind === "back" ? `${r.unit.title} taken out of the end of the Word file.` : "The text was removed.");
            }
            return err;
          }}
        />
      )}
    </div>
  );
}
