import { addPoint, updatePoint } from "@gap/engine";
import { FLOW_POSITIONS, SAMPLING_TYPES, UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE, type FlowPosition, type SamplingPlan, type SamplingType } from "@gap/process-model";
import { NOT_ON_DIAGRAM, POSITION_NOT_SET, SLOT_LABEL, TYPE_HELP, TYPE_LABEL, WIZARD_FIELDS, unitOpForStep, wizardPatch, type WizardField, type WizardValues } from "@gap/sampling";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../components";
import { useStepChoices } from "./SamplingPointDialog";
import type { Run } from "./SamplingFlow";

/*
 * Adding a sample: a short form, or the same questions one screen at a time (the wizard).
 *
 * Design notes (the why):
 *  - The long add form listed every study type's fields and was "so long and confusing" (the product owner). Adding now asks only four
 *    things (step, position, sample type, what is tested). Everything else is filled in afterwards under "More details", where only the
 *    chosen type's fields show.
 *  - The wizard is an alternative, not a second code path: both end in the same addPoint call (and, when the wizard collected the
 *    type's key fields, one updatePoint in the same store update), so the point, the change log and the checks are identical.
 *  - POSSIBILITIES, NOT RULES. Nothing new is required. The sample type was already needed to add a point (it decides which questions
 *    exist at all); "what is tested" and the position stay optional and stay empty unless the person fills them in.
 *  - Not on the diagram is a normal choice. A sample added there carries the "supporting work" step until the person picks a
 *    catalog step in More details (or the interview section it was added from).
 */

export type AddRequest = { stepId?: string | undefined; at?: FlowPosition | undefined; unitOp?: string | undefined; type?: SamplingType | undefined };

const MODE_KEY = "gap-sampling-add-mode";
type Mode = "short" | "wizard";

/** The remembered choice of form. Storage can be blocked (private window, site data off), so every access is guarded. */
function readMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "wizard" ? "wizard" : "short";
  } catch {
    return "short";
  }
}
function writeMode(m: Mode) {
  try {
    window.localStorage.setItem(MODE_KEY, m);
  } catch {
    /* the choice just isn't remembered */
  }
}

/** The first sentence of a type's help: the one-line description shown beside the type. */
const oneLine = (t: SamplingType): string => TYPE_HELP[t].split(/(?<=\.)\s/)[0]!;

const SCREENS = ["Where", "Sample type", "What is tested", "Key fields", "Review"] as const;

