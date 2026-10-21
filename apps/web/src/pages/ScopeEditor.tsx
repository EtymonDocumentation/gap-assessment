import {
  OPTIONAL_SECTIONS,
  SECTION_CHOICES,
  omittedSectionIds,
  setOmittedSections,
  setStepsExcluded,
  stepGroups,
  stepSummary,
  type StepGroupInfo,
  type StepInfo,
} from "@gap/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { dateTime } from "../lib";
import { href } from "../router";
import { useContent, useStore } from "../store";

/**
 * The scope choices, shown in two places (the Scope step and the top of the Document page) from ONE stored choice: the
 * project's stepScope (process steps left out) and document.omittedSections (optional sections left out). Both views read the
 * stored project, so they can never disagree.
 *
 * GMP reasoning: leaving a process step out of a gap assessment is a scope decision a reviewer must be able to see and
 * challenge. So an exclusion is change-logged (who, when, optional reason) and the document's Scope section lists it. Nothing is
 * deleted: values already recorded stay in the project as inactive entries and come back when the step is ticked again.
 * Everything is included until someone decides otherwise (no default is applied for the user).
 */

/** "12 of 14 process steps, 6 of 10 optional sections" and the counts behind it. */
export function useScopeSummary() {
  const content = useContent();
  const project = useStore((s) => s.project)!;
  return useMemo(() => {
    const steps = stepSummary(content, project);
    const omitted = omittedSectionIds(project);
    const optionalTotal = OPTIONAL_SECTIONS.length;
    const sectionsTotal = SECTION_CHOICES.length;
    const optionalIncluded = optionalTotal - omitted.length;
    const stepText = `${steps.included} of ${steps.selectable} process steps${steps.notApplicable ? ` (${steps.notApplicable} not applicable)` : ""}`;
    return {
      steps,
      omitted,
      optionalIncluded,
      optionalTotal,
      sectionsIncluded: sectionsTotal - omitted.length,
      sectionsTotal,
      text: `${stepText}, ${optionalIncluded} of ${optionalTotal} optional sections`,
    };
  }, [content, project]);
}

// ------------------------------------------------------------------ tri-state tick

