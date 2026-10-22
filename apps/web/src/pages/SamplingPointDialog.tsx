import {
  INSPECTIONS,
  INTERVAL_UNITS,
  SAMPLING_CATEGORIES,
  SAMPLING_METHODS,
  TIMING_OPTIONS,
  UNIT_OP_FINISHED_PRODUCT,
  UNIT_OP_NONE,
  reportOnlyAllowed,
  type SamplingMethod,
  type SamplingPlan,
  type SamplingPoint,
} from "@gap/process-model";
import { AQL_LEVELS, AQL_VALUES_105E, AQL_VALUES_414, VAR_LEVELS, CATEGORY_HELP, CATEGORY_LABEL, METHOD_HELP, METHOD_LABEL, TIMING_LABEL, calculatePoint, checkPoint, resultText, tableChangedSince } from "@gap/sampling";
import { useEffect, useId, useMemo, useState } from "react";
import { Modal } from "../components";
import { snapshotOf, tableProblems, useSamplingTables } from "../sampling-tables-store";
import { useContent, useStore } from "../store";

/** A number box that keeps what is typed ("0.", "") and reports a number, or undefined when the text is empty or not a number. */
export function NumField({
  label,
  value,
  onChange,
  scale = 1,
  hint,
  testId,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  /** 100 shows a fraction as a percentage. */
  scale?: number;
  hint?: string;
  testId?: string;
}) {
  const parse = (t: string): number | undefined => {
    const n = t.trim() === "" ? NaN : Number(t);
    return Number.isFinite(n) ? Number((n / scale).toPrecision(12)) : undefined;
  };
  const shown = (v: number | undefined) => (v === undefined ? "" : String(Number((v * scale).toPrecision(8))));
  const [text, setText] = useState(shown(value));
  // Follow the outside value when it changes by other means (for example "use updated table"), not while typing.
  useEffect(() => {
    if (shown(parse(text)) !== shown(value)) setText(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={text}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parse(e.target.value));
        }}
      />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

/**
 * The point editor. The person picks a method and only that method's inputs appear. The working panel recalculates from the
 * draft on every change, so the arithmetic is visible before saving. Nothing is preselected: an empty choice stays empty and
 * the point stays incomplete.
 */
export function PointDialog({ plan, point, onClose, onSave }: { plan: SamplingPlan; point: SamplingPoint; onClose: () => void; onSave: (d: SamplingPoint) => string | null }) {
  const content = useContent();
  const project = useStore((s) => s.project)!;
  const tables = useSamplingTables((s) => s.items);
  const loadTables = useSamplingTables((s) => s.load);
  useEffect(() => void loadTables(), [loadTables]);
  const [d, setD] = useState<SamplingPoint>(() => structuredClone(point));
  const [error, setError] = useState("");
  const uid = useId();
  const set = (patch: Partial<SamplingPoint>) => setD((cur) => ({ ...cur, ...patch }));
  const setInputs = (patch: Partial<SamplingPoint["sampleSize"]["inputs"]>) => setD((cur) => ({ ...cur, sampleSize: { ...cur.sampleSize, inputs: { ...cur.sampleSize.inputs, ...patch } } }));
  const method = d.sampleSize.method;
  const inputs = d.sampleSize.inputs;

  const steps = useMemo(
    () => [...content.catalog.unitOperations.map((u) => ({ key: u.key, label: u.label })), { key: UNIT_OP_FINISHED_PRODUCT, label: "Finished product" }, { key: UNIT_OP_NONE, label: "Supporting work (no single step)" }],
    [content],
  );

  const trial: SamplingPlan = useMemo(() => ({ ...plan, points: plan.points.map((p) => (p.id === d.id ? d : p)) }), [plan, d]);
  const results = useMemo(() => calculatePoint(trial, d), [trial, d]);
  const check = useMemo(() => checkPoint(trial, d), [trial, d]);
  const pickable = tables.filter((t) => tableProblems(t).length === 0);
  const inLibrary = inputs.table ? tables.find((t) => t.id === inputs.table!.id) : undefined;
  const changed = inputs.table && inLibrary ? tableChangedSince(inputs.table, tables) : undefined;
  const testKeys = [...new Set((inputs.table?.rows ?? []).flatMap((r) => (r.testKey ? [r.testKey] : [])))];
  const sources = project.sources.filter((s) => !s.supersededBy);
  const roAllowed = reportOnlyAllowed(d.category);

  // Inputs of another method are dropped so a hidden value can never drive the number (no stale values).
  const changeMethod = (m: SamplingMethod | "") => setD((cur) => ({ ...cur, sampleSize: m ? { method: m, inputs: {} } : { inputs: {} } }));
  const changeCategory = (c: SamplingPoint["category"]) =>
    setD((cur) => ({ ...cur, category: c, acceptance: cur.acceptance?.kind === "report_only" && !reportOnlyAllowed(c) ? undefined : cur.acceptance }));

  const toggle = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const batchIds = d.appliesTo === "all" ? plan.batches.map((b) => b.id) : d.appliesTo;

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Point ${d.id}`} description="Fill in what you know. What you leave empty stays an open item; the tool never fills it in." wide>
      <form
        className="stack"
        data-testid="point-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          const err = onSave(d);
          if (err) setError(err);
        }}
      >
        <fieldset className="stack fs">
          <legend>What is sampled</legend>
          <div className="row wrap">
            <label className="field">
              <span>Process step</span>
              <select value={d.unitOp} onChange={(e) => set({ unitOp: e.target.value })} data-testid="point-unitop">
                {steps.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
                {!steps.some((s) => s.key === d.unitOp) && <option value={d.unitOp}>{d.unitOp}</option>}
              </select>
            </label>
            <label className="field">
              <span>Category</span>
              <select value={d.category} onChange={(e) => changeCategory(e.target.value as SamplingPoint["category"])} data-testid="point-category" aria-describedby={`${uid}-cat`}>
                {SAMPLING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p id={`${uid}-cat`} className="muted small">
            {CATEGORY_HELP[d.category]}
          </p>
          {d.category === "other" && (
            <label className="field">
              <span>What kind of sampling is this</span>
              <input value={d.categoryLabel ?? ""} onChange={(e) => set({ categoryLabel: e.target.value || undefined })} />
            </label>
          )}
          <label className="field">
            <span>Attribute or test</span>
            <input value={d.attribute} onChange={(e) => set({ attribute: e.target.value })} data-testid="point-attribute" />
          </label>
          <div className="row wrap">
            <label className="field">
              <span>
                Test method reference <span className="muted">(optional)</span>
              </span>
              <input value={d.testMethodRef ?? ""} onChange={(e) => set({ testMethodRef: e.target.value || undefined })} />
            </label>
            <label className="field">
              <span>
                Material <span className="muted">(optional)</span>
              </span>
              <input value={d.materialType ?? ""} onChange={(e) => set({ materialType: e.target.value || undefined })} />
            </label>
          </div>
        </fieldset>

        <fieldset className="stack fs">
          <legend>When and where</legend>
          <div className="check-grid">
            {TIMING_OPTIONS.map((o) => (
              <label key={o} className="check">
                <input type="checkbox" checked={d.timing.options.includes(o)} onChange={() => set({ timing: { ...d.timing, options: toggle(d.timing.options, o) } })} data-testid={`timing-${o}`} />
                <span>{TIMING_LABEL[o]}</span>
              </label>
            ))}
          </div>
          {d.timing.options.includes("interval") && (
            <div className="row wrap">
              <NumField
                label="Every"
                value={d.timing.interval?.every}
                onChange={(v) => set({ timing: { ...d.timing, interval: v === undefined || v <= 0 ? undefined : { every: v, unit: d.timing.interval?.unit ?? "units" } } })}
              />
              <label className="field">
                <span>Interval in</span>
                <select
                  value={d.timing.interval?.unit ?? ""}
                  disabled={!d.timing.interval}
                  onChange={(e) => set({ timing: { ...d.timing, interval: d.timing.interval ? { ...d.timing.interval, unit: e.target.value as "units" | "minutes" } : undefined } })}
                >
                  {!d.timing.interval && <option value="">Enter the number first</option>}
                  {INTERVAL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {d.timing.options.includes("other") && (
            <label className="field">
              <span>Other timing</span>
              <input value={d.timing.other ?? ""} onChange={(e) => set({ timing: { ...d.timing, other: e.target.value || undefined } })} />
            </label>
          )}
          <label className="field">
            <span>
              Timing note <span className="muted">(optional)</span>
            </span>
            <input value={d.timing.note ?? ""} onChange={(e) => set({ timing: { ...d.timing, note: e.target.value || undefined } })} />
          </label>
          <div className="row wrap">
            <NumField label="Locations or time points per batch" value={d.locationsCount} onChange={(v) => set({ locationsCount: v === undefined ? undefined : Math.trunc(v) })} testId="point-locations" hint="Each location gets the sample size below." />
            <NumField label="Containers per sample (optional)" value={d.containerUnitsPerSample} onChange={(v) => set({ containerUnitsPerSample: v === undefined ? undefined : Math.trunc(v) })} />
          </div>
        </fieldset>

        <fieldset className="stack fs">
          <legend>How many samples</legend>
          <label className="field">
            <span>Sampling method</span>
            <select value={method ?? ""} onChange={(e) => changeMethod(e.target.value as SamplingMethod | "")} data-testid="point-method" aria-describedby={method ? `${uid}-m` : undefined}>
              <option value="">Not chosen yet</option>
              {SAMPLING_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          {method && (
            <p id={`${uid}-m`} className="muted small" data-testid="method-help">
              {METHOD_HELP[method]}
            </p>
          )}

          {method === "company-table" && (
            <div className="stack">
              <label className="field">
                <span>Company sampling table</span>
                <select
                  value={inputs.table?.id ?? ""}
                  data-testid="point-table"
                  onChange={(e) => {
                    const t = tables.find((x) => x.id === e.target.value);
                    setInputs({ table: t ? snapshotOf(t) : undefined, testKey: undefined });
                  }}
                >
                  <option value="">Choose a table</option>
                  {pickable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (version {t.version})
                    </option>
                  ))}
                  {inputs.table && !pickable.some((t) => t.id === inputs.table!.id) && (
                    <option value={inputs.table.id}>
                      {inputs.table.name} (version {inputs.table.version}, kept in this plan)
                    </option>
                  )}
                </select>
              </label>
              {pickable.length === 0 && !inputs.table && (
                <p className="muted small">
                  No usable table yet. Add one on the <a href="#/sampling/tables">Sampling tables</a> page.
                </p>
              )}
              {inputs.table && !inLibrary && (
                <p className="notice" data-testid="table-missing">
                  This table is no longer in your library. The copy kept in this plan is used.
                </p>
              )}
              {changed && (
                <div className="notice stack" data-testid="table-changed">
                  <p>The library table changed after it was chosen for this point: {changed}</p>
                  <div>
                    <button type="button" className="btn small" onClick={() => setInputs({ table: snapshotOf(inLibrary!) })}>
                      Use the updated table
                    </button>
                  </div>
                </div>
              )}
              {testKeys.length > 0 && (
                <label className="field">
                  <span>Test key</span>
                  <select value={inputs.testKey ?? ""} onChange={(e) => setInputs({ testKey: e.target.value || undefined })} data-testid="point-testkey">
                    <option value="">Choose a test</option>
                    {testKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {method === "fixed" && (
            <div className="stack">
              <NumField label="Sample size (number of units)" value={inputs.count} onChange={(v) => setInputs({ count: v === undefined ? undefined : Math.trunc(v) })} testId="point-count" />
              <label className="field">
                <span>Written basis for this number</span>
                <textarea rows={2} value={inputs.basis ?? ""} onChange={(e) => setInputs({ basis: e.target.value || undefined })} data-testid="point-basis" />
              </label>
            </div>
          )}

          {method === "conf-rel" && (
            <div className="row wrap">
              <NumField label="Confidence (%)" scale={100} value={inputs.confidence} onChange={(v) => setInputs({ confidence: v })} testId="point-confidence" />
              <NumField label="Reliability (%)" scale={100} value={inputs.reliability} onChange={(v) => setInputs({ reliability: v })} testId="point-reliability" />
              <NumField label="Allowed failures" value={inputs.allowedFailures} onChange={(v) => setInputs({ allowedFailures: v === undefined ? undefined : Math.trunc(v) })} testId="point-failures" />
            </div>
          )}

          {(method === "aql-105e" || method === "var-414") && (
            <div className="row wrap">
              <label className="field">
                <span>Inspection level</span>
                <select value={inputs.level ?? ""} onChange={(e) => setInputs({ level: e.target.value || undefined })} data-testid="point-level">
                  <option value="">Choose</option>
                  {(method === "aql-105e" ? AQL_LEVELS : VAR_LEVELS).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>AQL (%)</span>
                <select value={inputs.aql === undefined ? "" : String(inputs.aql)} onChange={(e) => setInputs({ aql: e.target.value === "" ? undefined : Number(e.target.value) })} data-testid="point-aql">
                  <option value="">Choose</option>
                  {/* The standards' own AQL values: the person picks one, nothing is preselected. */}
                  {(method === "aql-105e" ? AQL_VALUES_105E : AQL_VALUES_414).map((a) => (
                    <option key={a} value={String(a)}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Inspection severity</span>
                <select value={inputs.inspection ?? ""} onChange={(e) => setInputs({ inspection: (e.target.value || undefined) as typeof inputs.inspection })} data-testid="point-inspection">
                  <option value="">Choose</option>
                  {INSPECTIONS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
              {method === "var-414" && (
                <label className="field">
                  <span>Specification limits</span>
                  <select value={inputs.limits ?? ""} onChange={(e) => setInputs({ limits: (e.target.value || undefined) as typeof inputs.limits })} data-testid="point-limits">
                    <option value="">Choose</option>
                    <option value="single">One limit</option>
                    <option value="double">Two limits</option>
                  </select>
                </label>
              )}
            </div>
          )}

          <section aria-labelledby={`${uid}-w`} className="working" data-testid="point-working" aria-live="polite">
            <h3 id={`${uid}-w`}>Working</h3>
            {!method ? (
              <p className="muted">Choose a method to see the arithmetic.</p>
            ) : plan.batches.length === 0 ? (
              <p className="muted">Add the PPQ batches to the plan first. Most methods read the planned lot size of each batch.</p>
            ) : (
              results.map((r) => (
                <div key={r.batchId} className="working-batch">
                  <p>
                    <strong>{plan.batches.find((b) => b.id === r.batchId)?.label ?? r.batchId}:</strong> <span data-testid="working-result">{resultText(r)}</span>
                  </p>
                  {r.working.length > 0 && (
                    <dl className="working-list">
                      {r.working.map((w, i) => (
                        <div key={i}>
                          <dt>{w.label}</dt>
                          <dd>{w.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {r.citation && <p className="muted small">{r.citation}</p>}
                </div>
              ))
            )}
          </section>
        </fieldset>

        <fieldset className="stack fs">
          <legend>Acceptance and rationale</legend>
          <label className="field">
            <span>Acceptance</span>
            <select
              value={d.acceptance?.kind ?? ""}
              data-testid="point-acceptance"
              onChange={(e) => set({ acceptance: e.target.value === "criterion" ? { kind: "criterion", text: d.acceptance?.kind === "criterion" ? d.acceptance.text : "" } : e.target.value === "report_only" ? { kind: "report_only" } : undefined })}
            >
              <option value="">Not decided yet</option>
              <option value="criterion">Acceptance criterion</option>
              {roAllowed && <option value="report_only">Report only (collect and report, no criterion)</option>}
            </select>
          </label>
          {!roAllowed && (
            <p className="muted small" data-testid="report-only-rule">
              Report only is not available for {CATEGORY_LABEL[d.category].toLowerCase()} sampling. These points need an acceptance criterion.
            </p>
          )}
          {d.acceptance?.kind === "criterion" && (
            <label className="field">
              <span>Acceptance criterion</span>
              <textarea rows={2} value={d.acceptance.text} onChange={(e) => set({ acceptance: { kind: "criterion", text: e.target.value } })} data-testid="point-criterion" />
            </label>
          )}
          <label className="field">
            <span>Rationale: why is this point sampled</span>
            <textarea rows={3} value={d.rationale} onChange={(e) => set({ rationale: e.target.value })} data-testid="point-rationale" />
          </label>
        </fieldset>

        <fieldset className="stack fs">
          <legend>Handling and scope</legend>
          <div className="row wrap">
            <NumField label="Quantity per sample (optional)" value={d.quantity?.value} onChange={(v) => set({ quantity: v === undefined || v <= 0 ? undefined : { value: v, unit: d.quantity?.unit ?? "" } })} />
            <label className="field">
              <span>Quantity unit</span>
              <input value={d.quantity?.unit ?? ""} onChange={(e) => set({ quantity: d.quantity ? { ...d.quantity, unit: e.target.value } : undefined })} placeholder="e.g. mL" />
            </label>
            <label className="field">
              <span>Storage condition (optional)</span>
              <input value={d.storageCondition ?? ""} onChange={(e) => set({ storageCondition: e.target.value || undefined })} />
            </label>
            <label className="field">
              <span>Destination lab (optional)</span>
              <input value={d.destinationLab ?? ""} onChange={(e) => set({ destinationLab: e.target.value || undefined })} />
            </label>
          </div>
          {plan.batches.length > 0 && (
            <div role="group" aria-label="Batches this point applies to" className="stack">
              <span className="small">Applies to</span>
              <div className="check-grid">
                {plan.batches.map((b) => (
                  <label key={b.id} className="check">
                    <input
                      type="checkbox"
                      checked={batchIds.includes(b.id)}
                      data-testid={`applies-${b.id}`}
                      onChange={() => {
                        const next = toggle(batchIds, b.id);
                        // A point must apply to at least one batch: unticking the last one is ignored.
                        if (next.length > 0) set({ appliesTo: next.length === plan.batches.length ? "all" : next });
                      }}
                    />
                    <span>{b.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {sources.length > 0 && (
            <div role="group" aria-label="Sources this point cites" className="stack">
              <span className="small">Sources cited (optional)</span>
              <div className="check-grid">
                {sources.map((s) => (
                  <label key={s.id} className="check">
                    <input type="checkbox" checked={d.sourceIds.includes(s.id)} onChange={() => set({ sourceIds: toggle(d.sourceIds, s.id) })} />
                    <span>
                      {s.label} <span className="muted">({s.id})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        <div className="stack" aria-live="polite" data-testid="point-open">
          <p>
            <strong>Status: {check.status === "complete" ? "Complete" : "Incomplete"}</strong>
          </p>
          {check.problems.length > 0 && (
            <ul className="plain-list small">
              {check.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" data-testid="point-save">
            Save point
          </button>
        </div>
      </form>
    </Modal>
  );
}
