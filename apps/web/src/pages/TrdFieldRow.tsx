import { clearOverride, effectiveField, setOverride, type FieldAddr } from "@gap/engine";
import type { SeedStatus, TrdField } from "@gap/process-model";
import { useId, useRef, useState } from "react";
import { dateTime } from "../lib";
import type { Run } from "./SamplingFlow";

/** Words for a status, used in tags, so the state never rests on colour or a border style alone. */
export const STATUS_TEXT: Record<SeedStatus, string> = {
  established: "Established",
  tbd: "To be determined (TBD)",
  not_established: "Not established",
  not_applicable: "Not applicable",
};

/** The statuses a person can enter over a field. Every one of them is an answer the person gives; none is filled in by the tool. */
const ENTER_STATUSES: SeedStatus[] = ["established", "tbd", "not_applicable", "not_established"];

/** Badges that describe the value of a field in words. */
export function FieldTags({ f }: { f: TrdField }) {
  const v = effectiveField(f);
  return (
    <>
      {v.status !== "established" && (
        <span className={`tag status status-${v.status}`}>{v.provisional ? "TBD best guess, provisional" : STATUS_TEXT[v.status]}</span>
      )}
      {v.overridden && v.pulledText !== undefined && (
        <span className="tag tag-override" data-testid="trd-overridden-badge">
          Overridden (project: {v.pulledText})
        </span>
      )}
      {v.overridden && v.pulledText === undefined && <span className="tag tag-override">Entered by you</span>}
    </>
  );
}

/**
 * One field of a TRD: its value, a badge when it is overridden or open, and an editor. The project value stays beside the entered
 * one, because the TRD keeps both: an override is the team's decision, and a later "update from project" must be able to say what
 * the project now says without replacing it. The reason is optional; without one the TRD reads "No reason recorded".
 */
export function FieldRow({ docId, f, addr, run, testId }: { docId: string; f: TrdField; addr: FieldAddr; run: Run; testId: string }) {
  const v = effectiveField(f);
  const o = f.override;
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(Boolean(o) || !f.pulled);
  const [status, setStatus] = useState<SeedStatus>(o?.status ?? (f.pulled ? "established" : "established"));
  const [display, setDisplay] = useState(o?.display ?? "");
  const [unit, setUnit] = useState(o?.unit ?? "");
  const [reason, setReason] = useState(o?.reason ?? "");
  const [error, setError] = useState("");
  const editBtn = useRef<HTMLButtonElement>(null);
  const uid = useId();

  const reset = () => {
    setOn(Boolean(f.override) || !f.pulled);
    setStatus(f.override?.status ?? "established");
    setDisplay(f.override?.display ?? "");
    setUnit(f.override?.unit ?? "");
    setReason(f.override?.reason ?? "");
    setError("");
  };
  const close = () => {
    setOpen(false);
    // Focus returns to the Edit button once the row has gone back to its summary.
    setTimeout(() => editBtn.current?.focus(), 0);
  };
  const needsValue = status === "established";
  const mayHaveValue = status === "established" || status === "tbd";

  function save() {
    setError("");
    if (!on) {
      // Override switched off: the project value is the TRD value again.
      if (!f.override) return close();
      if (run((p, actor) => clearOverride(p, docId, addr, actor), `Override removed from ${f.label}`)) close();
      return;
    }
    if (needsValue && !display.trim()) return setError("Enter the value, or choose another status.");
    const input = {
      status,
      ...(mayHaveValue && display.trim() ? { display: display.trim() } : {}),
      ...(mayHaveValue && unit.trim() ? { unit: unit.trim() } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    if (run((p, actor) => setOverride(p, docId, addr, input, actor), `${f.label} saved`)) close();
  }

  return (
    <li className="trd-field" data-testid={testId}>
      <div className="trd-field-line">
        <span className="trd-field-label">{f.label}</span>
        <span className="trd-field-value" data-testid={`${testId}-value`}>
          {v.text}
        </span>
        <span className="row wrap trd-field-tags">
          <FieldTags f={f} />
        </span>
        {!open && (
          <button
            ref={editBtn}
            type="button"
            className="btn small"
            aria-label={`${f.pulled || o ? "Edit" : "Enter"} ${f.label}`}
            data-testid={`${testId}-edit`}
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            {f.pulled || o ? "Edit" : "Enter a value"}
          </button>
        )}
      </div>
      {v.overridden && !open && (
        <p className="small muted trd-field-reason" data-testid={`${testId}-reason`}>
          Reason: {v.reason}. Entered by {v.by} on {v.at ? dateTime(v.at) : ""}.
        </p>
      )}
      {open && (
        <div className="trd-field-edit stack" role="group" aria-label={`Edit ${f.label}`}>
          {f.pulled && (
            <p className="small" data-testid={`${testId}-project`}>
              <strong>Project value:</strong> {v.pulledText}
            </p>
          )}
          {f.pulled && (
            <label className="check">
              <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} data-testid={`${testId}-toggle`} /> <span>Override the project value</span>
            </label>
          )}
          {on && (
            <>
              <label className="field">
                <span>Status of the TRD value</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as SeedStatus)} data-testid={`${testId}-status`}>
                  {ENTER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_TEXT[s]}
                    </option>
                  ))}
                </select>
              </label>
              {mayHaveValue && (
                <div className="row wrap end-align">
                  <label className="field grow">
                    <span>{status === "tbd" ? "Best guess (optional, shown as provisional)" : "Value"}</span>
                    <input value={display} onChange={(e) => setDisplay(e.target.value)} aria-describedby={error ? `${uid}-err` : undefined} data-testid={`${testId}-display`} />
                  </label>
                  <label className="field">
                    <span>Unit (optional)</span>
                    <input value={unit} onChange={(e) => setUnit(e.target.value)} data-testid={`${testId}-unit`} />
                  </label>
                </div>
              )}
              <label className="field">
                <span>Reason (optional; without one the TRD says "No reason recorded")</span>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${testId}-reason-input`} />
              </label>
            </>
          )}
          {error && (
            <p className="error" role="alert" id={`${uid}-err`}>
              {error}
            </p>
          )}
          <div className="row wrap">
            <button type="button" className="btn primary small" onClick={save} data-testid={`${testId}-save`}>
              Save
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                reset();
                close();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
