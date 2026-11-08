import {
  effectiveContent,
  hasUnsavedChanges,
  historyOf,
  historyUsage,
  limitMessage,
  nextVersionNumber,
  openReviewCount,
  PROGRAM_STAGES,
  projectStage,
  REASON_MAX,
  REASON_MIN,
  STAGE_CHECK_TEXT,
  STAGE_LABEL,
  STAGE_MEANING,
  STAGE_OWN_TEXT_NOTE,
  stageCheckOf,
  stageReviewItems,
  stageShort,
  versionLabelOf,
  type ProgramStage,
  type StageChangeResult,
} from "@gap/engine";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "./components";
import { href, navigate } from "./router";
import { content, READ_ONLY_MESSAGE, useStore } from "./store";
import { docCountsText, useRealProject, VersionChip } from "./version-ui";

/** The open project's stage and its check, read the same way by the chip, Home and the TRD form. */
export function useProjectStage() {
  const stage = useStore((s) => (s.project ? projectStage(s.project) : undefined));
  const check = useStore((s) => (s.project ? stageCheckOf(s.project) : undefined));
  return { stage, check };
}

/** How many stage-review items are still to be reviewed (all reviews). Read from the real project, so a saved version being viewed does not hide them. */
export function useOpenReviewCount(): number {
  const p = useRealProject();
  return useMemo(() => (p ? openReviewCount(p) : 0), [p]);
}

type Step = "choose" | "why" | "done";

/**
 * The one place the project stage is changed (the header chip, Home, the interview's receiving-site question and the TRD form open it).
 * Three steps and NOTHING is written before the last button of step 2:
 *  1. choose: four options, none preselected; the current one is marked and cannot be picked (unless a stage check is waiting: then
 *     choosing it again confirms it, as before, with no version and no reason); the ones before it are marked "Going back".
 *  2. reason and preview: why the stage changes (required, unless the stage was never set), and what will be saved and what needs review.
 *  3. done: the version that was saved, and the way into the stage review.
 * Going back a stage is allowed. It is not a restore: no data is rolled back, only the wording follows the stage.
 */
