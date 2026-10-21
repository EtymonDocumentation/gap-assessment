import {
  applyAnswer,
  clearableRefs,
  clearInstances,
  confirmSection,
  isCustomQuestion,
  formatQuestionSide,
  isAnswered,
  instanceRefs,
  nextInstance,
  progress,
  sourceShort,
  questionLabel,
  setEntrySequence,
  setResponder,
  visibleInstances,
  type AnswerInput,
  type InstanceSide,
  type QuestionInstance,
  type SectionProgress,
} from "@gap/engine";
import { getEntry, type DocRef, type Project, type Source } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CategoryChip, Modal, ResponderForm, SeverityBadge } from "../components";
import { SIDE_SHORT, sideDescription, type UnitSide } from "../lib";
import { href, navigate } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";
import { QuestionInput, formTouched, initialForm, sameForm, toAnswer, type FormState } from "./question-inputs";

/** One answer to record: the instance, what was entered, and any cited documents. */
interface SaveItem {
  inst: QuestionInstance;
  input: AnswerInput;
  docRefs: DocRef[];
}

interface SaveResult {
  /** Why nothing was saved (the whole save is refused), or null. */
  error: string | null;
  /** The instance whose answer was refused, when known. */
  failedKey?: string;
  /** Saved, and the card stays because this side still needs an answer. */
  stayOn?: UnitSide;
}

/** Set when the app moves on by itself (after a save, Previous, Skip): the new card then puts focus on its heading, not on an input. */
let headingFocusKey: string | null = null;
function markHeadingFocus(key: string): void {
  headingFocusKey = key;
}

/** The instances shown on one card: both sides of a paired question (SU first), or the single instance. */
function groupOf(list: QuestionInstance[], inst: QuestionInstance): QuestionInstance[] {
  if (inst.question.sides !== "paired") return [inst];
  const g = list.filter((i) => i.question.id === inst.question.id).sort((x, y) => (x.side === y.side ? 0 : x.side === "source" ? -1 : 1));
  return g.length ? g : [inst];
}

/** The card's React key: stays the same while the user saves one side and carries on with the other. */
function cardKey(current: QuestionInstance, group: QuestionInstance[], project: Project): string {
  if (group.length < 2) return `${current.key}:${project.answers.length}`;
  return `${current.question.id}:${group.length}:${project.answers.filter((a) => a.questionId !== current.question.id).length}`;
}

/** What the user is asked to confirm before answers are cleared. */
interface ClearRequest {
  title: string;
  /** Label and value rows naming exactly what will be cleared. */
  facts: [string, string][];
  insts: QuestionInstance[];
  /** Entries that will go back to Not established. */
  count: number;
  /** True when a scoping answer is among them: it decides which sections are asked. */
  scoping: boolean;
}

function entriesText(n: number): string {
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}

function clearRequest(project: Project, insts: QuestionInstance[], title: string, facts: [string, string][]): ClearRequest {
  return { title, facts: [...facts, ["Entries to clear", String(clearableRefs(project, insts).length)]], insts, count: clearableRefs(project, insts).length, scoping: insts.some((i) => i.side === "shared") };
}

/**
 * Every clear is confirmed first: it removes recorded answers, and in a GMP record that must be deliberate. The dialog names
 * what goes and says what is kept (the old value in the change log, the source records) and what is withdrawn (verification).
 */
function ClearDialog({ request, onClose, onDone, restoreFocus }: { request: ClearRequest; onClose: () => void; onDone: () => void; restoreFocus: () => HTMLElement | null }) {
  const update = useStore((s) => s.update);
  const [error, setError] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={request.title} description="Nothing is cleared until you confirm." restoreFocus={restoreFocus}>
      <div className="stack">
        <dl className="clear-facts">
          {request.facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <ul className="impact" aria-label="What happens when you clear">
          <li>Each of these entries goes back to “Not established”.</li>
          <li>The old values stay in the change log, so the history is kept.</li>
          <li>Any verification of these entries is withdrawn.</li>
          <li>The source records stay in the source register; they are no longer cited by these entries.</li>
          {request.scoping && <li>A scoping answer decides which sections are asked. Values in sections that become hidden are kept, but are not asked about.</li>}
        </ul>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              let cleared = 0;
              const err = update((p, actor) => {
                const res = clearInstances(p, request.insts, actor);
                cleared = res.cleared;
                return res.project;
              }, "Answers cleared");
              if (err) {
                setError(err);
                return;
              }
              useStore.setState({ status: `Cleared ${entriesText(cleared)}. The old values are in the change log.` });
              onDone();
            }}
          >
            Clear {entriesText(request.count)}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** What a card for this instance is headed: the side prefix appears only on a card that asks one side of a paired question. */
