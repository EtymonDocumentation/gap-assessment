import { CONFIDENCE_LABEL, cellTextReadable, currentValue, type ImportDecisions, type ImportField, type ImportSession } from "@gap/engine";
import { useState, type ReactNode } from "react";

/**
 * The fields of the "Upload a TRD" review screen, one row per PARAMETER (set point, NOR, PAR, unit side by side) and one row per field for
 * the document and product details. Acceptance is still kept per value in the decisions: a cell in a row can be accepted or open, and an
 * open one says so in the cell. A row's Accept takes only that row's Exact values; a cell that is not Exact has its own Accept.
 */

export interface Editing {
  key: string;
  texts: Record<string, string>;
}

export interface ImportCtx {
  session: ImportSession;
  decisions: ImportDecisions;
  values: Map<string, string | undefined>;
  byId: Map<string, ImportField>;
  now: (id: string) => ReturnType<typeof currentValue> | undefined;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  /** An Exact value that is not decided yet and (in update mode) neither equals the TRD nor replaces the person's own override. */
  bulkable: (f: ImportField) => boolean;
  set: (id: string, value: string) => void;
  clear: (id: string) => void;
  pick: (id: string) => void;
  show: (id: string) => void;
}

type Col = "set" | "nor" | "par" | "unit";
const COLS: { col: Col; label: "Set point" | "NOR" | "PAR" | "Unit" }[] = [
  { col: "set", label: "Set point" },
  { col: "nor", label: "NOR" },
  { col: "par", label: "PAR" },
  { col: "unit", label: "Unit" },
];
const CHANGE_COL = { "Set point": "set", NOR: "nor", PAR: "par", Unit: "unit" } as const;
const PART_RE = /\.param\.[^.]+\.(set|nor_low|nor_high|par_low|par_high|unit|cell_set|cell_nor|cell_par|cell_unit)$/;
const PARAM_ROW_COLUMNS = 7;

/** A sub-group of fields is a parameter row when its ids are limit parts of a parameter. */
export const isParamGroup = (fields: ImportField[]) => fields.some((f) => PART_RE.test(f.id));

function colOf(f: ImportField): { col: Col; end?: "low" | "high" } | undefined {
  if (f.change) return { col: CHANGE_COL[f.change.column] };
  const m = PART_RE.exec(f.id);
  if (!m) return undefined;
  const part = m[1]!;
  if (part === "set" || part === "unit") return { col: part };
  const [c, end] = part.split("_") as [Col, "low" | "high"];
  return { col: c, end };
}

/** The evidence path is kept for the change log; on screen it is one short line. */
export const sourceText = (f: ImportField) => (f.source.startsWith("The data stored in the Word file") ? "From the data saved in the Word file" : f.source);

const shownValue = (ctx: ImportCtx, f: ImportField) => ctx.values.get(f.id) ?? f.value;
const rangeText = (low: string, high: string) => (low && high ? `${low} to ${high}` : low ? `from ${low}` : high ? `up to ${high}` : "");
const isFilled = (f: ImportField) => Boolean(f.value || f.change || f.lockedBy);
const wordsOf = (fields: ImportField[]) => {
  const filled = fields.filter(isFilled);
  const set = new Set((filled.length ? filled : fields).map((f) => CONFIDENCE_LABEL[f.confidence]));
  return [...set];
};
const changeState = (f: ImportField, d: string | undefined) =>
  d === undefined ? "Open: neither accepted nor rejected" : d === f.change!.old ? "Kept the exported text" : d === f.change!.new ? "Took the text from Word" : "Typed by you";
const labelOf = (f: ImportField) => (f.sub ? `${f.sub}: ${f.label}` : f.label);

