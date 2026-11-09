import { useState } from "react";
import { Modal } from "../components";

/**
 * "Why are you removing it?" for the excipient assessment's deletions. Everything can be removed, and the reason is kept in the change log
 * (nothing is undeletable, and nothing disappears without a trace). Cancel has the focus first, so a stray Enter keeps the data.
 * An empty reason is said in words next to the box; the dialog stays open.
 */
export function ReasonDialog({ title, description, confirmLabel, keepLabel, testId, onConfirm, onClose, restoreFocus }: {
  title: string;
  description: string;
  confirmLabel: string;
  keepLabel: string;
  testId: string;
  /** Returns the engine's message when it refuses, or null when it is done. */
  onConfirm: (reason: string) => string | null;
  onClose: () => void;
  restoreFocus?: () => HTMLElement | null;
}) {
  const [why, setWhy] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} description={description} {...(restoreFocus ? { restoreFocus } : {})}>
      <label className="field">
        <span>
          Why are you removing it? <span className="muted">(kept in the log)</span>
        </span>
        <input value={why} onChange={(e) => setWhy(e.target.value)} data-testid={`${testId}-reason`} aria-describedby={msg ? `${testId}-msg` : undefined} />
      </label>
      {msg && (
        <p className="error" role="alert" id={`${testId}-msg`} data-testid={`${testId}-msg`}>
          {msg}
        </p>
      )}
      <div className="row end">
        <button type="button" className="btn" autoFocus onClick={onClose} data-testid={`${testId}-keep`}>
          {keepLabel}
        </button>
        <button
          type="button"
          className="btn danger"
          data-testid={`${testId}-confirm`}
          onClick={() => {
            if (!why.trim()) return setMsg("Write a short reason. It is kept in the change log.");
            const err = onConfirm(why.trim());
            if (err) setMsg(err);
            else onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
