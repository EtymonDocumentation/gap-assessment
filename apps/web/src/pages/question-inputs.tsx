import {
  fieldLabel,
  optionsFor,
  parameterFields,
  type AnswerInput,
  type ContentBundle,
  type FieldAnswer,
  type ParameterField,
  type Question,
  type QuestionInstance,
} from "@gap/engine";
import { fullRef, getEntry, type Entry, type EntryValue, type Project, type Quantity, type Range } from "@gap/process-model";
import { useId } from "react";
import { content } from "../store";

/** Raw, editable form values (strings), converted to typed values on submit. */
export interface Scalar {
  choice: string;
  multi: string[];
  text: string;
  num: string;
  min: string;
  max: string;
  unit: string;
}

export interface FieldForm extends Scalar {
  unknown: boolean;
}

export interface FormState {
  simple: Scalar;
  fields: Partial<Record<ParameterField, FieldForm>>;
}

function emptyScalar(unit: string): Scalar {
  return { choice: "", multi: [], text: "", num: "", min: "", max: "", unit };
}

const isQ = (v: unknown): v is Quantity => !!v && typeof v === "object" && "value" in v && "unit" in v;
const isR = (v: unknown): v is Range => !!v && typeof v === "object" && ("min" in v || "max" in v) && !("value" in v);

function scalarFrom(v: EntryValue | undefined, unit: string): Scalar {
  const s = emptyScalar(unit);
  if (v === undefined) return s;
  if (typeof v === "boolean") s.choice = v ? "yes" : "no";
  else if (typeof v === "string") {
    s.choice = v;
    s.text = v;
  } else if (Array.isArray(v)) s.multi = v;
  else if (isQ(v)) {
    s.num = String(v.value);
    s.unit = v.unit;
  } else if (isR(v)) {
    if (v.min) s.min = String(v.min.value);
    if (v.max) s.max = String(v.max.value);
    s.unit = v.min?.unit ?? v.max?.unit ?? unit;
  }
  return s;
}

/** Pre-fills the form from the entries already recorded (values only; unknown/same/N/A are shown as status). */
export function initialForm(c: ContentBundle, project: Project, inst: QuestionInstance): FormState {
  const q = inst.question;
  const unit = q.input.units?.[0] ?? "";
  const valueOf = (e: Entry | undefined) => (e && e.status === "established" && !e.sameAsSource ? e.value : undefined);
  if (q.input.type === "parameter" && inst.side !== "shared") {
    const fields: FormState["fields"] = {};
    for (const f of parameterFields(q, inst.side)) {
      const e = getEntry(project, fullRef(inst.side, `${q.binds}.${f}`));
      fields[f] = { ...scalarFrom(valueOf(e), unit), unknown: e?.status === "unknown" && !e.sameAsSource };
    }
    return { simple: emptyScalar(unit), fields };
  }
  void c;
  return { simple: scalarFrom(valueOf(getEntry(project, fullRef(inst.side, q.binds))), unit), fields: {} };
}

type Parsed = { value: EntryValue } | { error: string };

function num(s: string, what: string): { n: number } | { error: string } {
  if (!s.trim()) return { error: `${what}: enter a number` };
  const n = Number(s.trim().replace(",", "."));
  return Number.isFinite(n) ? { n } : { error: `${what}: “${s}” is not a number` };
}

function toRange(s: Scalar, what: string): Parsed {
  const out: Range = {};
  if (s.min.trim()) {
    const r = num(s.min, `${what} minimum`);
    if ("error" in r) return r;
    out.min = { value: r.n, unit: s.unit };
  }
  if (s.max.trim()) {
    const r = num(s.max, `${what} maximum`);
    if ("error" in r) return r;
    out.max = { value: r.n, unit: s.unit };
  }
  if (!out.min && !out.max) return { error: `${what}: enter a minimum, a maximum or both` };
  return { value: out };
}

function scalarValue(type: string, s: Scalar, what: string): Parsed {
  switch (type) {
    case "choice":
      return s.choice ? { value: s.choice } : { error: `${what}: choose an option` };
    case "yes_no":
      return s.choice ? { value: s.choice } : { error: `${what}: choose yes or no` };
    case "multi_choice":
      return s.multi.length ? { value: s.multi } : { error: `${what}: choose at least one option` };
    case "text":
      return s.text.trim() ? { value: s.text.trim() } : { error: `${what}: enter text` };
    case "quantity": {
      const r = num(s.num, what);
      return "error" in r ? r : { value: { value: r.n, unit: s.unit } satisfies Quantity };
    }
    case "range":
      return toRange(s, what);
    default:
      return { error: `${what}: unsupported input` };
  }
}

const FIELD_TYPE: Record<ParameterField, string> = {
  classification: "choice",
  rangeBasis: "choice",
  setPoint: "quantity",
  nor: "range",
  par: "range",
  validatedRange: "range",
};