/** Pick from document, Show in document and Undo for each value of the row, plus where the values came from. */
function More({ ctx, fields, name }: { ctx: ImportCtx; fields: ImportField[]; name: string }) {
  const sources = [...new Set(fields.map(sourceText))];
  const close = (e: { currentTarget: HTMLElement }) => e.currentTarget.closest("details")?.removeAttribute("open");
  return (
    <details className="import-more">
      <summary className="btn small" aria-label={`More for ${name}`} data-testid="import-more">
        More
      </summary>
      <div className="import-more-body stack">
        {fields.map((f) => (
          <div key={f.id} className="import-more-item">
            <span className="import-more-name">{f.change ? `${f.label} (changed cell)` : f.label}</span>
            <span className="row wrap">
              <button
                type="button"
                className="btn small"
                aria-label={`Pick from document: ${labelOf(f)}`}
                data-testid="import-pick"
                onClick={(e) => {
                  close(e);
                  ctx.setEditing(null);
                  ctx.pick(f.id);
                }}
              >
                Pick from document
              </button>
              {ctx.session.fieldCells[f.id]?.length ? (
                <button
                  type="button"
                  className="btn small ghost"
                  aria-label={`Show in document: ${labelOf(f)}`}
                  onClick={(e) => {
                    close(e);
                    ctx.show(f.id);
                  }}
                >
                  Show in document
                </button>
              ) : null}
              {ctx.decisions[f.id] !== undefined && (
                <button type="button" className="btn small ghost" aria-label={`Undo ${labelOf(f)}`} data-testid="import-undo" onClick={() => ctx.clear(f.id)}>
                  Undo
                </button>
              )}
            </span>
          </div>
        ))}
        {sources.map((s) => (
          <p key={s} className="muted small" data-testid="import-source">
            {s}
          </p>
        ))}
      </div>
    </details>
  );
}

/** The inline editor of a row: one input per editable value. A value left empty and not decided stays open (never "accepted as empty"). */
function Editor({ ctx, fields, k, colSpan }: { ctx: ImportCtx; fields: ImportField[]; k: string; colSpan: number }) {
  const [err, setErr] = useState("");
  const ed = ctx.editing!;
  function save() {
    for (const f of fields) {
      const text = (ed.texts[f.id] ?? "").trim();
      if (f.change && text && !cellTextReadable(f.change.column, text)) return setErr(`"${text}" is not numbers the review can read in the ${f.change.column} column.`);
    }
    for (const f of fields) {
      const text = (ed.texts[f.id] ?? "").trim();
      if (text !== "" || ctx.decisions[f.id] !== undefined || (f.change ? f.change.new : f.value) !== "") ctx.set(f.id, text);
    }
    ctx.setEditing(null);
  }
  return (
    <tr className="import-wide import-edit-row" key={`${k}-edit`}>
      <td colSpan={colSpan}>
        <div className="import-editor">
          {fields.map((f) => (
            <label key={f.id} className="field">
              <span>{f.change ? `${f.label} (changed cell)` : f.label}</span>
              {f.multiline ? (
                <textarea rows={3} value={ed.texts[f.id] ?? ""} onChange={(e) => ctx.setEditing({ ...ed, texts: { ...ed.texts, [f.id]: e.target.value } })} data-testid="import-edit-input" />
              ) : (
                <input type="text" value={ed.texts[f.id] ?? ""} onChange={(e) => ctx.setEditing({ ...ed, texts: { ...ed.texts, [f.id]: e.target.value } })} data-testid="import-edit-input" />
              )}
            </label>
          ))}
          <div className="row wrap">
            <button type="button" className="btn small primary" onClick={save} data-testid="import-edit-save">
              Save
            </button>
            <button type="button" className="btn small ghost" onClick={() => ctx.setEditing(null)}>
              Cancel
            </button>
          </div>
          {err && (
            <p className="error" role="alert">
              {err}
            </p>
          )}
        </div>
      </td>
    </tr>
  );
}

function startEdit(ctx: ImportCtx, key: string, fields: ImportField[]) {
  ctx.setEditing({ key, texts: Object.fromEntries(fields.map((f) => [f.id, ctx.decisions[f.id]?.value ?? (f.change ? f.change.new : f.value)])) });
}

