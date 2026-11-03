import {
  PROGRAM_STAGES,
  projectStage,
  setProjectStage,
  STAGE_CHECK_TEXT,
  STAGE_LABEL,
  STAGE_MEANING,
  STAGE_OWN_TEXT_NOTE,
  stageCheckOf,
  stageShort,
  type ProgramStage,
} from "@gap/engine";
import { useId, useRef, useState, type ReactNode } from "react";
import { Modal } from "./components";
import { content, useStore } from "./store";

/** The open project's stage and its check, read the same way by the chip, Home and the TRD form. */
export function useProjectStage() {
  const stage = useStore((s) => (s.project ? projectStage(s.project) : undefined));
  const check = useStore((s) => (s.project ? stageCheckOf(s.project) : undefined));
  return { stage, check };
}

/**
 * The one place the project stage is chosen outside the interview. Four options with a line of meaning each and NOTHING preselected
 * (the stage is a real answer, so the tool never fills it in). After a choice the dialog turns into a summary of what now follows the
 * stage, and says that the person's own text is untouched. It calls setProjectStage, the same function the interview goes through.
 */
function StageChooser({ open, onClose, restoreFocus }: { open: boolean; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const update = useStore((s) => s.update);
  const { stage, check } = useProjectStage();
  const [picked, setPicked] = useState<ProgramStage | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ stage: ProgramStage; changed: boolean; adapts: readonly string[] } | null>(null);
  const name = useId();

  const close = () => {
    setPicked(null);
    setError("");
    setDone(null);
    onClose();
  };

  const apply = () => {
    if (!picked) {
      setError("Choose one of the four stages, or Cancel.");
      return;
    }
    let result: { changed: boolean; adapts: readonly string[] } = { changed: false, adapts: [] };
    const problem = update((p, actor) => {
      const r = setProjectStage(p, content, picked, actor);
      result = { changed: r.changed, adapts: r.adapts };
      return r.project;
    }, `Project stage: ${stageShort(picked)}`);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setDone({ stage: picked, ...result });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && close()}
      title={done ? "Project stage set" : "Project stage"}
      description={done ? undefined : "Which batches will the receiving site make next? Everything in this project follows your answer."}
      restoreFocus={restoreFocus}
      focusDialog={!done}
    >
      {done ? (
        <div data-testid="stage-summary" className="stack">
          <p>
            <strong>{done.changed ? `The project stage is now ${stageShort(done.stage)}.` : `The project stage is ${stageShort(done.stage)}. Nothing changed.`}</strong>
          </p>
          {done.changed && (
            <>
              <p className="small">These now follow the stage:</p>
              <ul className="small">
                {done.adapts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          )}
          <p className="small">{STAGE_OWN_TEXT_NOTE}</p>
          <div className="row">
            <button className="btn primary" onClick={close} autoFocus>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <p className="small" data-testid="stage-now">
            Now: {stage ? STAGE_LABEL[stage] : "not set"}
            {check ? ". It needs a check." : ""}
          </p>
          {check && <p className="small stage-check-text">{STAGE_CHECK_TEXT[check]}</p>}
          <fieldset className="stage-options">
            <legend className="visually-hidden">Project stage</legend>
            {PROGRAM_STAGES.map((s) => (
              <label key={s} className={picked === s ? "stage-option checked" : "stage-option"}>
                <input type="radio" name={name} value={s} checked={picked === s} onChange={() => setPicked(s)} />
                <span>
                  <strong>{STAGE_LABEL[s]}</strong>
                  <span className="small muted stage-meaning">{STAGE_MEANING[s]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row wrap">
            <button type="submit" className="btn primary">
              Set project stage
            </button>
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** A button that opens the chooser and gives focus back to itself when the dialog closes. */
export function StageChangeButton({ className = "btn small", children, label }: { className?: string; children?: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className={className} aria-label={label} onClick={() => setOpen(true)}>
        {children ?? "Change"}
      </button>
      <StageChooser open={open} onClose={() => setOpen(false)} restoreFocus={() => ref.current} />
    </>
  );
}

/**
 * The header chip: "Project stage: PPQ" or "Project stage: not set". A check adds a dot AND the words "needs a check" (so the cue is not
 * colour alone). The visible text is part of the accessible name.
 */
export function StageChip() {
  const { stage, check } = useProjectStage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const text = `Project stage: ${stageShort(stage)}`;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="stage-chip"
        data-testid="stage-chip"
        aria-label={check ? `${text}, needs a check. Change the project stage` : `${text}. Change the project stage`}
        onClick={() => setOpen(true)}
      >
        {check && <span className="stage-dot" data-testid="stage-dot" aria-hidden="true" />}
        <span>{text}</span>
      </button>
      <StageChooser open={open} onClose={() => setOpen(false)} restoreFocus={() => ref.current} />
    </>
  );
}

/** "Check the project stage: it was saved ..." -> "It was saved ...". Leaves any other wording as it is. */
function withoutCheckLeadIn(text: string): string {
  const rest = text.replace(/^Check the project stage:\s*/, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Home's notice when the stage needs a check: what the check is, and the chooser to settle it. */
export function StageCheckNotice() {
  const { check } = useProjectStage();
  if (!check) return null;
  return (
    <div className="stage-check-notice" data-testid="stage-check-notice" role="note">
      <p>
        {/* The shared text starts with "Check the project stage:" so it reads well alone as an open item in a document; here the
            bold heading already says that, so the lead-in is dropped to avoid saying it twice. */}
        <strong>Check the project stage.</strong> {withoutCheckLeadIn(STAGE_CHECK_TEXT[check])}
      </p>
      <StageChangeButton className="btn small">Check the project stage</StageChangeButton>
    </div>
  );
}

/** A "Project stage: value  [Change]" line for Home and the TRD form. */
export function StageRow() {
  const { stage, check } = useProjectStage();
  return (
    <span className="stage-row" data-testid="stage-row">
      <span>
        {stage ? STAGE_LABEL[stage] : "Not set"}
        {check ? " (needs a check)" : ""}
      </span>{" "}
      <StageChangeButton label={`Change the project stage (now ${stageShort(stage)})`}>Change</StageChangeButton>
    </span>
  );
}