function nextTitle(list: QuestionInstance[], inst: QuestionInstance): string {
  const q = inst.question;
  if (inst.side === "shared" || groupOf(list, inst).length > 1) return q.prompt;
  return `${SIDE_SHORT[inst.side]}: ${q.sideLabels?.[inst.side] ?? q.prompt}`;
}

export function InterviewPage({ params }: { params: URLSearchParams }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  const a = useAssessment()!;
  const mode = project.settings.entrySequence;
  const instances = useMemo(() => visibleInstances(content, project, mode), [content, project, mode]);
  const prog = useMemo(() => progress(content, project, instances), [content, project, instances]);
  const [editingResponder, setEditingResponder] = useState(false);

  const summaryId = params.get("summary");
  const requested = params.get("q");
  const current = (requested && instances.find((i) => i.key === requested)) || (!summaryId ? nextInstance(instances, project) : undefined);

  const group = current ? groupOf(instances, current) : [];
  const needsResponder = !project.interview.responder;
  const answeredCount = instances.filter((i) => isAnswered(project, i)).length;

  /** Records one or more answers in a single store update, then moves on (or stays, see SaveResult). */
  function save(group: QuestionInstance[], items: SaveItem[], opts: { quick: boolean; otherPending: boolean }): SaveResult {
    const out: { project?: Project; failed?: string } = {};
    const err = update((p, actor) => {
      let cur = p;
      for (const it of items) {
        try {
          cur = applyAnswer(cur, content, it.inst, it.input, actor, { docRefs: it.docRefs });
        } catch (e) {
          out.failed = it.inst.key;
          throw e;
        }
      }
      out.project = cur;
      return cur;
    }, "Answer saved");
    if (err || !out.project) return { error: err ?? "The answer could not be saved.", ...(out.failed ? { failedKey: out.failed } : {}) };
    const saved = out.project;
    const names = items.map((it) => it.inst.side).filter((x): x is UnitSide => x !== "shared").map((x) => SIDE_SHORT[x]);
    const done = names.length ? `Saved ${names.join(" and ")}.` : "Saved.";

    // A quick action (Unknown, Same as SU, Not applicable) on one panel stays on the card while the other side still needs an answer.
    if (opts.quick) {
      const savedKeys = items.map((it) => it.inst.key);
      const others = group.filter((i) => !savedKeys.includes(i.key));
      const open = others.filter((i) => !isAnswered(saved, i));
      const first = open[0] ?? others[0];
      if (first && first.side !== "shared" && (open.length > 0 || opts.otherPending)) {
        const name = SIDE_SHORT[first.side];
        useStore.setState({ status: open.length > 0 ? `${done} ${name} still needs an answer.` : `${done} Your ${name} entry is not saved yet.` });
        return { error: null, stayOn: first.side };
      }
    }

    const list = visibleInstances(content, saved, saved.settings.entrySequence);
    const idx = list.findIndex((i) => i.key === items[items.length - 1]!.inst.key);
    const from = list[idx];
    const after = list.slice(idx + 1).filter((i) => !from || i.question.id !== from.question.id);
    // Save and continue always goes to the NEXT question in order, answered or not, so a reviewer can click through and re-check
    // answers. Jumping to the next unanswered one would skip the answered ones and land on the summary far too early. Only when
    // nothing follows does it fall back to the first open question anywhere.
    const next = after[0] ?? (from ? undefined : nextInstance(list, saved));
    if (from && (!next || next.section.id !== from.section.id)) {
      useStore.setState({ status: `${done} Next: section summary, ${from.section.title}.` });
      navigate("/interview", { summary: from.section.id, ...(next ? { then: next.key } : {}) });
    } else if (next) {
      useStore.setState({ status: `${done} Next: ${nextTitle(list, next)}.` });
      markHeadingFocus(next.key);
      navigate("/interview", { q: next.key });
    } else {
      useStore.setState({ status: `${done} Next: interview summary.` });
      navigate("/interview", { summary: "all" });
    }
    return { error: null };
  }

  return (
    <div className="interview">
      <aside className="interview-aside" aria-label="Interview progress">
        <div className="card tight">
          <p className="small muted">
            {answeredCount} of {instances.length} answered
          </p>
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${instances.length ? (100 * answeredCount) / instances.length : 0}%` }} />
          </div>
          <fieldset className="segmented" aria-describedby="mode-help">
            <legend className="small">Entry order</legend>
            {(["paired", "sequential"] as const).map((m) => (
              <label key={m}>
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => update((p, actor) => setEntrySequence(p, m, actor), `Entry order: ${m}`)} />
                <span>{m === "paired" ? "Paired" : "Sequential"}</span>
              </label>
            ))}
          </fieldset>
          <p id="mode-help" className="small muted">
            {mode === "paired" ? "SU, then RU, for each question. Both are on one card." : "All SU answers first, then the RU pass. A question for both units still shows SU and RU together."}
          </p>
          <p className="small">
            Responder: <strong>{project.interview.responder?.name ?? "not set"}</strong>{" "}
            <button className="link-btn" onClick={() => setEditingResponder(true)}>
              change
            </button>
          </p>
        </div>
        <ProgressMap prog={prog} instances={instances} project={project} currentSection={summaryId ?? current?.section.id} />
        {a.inactive.length > 0 && (
          <p className="notice small">
            {a.inactive.length} earlier answer{a.inactive.length === 1 ? "" : "s"} belong to questions that no longer apply. They are kept but
            excluded. <a href={href("/builder")}>View in Builder</a>
          </p>
        )}
      </aside>

      <div className="interview-main">
        {summaryId ? (
          <SectionSummary sectionId={summaryId} instances={instances} thenKey={params.get("then")} />
        ) : current ? (
          <QuestionCard
            key={cardKey(current, group, project)}
            current={current}
            group={group}
            requestedKey={requested && instances.some((i) => i.key === requested) ? requested : null}
            instances={instances}
            mode={mode}
            onSave={(items, opts) => save(group, items, opts)}
          />
        ) : (
          <SectionSummary sectionId="all" instances={instances} thenKey={null} />
        )}
      </div>

      <Modal
        open={needsResponder || editingResponder}
        onOpenChange={(o) => !needsResponder && setEditingResponder(o)}
        title="Who is answering?"
        description="The name and role are recorded on every answer as its source."
      >
        <ResponderForm
          initial={project.interview.responder}
          submitLabel="Save responder"
          onSubmit={(v) => {
            update((p, actor) => setResponder(p, { name: v.name, ...(v.role ? { role: v.role } : {}) }, actor.at), "Responder saved");
            setEditingResponder(false);
          }}
        />
      </Modal>
    </div>
  );
}

function ProgressMap({
  prog,
  instances,
  project,
  currentSection,
}: {
  prog: SectionProgress[];
  instances: QuestionInstance[];
  project: Project;
  currentSection: string | undefined;
}) {
  return (
    <nav className="card tight" aria-label="Sections">
      <h2 className="h-small">Progress map</h2>
      <ol className="progress-map">
        {prog.map((s) => {
          const mine = instances.filter((i) => i.section.id === s.section.id);
          const target = mine.find((i) => !isAnswered(project, i)) ?? mine[0];
          const done = s.total > 0 && s.answered === s.total;
          return (
            <li key={s.section.id} className={s.section.id === currentSection ? "current" : undefined}>
              <a href={target ? href("/interview", { q: target.key }) : href("/interview", { summary: s.section.id })} aria-current={s.section.id === currentSection ? "step" : undefined}>
                <span className={`pm-state ${done ? "done" : s.answered ? "partial" : ""}`} aria-hidden="true" />
                <span className="pm-title">{s.section.title}</span>
                <span className="pm-count">
                  {s.answered}/{s.total}
                  <span className="visually-hidden"> answered{done ? ", complete" : ""}</span>
                </span>
              </a>
              {s.section.kind !== "scoping" && s.total > 0 && (
                <span className="pm-sides small muted">
                  SU {s.bySide.source.answered}/{s.bySide.source.total} · RU {s.bySide.target.answered}/{s.bySide.target.total}
                  {s.confirmed && " · confirmed"}
                </span>
              )}
              {s.total > 0 && (
                <a className="small pm-review" href={href("/interview", { summary: s.section.id })}>
                  Review<span className="visually-hidden"> {s.section.title}</span>
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Everything typed on one side's panel: the answer, a refused-answer message, the Not applicable box and the cited documents. */
interface SideState {
  form: FormState;
  error: string;
  naOpen: boolean;
  naText: string;
  citedIds: string[];
  docId: string;
  docTitle: string;
  docType: string;
}

const FIRST_INPUT = "input:not([type=checkbox]), .chips input, select, textarea";

function QuestionCard({
  current,
  group,
  requestedKey,
  instances,
  mode,
  onSave,
}: {
  current: QuestionInstance;
  group: QuestionInstance[];
  requestedKey: string | null;
  instances: QuestionInstance[];
  mode: "paired" | "sequential";
  onSave: (items: SaveItem[], opts: { quick: boolean; otherPending: boolean }) => SaveResult;
}) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  const wording = useStageWording();
  const q = current.question;
  const combined = group.length > 1;
  // Documents cited with an answer: register documents already backing the current value stay ticked; one new reference can be added.
  const registerDocs = useMemo(() => project.sources.filter((s) => s.type === "document_reference" && s.docRef && !s.supersededBy), [project.sources]);
  const makeState = (inst: QuestionInstance, proj: Project = project): SideState => {
    const ids = new Set(instanceRefs(inst).flatMap((r) => getEntry(proj, r)?.sourceIds ?? []));
    return {
      form: initialForm(content, proj, inst),
      error: "",
      naOpen: false,
      naText: "",
      citedIds: registerDocs.filter((s) => ids.has(s.id)).map((s) => s.id),
      docId: "",
      docTitle: "",
      docType: "",
    };
  };
  const [states, setStates] = useState<Record<string, SideState>>(() => Object.fromEntries(group.map((i) => [i.key, makeState(i)])));
  const [summaryError, setSummaryError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [clearing, setClearing] = useState<ClearRequest | null>(null);
  const st = (i: QuestionInstance): SideState => states[i.key] ?? makeState(i);
  const patch = (i: QuestionInstance, p: Partial<SideState>) => setStates((cur) => ({ ...cur, [i.key]: { ...(cur[i.key] ?? makeState(i)), ...p } }));

  const headingRef = useRef<HTMLHeadingElement>(null);
  const panels = useRef<Record<string, HTMLElement | null>>({});
  const pendingFocus = useRef<UnitSide | null>(null);

  const focusPanel = (side: InstanceSide) => {
    const el = panels.current[side];
    const target = el?.querySelector<HTMLElement>(FIRST_INPUT) ?? el?.querySelector<HTMLElement>("input");
    if (!el || !target) {
      headingRef.current?.focus();
      return;
    }
    target.focus();
    el.scrollIntoView?.({ block: "nearest" });
  };

  useEffect(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (pending) {
      focusPanel(pending);
      return;
    }
    // A link to one side (progress map, Compare, Register, a summary row) puts focus in that side's panel; moving on by itself
    // (after a save, Previous, Skip) starts at the heading.
    const byLink = combined && requestedKey !== null && headingFocusKey !== requestedKey;
    headingFocusKey = null;
    if (byLink) focusPanel(current.side);
    else headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.key, nonce]);

  // Previous / next question: the nearest instance of another question (the other side of this one is on this card).
  const idx = instances.findIndex((i) => i.key === current.key);
  const prev = [...instances.slice(0, Math.max(idx, 0))].reverse().find((i) => i.question.id !== q.id);
  const next = instances.slice(idx + 1).find((i) => i.question.id !== q.id);
  const gaps = a.gaps.filter((g) => g.questionId === q.id);
  const answeredHere = (i: QuestionInstance) => isAnswered(project, i);

  const docRefsOf = (s: SideState): DocRef[] => [
    ...registerDocs.filter((d) => s.citedIds.includes(d.id)).map((d) => d.docRef!),
    ...(s.docId.trim() ? [{ identifier: s.docId.trim(), docType: s.docType.trim() || "Document", ...(s.docTitle.trim() ? { title: s.docTitle.trim() } : {}) }] : []),
  ];

  // Which sides the primary button saves: those with input that is new or changed; if nothing changed, those that hold an answer.
  const hasInput = (i: QuestionInstance) => formTouched(q, st(i).form);
  const changed = (i: QuestionInstance) => !answeredHere(i) || !sameForm(st(i).form, initialForm(content, project, i));
  const changedInput = group.filter((i) => hasInput(i) && changed(i));
  const toSave = changedInput.length ? changedInput : group.filter(hasInput);
  const names = (list: QuestionInstance[]) => list.map((i) => (i.side === "shared" ? "" : SIDE_SHORT[i.side])).filter(Boolean).join(" and ");
  const primaryLabel = !combined ? "Save and continue" : `Save ${toSave.length ? names(toSave) : "SU and RU"}`;

  const failWith = (errors: Record<string, string>, summary: string) => {
    setStates((cur) => {
      const nextStates = { ...cur };
      for (const i of group) nextStates[i.key] = { ...(cur[i.key] ?? makeState(i)), error: errors[i.key] ?? "" };
      return nextStates;
    });
    setSummaryError(summary);
    const first = group.find((i) => errors[i.key]);
    if (first && combined) {
      pendingFocus.current = first.side === "shared" ? null : first.side;
      setNonce((n) => n + 1);
    }
  };

  const finish = (res: SaveResult, items: SaveItem[]) => {
    if (res.error) {
      const key = res.failedKey ?? items[0]?.inst.key ?? current.key;
      failWith({ [key]: res.error }, combined ? `Nothing was saved. Check the ${names(group.filter((i) => i.key === key))} answer.` : "");
      return;
    }
    setSummaryError("");
    if (res.stayOn) {
      setStates((cur) => {
        const nextStates = { ...cur };
        for (const it of items) nextStates[it.inst.key] = { ...(cur[it.inst.key] ?? makeState(it.inst)), error: "", naOpen: false, naText: "" };
        return nextStates;
      });
      pendingFocus.current = res.stayOn;
      setNonce((n) => n + 1);
    }
  };

  const savePrimary = () => {
    if (!toSave.length) {
      failWith({}, "Enter an answer for SU, RU or both, or choose Unknown — to be confirmed for a side.");
      if (combined) {
        pendingFocus.current = "source";
        setNonce((n) => n + 1);
      }
      return;
    }
    const items: SaveItem[] = [];
    const errors: Record<string, string> = {};
    for (const i of toSave) {
      const s = st(i);
      const r = toAnswer(q, s.form);
      if ("error" in r) errors[i.key] = r.error;
      else if (!s.docId.trim() && (s.docTitle.trim() || s.docType.trim())) errors[i.key] = "Enter the reference ID of the new document, or clear its title and type.";
      else items.push({ inst: i, input: r.input, docRefs: docRefsOf(s) });
    }
    if (Object.keys(errors).length) {
      failWith(errors, combined ? `Nothing was saved. Check the ${names(group.filter((i) => errors[i.key]))} answer.` : "");
      return;
    }
    finish(onSave(items, { quick: false, otherPending: false }), items);
  };

  const quickSave = (i: QuestionInstance, input: AnswerInput) => {
    const otherPending = group.some((o) => o.key !== i.key && hasInput(o) && changed(o));
    const items: SaveItem[] = [{ inst: i, input, docRefs: [] }];
    finish(onSave(items, { quick: true, otherPending }), items);
  };

  // Clearing asks first (see ClearDialog). Which sides: one panel's own, or every answered side of a paired card.
  const askClear = (insts: QuestionInstance[]) => {
    const who = insts.map((i) => (i.side === "shared" ? "" : SIDE_SHORT[i.side])).filter(Boolean).join(" and ");
    const title = insts.length > 1 ? "Clear both answers?" : who ? `Clear ${who} answer?` : "Clear answer?";
    setClearing(clearRequest(project, insts, title, [["Question", questionLabel(q)], ["Side", who || "SU and RU (one answer for both)"]]));
  };
  const clearable = (i: QuestionInstance) => clearableRefs(project, [i]).length > 0;
  // The cleared sides are rebuilt from the new project, so the form shows Not established; unsaved input on the other side stays.
  const afterClear = (insts: QuestionInstance[]) => {
    const np = useStore.getState().project!;
    setStates((cur) => ({ ...cur, ...Object.fromEntries(insts.map((i) => [i.key, makeState(i, np)])) }));
    setSummaryError("");
    setClearing(null);
  };

  const side = current.side;
  const sideLabel = side !== "shared" ? q.sideLabels?.[side] : undefined;
  const heading = combined ? q.prompt : side === "shared" ? q.prompt : `${SIDE_SHORT[side]}: ${sideLabel ?? q.prompt}`;
  const single = !combined ? group[0]! : null;

  const panel = (inst: QuestionInstance, primary?: ReactNode) => (
    <SidePanel
      key={inst.key}
      inst={inst}
      group={group}
      combined={combined}
      mode={mode}
      state={st(inst)}
      patch={(p) => patch(inst, p)}
      registerDocs={registerDocs}
      answered={answeredHere(inst)}
      onQuick={(input) => quickSave(inst, input)}
      onClear={clearable(inst) ? () => askClear([inst]) : undefined}
      panelRef={(el) => {
        panels.current[inst.side] = el;
      }}
      primary={primary}
    />
  );

  return (
    <article className={`card question-card${combined ? " is-paired" : ""}`} aria-labelledby="q-prompt">
      {single && (single.side === "shared" ? <SharedBanner /> : <SideBanner side={single.side} text={sideDescription(project, single.side, wording)} />)}
      <div className="q-meta">
        <span className="small muted">{current.section.title}</span>
        {isCustomQuestion(q) && <span className="tag tag-custom">Custom item</span>}
        {single && answeredHere(single) && <span className="tag">Answered</span>}
      </div>
      {current.depth > 0 && q.triggerNote && <p className="trigger">↳ {q.triggerNote}</p>}
      <h1 id="q-prompt" ref={headingRef} tabIndex={-1} className="q-prompt">
        {heading}
      </h1>
      {!combined && sideLabel && <p className="muted small">{q.prompt}</p>}
      <details className="why">
        <summary>Why is this asked?</summary>
        <p>{q.why}</p>
        {q.help && <p className="muted">{q.help}</p>}
      </details>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          savePrimary();
        }}
      >
        {combined ? (
          <div className="side-panels">{group.map((i) => panel(i))}</div>
        ) : (
          panel(
            group[0]!,
            <button type="submit" className="btn primary">
              {primaryLabel}
            </button>,
          )
        )}

        {combined && (
          <>
            {summaryError && (
              <p className="error" role="alert">
                {summaryError}
              </p>
            )}
            <div className="row wrap q-actions">
              <button type="submit" className="btn primary">
                {primaryLabel}
              </button>
              {group.every(clearable) && (
                <button type="button" className="btn ghost" onClick={() => askClear(group)}>
                  Clear both
                </button>
              )}
            </div>
          </>
        )}
      </form>

      {gaps.length > 0 && group.some((i) => i.side !== "source") && (
        <div className="live-compare" aria-live="polite">
          <span className="small muted">Comparison: </span>
          {gaps.map((g) => (
            <span key={g.key} className="row inline">
              <CategoryChip category={g.category} />
              <SeverityBadge severity={g.severity} />
              {g.subKey && <span className="small">{g.attribute.split(": ").pop()}</span>}
            </span>
          ))}
        </div>
      )}

      <div className="row between q-nav">
        {prev ? (
          <a href={href("/interview", { q: prev.key })} className="btn ghost" onClick={() => markHeadingFocus(prev.key)}>
            ← Previous
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a href={href("/interview", { q: next.key })} className="btn ghost" onClick={() => markHeadingFocus(next.key)}>
            Skip for now →
          </a>
        )}
      </div>
      {clearing && <ClearDialog request={clearing} onClose={() => setClearing(null)} onDone={() => afterClear(clearing.insts)} restoreFocus={() => headingRef.current} />}
    </article>
  );
}

function SideBanner({ side, text }: { side: UnitSide; text: string }) {
  return (
    <div className={`side-banner side-${side}`}>
      <span className="side-mark" aria-hidden="true">
        {SIDE_SHORT[side]}
      </span>
      <p>
        <span className="small">You are answering for: </span>
        <strong>{text}</strong>
      </p>
    </div>
  );
}

function SharedBanner() {
  return (
    <div className="side-banner side-shared">
      <span className="side-mark" aria-hidden="true">
        SU + RU
      </span>
      <p>
        <span className="small">Scoping: </span>
        <strong>one answer for both the sending unit (SU) and the receiving unit (RU)</strong>
      </p>
    </div>
  );
}

/** One side's answer: its own input, document citations and Unknown / Same as SU / Not applicable actions. */
function SidePanel({
  inst,
  group,
  combined,
  mode,
  state,
  patch,
  registerDocs,
  answered,
  onQuick,
  onClear,
  panelRef,
  primary,
}: {
  inst: QuestionInstance;
  group: QuestionInstance[];
  combined: boolean;
  mode: "paired" | "sequential";
  state: SideState;
  patch: (p: Partial<SideState>) => void;
  registerDocs: Source[];
  answered: boolean;
  onQuick: (input: AnswerInput) => void;
  /** Set only while this side holds something to clear. */
  onClear: (() => void) | undefined;
  panelRef: (el: HTMLElement | null) => void;
  /** Single-panel cards put the Save button first in the action row. */
  primary?: ReactNode;
}) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const wording = useStageWording();
  const q = inst.question;
  const side = inst.side;
  const who = side === "shared" ? undefined : SIDE_SHORT[side];
  const sideLabel = side !== "shared" ? q.sideLabels?.[side] : undefined;
  const sameAllowed = side === "target" && q.sides === "paired" && q.sameAsSource !== false;
  const errId = `err-${inst.key}`;
  const textId = `qtext-${inst.key}`;
  const citedCount = state.citedIds.length + (state.docId.trim() ? 1 : 0);
  const sourceInst = group.find((i) => i.side === "source");
  // The SU answer sits above the RU input. On a combined card it is shown once SU has one recorded, so "Same as SU" has something to refer to.
  const showSu = side === "target" && q.sides === "paired" && (!combined || (!!sourceInst && isAnswered(project, sourceInst)));
  const secondPassNote = combined && mode === "sequential" && side === "target" && !answered;

  const body = (
    <>
      {combined && sideLabel && (
        <p id={textId} className="side-question">
          {sideLabel}
        </p>
      )}
      {combined && answered && (
        <p className="recorded">
          <span className="small muted">Recorded {who}: </span>
          <span>{formatQuestionSide(content, project, q, side)}</span>
        </p>
      )}
      {showSu && (
        <div className="source-ref">
          <strong>SU answer: </strong>
          <span>{formatQuestionSide(content, project, q, "source")}</span>
        </div>
      )}
      {secondPassNote && <p className="small muted">RU is asked in the second pass; you can answer it now.</p>}

      <QuestionInput q={q} side={side} form={state.form} setForm={(f) => patch({ form: f })} {...(who ? { sideName: who } : {})} errorId={state.error ? errId : undefined} />

      <details className="cite">
        <summary>
          Cite supporting documents{who ? ` for ${who}` : ""} (optional)
          {citedCount > 0 && <span className="small muted"> — {citedCount} selected</span>}
        </summary>
        <div className="stack">
          <p className="small muted" id={`cite-help-${inst.key}`}>
            Where a document backs this value, the document is shown as its source instead of the interview. Documents are recorded with a value, not with Unknown or Not applicable.
          </p>
          {registerDocs.length > 0 && (
            <fieldset className="cite-pick" aria-describedby={`cite-help-${inst.key}`}>
              <legend className="small">Documents already in the register</legend>
              {registerDocs.map((s) => (
                <label key={s.id} className="row inline cite-option">
                  <input
                    type="checkbox"
                    checked={state.citedIds.includes(s.id)}
                    onChange={(e) => patch({ citedIds: e.target.checked ? [...state.citedIds, s.id] : state.citedIds.filter((x) => x !== s.id) })}
                  />
                  <span>{sourceShort(s)}</span>
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="cite-new">
            <legend className="small">Add a new document reference</legend>
            <div className="row wrap">
              <label className="field">
                <span>Reference ID</span>
                <input value={state.docId} onChange={(e) => patch({ docId: e.target.value })} placeholder="e.g. DEMO-PPQ-001 (fictional)" />
              </label>
              <label className="field">
                <span>Title</span>
                <input value={state.docTitle} onChange={(e) => patch({ docTitle: e.target.value })} placeholder="e.g. PPQ report" />
              </label>
              <label className="field">
                <span>Document type</span>
                <input value={state.docType} onChange={(e) => patch({ docType: e.target.value })} placeholder="e.g. Report" />
              </label>
            </div>
            <p className="small muted">A reference ID that is already in the register reuses that document.</p>
          </fieldset>
        </div>
      </details>

      {state.error && (
        <p className="error" id={errId} {...(combined ? {} : { role: "alert" })}>
          {state.error}
        </p>
      )}

      <div className="row wrap q-actions">
        {primary}
        <button type="button" className="btn" onClick={() => onQuick({ kind: "unknown" })}>
          Unknown — to be confirmed
        </button>
        {sameAllowed && (
          <button type="button" className="btn" onClick={() => onQuick({ kind: "same_as_source" })}>
            Same as SU
          </button>
        )}
        <button type="button" className="btn ghost" aria-expanded={state.naOpen} onClick={() => patch({ naOpen: !state.naOpen })}>
          Not applicable…
        </button>
        {onClear && (
          <button type="button" className="btn ghost" onClick={onClear}>
            {combined ? `Clear ${who} answer` : "Clear answer"}
          </button>
        )}
      </div>
      {state.naOpen && (
        <div className="na-box">
          <label className="field">
            <span>Why does this not apply{who ? ` for ${who}` : ""}? (required)</span>
            <textarea value={state.naText} onChange={(e) => patch({ naText: e.target.value })} rows={2} />
          </label>
          <button type="button" className="btn" onClick={() => onQuick({ kind: "not_applicable", justification: state.naText })}>
            Record as not applicable
          </button>
        </div>
      )}
    </>
  );

  if (!combined) {
    return (
      <div className="side-panel-single" data-side={side} ref={panelRef}>
        {body}
      </div>
    );
  }
  const unitSide = side as UnitSide;
  return (
    <fieldset
      className={`side-panel side-${unitSide}`}
      data-side={unitSide}
      ref={panelRef}
      aria-describedby={[sideLabel ? textId : "", state.error ? errId : ""].filter(Boolean).join(" ") || undefined}
    >
      <legend className="side-legend">
        <span className="side-mark" aria-hidden="true">
          {SIDE_SHORT[unitSide]}
        </span>
        <span>{sideDescription(project, unitSide, wording)}</span>
      </legend>
      {answered && <span className="tag side-answered">Answered</span>}
      {body}
    </fieldset>
  );
}

function SectionSummary({ sectionId, instances, thenKey }: { sectionId: string; instances: QuestionInstance[]; thenKey: string | null }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  const a = useAssessment()!;
  const all = sectionId === "all";
  const section = content.sectionById.get(sectionId);
  const mine = all ? instances : instances.filter((i) => i.section.id === sectionId);
  const questions = [...new Map(mine.map((i) => [i.question.id, i.question])).values()];
  const unanswered = mine.filter((i) => !isAnswered(project, i));
  const confirmed = project.interview.confirmations.find((c) => c.sectionId === sectionId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [sectionId]);
  const [clearing, setClearing] = useState<ClearRequest | null>(null);
  // Only the questions shown now: ones hidden by scoping keep their values.
  const clearableCount = clearableRefs(project, mine).length;

  return (
    <article className="card" aria-labelledby="sum-h">
      <h1 id="sum-h" ref={headingRef} tabIndex={-1}>
        {all ? (unanswered.length ? "Interview summary" : "Interview complete") : `Section summary: ${section?.title ?? sectionId}`}
      </h1>
      {unanswered.length > 0 ? (
        <p className="notice">
          {unanswered.length} question{unanswered.length === 1 ? "" : "s"} still unanswered.{" "}
          <a href={href("/interview", { q: unanswered[0]!.key })}>Go to the first one</a>
        </p>
      ) : (
        <p className="muted">All questions here are answered. Check the answers below; select a row to change it.</p>
      )}
      <div className="table-scroll" role="region" aria-label="Section answers table" tabIndex={0}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              <th scope="col">SU</th>
              <th scope="col">RU</th>
              <th scope="col">Comparison</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => {
              const srcInst = mine.find((i) => i.question.id === q.id && (i.side === "source" || i.side === "shared"));
              const tgtInst = mine.find((i) => i.question.id === q.id && i.side === "target");
              const gaps = a.gaps.filter((g) => g.questionId === q.id);
              return (
                <tr key={q.id}>
                  <th scope="row">{questionLabel(q)}</th>
                  <td>
                    {srcInst ? (
                      <a href={href("/interview", { q: srcInst.key })}>{formatQuestionSide(content, project, q, srcInst.side)}</a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {tgtInst ? <a href={href("/interview", { q: tgtInst.key })}>{formatQuestionSide(content, project, q, "target")}</a> : <span className="muted">—</span>}
                  </td>
                  <td>
                    {gaps.map((g) => (
                      <CategoryChip key={g.key} category={g.category} compact />
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row wrap">
        {!all && (
          <button
            className="btn"
            onClick={() => update((p, actor) => confirmSection(p, sectionId, "both", actor), "Section confirmed")}
            disabled={unanswered.length > 0}
          >
            {confirmed ? `Confirmed by ${confirmed.by} — confirm again` : "Confirm section"}
          </button>
        )}
        {!all && clearableCount > 0 && (
          <button
            className="btn ghost"
            onClick={() =>
              setClearing(
                clearRequest(project, mine, `Clear all answers in ${section?.title ?? sectionId}?`, [
                  ["Section", section?.title ?? sectionId],
                  ["Sides", "SU and RU"],
                  ["Questions asked", String(questions.length)],
                ]),
              )
            }
          >
            Clear section answers
          </button>
        )}
        {thenKey ? (
          <a className="btn primary" href={href("/interview", { q: thenKey })} onClick={() => markHeadingFocus(thenKey)}>
            Continue to next section →
          </a>
        ) : (
          <>
            <a className="btn primary" href={href("/register")}>
              Open the gap register
            </a>
            <a className="btn" href={href("/document")}>
              Preview the document
            </a>
          </>
        )}
      </div>
      {clearing && <ClearDialog request={clearing} onClose={() => setClearing(null)} onDone={() => setClearing(null)} restoreFocus={() => headingRef.current} />}
    </article>
  );
}
