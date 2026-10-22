import { setMethod } from "@gap/engine";
import { riskLoadouts } from "@gap/content";
import type { RiskAssessment, RiskConfig, RiskMethod as Method } from "@gap/process-model";
import { RISK_METHODS } from "@gap/process-model";
import { describeMethod, METHOD_LABEL, scoreIsEmpty } from "@gap/risk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { href } from "../router";
import { configToDraft, draftToConfig, emptyDraft, lookupCombos, type BandDraft, type Draft, type FactorDraft, type LevelDraft, type ScaleDraft } from "../risk-draft";
import { newMethodId, useRiskMethods } from "../risk-methods-store";
import type { Run } from "./SamplingFlow";

/*
 * Step 1 of a risk assessment: the method.
 *
 * Design notes (the why):
 *  - NO DEFAULTS. Nothing here is pre-chosen. The load-outs are one-click STARTERS the person may take and then edit; "Start
 *    blank" gives empty fields. A scale, band or matrix label that is empty stays empty and the page says what is missing.
 *  - The draft keeps numbers as text, so a half-typed field is never turned into a 0 (see risk-draft.ts).
 *  - Changing to a different kind of method clears the scores (they would mean something else), so it asks first and says how
 *    many scores are affected. Editing the same kind of method keeps the scores; an answer outside the new scale becomes "not
 *    scored" and an open item.
 *  - Editing the numbers of a method that came from the library drops the link to the library entry: the assessment would
 *    otherwise claim a name and version that no longer describe what it uses.
 */

type D<M extends Method> = Extract<Draft, { method: M }>;
type Edit<T> = (fn: (d: T) => void) => void;

