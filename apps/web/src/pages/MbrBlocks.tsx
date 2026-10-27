import {
  addMbrStep,
  addParamRow,
  addSampleRows,
  addTarget,
  addTimeLimit,
  blockLibraryStatus,
  candidateSamplePoints,
  libraryDifference,
  moveBlock,
  moveMbrStep,
  paramNote,
  removeParamRow,
  removeMbrStep,
  removeSampleRow,
  removeTarget,
  removeTimeLimit,
  renderStepText,
  requirementField,
  setParam,
  setTimeLimit,
  stepNumberText,
  stepRefToken,
  targetSum,
  trdRefText,
  updateBlock,
  updateBlockFromLibrary,
  updateMbrStep,
  updateRowFromTrd,
  updateSampleRowFromPlan,
  updateTarget,
  NOT_HELD,
  type SampleNotice,
  type TrdNotice,
} from "@gap/engine";
import { MBR_CHOICE_LABEL, POINT_AFTER_PPQ_LABEL, mbrChoiceText, type MbrBlock, type MbrChoice, type MbrLibraryBlock, type MbrParamRow, type MbrRecord, type MbrSection, type MbrTimeLimit, type MbrTrdRef, type Project } from "@gap/process-model";
import { useId, useRef, useState } from "react";
import { useStore } from "../store";
import type { Run } from "./SamplingFlow";

/*
 * One block of a master batch record: its steps, parameter rows, time limits, sample rows and the places left for the CMO.
 * Short form first (the block header with counts); the card opens to the full form. Nothing here decides anything: the notes are
 * information, a choice is only what the author sets, and an unset choice reads "Not decided".
 */

export interface BlockEnv {
  rec: MbrRecord;
  section: MbrSection;
  numbers: ReadonlyMap<string, string>;
  library: readonly MbrLibraryBlock[];
  trdNotices: readonly TrdNotice[];
  sampleNotices: readonly SampleNotice[];
  run: Run;
}

const NO_TRD = "No TRD value linked";

/** Where a TRD value comes from as short chips: the document identifier with the place in it. */
export function sourceChips(project: Project, ref: MbrTrdRef | undefined): string[] {
  if (!ref || ref.status !== "established") return [];
  return ref.sourceIds.map((id) => {
    const s = project.sources.find((x) => x.id === id);
    const name = s?.docRef?.identifier ?? s?.label ?? "source";
    const loc = ref.locations?.[id];
    const where = [loc?.section ? `section ${loc.section}` : "", loc?.page ? `page ${loc.page}` : ""].filter(Boolean).join(", ");
    return where ? `${name} (${where})` : name;
  });
}