/** A checkbox that can show "some" (mixed). The native indeterminate state is set as well as aria-checked, so every assistive technology reads it. */
function TriCheckbox({ state, label, onChange, disabled, id }: { state: boolean | "mixed"; label: string; onChange: () => void; disabled?: boolean; id?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={state === true}
      aria-checked={state === "mixed" ? "mixed" : state}
      aria-label={label}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

// ------------------------------------------------------------------ process steps

type Pending = { uos: StepInfo[]; label: string } | null;

export function ProcessStepsBlock({ idPrefix }: { idPrefix: string }) {
  const content = useContent();
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const groups = useMemo(() => stepGroups(content, project), [content, project]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");
  const lastTick = useRef<HTMLElement | null>(null);

  const allOpen = groups.every((g) => open[g.key]);

  function include(uos: StepInfo[], label: string) {
    const err = update((p, actor) => setStepsExcluded(content, p, uos.map((s) => s.uo), false, undefined, actor), `${label} put back in scope`);
    setError(err ?? "");
  }

  function askExclude(uos: StepInfo[], label: string) {
    if (!uos.length) return;
    lastTick.current = document.activeElement as HTMLElement | null;
    setPending({ uos, label });
  }

  return (
    <div className="stack" data-testid={`${idPrefix}-steps`}>
      <div className="row between wrap">
        <p className="small muted scope-hint">
          Untick a step the process does not have. It is hidden in the interview and left out of the comparison, the gap register, the validation plan and the document, on both sides.
        </p>
        <button
          type="button"
          className="btn small"
          onClick={() => setOpen(Object.fromEntries(groups.map((g) => [g.key, !allOpen])))}
        >
          {allOpen ? "Collapse all groups" : "Expand all groups"}
        </button>
      </div>
      <ul className="scope-groups">
        {groups.map((g) => (
          <GroupRow
            key={g.key}
            idPrefix={idPrefix}
            group={g}
            open={!!open[g.key]}
            onToggleOpen={() => setOpen({ ...open, [g.key]: !open[g.key] })}
            onInclude={include}
            onAskExclude={askExclude}
          />
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <ExcludeDialog
          pending={pending}
          onClose={() => setPending(null)}
          restoreFocus={() => lastTick.current}
          onConfirm={(reason) => {
            const err = update(
              (p, actor) => setStepsExcluded(content, p, pending.uos.map((s) => s.uo), true, reason, actor),
              `${pending.label} left out of the assessment`,
            );
            setError(err ?? "");
            setPending(null);
          }}
        />
      )}
    </div>
  );
}

function GroupRow({
  idPrefix,
  group,
  open,
  onToggleOpen,
  onInclude,
  onAskExclude,
}: {
  idPrefix: string;
  group: StepGroupInfo;
  open: boolean;
  onToggleOpen: () => void;
  onInclude: (uos: StepInfo[], label: string) => void;
  onAskExclude: (uos: StepInfo[], label: string) => void;
}) {
  const selectable = group.steps.filter((s) => s.state !== "not_applicable");
  const included = selectable.filter((s) => s.state === "included");
  const state: boolean | "mixed" = selectable.length === 0 ? false : included.length === selectable.length ? true : included.length === 0 ? false : "mixed";
  const bodyId = `${idPrefix}-group-${group.key}`;
  const na = group.steps.length - selectable.length;
  return (
    <li className="scope-group">
      <div className="scope-group-head">
        <TriCheckbox
          id={`${idPrefix}-tick-${group.key}`}
          state={state}
          label={`${group.label}: all process steps`}
          disabled={selectable.length === 0}
          onChange={() => {
            // From "all in scope" the group tick leaves every step out; from "none" or "some" it puts every step back.
            if (state === true) onAskExclude(selectable, group.label);
            else onInclude(selectable.filter((s) => s.state === "excluded"), group.label);
          }}
        />
        <button type="button" className="scope-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggleOpen}>
          <span aria-hidden="true" className="scope-chevron">
            {open ? "▾" : "▸"}
          </span>
          <span className="scope-group-title">{group.label}</span>
          <span className="small muted">
            {included.length} of {selectable.length} in scope{na ? `, ${na} not applicable` : ""}
          </span>
        </button>
      </div>
      <div id={bodyId} hidden={!open} className="scope-group-body">
        <p className="small muted">{group.description}</p>
        <ul className="scope-steps">
          {group.steps.map((s) => (
            <StepRow key={s.uo} idPrefix={idPrefix} step={s} onInclude={onInclude} onAskExclude={onAskExclude} />
          ))}
        </ul>
      </div>
    </li>
  );
}

function StepRow({
  idPrefix,
  step,
  onInclude,
  onAskExclude,
}: {
  idPrefix: string;
  step: StepInfo;
  onInclude: (uos: StepInfo[], label: string) => void;
  onAskExclude: (uos: StepInfo[], label: string) => void;
}) {
  const na = step.state === "not_applicable";
  const off = step.state === "excluded";
  const inputId = `${idPrefix}-step-${step.uo}`;
  return (
    <li className={`scope-step${off ? " is-off" : ""}${na ? " is-na" : ""}`} data-state={step.state}>
      <label className="check top" htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          checked={step.state === "included"}
          disabled={na}
          onChange={() => (step.state === "included" ? onAskExclude([step], step.label) : onInclude([step], step.label))}
        />
        <span>
          <strong>{step.label}</strong>
          <span className="small muted block">{step.description}</span>
        </span>
      </label>
      {na && step.notApplicable && (
        <p className="small scope-note">
          <span className="tag status-not_applicable">{step.notApplicable.text}</span>{" "}
          {step.notApplicable.questionKey && <a href={href("/interview", { q: step.notApplicable.questionKey })}>Go to this question</a>}
        </p>
      )}
      {step.state === "included" && step.dependsOn && (
        <p className="small scope-note">
          <span className="tag">{step.dependsOn.text}</span>{" "}
          {step.dependsOn.questionKey && <a href={href("/interview", { q: step.dependsOn.questionKey })}>Go to this question</a>}
          {" "}Still in scope until you decide.
        </p>
      )}
      {off && step.exclusion && (
        <p className="small scope-note">
          <span className="tag">Left out of the assessment</span> {step.exclusion.reason ? `Reason: ${step.exclusion.reason}.` : "No reason recorded."} Left out by {step.exclusion.by} on {dateTime(step.exclusion.at)}.
          {step.answerCount > 0 && ` ${step.answerCount} recorded ${step.answerCount === 1 ? "answer is" : "answers are"} kept and come back if you tick it again.`}
        </p>
      )}
    </li>
  );
}

function ExcludeDialog({ pending, onClose, onConfirm, restoreFocus }: { pending: NonNullable<Pending>; onClose: () => void; onConfirm: (reason: string) => void; restoreFocus: () => HTMLElement | null }) {
  const [reason, setReason] = useState("");
  const answers = pending.uos.reduce((n, s) => n + s.answerCount, 0);
  const many = pending.uos.length > 1;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={many ? `Leave out ${pending.label}?` : `Leave out “${pending.label}”?`}
      description={
        many
          ? `${pending.uos.length} process steps will be left out of the assessment, on both sides.`
          : "This process step will be left out of the assessment, on both sides."
      }
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason);
        }}
      >
        <ul className="plain-list small">
          {pending.uos.map((s) => (
            <li key={s.uo}>{s.label}</li>
          ))}
        </ul>
        {answers > 0 ? (
          <p className="notice" role="status">
            <strong>
              {answers} {answers === 1 ? "answer" : "answers"} will be kept but left out.
            </strong>{" "}
            Nothing is deleted. The answers come back if you tick the step again.
          </p>
        ) : (
          <p className="small muted">No answers are recorded for {many ? "these steps" : "this step"} yet.</p>
        )}
        <label className="field">
          <span>
            Reason <span className="muted">(optional)</span>
          </span>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. This line does not have this step (fictional)" autoFocus />
        </label>
        <p className="small muted">Without a reason the document says “No reason recorded”. Who and when are always recorded.</p>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Leave out
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ document sections

export function DocumentSectionsBlock({ idPrefix }: { idPrefix: string }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const omitted = omittedSectionIds(project);
  const [error, setError] = useState("");

  /** Ticks or unticks one optional section. The choice is stored with the project and applies to every format. */
  const toggle = (id: string, include: boolean) => {
    const title = OPTIONAL_SECTIONS.find((x) => x.id === id)?.title ?? id;
    // Worked out from the stored project, not from this render, so two quick clicks both count.
    const err = update(
      (p) => {
        const current = omittedSectionIds(p);
        return setOmittedSections(p, include ? current.filter((x) => x !== id) : [...current, id]);
      },
      include ? `${title} included in the document` : `${title} left out of the document`,
    );
    setError(err ?? "");
  };

  return (
    <div className="stack" data-testid={`${idPrefix}-sections`}>
      <p className="small muted scope-hint">
        Untick an optional section to leave it out of the preview and of every download (Markdown, HTML, Word and print). Numbering and appendix letters close up, and the document lists what was left out.
      </p>
      <ul className="section-choice">
        {SECTION_CHOICES.map((sec) => {
          const id = `${idPrefix}-sec-${sec.id}`;
          return (
            <li key={sec.id}>
              <label htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={!sec.optional || !omitted.includes(sec.id)}
                  disabled={!sec.optional}
                  onChange={(e) => toggle(sec.id, e.target.checked)}
                />
                <span>
                  {sec.appendix ? `${sec.title} (appendix)` : sec.title}
                  {!sec.optional && <span className="small muted block">Always included</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="small muted" role="status">
        {error || (omitted.length ? `${omitted.length} optional ${omitted.length === 1 ? "section is" : "sections are"} left out.` : "All optional sections are included.")}
      </p>
    </div>
  );
}