export function RiskMethod({ a, run }: { a: RiskAssessment; run: Run }) {
  const [draft, setDraft] = useState<Draft | null>(() => (a.config ? configToDraft(a.config) : null));
  const cfgKey = JSON.stringify(a.config ?? null);
  // The saved method changed (applied, loaded from the library, undone elsewhere): the editor starts again from it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setDraft(a.config ? configToDraft(a.config) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  const scored = a.items.filter((i) => !scoreIsEmpty(i.initial) || !scoreIsEmpty(i.residual)).length;
  const [confirm, setConfirm] = useState<null | { config: RiskConfig | null; label: string; status: string }>(null);
  const opener = useRef<HTMLElement | null>(null);

  /** Applies a whole method to the assessment. Asks first when it replaces another kind of method that has scores. */
  function apply(config: RiskConfig | null, label: string, status: string, forceAsk = false) {
    const method = config?.method ?? null;
    const differs = (a.config?.method ?? null) !== method;
    if ((differs && a.config && scored > 0) || (forceAsk && a.config)) {
      opener.current = document.activeElement as HTMLElement | null;
      setConfirm({ config, label, status });
      return;
    }
    run((p, actor) => setMethod(p, a.id, config, actor, { clearScores: false }), status);
  }
  function confirmed() {
    if (!confirm) return;
    const c = confirm;
    setConfirm(null);
    run((p, actor) => setMethod(p, a.id, c.config, actor, { clearScores: true }), c.status);
  }

  const description = useMemo(() => (a.config ? describeMethod(a.config) : undefined), [a.config]);
  const differsKind = confirm ? (a.config?.method ?? null) !== (confirm.config?.method ?? null) : false;

  return (
    <>
      <section className="card stack" aria-labelledby="rm-start" data-testid="risk-method-start">
        <h2 id="rm-start">Choose a starting point</h2>
        <p className="muted small">
          The tool has no default method. A starter is a shape you may take and then change: its scales, bands and labels are examples from the company-neutral catalog, not rules. One method applies to the whole assessment.
        </p>
        <ul className="plain-list loadouts" data-testid="risk-loadouts">
          {riskLoadouts.loadouts.map((l) => (
            <li key={l.id} className="loadout">
              <div>
                <strong>{l.title}</strong>
                <p className="small muted">{l.description}</p>
              </div>
              <button type="button" className="btn small" aria-label={`Use this starter: ${l.title}`} data-testid={`risk-loadout-${l.id}`} onClick={() => apply({ ...structuredClone(l.config), loadoutId: l.id }, l.title, `Method set from the starter ${l.title}`, true)}>
                Use this starter
              </button>
            </li>
          ))}
        </ul>
        <div role="group" aria-label="Start with an empty method" className="row wrap">
          <span className="small muted">Or start blank:</span>
          {RISK_METHODS.map((m) => (
            <button key={m} type="button" className="btn small" data-testid={`risk-blank-${m}`} onClick={() => setDraft(emptyDraft(m))}>
              Blank {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </section>

      {a.config && description && (
        <section className="card stack" aria-labelledby="rm-current" data-testid="risk-method-summary">
          <h2 id="rm-current">Method in use: {description.title}</h2>
          <p>{description.formula}</p>
          {description.problems.length > 0 && (
            <div className="notice" role="status">
              <p>
                <strong>Open items in the method:</strong>
              </p>
              <ul className="plain-list small">
                {description.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <MethodFacts d={description} />
          {a.config.libraryRef && (
            <p className="small muted" data-testid="risk-method-libref">
              From the method library: {a.config.libraryRef.name}, version {a.config.libraryRef.version}.
            </p>
          )}
          <div>
            <button
              type="button"
              className="btn danger small"
              data-testid="risk-method-remove"
              onClick={(e) => {
                opener.current = e.currentTarget;
                setConfirm({ config: null, label: "no method", status: "Method removed" });
              }}
            >
              Remove the method
            </button>
          </div>
        </section>
      )}

      {draft && <DraftEditor a={a} draft={draft} setDraft={setDraft} run={run} apply={apply} />}

      <Library a={a} run={run} apply={apply} />

      {confirm && (
        <Modal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm.config ? `Use ${confirm.label}?` : "Remove the method?"}
          description={a.config ? `This replaces the method now in use (${METHOD_LABEL[a.config.method]}).` : "Choose the method for this assessment."}
          restoreFocus={() => opener.current}
        >
          <div className="stack">
            {differsKind && scored > 0 ? (
              <p data-testid="risk-method-clear-warning">
                {scored} {scored === 1 ? "item has" : "items have"} scores under the current method. A different kind of method means a different scale, so those scores will be <strong>cleared</strong> (the change log keeps them). Do you want to go on?
              </p>
            ) : (
              <p>Scores already entered are kept where they still fit the new scales; any that no longer fit show as "Not scored" and become open items.</p>
            )}
            <div className="row end">
              <button type="button" className="btn" autoFocus onClick={() => setConfirm(null)}>
                Keep the current method
              </button>
              <button type="button" className={confirm.config ? "btn primary" : "btn danger"} data-testid="risk-method-confirm" onClick={confirmed}>
                {confirm.config ? "Replace the method" : "Remove the method"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The scales, levels, grid and bands of a method as read-only tables (the same facts the document carries). */
function MethodFacts({ d }: { d: ReturnType<typeof describeMethod> }) {
  return (
    <div className="stack">
      {d.scales.map((s) => (
        <div key={s.name}>
          <h3>
            {s.name}: {s.min} to {s.max}
          </h3>
          {s.levels.length > 0 && (
            <ul className="plain-list small">
              {s.levels.map((l) => (
                <li key={l.value}>
                  {l.value}: {l.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {d.levelLists.map((l) => (
        <div key={l.name}>
          <h3>{l.name}</h3>
          <ol className="small">
            {l.levels.map((v) => (
              <li key={v.label}>
                {v.label}
                {v.description ? `: ${v.description}` : ""}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {d.grid && (
        <div className="table-scroll" role="region" aria-label="Risk matrix: likelihood rows by severity columns" tabIndex={0}>
          <table className="data" data-testid="risk-method-grid">
            <caption className="small muted">Likelihood (rows) by severity (columns); each cell holds your risk label.</caption>
            <thead>
              <tr>
                <th scope="col">Likelihood \ Severity</th>
                {d.grid.cols.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.grid.rows.map((r, i) => (
                <tr key={r}>
                  <th scope="row">{r}</th>
                  {d.grid!.cells[i]!.map((c, j) => (
                    <td key={j}>{c || <span className="muted">No label yet</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small">
        {d.bandsText}
      </p>
      {d.bands.length > 0 && (
        <ul className="plain-list small">
          {d.bands.map((b) => (
            <li key={b.label}>
              {b.label}: {b.range}
              {b.note ? ` (${b.note})` : ""}
            </li>
          ))}
        </ul>
      )}
      {d.extra.length > 0 && (
        <ul className="plain-list small">
          {d.extra.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the editor

function DraftEditor({ a, draft, setDraft, run, apply }: { a: RiskAssessment; draft: Draft; setDraft: (d: Draft) => void; run: Run; apply: (c: RiskConfig | null, label: string, status: string) => void }) {
  void run;
  const result = useMemo(() => draftToConfig(draft), [draft]);
  /** Every edit of a number or a label drops the link to the library entry it started from. */
  const edit = (fn: (d: Draft) => void) => {
    const n = structuredClone(draft);
    fn(n);
    delete n.keep.libraryRef;
    setDraft(n);
  };
  const same = result.ok && JSON.stringify(result.config) === JSON.stringify(a.config ?? null);
  return (
    <section className="card stack" aria-labelledby="rm-edit" data-testid="risk-method-editor">
      <h2 id="rm-edit">Define the method: {METHOD_LABEL[draft.method]}</h2>
      {draft.method === "fmea" && <FmeaEditor d={draft} edit={edit as Edit<D<"fmea">>} />}
      {draft.method === "matrix" && <MatrixEditor d={draft} edit={edit as Edit<D<"matrix">>} />}
      {draft.method === "custom" && <CustomEditor d={draft} edit={edit as Edit<D<"custom">>} />}
      {draft.method === "qualitative" && <QualitativeEditor d={draft} edit={edit as Edit<D<"qualitative">>} />}

      <div role="status" aria-live="polite" data-testid="risk-method-errors">
        {result.ok ? null : (
          <div className="notice">
            <p>
              <strong>Still to enter before this method can be saved:</strong>
            </p>
            <ul className="plain-list small">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="row wrap">
        <button type="button" className="btn primary" disabled={!result.ok || same} data-testid="risk-method-save" onClick={() => result.ok && apply(result.config, METHOD_LABEL[result.config.method], a.config ? "Method saved" : "Method set")}>
          Save the method
        </button>
        {a.config && (
          <button type="button" className="btn" onClick={() => setDraft(configToDraft(a.config!))} data-testid="risk-method-revert">
            Discard changes
          </button>
        )}
      </div>
    </section>
  );
}

const field = (label: string, value: string, onChange: (v: string) => void, opts: { testid?: string; wide?: boolean; hint?: string } = {}) => (
  <label className={opts.wide ? "field grow" : "field"}>
    <span>{label}</span>
    <input value={value} onChange={(e) => onChange(e.target.value)} inputMode={opts.wide ? "text" : "numeric"} data-testid={opts.testid} />
    {opts.hint && <span className="muted small">{opts.hint}</span>}
  </label>
);

function ScaleEditor({ name, s, edit }: { name: string; s: ScaleDraft; edit: Edit<ScaleDraft> }) {
  return (
    <fieldset className="fs stack">
      <legend>{name} scale</legend>
      <div className="row wrap">
        {field(`${name}: lowest value`, s.min, (v) => edit((x) => void (x.min = v)), { testid: `scale-${name}-min` })}
        {field(`${name}: highest value`, s.max, (v) => edit((x) => void (x.max = v)), { testid: `scale-${name}-max` })}
      </div>
      <p className="small muted">Level descriptions are optional: write what each value means in your quality system.</p>
      {s.levels.map((l, i) => (
        <div key={i} className="row wrap end-align">
          <label className="field">
            <span>{name}: level value</span>
            <input value={l.value} inputMode="numeric" onChange={(e) => edit((x) => void (x.levels[i]!.value = e.target.value))} />
          </label>
          <label className="field grow">
            <span>{name}: what it means</span>
            <input value={l.description} onChange={(e) => edit((x) => void (x.levels[i]!.description = e.target.value))} />
          </label>
          <button type="button" className="btn small" aria-label={`Remove ${name} level ${l.value || i + 1}`} onClick={() => edit((x) => void x.levels.splice(i, 1))}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn small" onClick={() => edit((x) => void x.levels.push({ value: "", description: "" }))}>
          Add a {name.toLowerCase()} level description
        </button>
      </div>
    </fieldset>
  );
}

function BandsEditor({ bands, edit, unit }: { bands: BandDraft[]; edit: Edit<BandDraft[]>; unit: string }) {
  return (
    <fieldset className="fs stack" data-testid="bands-editor">
      <legend>Bands (optional)</legend>
      <p className="small muted">
        Bands are your own ranges of the {unit} with your own labels. Without bands the tool shows the number only and does not call any risk acceptable or not. Ranges must not overlap or leave gaps.
      </p>
      {bands.map((b, i) => (
        <div key={i} className="row wrap end-align">
          <label className="field">
            <span>Band {i + 1}: label</span>
            <input value={b.label} onChange={(e) => edit((x) => void (x[i]!.label = e.target.value))} data-testid={`band-label-${i}`} />
          </label>
          <label className="field">
            <span>Band {i + 1}: from</span>
            <input value={b.min} inputMode="decimal" onChange={(e) => edit((x) => void (x[i]!.min = e.target.value))} data-testid={`band-min-${i}`} />
          </label>
          <label className="field">
            <span>Band {i + 1}: to</span>
            <input value={b.max} inputMode="decimal" onChange={(e) => edit((x) => void (x[i]!.max = e.target.value))} data-testid={`band-max-${i}`} />
          </label>
          <label className="field grow">
            <span>Band {i + 1}: note (optional)</span>
            <input value={b.note} onChange={(e) => edit((x) => void (x[i]!.note = e.target.value))} />
          </label>
          <button type="button" className="btn small" aria-label={`Remove band ${i + 1}`} onClick={() => edit((x) => void x.splice(i, 1))}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn small" data-testid="band-add" onClick={() => edit((x) => void x.push({ label: "", min: "", max: "", note: "" }))}>
          Add a band
        </button>
      </div>
    </fieldset>
  );
}

function LevelsEditor({ title, levels, edit, onRemove, testid }: { title: string; levels: LevelDraft[]; edit: Edit<LevelDraft[]>; onRemove?: (i: number) => void; testid?: string }) {
  return (
    <fieldset className="fs stack" data-testid={testid}>
      <legend>{title}</legend>
      {levels.map((l, i) => (
        <div key={i} className="row wrap end-align">
          <label className="field">
            <span>
              {title}: level {i + 1} name
            </span>
            <input value={l.label} onChange={(e) => edit((x) => void (x[i]!.label = e.target.value))} data-testid={`${testid ?? "lv"}-label-${i}`} />
          </label>
          <label className="field grow">
            <span>
              {title}: level {i + 1} meaning (optional)
            </span>
            <input value={l.description} onChange={(e) => edit((x) => void (x[i]!.description = e.target.value))} />
          </label>
          <button type="button" className="btn small" aria-label={`Remove ${title} level ${i + 1}`} disabled={levels.length <= 1} onClick={() => (onRemove ? onRemove(i) : edit((x) => void x.splice(i, 1)))}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn small" data-testid={`${testid ?? "lv"}-add`} onClick={() => edit((x) => void x.push({ label: "", description: "" }))}>
          Add a level
        </button>
      </div>
    </fieldset>
  );
}

function FmeaEditor({ d, edit }: { d: D<"fmea">; edit: Edit<D<"fmea">> }) {
  return (
    <div className="stack">
      <p className="muted small">FMEA: the risk priority number is severity x occurrence x detection. Enter the scales your quality system uses; the tool does not assume 1 to 10.</p>
      <ScaleEditor name="Severity" s={d.severity} edit={(fn) => edit((x) => fn(x.severity))} />
      <ScaleEditor name="Occurrence" s={d.occurrence} edit={(fn) => edit((x) => fn(x.occurrence))} />
      <ScaleEditor name="Detection" s={d.detection} edit={(fn) => edit((x) => fn(x.detection))} />
      <BandsEditor bands={d.bands} unit="RPN" edit={(fn) => edit((x) => fn(x.bands))} />
      <fieldset className="fs stack">
        <legend>Severity rule (optional)</legend>
        <label className="check">
          <input type="checkbox" checked={d.trigger.on} data-testid="trigger-on" onChange={(e) => edit((x) => void (x.trigger.on = e.target.checked))} /> <span>A high severity alone triggers a label, whatever the RPN</span>
        </label>
        {d.trigger.on && (
          <div className="row wrap end-align">
            {field("Severity of", d.trigger.min, (v) => edit((x) => void (x.trigger.min = v)), { testid: "trigger-min" })}
            {field("or more gives the label", d.trigger.label, (v) => edit((x) => void (x.trigger.label = v)), { wide: true, testid: "trigger-label" })}
            {field("Note (optional)", d.trigger.note, (v) => edit((x) => void (x.trigger.note = v)), { wide: true })}
          </div>
        )}
      </fieldset>
    </div>
  );
}

function MatrixEditor({ d, edit }: { d: D<"matrix">; edit: Edit<D<"matrix">> }) {
  return (
    <div className="stack">
      <p className="muted small">Risk matrix: likelihood in the rows, severity in the columns. Name the levels and write your risk label in each cell. A cell left empty is an open item for any item that lands on it.</p>
      <LevelsEditor
        title="Likelihood (rows)"
        testid="mx-rows"
        levels={d.likelihood}
        edit={(fn) =>
          edit((x) => {
            const before = x.likelihood.length;
            fn(x.likelihood);
            while (x.cells.length < x.likelihood.length) x.cells.push(x.severity.map(() => ""));
            if (x.likelihood.length < before) x.cells.length = x.likelihood.length;
          })
        }
        onRemove={(i) =>
          edit((x) => {
            x.likelihood.splice(i, 1);
            x.cells.splice(i, 1);
          })
        }
      />
      <LevelsEditor
        title="Severity (columns)"
        testid="mx-cols"
        levels={d.severity}
        edit={(fn) =>
          edit((x) => {
            fn(x.severity);
            for (const row of x.cells) while (row.length < x.severity.length) row.push("");
          })
        }
        onRemove={(j) =>
          edit((x) => {
            x.severity.splice(j, 1);
            for (const row of x.cells) row.splice(j, 1);
          })
        }
      />
      <div className="table-scroll" role="region" aria-label="Risk label of each matrix cell" tabIndex={0}>
        <table className="data" data-testid="mx-cells">
          <caption className="small muted">Your risk label in each cell</caption>
          <thead>
            <tr>
              <th scope="col">Likelihood \ Severity</th>
              {d.severity.map((c, j) => (
                <th key={j} scope="col">
                  {c.label || `Column ${j + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.likelihood.map((r, i) => (
              <tr key={i}>
                <th scope="row">{r.label || `Row ${i + 1}`}</th>
                {d.severity.map((c, j) => (
                  <td key={j}>
                    <input
                      aria-label={`Risk label: ${r.label || `row ${i + 1}`} and ${c.label || `column ${j + 1}`}`}
                      value={d.cells[i]?.[j] ?? ""}
                      data-testid={`mx-cell-${i}-${j}`}
                      onChange={(e) =>
                        edit((x) => {
                          x.cells[i] ??= x.severity.map(() => "");
                          x.cells[i]![j] = e.target.value;
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const COMBINE_LABEL = { product: "Product of the factors", sum: "Sum of the factors", max: "Highest factor", lookup: "Table of combinations" } as const;

function CustomEditor({ d, edit }: { d: D<"custom">; edit: Edit<D<"custom">> }) {
  const combos = d.combine === "lookup" ? lookupCombos(d.factors) : [];
  return (
    <div className="stack">
      <p className="muted small">Your own factors (two to four), combined the way your quality system says. Each factor has its own whole-number scale.</p>
      {d.factors.map((f: FactorDraft, i) => (
        <div key={f.key} className="stack">
          <div className="row wrap end-align">
            <label className="field grow">
              <span>Factor {i + 1} name</span>
              <input value={f.name} onChange={(e) => edit((x) => void (x.factors[i]!.name = e.target.value))} data-testid={`factor-name-${i}`} />
            </label>
            <button type="button" className="btn small" disabled={d.factors.length <= 2} aria-label={`Remove factor ${i + 1}`} onClick={() => edit((x) => void x.factors.splice(i, 1))}>
              Remove factor
            </button>
          </div>
          <ScaleEditor name={f.name.trim() || `Factor ${i + 1}`} s={f.scale} edit={(fn) => edit((x) => fn(x.factors[i]!.scale))} />
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn small"
          disabled={d.factors.length >= 4}
          data-testid="factor-add"
          onClick={() =>
            edit((x) => {
              let n = x.factors.length + 1;
              while (x.factors.some((f) => f.key === `f${n}`)) n += 1;
              x.factors.push({ key: `f${n}`, name: "", scale: { min: "", max: "", levels: [] } });
            })
          }
        >
          Add a factor
        </button>
      </div>
      <label className="field">
        <span>How the factors combine</span>
        <select value={d.combine} data-testid="combine" onChange={(e) => edit((x) => void (x.combine = e.target.value as D<"custom">["combine"]))}>
          {(Object.keys(COMBINE_LABEL) as (keyof typeof COMBINE_LABEL)[]).map((k) => (
            <option key={k} value={k}>
              {COMBINE_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {d.combine === "lookup" ? (
        <fieldset className="fs stack" data-testid="lookup-table">
          <legend>Your label for each combination</legend>
          {combos.length === 0 ? (
            <p className="notice">Enter every factor's lowest and highest value first; the combinations then appear here.</p>
          ) : combos.length > 125 ? (
            <p className="notice">{combos.length} combinations is more than a table can reasonably hold (125). Narrow a scale.</p>
          ) : (
            <div className="table-scroll" role="region" aria-label="Label for each combination" tabIndex={0}>
              <table className="data">
                <thead>
                  <tr>
                    {d.factors.map((f, i) => (
                      <th key={f.key} scope="col">
                        {f.name || `Factor ${i + 1}`}
                      </th>
                    ))}
                    <th scope="col">Your label</th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map((c) => {
                    const k = c.join(",");
                    return (
                      <tr key={k}>
                        {c.map((v, i) => (
                          <td key={i} className="num">
                            {v}
                          </td>
                        ))}
                        <td>
                          <input aria-label={`Label for ${d.factors.map((f, i) => `${f.name || `factor ${i + 1}`} ${c[i]}`).join(", ")}`} value={d.lookup[k] ?? ""} onChange={(e) => edit((x) => void (x.lookup[k] = e.target.value))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </fieldset>
      ) : (
        <BandsEditor bands={d.bands} unit="combined score" edit={(fn) => edit((x) => fn(x.bands))} />
      )}
    </div>
  );
}

function QualitativeEditor({ d, edit }: { d: D<"qualitative">; edit: Edit<D<"qualitative">> }) {
  return (
    <div className="stack">
      <p className="muted small">Qualitative: each item gets one level from your list and a written reason. No number is calculated.</p>
      <LevelsEditor title="Levels" testid="ql" levels={d.levels} edit={(fn) => edit((x) => fn(x.levels))} />
    </div>
  );
}

// ------------------------------------------------------------------ the method library

function Library({ a, run, apply }: { a: RiskAssessment; run: Run; apply: (c: RiskConfig | null, label: string, status: string, forceAsk?: boolean) => void }) {
  const lib = useRiskMethods();
  useEffect(() => void lib.load(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [docRef, setDocRef] = useState("");
  const [owner, setOwner] = useState("");
  const [asNew, setAsNew] = useState(true);
  const [msg, setMsg] = useState("");
  const ref = a.config?.libraryRef;
  const entry = ref ? lib.items.find((m) => m.id === ref.id) : undefined;
  const chosen = lib.items.find((m) => m.id === pick);

  async function save() {
    if (!a.config) return;
    const { libraryRef: _ignore, ...config } = a.config;
    void _ignore;
    const id = entry && !asNew ? entry.id : newMethodId();
    // A saved method never carries a link to a library entry: the link belongs to the assessment that uses it.
    try {
      const saved = await lib.save({ id, name: name.trim(), version: version.trim(), ...(docRef.trim() ? { docRef: docRef.trim() } : {}), ...(owner.trim() ? { owner: owner.trim() } : {}), config: config as RiskConfig });
      setMsg(`Saved "${saved.name}" version ${saved.version} in the method library.`);
      run((p, actor) => setMethod(p, a.id, { ...(config as RiskConfig), libraryRef: { id: saved.id, name: saved.name, version: saved.version } }, actor), "Method linked to the library entry");
    } catch {
      setMsg("");
    }
  }

  return (
    <section className="card stack" aria-labelledby="rm-lib" data-testid="risk-library">
      <h2 id="rm-lib">Method library</h2>
      <p className="muted small">
        Methods your company has defined, kept outside any project. Using one copies it into this assessment; later changes to the library entry do not change an assessment already made. <a href={href("/risk/methods")}>Manage the library</a>.
      </p>
      {lib.error && (
        <p className="notice" role="alert">
          {lib.error}
        </p>
      )}
      {lib.items.length === 0 ? (
        <p className="muted" data-testid="risk-library-empty">
          {lib.ready ? "No saved methods yet." : "Loading the saved methods..."}
        </p>
      ) : (
        <div className="row wrap end-align">
          <label className="field grow">
            <span>Saved method</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} data-testid="risk-library-select">
              <option value="">Choose a saved method</option>
              {lib.items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (version {m.version}, {METHOD_LABEL[m.config.method]})
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" disabled={!chosen} data-testid="risk-library-use" onClick={() => chosen && apply({ ...structuredClone(chosen.config), libraryRef: { id: chosen.id, name: chosen.name, version: chosen.version } }, `${chosen.name} version ${chosen.version}`, "Method set from the library", true)}>
            Use this method
          </button>
        </div>
      )}
      {a.config ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>Save the method in use to the library</h3>
          {ref && entry && (
            <label className="check">
              <input type="checkbox" checked={!asNew} onChange={(e) => setAsNew(!e.target.checked)} data-testid="risk-library-newversion" /> <span>Save as a new version of {entry.name} (keeps its history)</span>
            </label>
          )}
          <div className="row wrap end-align">
            <label className="field grow">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} data-testid="risk-library-name" />
            </label>
            <label className="field">
              <span>Version</span>
              <input value={version} onChange={(e) => setVersion(e.target.value)} data-testid="risk-library-version" />
            </label>
          </div>
          <div className="row wrap end-align">
            <label className="field grow">
              <span>
                Document that defines it <span className="muted">(optional)</span>
              </span>
              <input value={docRef} onChange={(e) => setDocRef(e.target.value)} placeholder="e.g. SOP-RM-001 (fictional)" />
            </label>
            <label className="field grow">
              <span>
                Owner <span className="muted">(optional)</span>
              </span>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} />
            </label>
          </div>
          <div>
            <button type="submit" className="btn" disabled={!name.trim() || !version.trim()} data-testid="risk-library-save">
              Save to the library
            </button>
          </div>
          <div role="status" aria-live="polite">
            {msg && <p data-testid="risk-library-msg">{msg}</p>}
          </div>
        </form>
      ) : (
        <p className="muted small">Choose or define a method above to be able to save it to the library.</p>
      )}
    </section>
  );
}