function TrdValue({ ref, testId }: { ref: MbrTrdRef | undefined; testId: string }) {
  const project = useStore((s) => s.project)!;
  const chips = sourceChips(project, ref);
  const text = ref ? (ref.status === "established" ? trdRefText(ref) : ref.status === "not_established" ? NOT_HELD : ref.text || NOT_HELD) : NO_TRD;
  return (
    <span className="mbr-trd" data-testid={testId}>
      <span className="mbr-trd-label">TRD value</span> <strong>{text}</strong>
      {ref?.provisional && <span className="tag status status-tbd">provisional</span>}
      {ref?.status === "established" && chips.length === 0 && <span className="tag status status-not_established">no source cited</span>}
      {chips.map((c) => (
        <span key={c} className="tag mbr-source-chip" title="Source of the TRD value">
          Source: {c}
        </span>
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ steps

function StepItem({ env, block, step, index, count }: { env: BlockEnv; block: MbrBlock; step: MbrBlock["steps"][number]; index: number; count: number }) {
  const { rec, numbers, run } = env;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(step.text);
  const editBtn = useRef<HTMLButtonElement>(null);
  const number = numbers.get(step.id) ?? "";
  const close = () => {
    setEditing(false);
    // Focus returns to the Edit button once the step has gone back to reading.
    setTimeout(() => editBtn.current?.focus(), 0);
  };
  const others = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps.filter((x) => x.id !== step.id)));
  return (
    <li className="mbr-step" data-testid={`mbr-step-${step.id}`}>
      <span className="mbr-step-no" data-testid={`mbr-step-no-${step.id}`}>
        {number}
      </span>
      {!editing ? (
        <>
          <span className="mbr-step-text">{renderStepText(step.text, numbers)}</span>
          <span className="row wrap mbr-step-actions">
            <button ref={editBtn} type="button" className="btn small" aria-label={`Edit step ${number}`} data-testid={`mbr-step-edit-${step.id}`} onClick={() => { setText(step.text); setEditing(true); }}>
              Edit
            </button>
            <button type="button" className="btn small" aria-label={`Move step ${number} up`} disabled={index === 0} onClick={() => run((p, a) => moveMbrStep(p, rec.id, step.id, -1, a), "Step moved")}>
              Up
            </button>
            <button type="button" className="btn small" aria-label={`Move step ${number} down`} disabled={index === count - 1} onClick={() => run((p, a) => moveMbrStep(p, rec.id, step.id, 1, a), "Step moved")}>
              Down
            </button>
            <button type="button" className="btn small" aria-label={`Remove step ${number}`} onClick={() => run((p, a) => removeMbrStep(p, rec.id, step.id, a), "Step removed")}>
              Remove
            </button>
          </span>
        </>
      ) : (
        <span className="stack mbr-step-edit">
          <label className="field">
            <span className="visually-hidden">Text of step {number}</span>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid={`mbr-step-text-${step.id}`} />
          </label>
          <label className="field">
            <span>Add a reference to another step</span>
            <select
              value=""
              data-testid={`mbr-step-ref-${step.id}`}
              onChange={(e) => {
                if (e.target.value) setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${stepRefToken(e.target.value)}`);
              }}
            >
              <option value="">Choose a step</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {stepNumberText(numbers, o.id)}: {o.text.slice(0, 50)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">A reference is stored as the step's id and shown as its number, for example "(Step 9.14)", so it stays right when steps are added, moved or removed.</p>
          <span className="row wrap">
            <button
              type="button"
              className="btn primary small"
              data-testid={`mbr-step-save-${step.id}`}
              onClick={() => {
                if (run((p, a) => updateMbrStep(p, rec.id, step.id, text, a), "Step saved")) close();
              }}
            >
              Save step
            </button>
            <button type="button" className="btn small" onClick={close}>
              Cancel
            </button>
          </span>
        </span>
      )}
      {block.steps.length === 0 && null}
    </li>
  );
}

function Steps({ env, block }: { env: BlockEnv; block: MbrBlock }) {
  const { rec, run } = env;
  const [text, setText] = useState("");
  return (
    <div className="stack">
      <h4>Steps</h4>
      {block.steps.length === 0 ? (
        <p className="muted small">No steps yet.</p>
      ) : (
        <ol className="mbr-steps plain-list" aria-label={`Steps of ${block.title}`}>
          {block.steps.map((s, i) => (
            <StepItem key={s.id} env={env} block={block} step={s} index={i} count={block.steps.length} />
          ))}
        </ol>
      )}
      <div className="row wrap end-align">
        <label className="field grow">
          <span>New step</span>
          <input value={text} onChange={(e) => setText(e.target.value)} data-testid={`mbr-step-new-${block.id}`} />
        </label>
        <button
          type="button"
          className="btn small"
          data-testid={`mbr-step-add-${block.id}`}
          onClick={() => {
            if (!text.trim()) return;
            if (run((p, a) => addMbrStep(p, rec.id, block.id, text, a).project, "Step added")) setText("");
          }}
        >
          Add step
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ parameter rows

function ParamRowView({ env, block, row }: { env: BlockEnv; block: MbrBlock; row: MbrParamRow }) {
  const { rec, run } = env;
  const [value, setValue] = useState(row.mbrValue ?? "");
  const [unit, setUnit] = useState(row.mbrUnit ?? "");
  const [reason, setReason] = useState(row.reason ?? "");
  const name = useId();
  const notice = env.trdNotices.find((n) => n.rowId === row.id && n.kind === "param");
  const note = paramNote(row);
  const following = row.choice === "same_as_trd";
  const current: MbrChoice | "unset" = row.choice && row.choice !== "not_decided" ? row.choice : "unset";
  const choose = (c: MbrChoice | "unset") => run((p, a) => setParam(p, rec.id, row.id, { choice: c === "unset" ? null : c }, a), "Choice saved");
  const commit = (patch: { mbrValue?: string; mbrUnit?: string }) => {
    if (following) return;
    run((p, a) => setParam(p, rec.id, row.id, patch, a), "MBR value saved");
  };
  return (
    <li className="mbr-row" id={`mbr-row-${row.id}`} data-testid={`mbr-row-${row.id}`} tabIndex={-1}>
      <div className="mbr-row-head">
        <strong className="mbr-row-label">{row.label}</strong>
        <span className="tag" data-testid={`mbr-choice-state-${row.id}`}>
          {mbrChoiceText(row)}
        </span>
      </div>
      <TrdValue ref={row.trd} testId={`mbr-trd-${row.id}`} />
      {notice && (
        <p className="notice small" role="status" data-testid={`mbr-trd-changed-${row.id}`}>
          TRD value changed since this was set.{" "}
          {notice.trdGone ? (
            "The TRD record is no longer in this project."
          ) : (
            <button type="button" className="btn small" aria-label={`Update from TRD: ${row.label}`} data-testid={`mbr-trd-update-${row.id}`} onClick={() => run((p, a) => updateRowFromTrd(p, rec.id, row.id, a), "Row updated from the TRD")}>
              Update from TRD
            </button>
          )}
        </p>
      )}
      <fieldset className="mbr-choice" data-testid={`mbr-choice-${row.id}`}>
        <legend className="visually-hidden">Choice for {row.label}</legend>
        {(["same_as_trd", "tightened_by_cmo"] as const).map((c) => (
          <label key={c} className="check">
            <input type="radio" name={`${name}-c`} checked={current === c} onChange={() => choose(c)} data-testid={`mbr-choice-${c}-${row.id}`} /> <span>{MBR_CHOICE_LABEL[c]}</span>
          </label>
        ))}
        <label className="check">
          <input type="radio" name={`${name}-c`} checked={current === "unset"} onChange={() => choose("unset")} data-testid={`mbr-choice-unset-${row.id}`} /> <span>Not decided</span>
        </label>
      </fieldset>
      <div className="row wrap end-align">
        <label className="field">
          <span>MBR value{following ? " (follows the TRD value)" : ""}</span>
          <input
            value={following ? (row.mbrValue ?? "") : value}
            readOnly={following}
            placeholder={following && !row.mbrValue ? NOT_HELD : ""}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => value !== (row.mbrValue ?? "") && commit({ mbrValue: value })}
            data-testid={`mbr-value-${row.id}`}
          />
        </label>
        <label className="field">
          <span>MBR unit</span>
          <input
            className="num"
            value={following ? (row.mbrUnit ?? "") : unit}
            readOnly={following}
            onChange={(e) => setUnit(e.target.value)}
            onBlur={() => unit !== (row.mbrUnit ?? "") && commit({ mbrUnit: unit })}
            data-testid={`mbr-unit-${row.id}`}
          />
        </label>
      </div>
      {note && (
        <p className="mbr-note small" data-testid={`mbr-note-${row.id}`}>
          Note (for information, nothing is blocked): {note}
        </p>
      )}
      {row.reason && <p className="small">Reason: {row.reason}</p>}
      <details className="mbr-more">
        <summary data-testid={`mbr-more-${row.id}`}>More details</summary>
        <div className="stack">
          <label className="field">
            <span>Reason (optional)</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => reason !== (row.reason ?? "") && run((p, a) => setParam(p, rec.id, row.id, { reason }, a), "Reason saved")} data-testid={`mbr-reason-${row.id}`} />
          </label>
          <label className="check">
            <input type="checkbox" checked={Boolean(row.studyPoint)} onChange={(e) => run((p, a) => setParam(p, rec.id, row.id, { studyPoint: e.target.checked }, a), "Study point marker saved")} data-testid={`mbr-study-${row.id}`} />{" "}
            <span>Study point, not a limit (a challenge value; no comparison note is shown)</span>
          </label>
          <div>
            <button type="button" className="btn small" aria-label={`Remove this row: ${row.label}`} onClick={() => run((p, a) => removeParamRow(p, rec.id, row.id, a), "Row removed")}>
              Remove this row
            </button>
          </div>
        </div>
      </details>
      {block.params.length === 0 && null}
    </li>
  );
}

function Params({ env, block }: { env: BlockEnv; block: MbrBlock }) {
  const { rec, section, run } = env;
  const project = useStore((s) => s.project)!;
  const [label, setLabel] = useState("");
  const [ref, setRef] = useState("");
  const trd = project.trd.documents.find((d) => d.id === rec.trdId);
  const step = trd?.steps.find((s) => s.key === section.unitOp);
  const options = (step?.items ?? []).filter((i) => i.collection === "param" || i.collection === "ipc").flatMap((i) => {
    const field = requirementField(i);
    return field ? [{ value: `${i.collection}|${i.key}|${field}`, label: i.label }] : [];
  });
  return (
    <div className="stack">
      <h4>Parameters</h4>
      {block.params.length === 0 ? (
        <p className="muted small">No parameter rows in this block.</p>
      ) : (
        <ul className="mbr-rows plain-list" aria-label={`Parameter rows of ${block.title}`}>
          {block.params.map((r) => (
            <ParamRowView key={r.id} env={env} block={block} row={r} />
          ))}
        </ul>
      )}
      <div className="row wrap end-align">
        <label className="field grow">
          <span>New parameter row</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} data-testid={`mbr-row-new-${block.id}`} />
        </label>
        {options.length > 0 && (
          <label className="field">
            <span>TRD value (optional)</span>
            <select value={ref} onChange={(e) => setRef(e.target.value)} data-testid={`mbr-row-ref-${block.id}`}>
              <option value="">No TRD link</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="btn small"
          data-testid={`mbr-row-add-${block.id}`}
          onClick={() => {
            if (!label.trim()) return;
            const [collection, itemKey, field] = ref.split("|");
            const input = ref ? { label, ref: { collection: collection as "param" | "ipc", itemKey: itemKey!, field: field! } } : { label };
            if (run((p, a) => addParamRow(p, rec.id, block.id, input, a).project, "Parameter row added")) {
              setLabel("");
              setRef("");
            }
          }}
        >
          Add parameter row
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ time limits

function TargetView({ env, block, limit, t }: { env: BlockEnv; block: MbrBlock; limit: MbrTimeLimit; t: MbrTimeLimit["targets"][number] }) {
  const { rec, numbers, run } = env;
  const [label, setLabel] = useState(t.label);
  const [value, setValue] = useState(t.value ?? "");
  const [unit, setUnit] = useState(t.unit ?? "");
  const save = (patch: Parameters<typeof updateTarget>[3]) => run((p, a) => updateTarget(p, rec.id, t.id, patch, a), "Target saved");
  const stepOptions = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps));
  return (
    <li className="mbr-target" data-testid={`mbr-target-${t.id}`}>
      <div className="row wrap end-align">
        <label className="field grow">
          <span>Target</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label.trim() && label !== t.label && save({ label })} data-testid={`mbr-target-label-${t.id}`} />
        </label>
        <label className="field">
          <span>Value</span>
          <input className="num" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== (t.value ?? "") && save({ value })} data-testid={`mbr-target-value-${t.id}`} />
        </label>
        <label className="field">
          <span>Unit</span>
          <input className="num" value={unit} onChange={(e) => setUnit(e.target.value)} onBlur={() => unit !== (t.unit ?? "") && save({ unit })} />
        </label>
        {(["fromStepId", "toStepId"] as const).map((k) => (
          <label key={k} className="field">
            <span>{k === "fromStepId" ? "From step" : "To step"}</span>
            <select value={t[k] ?? ""} onChange={(e) => save(k === "fromStepId" ? { fromStepId: e.target.value || null } : { toStepId: e.target.value || null })} data-testid={`mbr-target-${k === "fromStepId" ? "from" : "to"}-${t.id}`}>
              <option value="">Not set</option>
              {stepOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {stepNumberText(numbers, s.id)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="button" className="btn small" aria-label={`Remove target ${t.label}`} onClick={() => run((p, a) => removeTarget(p, rec.id, t.id, a), "Target removed")}>
          Remove
        </button>
      </div>
      {(t.fromStepId || t.toStepId) && (
        <p className="muted small">
          Covers {stepNumberText(numbers, t.fromStepId) || "?"} to {stepNumberText(numbers, t.toStepId) || "?"}.
        </p>
      )}
      {block.id === "" && limit.id === "" && null}
    </li>
  );
}

function TimeLimitView({ env, block, limit }: { env: BlockEnv; block: MbrBlock; limit: MbrTimeLimit }) {
  const { rec, run } = env;
  const notice = env.trdNotices.find((n) => n.rowId === limit.id && n.kind === "time_limit");
  const [value, setValue] = useState(limit.value ?? "");
  const [unit, setUnit] = useState(limit.unit ?? "");
  const [label, setLabel] = useState("");
  const [tv, setTv] = useState("");
  const [tu, setTu] = useState("");
  const sum = targetSum(limit);
  return (
    <li className="mbr-limit" data-testid={`mbr-limit-${limit.id}`}>
      <strong>{limit.label}</strong>
      <TrdValue ref={limit.trd} testId={`mbr-limit-trd-${limit.id}`} />
      {notice && (
        <p className="notice small" role="status" data-testid={`mbr-limit-changed-${limit.id}`}>
          TRD value changed since this was set.{" "}
          {notice.trdGone ? (
            "The TRD record is no longer in this project."
          ) : (
            <button type="button" className="btn small" aria-label={`Update from TRD: ${limit.label}`} onClick={() => run((p, a) => updateRowFromTrd(p, rec.id, limit.id, a), "Time limit updated from the TRD")}>
              Update from TRD
            </button>
          )}
        </p>
      )}
      <div className="row wrap end-align">
        <label className="field">
          <span>Critical limit</span>
          <input className="num" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== (limit.value ?? "") && run((p, a) => setTimeLimit(p, rec.id, limit.id, { value }, a), "Critical limit saved")} data-testid={`mbr-limit-value-${limit.id}`} />
        </label>
        <label className="field">
          <span>Unit</span>
          <input className="num" value={unit} onChange={(e) => setUnit(e.target.value)} onBlur={() => unit !== (limit.unit ?? "") && run((p, a) => setTimeLimit(p, rec.id, limit.id, { unit }, a), "Critical limit unit saved")} />
        </label>
        <button type="button" className="btn small" aria-label={`Remove limit: ${limit.label}`} onClick={() => run((p, a) => removeTimeLimit(p, rec.id, limit.id, a), "Time limit removed")}>
          Remove limit
        </button>
      </div>
      <p className="muted small">Targets sit under the critical limit, each tied to a range of steps. The limit comes from the TRD; a target is the CMO's own planning value.</p>
      {limit.targets.length > 0 && (
        <ul className="mbr-targets plain-list" aria-label={`Targets under ${limit.label}`}>
          {limit.targets.map((t) => (
            <TargetView key={t.id} env={env} block={block} limit={limit} t={t} />
          ))}
        </ul>
      )}
      <p className="small" data-testid={`mbr-limit-sum-${limit.id}`}>
        {sum.text}
      </p>
      <div className="row wrap end-align">
        <label className="field grow">
          <span>New target</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} data-testid={`mbr-target-new-${limit.id}`} />
        </label>
        <label className="field">
          <span>Value</span>
          <input className="num" value={tv} onChange={(e) => setTv(e.target.value)} />
        </label>
        <label className="field">
          <span>Unit</span>
          <input className="num" value={tu} onChange={(e) => setTu(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn small"
          data-testid={`mbr-target-add-${limit.id}`}
          onClick={() => {
            if (!label.trim()) return;
            if (run((p, a) => addTarget(p, rec.id, limit.id, { label, ...(tv.trim() ? { value: tv } : {}), ...(tu.trim() ? { unit: tu } : {}) }, a).project, "Target added")) {
              setLabel("");
              setTv("");
              setTu("");
            }
          }}
        >
          Add target
        </button>
      </div>
    </li>
  );
}

function TimeLimits({ env, block }: { env: BlockEnv; block: MbrBlock }) {
  const { rec, run } = env;
  const [label, setLabel] = useState("");
  return (
    <div className="stack">
      <h4>Time limits</h4>
      {block.timeLimits.length === 0 ? (
        <p className="muted small">No time limits in this block.</p>
      ) : (
        <ul className="mbr-limits plain-list" aria-label={`Time limits of ${block.title}`}>
          {block.timeLimits.map((l) => (
            <TimeLimitView key={l.id} env={env} block={block} limit={l} />
          ))}
        </ul>
      )}
      <div className="row wrap end-align">
        <label className="field grow">
          <span>New time limit</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} data-testid={`mbr-limit-new-${block.id}`} />
        </label>
        <button
          type="button"
          className="btn small"
          data-testid={`mbr-limit-add-${block.id}`}
          onClick={() => {
            if (!label.trim()) return;
            if (run((p, a) => addTimeLimit(p, rec.id, block.id, { label }, a).project, "Time limit added")) setLabel("");
          }}
        >
          Add time limit
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ samples

function Samples({ env, block }: { env: BlockEnv; block: MbrBlock }) {
  const { rec, section, run } = env;
  const project = useStore((s) => s.project)!;
  const plan = project.sampling.plans.find((p) => p.id === rec.planId);
  const [pick, setPick] = useState("");
  if (!plan && block.samples.length === 0) return null;
  const have = new Set(block.samples.map((s) => s.pointId));
  const candidates = plan ? plan.points.filter((p) => !have.has(p.id) && (candidateSamplePoints(plan, section.unitOp, ["*"]).some((c) => c.id === p.id) || !section.unitOp)) : [];
  return (
    <div className="stack">
      <h4>Samples from the sampling plan</h4>
      {block.samples.length === 0 ? (
        <p className="muted small">No sample rows in this block.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label={`Sample rows of ${block.title}`} tabIndex={0}>
          <table className="data" data-testid={`mbr-samples-${block.id}`}>
            <thead>
              <tr>
                <th scope="col">Point</th>
                <th scope="col">Test</th>
                <th scope="col">Step</th>
                <th scope="col">Quantity</th>
                <th scope="col">Container</th>
                <th scope="col">Storage</th>
                <th scope="col">Moment and hold</th>
                <th scope="col">After PPQ</th>
                <th scope="col">Plan check</th>
              </tr>
            </thead>
            <tbody>
              {block.samples.map((r) => {
                const n = env.sampleNotices.find((x) => x.rowId === r.id);
                return (
                  <tr key={r.id} data-testid={`mbr-sample-${r.id}`}>
                    <th scope="row">{r.pointId}</th>
                    <td>{r.test}</td>
                    <td>{r.step ?? ""}</td>
                    <td>{r.quantity ?? ""}</td>
                    <td>{r.container ?? ""}</td>
                    <td>{r.storage ?? ""}</td>
                    <td>{[r.hour, r.hold].filter(Boolean).join("; ")}</td>
                    <td data-testid={`mbr-sample-after-ppq-${r.id}`}>{afterPpqOf(plan, r.pointId)}</td>
                    <td>
                      {n ? (
                        <span className="stack">
                          <span data-testid={`mbr-sample-changed-${r.id}`}>{n.missing ? "This point is no longer in the sampling plan." : "Changed in the sampling plan."}</span>
                          {!n.missing && (
                            <button type="button" className="btn small" aria-label={`Update from plan: sample row ${r.pointId}`} data-testid={`mbr-sample-update-${r.id}`} onClick={() => run((p, a) => updateSampleRowFromPlan(p, rec.id, r.id, a), "Sample row updated from the plan")}>
                              Update from plan
                            </button>
                          )}
                        </span>
                      ) : (
                        <span className="muted small">Same as the plan</span>
                      )}
                      <button type="button" className="btn small" aria-label={`Remove sample row ${r.pointId}`} onClick={() => run((p, a) => removeSampleRow(p, rec.id, r.id, a), "Sample row removed")}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {plan && candidates.length > 0 && (
        <div className="row wrap end-align">
          <label className="field">
            <span>Add a sample row from the plan</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} data-testid={`mbr-sample-pick-${block.id}`}>
              <option value="">Choose a sample point</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}: {p.attribute}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn small"
            disabled={!pick}
            data-testid={`mbr-sample-add-${block.id}`}
            onClick={() => {
              if (run((p, a) => addSampleRows(p, rec.id, block.id, [pick], a), "Sample row added")) setPick("");
            }}
          >
            Add sample row
          </button>
        </div>
      )}
    </div>
  );
}

/** The PPQ-only / continues flag, read live from the sampling plan point (never copied into the record). Unflagged = "Not stated". */
function afterPpqOf(plan: { points: { id: string; afterPpq?: keyof typeof POINT_AFTER_PPQ_LABEL | undefined }[] } | undefined, pointId: string): string {
  const a = plan?.points.find((p) => p.id === pointId)?.afterPpq;
  return a ? POINT_AFTER_PPQ_LABEL[a] : "Not stated";
}

/** Read-only view of the forms a library block carries (filter records, intervention log). The record's form is printed blank for the operators. */
function Forms({ block }: { block: MbrBlock }) {
  if (!block.forms?.length) return null;
  return (
    <div className="stack" data-testid={`mbr-forms-${block.id}`}>
      {block.forms.map((f) => (
        <div key={f.key} className="stack">
          <h4>{f.title}</h4>
          <div className="table-scroll" role="region" aria-label={`Form columns of ${f.title}`} tabIndex={0}>
            <table className="data" data-testid={`mbr-form-${block.id}-${f.key}`}>
              <thead>
                <tr>
                  {f.columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          <p className="muted small">Printed with {f.blankRows} blank rows for the operators to complete.</p>
          {f.note && <p className="small">{f.note}</p>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the block card

export function BlockCard({ env, block, index, count, open, onToggle, onRemove }: { env: BlockEnv; block: MbrBlock; index: number; count: number; open: boolean; onToggle: () => void; onRemove: (opener: HTMLElement) => void }) {
  const { rec, run } = env;
  const [title, setTitle] = useState(block.title);
  const [note, setNote] = useState(block.note ?? "");
  const [cmo, setCmo] = useState(block.cmoFields.join("\n"));
  const status = blockLibraryStatus(block, env.library);
  const lib = block.libraryId ? env.library.find((b) => b.id === block.libraryId) : undefined;
  const diff = lib && status.kind === "newer" ? libraryDifference(block, lib) : undefined;
  const undecided = block.params.filter((r) => !r.studyPoint && (!r.choice || r.choice === "not_decided")).length;
  const panelId = `mbr-block-${block.id}`;
  const counts = `${block.steps.length} ${block.steps.length === 1 ? "step" : "steps"}, ${block.params.length} ${block.params.length === 1 ? "parameter" : "parameters"}${undecided ? ` (${undecided} not decided)` : ""}, ${block.timeLimits.length} time ${block.timeLimits.length === 1 ? "limit" : "limits"}, ${block.samples.length} ${block.samples.length === 1 ? "sample" : "samples"}`;
  return (
    <article className="mbr-block card stack" data-testid={`mbr-block-card-${block.id}`} aria-labelledby={`${panelId}-h`}>
      <div className="row wrap between">
        <h3 id={`${panelId}-h`} className="mbr-block-title">
          <button type="button" className="mbr-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle} data-testid={`mbr-block-toggle-${block.id}`}>
            <span aria-hidden="true">{open ? "▾" : "▸"}</span> {block.title}
          </button>
        </h3>
        <span className="row wrap">
          <button type="button" className="btn small" aria-label={`Move block ${block.title} up`} disabled={index === 0 && rec.sections[0]?.id === env.section.id} onClick={() => run((p, a) => moveBlock(p, rec.id, block.id, -1, a), "Block moved")}>
            Up
          </button>
          <button type="button" className="btn small" aria-label={`Move block ${block.title} down`} disabled={index === count - 1 && rec.sections[rec.sections.length - 1]?.id === env.section.id} onClick={() => run((p, a) => moveBlock(p, rec.id, block.id, 1, a), "Block moved")}>
            Down
          </button>
          <button type="button" className="btn small" aria-label={`Remove block ${block.title}`} data-testid={`mbr-block-remove-${block.id}`} onClick={(e) => onRemove(e.currentTarget)}>
            Remove
          </button>
        </span>
      </div>
      <p className="muted small" data-testid={`mbr-block-counts-${block.id}`}>
        {counts}
        {block.libraryId && ` · from library block ${block.libraryId}, version ${block.libraryVersion}`}
      </p>
      {status.kind === "newer" && (
        <p className="notice small" role="status" data-testid={`mbr-library-newer-${block.id}`}>
          The library has a newer version of this block (version {status.libraryVersion}; this block is version {status.usedVersion}).
          {diff && ` Differences: ${diff.stepsAdded} steps added, ${diff.stepsRemoved} removed, ${diff.stepsChanged} changed${diff.titleChanged ? ", title changed" : ""}${diff.paramsAdded.length ? `, new parameter rows: ${diff.paramsAdded.join(", ")}` : ""}.`}{" "}
          <button type="button" className="btn small" data-testid={`mbr-library-update-${block.id}`} onClick={() => run((p, a) => updateBlockFromLibrary(p, rec.id, block.id, lib!, a), "Block updated from the library")}>
            Update from library
          </button>
        </p>
      )}
      {status.kind === "missing" && <p className="muted small">The library no longer holds this block. This record keeps its own copy.</p>}
      {open && (
        <div id={panelId} className="stack">
          <div className="row wrap end-align">
            <label className="field grow">
              <span>Block title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== block.title && run((p, a) => updateBlock(p, rec.id, block.id, { title }, a), "Block title saved")} data-testid={`mbr-block-title-${block.id}`} />
            </label>
          </div>
          <Steps env={env} block={block} />
          <Params env={env} block={block} />
          <TimeLimits env={env} block={block} />
          <Samples env={env} block={block} />
          <Forms block={block} />
          <details className="mbr-more">
            <summary data-testid={`mbr-block-more-${block.id}`}>More details: what the CMO completes, and a note</summary>
            <div className="stack">
              <label className="field">
                <span>To be completed by the CMO (one entry per line)</span>
                <textarea rows={4} value={cmo} onChange={(e) => setCmo(e.target.value)} onBlur={() => run((p, a) => updateBlock(p, rec.id, block.id, { cmoFields: cmo.split("\n").map((x) => x.trim()).filter(Boolean) }, a), "CMO entries saved")} data-testid={`mbr-block-cmo-${block.id}`} />
              </label>
              <label className="field">
                <span>Note for the reader (optional)</span>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (block.note ?? "") && run((p, a) => updateBlock(p, rec.id, block.id, { note }, a), "Block note saved")} />
              </label>
            </div>
          </details>
        </div>
      )}
    </article>
  );
}