/** The cell of one column in a parameter row. */
function ParamCell({ ctx, col, label, fields }: { ctx: ImportCtx; col: Col; label: string; fields: ImportField[] }) {
  const change = fields.find((f) => f.change && colOf(f)?.col === col);
  const parts = fields.filter((f) => !f.change && colOf(f)?.col === col);
  const nowOf = (f: ImportField) => ctx.now(f.id);
  let body: ReactNode;
  if (change) {
    const d = ctx.decisions[change.id]?.value;
    body =
      d === undefined ? (
        <>
          <span className="tag status status-partial">Changed in Word</span>
          <span className="import-cell-state">Waits for the change above</span>
        </>
      ) : (
        <>
          <span className="import-value">{d || <span className="muted">(empty)</span>}</span>
          <span className="import-cell-state">{changeState(change, d)}</span>
        </>
      );
  } else {
    const low = parts.find((f) => colOf(f)?.end === "low");
    const high = parts.find((f) => colOf(f)?.end === "high");
    const text = low || high ? rangeText(low ? shownValue(ctx, low) : "", high ? shownValue(ctx, high) : "") : parts[0] ? shownValue(ctx, parts[0]) : "";
    const relevant = parts.filter((f) => f.value !== "" || ctx.decisions[f.id] !== undefined);
    const accepted = relevant.filter((f) => ctx.decisions[f.id] !== undefined).length;
    const state = relevant.length === 0 ? "" : accepted === relevant.length ? "Accepted" : accepted === 0 ? "Open" : "Part accepted";
    const nows = parts.map(nowOf);
    const nowText = low || high ? rangeText(low ? (nowOf(low)?.text ?? "") : "", high ? (nowOf(high)?.text ?? "") : "") : (nows[0]?.text ?? "");
    const loose = parts.filter((f) => !f.lockedBy && f.confidence !== "exact" && f.value && ctx.decisions[f.id] === undefined);
    body = (
      <>
        <span className="import-value">{text || <span className="muted">Not filled</span>}</span>
        {state && <span className="import-cell-state">{state}</span>}
        {ctx.now(parts[0]?.id ?? "") && (
          <span className="import-cell-state" data-testid="import-now">
            TRD now: {nows.some((n) => n?.exists) ? nowText : "not established"}
            {nows.some((n) => n?.overridden) ? " (your own value, protected)" : ""}
          </span>
        )}
        {loose.length > 0 && (
          <button type="button" className="btn small" aria-label={`Accept ${label}`} onClick={() => loose.forEach((f) => ctx.set(f.id, f.value))} data-testid="import-accept-cell">
            Accept
          </button>
        )}
      </>
    );
  }
  return (
    <td className="import-cell" data-label={label}>
      {body}
    </td>
  );
}

/** The table of parameters of one process step (or of the parameters with nothing filled in). */
export function ParamTable({ ctx, subs }: { ctx: ImportCtx; subs: { name: string; fields: ImportField[] }[] }) {
  return (
    <table className="import-table" data-testid="import-param-table">
      <thead>
        <tr>
          <th scope="col">Parameter</th>
          <th scope="col">Set point</th>
          <th scope="col">NOR</th>
          <th scope="col">PAR</th>
          <th scope="col">Unit</th>
          <th scope="col">Reading</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {subs.map((s) => (
          <ParamRows key={s.name} ctx={ctx} name={s.name} fields={s.fields} />
        ))}
      </tbody>
    </table>
  );
}

function ParamRows({ ctx, name, fields }: { ctx: ImportCtx; name: string; fields: ImportField[] }) {
  const changes = fields.filter((f) => f.change);
  const editable = fields.filter((f) => !f.change && !f.lockedBy);
  const exact = fields.filter(ctx.bulkable);
  const key = `param:${name}:${fields[0]?.id ?? ""}`;
  const editingRow = ctx.editing?.key === key;
  const allDecided = fields.filter((f) => !f.change && (f.value !== "" || ctx.decisions[f.id] !== undefined)).every((f) => ctx.decisions[f.id] !== undefined) && changes.every((f) => ctx.decisions[f.id] !== undefined);
  return (
    <>
      {changes.map((f) => {
        const d = ctx.decisions[f.id]?.value;
        const changeKey = `change:${f.id}`;
        return (
          <FragmentRows key={f.id}>
            <tr className="import-wide import-change-row" data-testid="import-field" data-field={f.id} data-state={d === undefined ? "open" : "accepted"}>
              <td colSpan={PARAM_ROW_COLUMNS}>
                <div className="import-changed">
                  <p className="import-change" data-testid="import-change">
                    <strong>{name}, {f.label}</strong>
                    <span className="tag status status-partial">Changed in Word</span>
                    <span>
                      {" "}
                      Changed in Word: <span className="import-old">{f.change!.old || "(empty)"}</span> → <span className="import-new">{f.change!.new || "(empty)"}</span>
                    </span>
                  </p>
                  <p className="small" data-testid="import-state">
                    {changeState(f, d)}
                  </p>
                  <div className="row wrap">
                    <button type="button" className="btn small" onClick={() => ctx.set(f.id, f.change!.old)} disabled={!cellTextReadable(f.change!.column, f.change!.old)} data-testid="import-keep-old">
                      Keep the exported text
                    </button>
                    <button type="button" className="btn small" onClick={() => ctx.set(f.id, f.change!.new)} disabled={!cellTextReadable(f.change!.column, f.change!.new)} data-testid="import-take-new">
                      Take the text from Word
                    </button>
                    <button type="button" className="btn small" aria-label={`Edit the changed cell: ${name}, ${f.label}`} onClick={() => startEdit(ctx, changeKey, [f])} data-testid="import-edit-change">
                      Edit
                    </button>
                    {d !== undefined && (
                      <button type="button" className="btn small ghost" aria-label={`Undo the choice: ${name}, ${f.label}`} onClick={() => ctx.clear(f.id)}>
                        Undo
                      </button>
                    )}
                  </div>
                </div>
              </td>
            </tr>
            {ctx.editing?.key === changeKey && <Editor ctx={ctx} fields={[f]} k={changeKey} colSpan={PARAM_ROW_COLUMNS} />}
          </FragmentRows>
        );
      })}
      <tr className="import-prow" data-testid="import-field" data-field={fields[0]?.id} data-state={allDecided ? "accepted" : "open"}>
        <th scope="row" className="import-name">
          {name}
        </th>
        {COLS.map((c) => (
          <ParamCell key={c.col} ctx={ctx} col={c.col} label={c.label} fields={fields} />
        ))}
        <td className="import-word" data-label="Reading">
          {wordsOf(fields).map((w) => (
            <span key={w} className="tag status">
              {w}
            </span>
          ))}
        </td>
        <td className="import-actions">
          <button type="button" className="btn small" disabled={exact.length === 0} aria-label={`Accept ${name}`} onClick={() => exact.forEach((f) => ctx.set(f.id, f.value))} data-testid="import-row-accept">
            Accept
          </button>
          <button type="button" className="btn small" aria-label={`Edit ${name}`} disabled={editable.length === 0} onClick={() => startEdit(ctx, key, editable)} data-testid="import-edit">
            Edit
          </button>
          <More ctx={ctx} fields={fields.filter((f) => !f.lockedBy)} name={name} />
        </td>
      </tr>
      {editingRow && <Editor ctx={ctx} fields={editable} k={key} colSpan={PARAM_ROW_COLUMNS} />}
    </>
  );
}