/** Converts the form to an engine answer, or returns a message naming what is missing. */
export function toAnswer(q: Question, form: FormState): { input: AnswerInput } | { error: string } {
  if (q.input.type === "parameter") {
    const fields: Partial<Record<ParameterField, FieldAnswer>> = {};
    for (const [f, s] of Object.entries(form.fields) as [ParameterField, FieldForm][]) {
      if (s.unknown) {
        fields[f] = { kind: "unknown" };
        continue;
      }
      const r = scalarValue(FIELD_TYPE[f], s, fieldLabel(content, f));
      if ("error" in r) return { error: `${r.error}, or tick “Unknown”.` };
      fields[f] = { kind: "value", value: r.value };
    }
    return { input: { kind: "composite", fields } };
  }
  const r = scalarValue(q.input.type, form.simple, "Answer");
  if ("error" in r) return { error: `${r.error.replace(/^Answer: /, "")}. Or choose “Unknown — to be confirmed”.` };
  return { input: { kind: "value", value: r.value } };
}

// ------------------------------------------------------------------ rendering

function UnitSelect({ units, value, onChange, label }: { units: string[]; value: string; onChange: (u: string) => void; label: string }) {
  if (units.length <= 1) return <span className="unit">{units[0]}</span>;
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="unit-select">
      {units.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}

function Chips({
  name,
  options,
  multi,
  value,
  onChange,
  legend,
}: {
  name: string;
  options: { value: string; label: string }[];
  multi?: boolean;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  legend: string;
}) {
  return (
    <fieldset className="chips">
      <legend className="visually-hidden">{legend}</legend>
      {options.map((o) => {
        const checked = multi ? (value as string[]).includes(o.value) : value === o.value;
        return (
          <label key={o.value} className={`choice-chip${checked ? " checked" : ""}`}>
            <input
              type={multi ? "checkbox" : "radio"}
              name={name}
              value={o.value}
              checked={checked}
              onChange={(e) => {
                if (!multi) onChange(o.value);
                else {
                  const cur = value as string[];
                  onChange(e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value));
                }
              }}
            />
            <span>{o.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ScalarInput({
  type,
  q,
  s,
  set,
  label,
  options,
}: {
  type: string;
  q: Question;
  s: Scalar;
  set: (patch: Partial<Scalar>) => void;
  label: string;
  options?: { value: string; label: string }[];
}) {
  const id = useId();
  const units = q.input.units ?? [];
  switch (type) {
    case "choice":
    case "yes_no":
      return <Chips name={id} legend={label} options={options ?? optionsFor(content, q)} value={s.choice} onChange={(v) => set({ choice: v as string })} />;
    case "multi_choice":
      return <Chips name={id} legend={label} multi options={optionsFor(content, q)} value={s.multi} onChange={(v) => set({ multi: v as string[] })} />;
    case "text":
      return (
        <label className="field">
          <span className="visually-hidden">{label}</span>
          <input value={s.text} onChange={(e) => set({ text: e.target.value })} placeholder={q.input.placeholder} />
        </label>
      );
    case "quantity":
      return (
        <div className="row inline">
          <label className="field compact">
            <span className="visually-hidden">{label} value</span>
            <input inputMode="decimal" value={s.num} onChange={(e) => set({ num: e.target.value })} className="num" />
          </label>
          <UnitSelect units={units} value={s.unit} onChange={(u) => set({ unit: u })} label={`${label} unit`} />
        </div>
      );
    case "range":
      return (
        <div className="row inline wrap">
          <label className="field compact">
            <span className="small">Min</span>
            <input inputMode="decimal" value={s.min} onChange={(e) => set({ min: e.target.value })} className="num" aria-label={`${label} minimum`} />
          </label>
          <span aria-hidden="true">–</span>
          <label className="field compact">
            <span className="small">Max</span>
            <input inputMode="decimal" value={s.max} onChange={(e) => set({ max: e.target.value })} className="num" aria-label={`${label} maximum`} />
          </label>
          <UnitSelect units={units} value={s.unit} onChange={(u) => set({ unit: u })} label={`${label} unit`} />
        </div>
      );
    default:
      return null;
  }
}

export function QuestionInput({
  q,
  side,
  form,
  setForm,
}: {
  q: Question;
  side: QuestionInstance["side"];
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  if (q.input.type !== "parameter" || side === "shared") {
    return <ScalarInput type={q.input.type} q={q} s={form.simple} label={q.label ?? q.prompt} set={(patch) => setForm({ ...form, simple: { ...form.simple, ...patch } })} />;
  }
  const fields = parameterFields(q, side);
  return (
    <div className="param-card">
      {fields.map((f) => {
        const s = form.fields[f]!;
        const set = (patch: Partial<FieldForm>) => setForm({ ...form, fields: { ...form.fields, [f]: { ...s, ...patch } } });
        const optSet = f === "classification" ? "classification" : f === "rangeBasis" ? "rangeBasis" : undefined;
        return (
          <div key={f} className={`param-field${s.unknown ? " is-unknown" : ""}`}>
            <div className="param-label">
              <span id={`pf-${f}`}>{fieldLabel(content, f)}</span>
              <label className="small unknown-toggle">
                <input type="checkbox" checked={s.unknown} onChange={(e) => set({ unknown: e.target.checked })} /> Unknown
              </label>
            </div>
            {!s.unknown && (
              <ScalarInput
                type={FIELD_TYPE[f]}
                q={q}
                s={s}
                set={set}
                label={fieldLabel(content, f)}
                {...(optSet ? { options: content.catalog.optionSets[optSet] ?? [] } : {})}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