function StageDialog({ open, onClose, restoreFocus }: { open: boolean; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const project = useStore((s) => s.project);
  const changeStage = useStore((s) => s.changeStage);
  const { stage, check } = useProjectStage();
  const [step, setStep] = useState<Step>("choose");
  const [picked, setPicked] = useState<ProgramStage | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ stage: ProgramStage; result: StageChangeResult } | null>(null);
  const name = useId();
  const reasonId = useId();
  const hintId = useId();
  const errId = useId();

  const currentIndex = stage ? PROGRAM_STAGES.indexOf(stage) : -1;
  const confirming = picked !== null && picked === stage;

  // The preview is worked out from the real wording functions when step 2 opens (not on every key typed in the reason box).
  const preview = useMemo(() => {
    if (step !== "why" || !project || !picked) return null;
    const items = stageReviewItems(project, effectiveContent(content, project), stage, picked);
    const history = historyOf(project);
    const unsaved = history.entries.length > 0 && hasUnsavedChanges(project);
    const major = nextVersionNumber(history, "stage-change");
    return {
      items,
      label: versionLabelOf(major.major, major.minor),
      autoLabel: unsaved ? versionLabelOf(nextVersionNumber(history, "before-change").major, nextVersionNumber(history, "before-change").minor) : null,
      full: historyUsage(project).atLimit ? limitMessage(project) : null,
    };
  }, [step, project, picked, stage]);

  const close = () => {
    setStep("choose");
    setPicked(null);
    setReason("");
    setError("");
    setBusy(false);
    setDone(null);
    onClose();
  };

  const apply = async (to: ProgramStage) => {
    setBusy(true);
    setError("");
    const r = await changeStage(to, reason);
    setBusy(false);
    if (r.error !== null) {
      setError(r.error);
      return;
    }
    setDone({ stage: to, result: r.result });
    setStep("done");
  };

  const next = () => {
    if (!picked) {
      setError("Choose one of the four stages, or Cancel.");
      return;
    }
    setError("");
    // Choosing the stage the project already has only confirms it (a stage check is waiting): no version and no reason are needed.
    if (confirming) void apply(picked);
    else setStep("why");
  };

  const save = () => {
    if (!picked) return;
    const why = reason.trim();
    if (stage !== undefined && !why) {
      setError("Say why the project stage is changing.");
      return;
    }
    if (why && why.length < REASON_MIN) {
      setError(`Say why the project stage is changing (at least ${REASON_MIN} characters).`);
      return;
    }
    void apply(picked);
  };

  const going = picked && stage && PROGRAM_STAGES.indexOf(picked) < currentIndex;
  const items = done?.result.review?.items.length ?? 0;
  const result = done?.result;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && close()}
      title={step === "done" ? "Project stage set" : "Project stage"}
      description={step === "choose" ? "Which batches will the receiving site make next? Everything in this project follows your answer." : undefined}
      restoreFocus={restoreFocus}
      focusDialog={step === "choose"}
    >
      {step === "done" && done && result ? (
        <div data-testid="stage-summary" className="stack">
          {result.entry ? (
            <>
              <p>
                <strong>
                  Version {result.entry.label} saved. Project stage is now {stageShort(done.stage)}.
                </strong>
              </p>
              {result.autoEntry && <p className="small">Your edits since the last version were saved first as {result.autoEntry.label}, so they are kept in the history.</p>}
              <p className="small">{STAGE_OWN_TEXT_NOTE}</p>
              <div className="row wrap">
                {items > 0 ? (
                  <>
                    <button
                      className="btn primary"
                      autoFocus
                      onClick={() => {
                        close();
                        navigate("/stage-review");
                      }}
                    >
                      Start the stage review ({items} {items === 1 ? "item" : "items"})
                    </button>
                    <button className="btn" onClick={close}>
                      Later
                    </button>
                  </>
                ) : (
                  <>
                    <p className="small">Nothing in your documents needs review for this change.</p>
                    <button className="btn primary" onClick={close} autoFocus>
                      Close
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p>
                <strong>{result.changed ? `The project stage is ${stageShort(done.stage)}. The check is cleared.` : `The project stage is ${stageShort(done.stage)}. Nothing changed.`}</strong>
              </p>
              <p className="small">No new version was needed: the stage is the same.</p>
              <div className="row">
                <button className="btn primary" onClick={close} autoFocus>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      ) : step === "why" && picked && preview ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            // The dialog is a portal inside the page tree: without this a submit here would also reach a surrounding form (the interview question).
            e.stopPropagation();
            save();
          }}
        >
          <p className="small" data-testid="stage-change-line">
            From: {stage ? STAGE_LABEL[stage] : "not set yet"}
            <br />
            To: <strong>{STAGE_LABEL[picked]}</strong>
          </p>
          <label className="field" htmlFor={reasonId}>
            {/* Ease-of-use pass (EOU-33): an empty reason stops the button with a message, so the box says it is needed before anyone presses. */}
            <span>{stage === undefined ? "Why is the stage being set? (optional)" : "Why is the stage changing? (needed to save the change)"}</span>
            <textarea
              id={reasonId}
              rows={2}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={[hintId, error ? errId : ""].filter(Boolean).join(" ")}
              aria-invalid={error ? true : undefined}
              aria-required={stage === undefined ? undefined : true}
              autoFocus
            />
            <span className="small muted" id={hintId}>
              {stage === undefined ? "For example: PPQ protocol approved" : `A few words are enough, at least ${REASON_MIN} characters. For example: PPQ protocol approved`}
            </span>
          </label>
          {error && (
            <p className="error" role="alert" id={errId}>
              {error}
            </p>
          )}
          <div className="stack stage-preview" data-testid="stage-preview">
            {going && (
              <p>
                This goes back from {stageShort(stage)} to {stageShort(picked)}. The data stays as it is; only the wording follows the stage.
              </p>
            )}
            <p>
              <strong>Version {preview.label} will be saved.</strong>
              {preview.autoLabel && ` Your edits since the last version are saved first as ${preview.autoLabel}, so they are kept in the history before the stage changes.`}
            </p>
            <p className="small muted" data-testid="version-kinds-note">
              A change of the project stage makes a new main version, such as v2. Save a version makes a smaller step in between, such as v2.1.
            </p>
            <p>{preview.items.length > 0 ? `These need your review: ${docCountsText(preview.items)}.` : "Nothing in your documents needs your review for this change."}</p>
            <p>These change by themselves: Word headers and cover, titles.</p>
            <p>{STAGE_OWN_TEXT_NOTE}</p>
          </div>
          {preview.full && (
            <p className="notice" data-testid="version-limit">
              {preview.full} <a href={href("/versions")}>Go to the version history</a> to remove one.
            </p>
          )}
          <div className="row wrap">
            <button type="submit" className="btn primary" disabled={busy || !!preview.full}>
              {busy ? "Saving…" : `Save ${preview.label} and change the stage`}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setStep("choose");
                setError("");
              }}
            >
              Back
            </button>
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            // The dialog is a portal inside the page tree: without this a submit here would also reach a surrounding form (the interview question).
            e.stopPropagation();
            next();
          }}
        >
          <p className="small" data-testid="stage-now">
            Now: {stage ? STAGE_LABEL[stage] : "not set"}
            {check ? ". It needs a check." : ""}
          </p>
          {check && <p className="small stage-check-text">{STAGE_CHECK_TEXT[check]}</p>}
          <fieldset className="stage-options">
            <legend className="visually-hidden">Project stage</legend>
            {PROGRAM_STAGES.map((s) => {
              const isCurrent = s === stage;
              const back = stage !== undefined && PROGRAM_STAGES.indexOf(s) < currentIndex;
              // The current stage cannot be "changed to". With a check waiting it can be chosen once more, to confirm it.
              const locked = isCurrent && !check;
              return (
                <label key={s} className={picked === s ? "stage-option checked" : locked ? "stage-option locked" : "stage-option"}>
                  <input type="radio" name={name} value={s} checked={picked === s} disabled={locked} onChange={() => setPicked(s)} />
                  <span>
                    <strong>{STAGE_LABEL[s]}</strong>
                    {isCurrent && <span className="tag">Current</span>}
                    {back && <span className="tag">Going back</span>}
                    <span className="small muted stage-meaning">{STAGE_MEANING[s]}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row wrap">
            <button type="submit" className="btn primary">
              {confirming ? `Confirm ${stageShort(picked)}` : "Next"}
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

/** A button that opens the dialog and gives focus back to itself when the dialog closes. Off (with the reason) while a saved version is open. */
export function StageChangeButton({ className = "btn small", children, label }: { className?: string; children?: ReactNode; label?: string }) {
  const viewing = useStore((s) => !!s.viewing);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className={className} aria-label={label} disabled={viewing} title={viewing ? READ_ONLY_MESSAGE : undefined} onClick={() => setOpen(true)}>
        {children ?? "Change project stage"}
      </button>
      <StageDialog open={open} onClose={() => setOpen(false)} restoreFocus={() => ref.current} />
    </>
  );
}

/**
 * The header chip: "Project stage: PPQ" or "Project stage: not set". A check adds a dot AND the words "needs a check"; stage-review items
 * still to be reviewed add a dot AND "3 to review" (in the accessible name and the tooltip), so the cue is not colour alone. The visible text
 * is part of the accessible name.
 */
export function StageChip() {
  const { stage, check } = useProjectStage();
  const viewing = useStore((s) => !!s.viewing);
  const toReview = useOpenReviewCount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const text = `Project stage: ${stageShort(stage)}`;
  const extras = [check ? "needs a check" : "", toReview > 0 ? `${toReview} to review` : ""].filter(Boolean).join(", ");
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="stage-chip"
        data-testid="stage-chip"
        data-tour="stage-chip"
        aria-label={`${text}${extras ? `, ${extras}` : ""}. ${viewing ? "Cannot be changed while a saved version is open" : "Change the project stage"}`}
        title={extras || undefined}
        disabled={viewing}
        onClick={() => setOpen(true)}
      >
        {check && <span className="stage-dot" data-testid="stage-dot" aria-hidden="true" />}
        {toReview > 0 && <span className="stage-dot stage-dot-review" data-testid="stage-review-dot" aria-hidden="true" />}
        <span>{text}</span>
      </button>
      <StageDialog open={open} onClose={() => setOpen(false)} restoreFocus={() => ref.current} />
    </>
  );
}

/** The stage chip with the version chip beside it (the header and the thin row under it on a narrow screen). */
export function StageChips({ short }: { short?: boolean }) {
  return (
    <>
      <StageChip />
      <VersionChip {...(short ? { short } : {})} />
    </>
  );
}

/** "Check the project stage: it was saved ..." -> "It was saved ...". Leaves any other wording as it is. */
function withoutCheckLeadIn(text: string): string {
  const rest = text.replace(/^Check the project stage:\s*/, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Home's notice when the stage needs a check: what the check is, and the dialog to settle it. */
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

/** Home's notice while stage-review items are still to be reviewed. Words, a count and the way in: nothing is ticked for the person. */
export function StageReviewNotice() {
  const n = useOpenReviewCount();
  if (n === 0) return null;
  return (
    <div className="stage-check-notice" data-testid="stage-review-notice" role="note">
      <p>
        <strong>Stage review.</strong> {n} {n === 1 ? "item is" : "items are"} still to be reviewed after the project stage changed.
      </p>
      <a className="btn small" href={href("/stage-review")}>
        Go to the stage review
      </a>
    </div>
  );
}

/** A "Project stage: value  [Change project stage]" line for Home and the TRD form (and the same words as the interview question). */
export function StageRow() {
  const { stage, check } = useProjectStage();
  return (
    <span className="stage-row" data-testid="stage-row">
      <span>
        {stage ? STAGE_LABEL[stage] : "Not set"}
        {check ? " (needs a check)" : ""}
      </span>{" "}
      <StageChangeButton label={`Change project stage (now ${stageShort(stage)})`} />
    </span>
  );
}
