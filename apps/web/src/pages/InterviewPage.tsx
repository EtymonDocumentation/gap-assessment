import {
  applyAnswer,
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
  type QuestionInstance,
  type SectionProgress,
} from "@gap/engine";
import { getEntry, type DocRef, type Project } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryChip, Modal, ResponderForm, SeverityBadge } from "../components";
import { sideText } from "../lib";
import { href, navigate } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";
import { QuestionInput, initialForm, toAnswer, type FormState } from "./question-inputs";

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

  const needsResponder = !project.interview.responder;
  const answeredCount = instances.filter((i) => isAnswered(project, i)).length;

  function goNext(fromKey: string, p: Project) {
    const list = visibleInstances(content, p, p.settings.entrySequence);
    const idx = list.findIndex((i) => i.key === fromKey);
    const after = list.slice(idx + 1);
    const next = after.find((i) => !isAnswered(p, i)) ?? after[0] ?? nextInstance(list, p);
    const from = list[idx];
    if (from && (!next || next.section.id !== from.section.id)) {
      navigate("/interview", { summary: from.section.id, ...(next ? { then: next.key } : {}) });
    } else if (next) {
      navigate("/interview", { q: next.key });
    } else {
      navigate("/interview", { summary: "all" });
    }
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
            {mode === "paired" ? "SU, then RU, for each question." : "All SU answers first, then the RU pass."}
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
            key={current.key + ":" + project.answers.length}
            inst={current}
            instances={instances}
            onSave={(input, docRefs) => {
              let saved: Project | null = null;
              const err = update((p, actor) => (saved = applyAnswer(p, content, current, input, actor, { docRefs })), "Answer saved");
              if (!err && saved) goNext(current.key, saved);
              return err;
            }}
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

function QuestionCard({
  inst,
  instances,
  onSave,
}: {
  inst: QuestionInstance;
  instances: QuestionInstance[];
  onSave: (input: AnswerInput, docRefs: DocRef[]) => string | null;
}) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  const q = inst.question;
  const [form, setForm] = useState<FormState>(() => initialForm(content, project, inst));
  const [error, setError] = useState("");
  const [naOpen, setNaOpen] = useState(false);
  const [naText, setNaText] = useState("");
  // Documents cited with this answer: register documents already backing the current value stay ticked; one new reference can be added.
  const registerDocs = useMemo(() => project.sources.filter((s) => s.type === "document_reference" && s.docRef && !s.supersededBy), [project.sources]);
  const [citedIds, setCitedIds] = useState<string[]>(() => {
    const ids = new Set(instanceRefs(inst).flatMap((r) => getEntry(project, r)?.sourceIds ?? []));
    return registerDocs.filter((s) => ids.has(s.id)).map((s) => s.id);
  });
  const [docId, setDocId] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [inst.key]);

  const idx = instances.findIndex((i) => i.key === inst.key);
  const prev = instances[idx - 1];
  const next = instances[idx + 1];
  const side = inst.side;
  const sameAllowed = side === "target" && q.sides === "paired" && q.sameAsSource !== false;
  const wording = useStageWording();
  const sideLabel = side !== "shared" ? q.sideLabels?.[side] : undefined;
  const gaps = a.gaps.filter((g) => g.questionId === q.id);
  const answered = isAnswered(project, inst);

  const docRefs = (): DocRef[] => [
    ...registerDocs.filter((s) => citedIds.includes(s.id)).map((s) => s.docRef!),
    ...(docId.trim() ? [{ identifier: docId.trim(), docType: docType.trim() || "Document", ...(docTitle.trim() ? { title: docTitle.trim() } : {}) }] : []),
  ];
  const submit = (input: AnswerInput) => {
    const withValue = input.kind === "value" || input.kind === "composite";
    if (withValue && !docId.trim() && (docTitle.trim() || docType.trim())) {
      setError("Enter the reference ID of the new document, or clear its title and type.");
      return;
    }
    const err = onSave(input, withValue ? docRefs() : []);
    setError(err ?? "");
  };
  const citedCount = citedIds.length + (docId.trim() ? 1 : 0);

  return (
    <article className="card question-card" aria-labelledby="q-prompt">
      <div className="q-meta">
        <span className="small muted">{inst.section.title}</span>
        <span className={`side-badge side-${side}`}>{sideText(wording)[side]}</span>
        {isCustomQuestion(q) && <span className="tag tag-custom">Custom item</span>}
        {answered && <span className="tag">Answered</span>}
      </div>
      {inst.depth > 0 && q.triggerNote && <p className="trigger">↳ {q.triggerNote}</p>}
      <h1 id="q-prompt" ref={headingRef} tabIndex={-1} className="q-prompt">
        {sideLabel ?? q.prompt}
      </h1>
      {sideLabel && <p className="muted small">{q.prompt}</p>}
      <details className="why">
        <summary>Why is this asked?</summary>
        <p>{q.why}</p>
        {q.help && <p className="muted">{q.help}</p>}
      </details>

      {side === "target" && q.sides === "paired" && (
        <div className="source-ref">
          <span className="small muted">{wording.sourceValidated ? "SU (validated)" : "SU (current)"}: </span>
          <span>{formatQuestionSide(content, project, q, "source")}</span>
        </div>
      )}

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const r = toAnswer(q, form);
          if ("error" in r) setError(r.error);
          else submit(r.input);
        }}
      >
        <QuestionInput q={q} side={side} form={form} setForm={setForm} />

        <details className="cite">
          <summary>
            Cite supporting documents (optional)
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
                      checked={citedIds.includes(s.id)}
                      onChange={(e) => setCitedIds((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
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
                  <input value={docId} onChange={(e) => setDocId(e.target.value)} placeholder="e.g. DEMO-PPQ-001 (fictional)" />
                </label>
                <label className="field">
                  <span>Title</span>
                  <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. PPQ report" />
                </label>
                <label className="field">
                  <span>Document type</span>
                  <input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="e.g. Report" />
                </label>
              </div>
              <p className="small muted">A reference ID that is already in the register reuses that document.</p>
            </fieldset>
          </div>
        </details>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row wrap q-actions">
          <button type="submit" className="btn primary">
            Save and continue
          </button>
          <button type="button" className="btn" onClick={() => submit({ kind: "unknown" })}>
            Unknown — to be confirmed
          </button>
          {sameAllowed && (
            <button type="button" className="btn" onClick={() => submit({ kind: "same_as_source" })}>
              Same as SU
            </button>
          )}
          <button type="button" className="btn ghost" aria-expanded={naOpen} onClick={() => setNaOpen((o) => !o)}>
            Not applicable…
          </button>
        </div>
        {naOpen && (
          <div className="na-box">
            <label className="field">
              <span>Why does this not apply? (required)</span>
              <textarea value={naText} onChange={(e) => setNaText(e.target.value)} rows={2} />
            </label>
            <button type="button" className="btn" onClick={() => submit({ kind: "not_applicable", justification: naText })}>
              Record as not applicable
            </button>
          </div>
        )}
      </form>

      {gaps.length > 0 && side !== "source" && (
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
          <a href={href("/interview", { q: prev.key })} className="btn ghost">
            ← Previous
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a href={href("/interview", { q: next.key })} className="btn ghost">
            Skip for now →
          </a>
        )}
      </div>
    </article>
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
        {thenKey ? (
          <a className="btn primary" href={href("/interview", { q: thenKey })}>
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
    </article>
  );
}