export function AddSampleDialog({
  plan,
  request,
  run,
  onClose,
  onAdded,
  restoreFocus,
}: {
  plan: SamplingPlan;
  request: AddRequest;
  run: Run;
  onClose: () => void;
  onAdded: (pointId: string) => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const steps = useStepChoices();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [stepId, setStepId] = useState(request.stepId && plan.steps.some((s) => s.id === request.stepId) ? request.stepId : "");
  const [at, setAt] = useState<FlowPosition | "">(request.stepId ? (request.at ?? "") : "");
  const [type, setType] = useState<SamplingType | "">(request.type ?? "");
  const [attribute, setAttribute] = useState("");
  const [values, setValues] = useState<WizardValues>({});
  const [screen, setScreen] = useState(0);
  const [failed, setFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const setMode = (m: Mode) => {
    setModeState(m);
    writeMode(m);
  };
  // Keyboard and screen-reader users must not lose their place: each wizard screen moves focus to its own heading.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (mode === "wizard") headingRef.current?.focus();
  }, [screen, mode]);

  const onDiagram = stepId !== "";
  const setStep = (v: string) => {
    setStepId(v);
    if (!v) setAt("");
  };

  function submit() {
    if (!type) return;
    const step = plan.steps.find((s) => s.id === stepId);
    // A sample on a step takes that step's unit operation; one that is not on the diagram carries the section it was added from, or
    // "supporting work", never a guess.
    const unitOp = step ? unitOpForStep(step) : (request.unitOp ?? UNIT_OP_NONE);
    const patch = mode === "wizard" ? wizardPatch(type, values) : {};
    let id = "";
    const ok = run((p, actor) => {
      const r = addPoint(p, plan.id, { unitOp, type, ...(attribute.trim() ? { attribute: attribute.trim() } : {}), ...(step ? { flow: { stepId: step.id, ...(at ? { at } : {}) } } : {}) }, actor);
      id = r.pointId;
      return Object.keys(patch).length ? updatePoint(r.project, plan.id, id, patch, actor) : r.project;
    }, "Point added");
    if (ok) onAdded(id);
    else setFailed(true);
  }

  const stepLabel = plan.steps.find((s) => s.id === stepId)?.label;
  const wherePicker = (
    <>
      <label className="field">
        <span>Step</span>
        <select value={stepId} onChange={(e) => setStep(e.target.value)} data-testid="add-step">
          <option value="">{NOT_ON_DIAGRAM}</option>
          {plan.steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Position</span>
        <select value={at} disabled={!onDiagram} onChange={(e) => setAt(e.target.value as FlowPosition | "")} data-testid="add-position">
          <option value="">{onDiagram ? POSITION_NOT_SET : "Not applicable"}</option>
          {FLOW_POSITIONS.map((f) => (
            <option key={f} value={f}>
              {SLOT_LABEL[f]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
  const whatField = (
    <label className="field">
      <span>
        What is tested <span className="muted">(optional now)</span>
      </span>
      <input value={attribute} onChange={(e) => setAttribute(e.target.value)} data-testid="add-what" />
    </label>
  );

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Add a sample" description="A few questions now. Everything else you can fill in later under More details." restoreFocus={restoreFocus}>
      <div className="stack" data-testid="add-dialog">
        <div role="group" aria-label="Add with" className="row wrap seg add-mode" data-testid="add-mode">
          <span className="small">Add with:</span>
          <button type="button" className={mode === "short" ? "btn small primary" : "btn small"} aria-pressed={mode === "short"} onClick={() => setMode("short")} data-testid="add-mode-short">
            Short form
          </button>
          <button type="button" className={mode === "wizard" ? "btn small primary" : "btn small"} aria-pressed={mode === "wizard"} onClick={() => setMode("wizard")} data-testid="add-mode-wizard">
            Step by step
          </button>
        </div>

        {mode === "short" ? (
          <form
            className="stack"
            aria-label="Add a sample, short form"
            data-testid="add-short"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {wherePicker}
            <label className="field">
              <span>Sample type</span>
              <select value={type} onChange={(e) => setType(e.target.value as SamplingType | "")} data-testid="add-type" aria-describedby="add-type-help">
                <option value="">Choose</option>
                {SAMPLING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <span id="add-type-help" className="muted small" data-testid="add-type-help">
                {type ? oneLine(type) : "The type decides which questions come next."}
              </span>
            </label>
            {whatField}
            {failed && (
              <p className="error" role="alert">
                The sample was not added. See the message on the page.
              </p>
            )}
            <div className="row wrap end">
              <button type="button" className="btn" onClick={onClose} data-testid="add-cancel">
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!type} data-testid="add-submit">
                Add sample
              </button>
            </div>
          </form>
        ) : (
          <form
            className="stack"
            aria-label="Add a sample, step by step"
            data-testid="add-wizard"
            onSubmit={(e) => {
              e.preventDefault();
              if (screen === SCREENS.length - 1) submit();
              else if (screen !== 1 || type) setScreen(screen + 1);
            }}
          >
            <p className="small muted" data-testid="wizard-progress">
              Step {screen + 1} of {SCREENS.length}
            </p>
            <h3 ref={headingRef} tabIndex={-1} className="wizard-heading" data-testid="wizard-heading">
              {["Where does the sample go?", "What kind of sample is it?", "What is tested?", type ? `Key fields: ${TYPE_LABEL[type]}` : "Key fields", "Review"][screen]}
            </h3>

            {screen === 0 && <div className="stack">{wherePicker}</div>}

            {screen === 1 && (
              <fieldset className="stack fs wizard-types">
                <legend>Sample type</legend>
                {SAMPLING_TYPES.map((t) => (
                  <label key={t} className="wizard-type">
                    <input type="radio" name="add-type" value={t} checked={type === t} onChange={() => setType(t)} data-testid={`wizard-type-${t}`} />
                    <span>
                      <strong>{TYPE_LABEL[t]}</strong>
                      <span className="muted small"> {oneLine(t)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {screen === 2 && (
              <div className="stack">
                {whatField}
                <p className="muted small">You can leave this empty. It then shows as an open item until you name it.</p>
              </div>
            )}

            {screen === 3 && type && <KeyFields type={type} values={values} onChange={setValues} />}

            {screen === 4 && (
              <dl className="wizard-review" data-testid="wizard-review">
                <div>
                  <dt>Step</dt>
                  <dd>{stepLabel ?? NOT_ON_DIAGRAM}</dd>
                </div>
                <div>
                  <dt>Position</dt>
                  <dd>{onDiagram ? (at ? SLOT_LABEL[at] : POSITION_NOT_SET) : "Not applicable"}</dd>
                </div>
                <div>
                  <dt>Sample type</dt>
                  <dd>{type ? TYPE_LABEL[type] : "Not chosen"}</dd>
                </div>
                <div>
                  <dt>What is tested</dt>
                  <dd>{attribute.trim() || "Not named yet"}</dd>
                </div>
                {type &&
                  WIZARD_FIELDS[type].map((f) => (
                    <div key={f.key}>
                      <dt>{f.label}</dt>
                      <dd>{valueText(f, values[f.key], steps)}</dd>
                    </div>
                  ))}
              </dl>
            )}

            {failed && (
              <p className="error" role="alert">
                The sample was not added. See the message on the page.
              </p>
            )}
            <div className="row wrap between">
              <button type="button" className="btn" onClick={onClose} data-testid="add-cancel">
                Cancel
              </button>
              <div className="row wrap">
                <button type="button" className="btn" disabled={screen === 0} onClick={() => setScreen(screen - 1)} data-testid="wizard-back">
                  Back
                </button>
                {screen < SCREENS.length - 1 ? (
                  <button key="next" type="submit" className="btn primary" disabled={screen === 1 && !type} data-testid="wizard-next">
                    Next
                  </button>
                ) : (
                  <button key="add" type="submit" className="btn primary" disabled={!type} data-testid="add-submit">
                    Add sample
                  </button>
                )}
              </div>
            </div>
            {screen === 1 && !type && <p className="muted small">Choose a sample type to continue.</p>}
          </form>
        )}
      </div>
    </Modal>
  );
}

function valueText(f: WizardField, v: string | string[] | undefined, steps: { key: string; label: string }[]): string {
  if (v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === "")) return "Not given yet";
  if (Array.isArray(v)) return v.map((x) => (f.kind === "multi" ? (f.options.find((o) => o.value === x)?.label ?? x) : x)).join(", ");
  if (f.kind === "select") return f.options.find((o) => o.value === v)?.label ?? v;
  if (f.kind === "step") return steps.find((s) => s.key === v)?.label ?? v;
  return v;
}

/** The wizard's fourth screen: only the chosen type's own key fields. Nothing is preselected. */
function KeyFields({ type, values, onChange }: { type: SamplingType; values: WizardValues; onChange: (v: WizardValues) => void }) {
  const steps = useStepChoices();
  const fields = WIZARD_FIELDS[type];
  const set = (k: string, v: string | string[]) => onChange({ ...values, [k]: v });
  if (fields.length === 0) {
    return <p className="muted">{TYPE_LABEL[type]} has no extra fields of its own. The common entries (who samples, how many, acceptance, reporting) are under More details after you add the sample.</p>;
  }
  return (
    <div className="stack" data-testid="wizard-fields">
      {fields.map((f) => {
        const v = values[f.key];
        if (f.kind === "text")
          return (
            <label key={f.key} className="field">
              <span>
                {f.label} <span className="muted">(optional now)</span>
              </span>
              <input value={typeof v === "string" ? v : ""} onChange={(e) => set(f.key, e.target.value)} data-testid={`wizard-field-${f.key}`} />
            </label>
          );
        if (f.kind === "multi") {
          const picked = Array.isArray(v) ? v : [];
          return (
            <fieldset key={f.key} className="stack fs">
              <legend>
                {f.label} <span className="muted">(optional now)</span>
              </legend>
              <div className="check-grid">
                {f.options.map((o) => (
                  <label key={o.value} className="check">
                    <input type="checkbox" checked={picked.includes(o.value)} onChange={() => set(f.key, picked.includes(o.value) ? picked.filter((x) => x !== o.value) : [...picked, o.value])} data-testid={`wizard-field-${f.key}-${o.value}`} />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        const options = f.kind === "select" ? f.options : steps.filter((s) => s.key !== UNIT_OP_NONE && s.key !== UNIT_OP_FINISHED_PRODUCT).map((s) => ({ value: s.key, label: s.label }));
        return (
          <label key={f.key} className="field">
            <span>
              {f.label} <span className="muted">(optional now)</span>
            </span>
            <select value={typeof v === "string" ? v : ""} onChange={(e) => set(f.key, e.target.value)} data-testid={`wizard-field-${f.key}`}>
              <option value="">Choose</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <p className="muted small">Lists such as time points, durations or conditions are added under More details.</p>
    </div>
  );
}