/** A keyed group of table rows. */
function FragmentRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Document and product fields: field, value, reading word, Accept. */
export function SimpleTable({ ctx, fields }: { ctx: ImportCtx; fields: ImportField[] }) {
  return (
    <table className="import-table" data-testid="import-simple-table">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Value</th>
          <th scope="col">Reading</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => {
          const decision = ctx.decisions[f.id]?.value;
          const key = `field:${f.id}`;
          const now = ctx.now(f.id);
          const shown = shownValue(ctx, f);
          return (
            <FragmentRows key={f.id}>
              <tr className="import-prow import-simple" data-testid="import-field" data-field={f.id} data-state={decision === undefined ? "open" : "accepted"}>
                <th scope="row" className="import-name">
                  {f.label}
                </th>
                <td className="import-cell" data-label="Value">
                  <span className="import-value">{f.multiline ? <span className="block">{shown || <span className="muted">Not filled</span>}</span> : shown || <span className="muted">Not filled</span>}</span>
                  <span className="import-cell-state" data-testid="import-state">
                    {decision !== undefined ? (decision === "" ? "Accepted as no value" : "Accepted") : f.value ? "Open" : ""}
                  </span>
                  {now && (
                    <span className="import-cell-state" data-testid="import-now">
                      TRD now: {now.exists ? now.text : "not established"}
                      {now.exists && now.text === f.value && f.value ? " (same as the file)" : ""}
                      {now.overridden ? " (your own value, protected)" : ""}
                    </span>
                  )}
                </td>
                <td className="import-word" data-label="Reading">
                  <span className="tag status">{CONFIDENCE_LABEL[f.confidence]}</span>
                </td>
                <td className="import-actions">
                  {/* Nothing was read, so there is nothing to accept: the button is left out rather than greyed
                      out (site rule: a control that does not apply is absent). Edit stays to type a value. */}
                  {f.value && (
                    <button type="button" className="btn small" onClick={() => ctx.set(f.id, f.value)} aria-label={`Accept ${f.label}`} data-testid="import-accept">
                      Accept
                    </button>
                  )}
                  <button type="button" className="btn small" aria-label={`Edit ${f.label}`} onClick={() => startEdit(ctx, key, [f])} data-testid="import-edit">
                    Edit
                  </button>
                  <More ctx={ctx} fields={[f]} name={f.label} />
                </td>
              </tr>
              {ctx.editing?.key === key && <Editor ctx={ctx} fields={[f]} k={key} colSpan={4} />}
            </FragmentRows>
          );
        })}
      </tbody>
    </table>
  );
}
