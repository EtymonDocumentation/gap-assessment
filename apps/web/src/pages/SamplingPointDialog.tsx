import {
  FILTER_TESTS,
  HOLD_UNITS,
  INSPECTIONS,
  INTERVAL_UNITS,
  MIXING_POSITIONS,
  RANGE_KINDS,
  REPORT_PRESENTATION,
  REPORT_WHAT,
  RESPONSIBLE_PARTIES,
  RETAIN_PURPOSES,
  RUN_TAGS,
  SAMPLING_METHODS,
  SAMPLING_TYPES,
  TIMING_OPTIONS,
  UNIT_OP_CUSTOM_STEP,
  UNIT_OP_FINISHED_PRODUCT,
  UNIT_OP_NONE,
  WORST_CASES,
  reportOnlyAllowed,
  type DesignLoadout,
  type MixingDesignData,
  type MixingRun,
  type RunParameter,
  type SamplingMethod,
  type SamplingPlan,
  type SamplingPoint,
  type SamplingType,
  type TypeDetail,
} from "@gap/process-model";
import {
  FILTER_TEST_LABEL,
  POINT_GROUPS,
  AQL_LEVELS,
  AQL_VALUES_105E,
  AQL_VALUES_414,
  METHOD_HELP,
  METHOD_LABEL,
  MIXING_DESIGN_HELP,
  RANGE_KIND_LABEL,
  REPORT_PRESENTATION_LABEL,
  REPORT_WHAT_LABEL,
  RESPONSIBLE_LABEL,
  RUN_TAG_LABEL,
  TIMING_LABEL,
  TYPE_HELP,
  TYPE_LABEL,
  VAR_LEVELS,
  WORST_CASE_LABEL,
  applyLoadout,
  calculatePoint,
  checkPoint,
  groupSummary,
  initialOpenGroups,
  placementText,
  requestTitle,
  reportingInstructions,
  resultText,
  retainDerivation,
  stabilityDerivation,
  stepOf,
  tableChangedSince,
  toFillText,
  typeChangeHidesValues,
  typeGroupLabel,
  usesSampleSizeMethod,
  type LoadoutMode,
  type PointGroup,
} from "@gap/sampling";
import { designLoadouts } from "@gap/content";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
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

const toggle = <T extends string>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const opt = (s: string): string | undefined => (s.trim() === "" ? undefined : s);

const POSITION_LABEL: Record<(typeof MIXING_POSITIONS)[number], string> = { top: "Top", middle: "Middle", bottom: "Bottom", other: "Other" };
const RETAIN_PURPOSE_LABEL: Record<(typeof RETAIN_PURPOSES)[number], string> = { retain: "Retain", reserve: "Reserve", both: "Retain and reserve" };

/** A growing list of rows with Add and Remove buttons. Used for time points, conditions, analyses and runs. */
function ListEditor<T>({
  legend,
  items,
  onChange,
  blank,
  render,
  addLabel,
  testId,
  hint,
}: {
  legend: string;
  items: T[];
  onChange: (next: T[]) => void;
  blank: () => T;
  render: (item: T, set: (patch: Partial<T>) => void, index: number) => ReactNode;
  addLabel: string;
  testId?: string;
  hint?: string;
}) {
  return (
    <div role="group" aria-label={legend} className="stack" data-testid={testId}>
      <span className="small">{legend}</span>
      {hint && <span className="muted small">{hint}</span>}
      {items.map((it, i) => (
        <div key={i} className="row wrap end-align list-row">
          {render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}
          <button type="button" className="btn small danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${legend.toLowerCase()} ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn small" onClick={() => onChange([...items, blank()])} data-testid={testId ? `${testId}-add` : undefined}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, testId, optional, hint, area }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; testId?: string; optional?: boolean; hint?: string; area?: boolean }) {
  return (
    <label className="field">
      <span>
        {label} {optional && <span className="muted">(optional)</span>}
      </span>
      {area ? <textarea rows={2} value={value ?? ""} onChange={(e) => onChange(opt(e.target.value))} data-testid={testId} /> : <input value={value ?? ""} onChange={(e) => onChange(opt(e.target.value))} data-testid={testId} />}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ the optional mixing study design

function ParamFields({ label, value, onChange }: { label: string; value: RunParameter | undefined; onChange: (v: RunParameter | undefined) => void }) {
  const set = (patch: Partial<RunParameter>) => {
    const next: RunParameter = { ...value, ...patch };
    for (const k of Object.keys(next) as (keyof RunParameter)[]) if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <fieldset className="stack fs param">
      <legend>{label}</legend>
      <div className="row wrap">
        <NumField label="Value" value={value?.value} onChange={(v) => set({ value: v !== undefined && v > 0 ? v : undefined })} />
        <label className="field">
          <span>Unit</span>
          <input value={value?.unit ?? ""} onChange={(e) => set({ unit: opt(e.target.value) })} />
        </label>
        <label className="field">
          <span>Where in the range</span>
          <select value={value?.tag ?? ""} onChange={(e) => set({ tag: (e.target.value || undefined) as RunParameter["tag"] })}>
            <option value="">Not set</option>
            {RUN_TAGS.map((t) => (
              <option key={t} value={t}>
                {RUN_TAG_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

/**
 * The study design of a mixing point. Everything here is optional: nothing is required, checked or enforced, and a design left
 * empty prints nothing. A load-out is only a starting shape (blank values) that the person edits or ignores.
 */
function MixingDesignEditor({ design, onChange }: { design: MixingDesignData | undefined; onChange: (d: MixingDesignData | undefined) => void }) {
  const [choice, setChoice] = useState("");
  const [pending, setPending] = useState<{ kind: "loadout"; loadout: DesignLoadout } | { kind: "blank" } | null>(null);
  const [applied, setApplied] = useState("");
  const runs = design?.runs ?? [];
  const ranges = design?.rangeSupport ?? [];
  const has = !!design && (runs.length > 0 || ranges.length > 0 || !!design.approach);

  const commit = (next: MixingDesignData) => {
    const clean: MixingDesignData = { ...next };
    if (!clean.approach) delete clean.approach;
    if (!clean.runs?.length) delete clean.runs;
    if (!clean.rangeSupport?.length) delete clean.rangeSupport;
    onChange(Object.keys(clean).length ? clean : undefined);
  };
  const apply = (loadout: DesignLoadout, mode: LoadoutMode) => {
    onChange(applyLoadout(design, loadout, mode));
    setApplied(`Load-out "${loadout.title}" ${mode === "replace" ? "applied" : "added after the existing runs"}. Edit or remove anything; nothing here is required.`);
    setPending(null);
  };
  const start = () => {
    if (choice === "blank") {
      if (has) setPending({ kind: "blank" });
      else setApplied("Starting blank. The design stays empty and prints nothing.");
      return;
    }
    const lo = designLoadouts.loadouts.find((l) => l.id === choice);
    if (!lo) return;
    if (has) setPending({ kind: "loadout", loadout: lo });
    else apply(lo, "replace");
  };

  return (
    <fieldset className="stack fs" data-testid="mixing-design">
      <legend>Study design (optional)</legend>
      <details>
        <summary>About this section</summary>
        <p className="muted small" data-testid="mixing-design-help">
          {MIXING_DESIGN_HELP}
        </p>
      </details>
      <label className="field">
        <span>
          Design label <span className="muted">(optional)</span>
        </span>
        <input value={design?.approach ?? ""} onChange={(e) => commit({ ...design, approach: opt(e.target.value) })} data-testid="design-approach" />
      </label>

      <div className="row wrap end-align">
        <label className="field">
          <span>Load-out (a starting shape, optional)</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="loadout-select">
            <option value="">Choose a load-out</option>
            <option value="blank">Start blank (no preset)</option>
            {designLoadouts.loadouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={!choice} onClick={start} data-testid="loadout-apply">
          Apply load-out
        </button>
      </div>
      {choice && choice !== "blank" && <p className="muted small">{designLoadouts.loadouts.find((l) => l.id === choice)?.description}</p>}
      {pending && (
        <div className="notice stack" role="group" aria-label="Replace or add" data-testid="loadout-prompt">
          {pending.kind === "blank" ? (
            <p>This point already has a design. Start blank removes its label, runs and ranges from this draft.</p>
          ) : (
            <p>
              This point already has {runs.length} {runs.length === 1 ? "run" : "runs"} and {ranges.length} range {ranges.length === 1 ? "row" : "rows"}. Replace them with "{pending.loadout.title}", or add the load-out after them?
            </p>
          )}
          <div className="row wrap">
            <button type="button" className="btn primary" onClick={() => (pending.kind === "blank" ? (onChange(undefined), setApplied("Design cleared in this draft."), setPending(null)) : apply(pending.loadout, "replace"))} data-testid="loadout-replace">
              Replace
            </button>
            {pending.kind === "loadout" && (
              <button type="button" className="btn" onClick={() => apply(pending.loadout, "append")} data-testid="loadout-append">
                Add after the existing
              </button>
            )}
            <button type="button" className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div role="status" aria-live="polite">
        {applied && <p className="small" data-testid="loadout-done">{applied}</p>}
      </div>

      <ListEditor<MixingRun>
        legend="Run"
        items={runs}
        onChange={(next) => commit({ ...design, runs: next })}
        blank={() => ({ label: "" })}
        addLabel="Add a run"
        testId="design-runs"
        render={(r, set, i) => (
          <div className="stack run-card">
            <label className="field">
              <span>Run {i + 1} label</span>
              <input value={r.label} onChange={(e) => set({ label: e.target.value })} data-testid={`run-${i}-label`} />
            </label>
            <div className="row wrap">
              <ParamFields label="Batch size" value={r.batchSize} onChange={(v) => set({ batchSize: v })} />
              <ParamFields label="Mixing speed" value={r.speed} onChange={(v) => set({ speed: v })} />
              <ParamFields label="Mix time" value={r.mixTime} onChange={(v) => set({ mixTime: v })} />
            </div>
            <div role="group" aria-label={`Run ${i + 1} challenges`} className="stack">
              <span className="small">What this run challenges (optional)</span>
              <div className="check-grid">
                {WORST_CASES.map((w) => (
                  <label key={w} className="check">
                    <input type="checkbox" checked={r.challenges?.includes(w) ?? false} onChange={() => set({ challenges: toggle(r.challenges ?? [], w) })} />
                    <span>{WORST_CASE_LABEL[w]}</span>
                  </label>
                ))}
              </div>
              {r.challenges?.includes("other") && <TextField label="Other challenge" value={r.challengesOther} onChange={(v) => set({ challengesOther: v })} />}
            </div>
            <TextField label="Attributes tested" value={r.attributes} onChange={(v) => set({ attributes: v })} optional />
            <TextField label="Rationale for this run" value={r.rationale} onChange={(v) => set({ rationale: v })} optional area />
          </div>
        )}
      />

      <ListEditor<{ parameter: string; rangeKind?: (typeof RANGE_KINDS)[number]; text?: string }>
        legend="Range row"
        items={ranges}
        onChange={(next) => commit({ ...design, rangeSupport: next })}
        blank={() => ({ parameter: "" })}
        addLabel="Add a range row"
        testId="design-ranges"
        hint="The parameter and the range this study is meant to support, in your words. The kind (PAR, NOR or other) is your choice."
        render={(r, set, i) => (
          <>
            <label className="field">
              <span>Parameter</span>
              <input value={r.parameter} onChange={(e) => set({ parameter: e.target.value })} data-testid={`range-${i}-parameter`} />
            </label>
            <label className="field">
              <span>Kind of range</span>
              <select value={r.rangeKind ?? ""} onChange={(e) => set({ rangeKind: (e.target.value || undefined) as (typeof RANGE_KINDS)[number] | undefined })} data-testid={`range-${i}-kind`}>
                <option value="">Not chosen</option>
                {RANGE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RANGE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>Range</span>
              <input value={r.text ?? ""} onChange={(e) => set({ text: opt(e.target.value) })} data-testid={`range-${i}-text`} />
            </label>
          </>
        )}
      />
    </fieldset>
  );
}

// ------------------------------------------------------------------ the type-specific card

type DetailKey = keyof TypeDetail;

function TypeCard({ d, plan, steps, setDetail }: { d: SamplingPoint; plan: SamplingPlan; steps: { key: string; label: string }[]; setDetail: <K extends DetailKey>(key: K, patch: Partial<NonNullable<TypeDetail[K]>>) => void }) {
  const det = d.detail ?? {};
  switch (d.type) {
    case "ppq_enhanced": {
      const e = det.enhanced ?? {};
      return (
        <>
          <TextField label="Interventions or stoppages covered" value={e.interventions} onChange={(v) => setDetail("enhanced", { interventions: v })} testId="enh-interventions" />
          {d.timing.options.includes("interval") && <TextField label="Interval definition (what is counted and when)" value={e.intervalDefinition} onChange={(v) => setDetail("enhanced", { intervalDefinition: v })} />}
          {(d.timing.options.includes("per_needle") || d.timing.options.includes("per_lyo_shelf")) && <TextField label="Per needle or shelf details" value={e.perNeedleShelf} onChange={(v) => setDetail("enhanced", { perNeedleShelf: v })} />}
        </>
      );
    }
    case "mixing_homogeneity": {
      const m = det.mixing ?? {};
      return (
        <>
          <div className="row wrap">
            <TextField label="Vessel or equipment" value={m.vesselRef} onChange={(v) => setDetail("mixing", { vesselRef: v })} testId="mix-vessel" />
            <TextField label="Mixing parameters (for example speed and time)" value={m.parameters} onChange={(v) => setDetail("mixing", { parameters: v })} testId="mix-parameters" />
          </div>
          <div role="group" aria-label="Sampling positions" className="stack">
            <span className="small">Sampling positions</span>
            <div className="check-grid">
              {MIXING_POSITIONS.map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" checked={m.positions?.includes(p) ?? false} onChange={() => setDetail("mixing", { positions: toggle(m.positions ?? [], p) })} data-testid={`mix-pos-${p}`} />
                  <span>{POSITION_LABEL[p]}</span>
                </label>
              ))}
            </div>
            {m.positions?.includes("other") && <TextField label="Other position" value={m.positionsOther} onChange={(v) => setDetail("mixing", { positionsOther: v })} />}
          </div>
          <ListEditor<{ label: string; time: string }>
            legend="Time point"
            items={m.timePoints ?? []}
            onChange={(next) => setDetail("mixing", { timePoints: next })}
            blank={() => ({ label: "", time: "" })}
            addLabel="Add a time point"
            testId="mix-timepoints"
            render={(t, set, i) => (
              <>
                <label className="field">
                  <span>Label</span>
                  <input value={t.label} onChange={(e) => set({ label: e.target.value })} data-testid={`mix-tp-${i}-label`} />
                </label>
                <label className="field">
                  <span>When</span>
                  <input value={t.time} onChange={(e) => set({ time: e.target.value })} data-testid={`mix-tp-${i}-time`} />
                </label>
              </>
            )}
          />
          <TextField label="Basis of the criterion (for example an RSD)" value={m.criterionBasis} onChange={(v) => setDetail("mixing", { criterionBasis: v })} />
          <MixingDesignEditor design={m.design} onChange={(next) => setDetail("mixing", { design: next as never })} />
        </>
      );
    }
    case "hold_time": {
      const h = det.hold ?? {};
      return (
        <>
          <label className="field">
            <span>Step after which the material is held</span>
            <select value={h.holdStep ?? ""} onChange={(e) => setDetail("hold", { holdStep: opt(e.target.value) })} data-testid="hold-step">
              <option value="">Choose</option>
              {steps
                .filter((s) => s.key !== UNIT_OP_NONE && s.key !== UNIT_OP_FINISHED_PRODUCT)
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
            </select>
          </label>
          <div className="row wrap">
            <TextField label="Hold starts" value={h.start} onChange={(v) => setDetail("hold", { start: v })} testId="hold-start" />
            <TextField label="Hold ends" value={h.end} onChange={(v) => setDetail("hold", { end: v })} testId="hold-end" />
          </div>
          <DurationRows durations={h.durations ?? []} onChange={(next) => setDetail("hold", { durations: next })} />
          <div className="row wrap">
            <TextField label="Temperature or condition" value={h.condition} onChange={(v) => setDetail("hold", { condition: v })} testId="hold-condition" />
            <TextField label="Container" value={h.container} onChange={(v) => setDetail("hold", { container: v })} optional />
          </div>
          <TextField label="Time points sampled" value={h.timePointsSampled} onChange={(v) => setDetail("hold", { timePointsSampled: v })} optional />
          <TextField label="What the result supports (the proposed maximum hold)" value={h.supports} onChange={(v) => setDetail("hold", { supports: v })} testId="hold-supports" />
        </>
      );
    }
    case "filter_study": {
      const f = det.filter ?? {};
      return (
        <>
          <TextField label="Filter (identifier or type)" value={f.filterRef} onChange={(v) => setDetail("filter", { filterRef: v })} testId="filter-ref" />
          <label className="field">
            <span>Filter test</span>
            <select value={f.test ?? ""} onChange={(e) => setDetail("filter", { test: (e.target.value || undefined) as never })} data-testid="filter-test">
              <option value="">Choose</option>
              {FILTER_TESTS.map((t) => (
                <option key={t} value={t}>
                  {FILTER_TEST_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {f.test === "other" && <TextField label="Other filter test" value={f.testOther} onChange={(v) => setDetail("filter", { testOther: v })} />}
        </>
      );
    }
    case "stability": {
      const s = det.stability ?? {};
      const der = stabilityDerivation(d);
      return (
        <>
          <TextField label="Stability protocol reference" value={s.protocolRef} onChange={(v) => setDetail("stability", { protocolRef: v })} testId="stab-protocol" />
          <ListEditor<{ label: string; detail: string }>
            legend="Storage condition"
            items={s.conditions ?? []}
            onChange={(next) => setDetail("stability", { conditions: next })}
            blank={() => ({ label: "", detail: "" })}
            addLabel="Add a storage condition"
            testId="stab-conditions"
            render={(c, set, i) => (
              <>
                <label className="field">
                  <span>Condition</span>
                  <input value={c.label} onChange={(e) => set({ label: e.target.value })} data-testid={`stab-cond-${i}-label`} />
                </label>
                <label className="field grow">
                  <span>Detail (optional)</span>
                  <input value={c.detail} onChange={(e) => set({ detail: e.target.value })} />
                </label>
              </>
            )}
          />
          <ListEditor<{ label: string }>
            legend="Time point"
            items={s.timePoints ?? []}
            onChange={(next) => setDetail("stability", { timePoints: next })}
            blank={() => ({ label: "" })}
            addLabel="Add a time point"
            testId="stab-timepoints"
            render={(t, set, i) => (
              <label className="field">
                <span>Time point</span>
                <input value={t.label} onChange={(e) => set({ label: e.target.value })} data-testid={`stab-tp-${i}-label`} />
              </label>
            )}
          />
          <div className="row wrap">
            <TextField label="Orientation" value={s.orientation} onChange={(v) => setDetail("stability", { orientation: v })} optional />
            <NumField label="Units per pull" value={s.unitsPerPull} onChange={(v) => setDetail("stability", { unitsPerPull: v === undefined || v < 1 ? undefined : Math.trunc(v) })} testId="stab-units-per-pull" />
          </div>
          <label className="check">
            <input type="checkbox" checked={s.reportedAgainstProtocol === true} onChange={(e) => setDetail("stability", { reportedAgainstProtocol: e.target.checked ? true : undefined })} data-testid="stab-against-protocol" />
            <span>Results are reported against the stability protocol (this is what allows "report only")</span>
          </label>
          <WorkingList title="Pulls and units (worked out from the entries above)" lines={der.working} testId="stab-working" />
        </>
      );
    }
    case "retain_reserve": {
      const r = det.retain ?? {};
      const der = retainDerivation(d);
      return (
        <>
          <label className="field">
            <span>Retain, reserve or both</span>
            <select value={r.purpose ?? ""} onChange={(e) => setDetail("retain", { purpose: (e.target.value || undefined) as never })} data-testid="retain-purpose">
              <option value="">Choose</option>
              {RETAIN_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {RETAIN_PURPOSE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Basis of the quantity" value={r.quantityBasis} onChange={(v) => setDetail("retain", { quantityBasis: v })} testId="retain-basis" />
          <NumField label="Units per batch" value={r.unitsPerBatch} onChange={(v) => setDetail("retain", { unitsPerBatch: v === undefined || v < 1 ? undefined : Math.trunc(v) })} testId="retain-units" />
          <div className="row wrap">
            <TextField label="Retention period" value={r.retentionPeriod} onChange={(v) => setDetail("retain", { retentionPeriod: v })} testId="retain-period" />
            <TextField label="Storage" value={r.storage} onChange={(v) => setDetail("retain", { storage: v })} testId="retain-storage" />
          </div>
          <TextField label="Requirement the quantity and period come from" value={r.requirementRef} onChange={(v) => setDetail("retain", { requirementRef: v })} testId="retain-requirement" />
          <WorkingList title="Units (worked out from the entries above)" lines={der.working} testId="retain-working" />
        </>
      );
    }
    case "characterization":
    case "supporting_study": {
      const a = det.analyses ?? {};
      return (
        <>
          <ListEditor<{ name: string; methodRef: string }>
            legend="Analysis"
            items={a.analyses ?? []}
            onChange={(next) => setDetail("analyses", { analyses: next })}
            blank={() => ({ name: "", methodRef: "" })}
            addLabel="Add an analysis"
            testId="analyses"
            render={(x, set, i) => (
              <>
                <label className="field">
                  <span>Name</span>
                  <input value={x.name} onChange={(e) => set({ name: e.target.value })} data-testid={`analysis-${i}-name`} />
                </label>
                <label className="field">
                  <span>Method reference (optional)</span>
                  <input value={x.methodRef} onChange={(e) => set({ methodRef: e.target.value })} />
                </label>
              </>
            )}
          />
          <TextField label="What decision or report the result informs" value={a.informs} onChange={(v) => setDetail("analyses", { informs: v })} testId="analyses-informs" />
        </>
      );
    }
    case "regulatory_commitment": {
      return (
        <>
          <p className="muted small">Link the agency request or commitment this study answers under "Agency requests" below. The tool keeps the request as quoted and states no filing category.</p>
          <TextField label="How this study answers the request" value={det.commitment?.answer} onChange={(v) => setDetail("commitment", { answer: v })} testId="commitment-answer" area />
        </>
      );
    }
    default:
      return null;
  }
}

function WorkingList({ title, lines, testId }: { title: string; lines: { label: string; value: string }[]; testId: string }) {
  return (
    <section className="working" aria-label={title} data-testid={testId}>
      <h3>{title}</h3>
      {lines.length === 0 ? (
        <p className="muted">Nothing is worked out yet. Enter the values above.</p>
      ) : (
        <dl className="working-list">
          {lines.map((w, i) => (
            <div key={i}>
              <dt>{w.label}</dt>
              <dd>{w.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** Hold durations. A row with no value yet stays in the editor only; it is stored once it has a positive value and a unit. */
function DurationRows({ durations, onChange }: { durations: { value: number; unit: (typeof HOLD_UNITS)[number] }[]; onChange: (next: { value: number; unit: (typeof HOLD_UNITS)[number] }[]) => void }) {
  type Row = { value?: number; unit?: (typeof HOLD_UNITS)[number] };
  const [rows, setRows] = useState<Row[]>(durations);
  const push = (next: Row[]) => {
    setRows(next);
    onChange(next.filter((r): r is { value: number; unit: (typeof HOLD_UNITS)[number] } => r.value !== undefined && r.value > 0 && r.unit !== undefined));
  };
  const incomplete = rows.filter((r) => r.value === undefined || r.unit === undefined).length;
  return (
    <>
      <ListEditor<Row>
        legend="Hold duration"
        items={rows}
        onChange={push}
        blank={() => ({})}
        addLabel="Add a hold duration"
        testId="hold-durations"
        render={(r, set, i) => (
          <>
            <NumField label="Duration" value={r.value} onChange={(v) => set({ value: v !== undefined && v > 0 ? v : undefined })} testId={`hold-dur-${i}-value`} />
            <label className="field">
              <span>Unit</span>
              <select value={r.unit ?? ""} onChange={(e) => set({ unit: (e.target.value || undefined) as Row["unit"] })} data-testid={`hold-dur-${i}-unit`}>
                <option value="">Choose</option>
                {HOLD_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      />
      {incomplete > 0 && <p className="muted small">A duration is saved once it has a value and a unit.</p>}
    </>
  );
}

// ------------------------------------------------------------------ the point editor

/**
 * One collapsible group of the point editor. The header is a button (aria-expanded) with a one-line summary and the "N to fill" count
 * (words, never colour alone). The content stays mounted while closed (hidden), so a half-typed value is not lost by closing a group.
 */
function Group({ id, title, summary, count, open, onToggle, children }: { id: PointGroup; title: string; summary: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  const panel = useId();
  return (
    <section className="point-group" data-testid={`group-${id}`}>
      <h5 className="group-head">
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle} data-testid={`group-toggle-${id}`}>
          <span aria-hidden="true" className="group-caret">
            {open ? "▾" : "▸"}
          </span>
          <span className="group-title">{title}</span>
          <span className="group-summary muted small">{summary}</span>
          <span className={count > 0 ? "group-count open" : "group-count"} data-testid={`group-count-${id}`}>
            {toFillText(count)}
          </span>
        </button>
      </h5>
      <div id={panel} className="group-body stack" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Steps a point can belong to: the catalog's unit operations, finished product, and supporting work. */
export function useStepChoices(): { key: string; label: string }[] {
  const content = useContent();
  return useMemo(
    () => [...content.catalog.unitOperations.map((u) => ({ key: u.key, label: u.label })), { key: UNIT_OP_FINISHED_PRODUCT, label: "Finished product" }, { key: UNIT_OP_NONE, label: "Supporting work (no single step)" }],
    [content],
  );
}

/**
 * The point editor. The person picks a study type and a method and only the entries that apply appear. The working panel and the
 * reporting-instructions preview recalculate from the draft on every change. Nothing is preselected: an empty choice stays empty
 * and the point stays incomplete. Used inside a dialog (Overview) and inline in the interview, so both views edit the same point.
 */
export function PointForm({
  plan,
  point,
  onClose,
  onSave,
  inline,
  groups,
}: {
  plan: SamplingPlan;
  point: SamplingPoint;
  onClose: () => void;
  onSave: (d: SamplingPoint) => string | null;
  inline?: boolean;
  /** Which groups are open, kept by the caller so a save (which remounts the form) does not close what the person had open. */
  groups?: { open: PointGroup[] | undefined; onChange: (open: PointGroup[]) => void };
}) {
  const project = useStore((s) => s.project)!;
  const tables = useSamplingTables((s) => s.items);
  const loadTables = useSamplingTables((s) => s.load);
  useEffect(() => void loadTables(), [loadTables]);
  const [d, setD] = useState<SamplingPoint>(() => structuredClone(point));
  const [error, setError] = useState("");
  // Groups start closed, except the first one that still has something to fill (the person lands where the work is).
  const [openGroups, setOpenGroups] = useState<PointGroup[]>(() => groups?.open ?? initialOpenGroups(checkPoint(plan, point).byGroup, POINT_GROUPS));
  const [pendingType, setPendingType] = useState<SamplingType | "" | null>(null);
  const uid = useId();
  const setGroups = (next: PointGroup[]) => {
    setOpenGroups(next);
    groups?.onChange(next);
  };
  const isOpen = (g: PointGroup) => openGroups.includes(g);
  const toggleGroup = (g: PointGroup) => setGroups(isOpen(g) ? openGroups.filter((x) => x !== g) : [...openGroups, g]);
  const allOpen = openGroups.length === POINT_GROUPS.length;
  const setAllGroups = (open: boolean) => setGroups(open ? [...POINT_GROUPS] : []);
  const steps = useStepChoices();
  const set = (patch: Partial<SamplingPoint>) => setD((cur) => ({ ...cur, ...patch }));
  const setInputs = (patch: Partial<SamplingPoint["sampleSize"]["inputs"]>) => setD((cur) => ({ ...cur, sampleSize: { ...cur.sampleSize, inputs: { ...cur.sampleSize.inputs, ...patch } } }));
  const setDetail = <K extends DetailKey>(key: K, patch: Partial<NonNullable<TypeDetail[K]>>) =>
    setD((cur) => {
      const group = { ...(cur.detail?.[key] ?? {}), ...patch } as Record<string, unknown>;
      for (const k of Object.keys(group)) if (group[k] === undefined) delete group[k];
      return { ...cur, detail: { ...cur.detail, [key]: group } };
    });
  const method = d.sampleSize.method;
  const inputs = d.sampleSize.inputs;
  const byMethod = usesSampleSizeMethod(d);

  const trial: SamplingPlan = useMemo(() => ({ ...plan, points: plan.points.map((p) => (p.id === d.id ? d : p)) }), [plan, d]);
  const results = useMemo(() => calculatePoint(trial, d), [trial, d]);
  const check = useMemo(() => checkPoint(trial, d), [trial, d]);
  const stepLabel = useMemo(() => new Map(steps.map((s) => [s.key, s.label])), [steps]);
  const ri = useMemo(() => reportingInstructions(trial, d, { unitOpLabel: (k) => stepLabel.get(k) ?? k }), [trial, d, stepLabel]);
  const pickable = tables.filter((t) => tableProblems(t).length === 0);
  const inLibrary = inputs.table ? tables.find((t) => t.id === inputs.table!.id) : undefined;
  const changed = inputs.table && inLibrary ? tableChangedSince(inputs.table, tables) : undefined;
  const testKeys = [...new Set((inputs.table?.rows ?? []).flatMap((r) => (r.testKey ? [r.testKey] : [])))];
  const sources = project.sources.filter((s) => !s.supersededBy);
  const roAllowed = reportOnlyAllowed(d.type);

  // Inputs of another method are dropped so a hidden value can never drive the number (no stale values).
  const changeMethod = (m: SamplingMethod | "") => setD((cur) => ({ ...cur, sampleSize: m ? { method: m, inputs: {} } : { inputs: {} } }));
  // Changing the type hides the old type's field group. The entries stay in the data (nothing is deleted) but the person is told first.
  const askType = (t: SamplingType | "") => (typeChangeHidesValues(d, t || undefined) ? setPendingType(t) : changeType(t));
  const changeType = (t: SamplingType | "") =>
    setD((cur) => {
      const next: SamplingPoint = { ...cur, acceptance: cur.acceptance?.kind === "report_only" && !reportOnlyAllowed(t || undefined) ? undefined : cur.acceptance };
      if (t) next.type = t;
      else delete next.type;
      return next;
    });

  const batchIds = d.appliesTo === "all" ? plan.batches.map((b) => b.id) : d.appliesTo;
  const rep = d.reporting ?? {};
  const setRep = (patch: Partial<NonNullable<SamplingPoint["reporting"]>>) => {
    const next = { ...rep, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || (Array.isArray(next[k]) && (next[k] as unknown[]).length === 0)) delete next[k];
    setD((cur) => {
      const copy = { ...cur };
      if (Object.keys(next).length) copy.reporting = next as never;
      else delete copy.reporting;
      return copy;
    });
  };

  const form = (
    <form
      className="stack"
      data-testid="point-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        const err = onSave(d);
        if (err) setError(err);
      }}
    >
      <div className="row wrap between">
        <p className="muted small">Only the chosen study type's own fields are shown. Open a group to fill it in; "to fill" counts what the point still needs.</p>
        <button type="button" className="btn small" onClick={() => setAllGroups(!allOpen)} data-testid="point-expand-all" aria-pressed={allOpen}>
          {allOpen ? "Close all groups" : "Open all groups"}
        </button>
      </div>

      <Group id="type" title={typeGroupLabel(d.type)} summary={groupSummary(d, "type")} count={check.byGroup.type.length} open={isOpen("type")} onToggle={() => toggleGroup("type")}>
        <label className="field">
          <span>Study type</span>
          <select value={d.type ?? ""} onChange={(e) => askType(e.target.value as SamplingType | "")} data-testid="point-type" aria-describedby={`${uid}-type`}>
            <option value="">Not chosen yet</option>
            {SAMPLING_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <p id={`${uid}-type`} className="muted small">
          {d.type ? TYPE_HELP[d.type] : "Choose the study type. It decides which questions come next and where the point is printed. A point migrated from an older file has no type until you choose one."}
        </p>
        {pendingType !== null && d.type && (
          <div className="notice stack" role="alertdialog" aria-label="Change the study type" data-testid="type-change-confirm">
            <p>
              This point has entries for {TYPE_LABEL[d.type]}. Changing the type to {pendingType ? TYPE_LABEL[pendingType] : "not chosen"} hides them. They stay saved in the point and show again if you change back.
            </p>
            <div className="row wrap">
              <button type="button" className="btn primary" autoFocus onClick={() => (changeType(pendingType), setPendingType(null))} data-testid="type-change-yes">
                Change the type
              </button>
              <button type="button" className="btn" onClick={() => setPendingType(null)} data-testid="type-change-no">
                Keep {TYPE_LABEL[d.type]}
              </button>
            </div>
          </div>
        )}
        <label className="field">
          <span>
            {d.type === "other" ? "What kind of sampling is this" : "Study type wording"} {d.type !== "other" && <span className="muted">(optional)</span>}
          </span>
          <input value={d.typeLabel ?? ""} onChange={(e) => set({ typeLabel: opt(e.target.value) })} data-testid="point-type-label" />
        </label>
        {d.type && TypeCardHasFields(d.type) && (
          <div className="stack" data-testid="type-card">
            {/* Why only the chosen type's fields: the full form listed every type's fields at once and the product owner found it overwhelming. */}
            <TypeCard d={d} plan={plan} steps={steps} setDetail={setDetail} />
          </div>
        )}
      </Group>

      <Group id="sampling" title="Sampling" summary={groupSummary(d, "sampling")} count={check.byGroup.sampling.length} open={isOpen("sampling")} onToggle={() => toggleGroup("sampling")}>
        <label className="field">
          <span>Process step</span>
          {/* A point on the plan's process flow takes its unit operation from that step, so the step is changed in the table or the diagram. */}
          <select value={d.unitOp} onChange={(e) => set({ unitOp: e.target.value })} data-testid="point-unitop" disabled={!!stepOf(plan, d)} aria-describedby={stepOf(plan, d) ? `${uid}-flowstep` : undefined}>
            {steps.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
            {!steps.some((s) => s.key === d.unitOp) && <option value={d.unitOp}>{d.unitOp === UNIT_OP_CUSTOM_STEP ? (stepOf(plan, d)?.label ?? "Custom step") : d.unitOp}</option>}
          </select>
          {stepOf(plan, d) && (
            <span id={`${uid}-flowstep`} className="muted small">
              On the process flow: {placementText(plan, d)}. Change the step or position in the points table or on the diagram.
            </span>
          )}
        </label>
        <TextField label="Material" value={d.materialType} onChange={(v) => set({ materialType: v })} optional />
        {/* M10: the optional hour the sample is taken (flow figure) and, for a sample on the diagram, the hold it is taken during. Both stay empty until a person fills them. */}
        <div className="row wrap">
          <NumField label="Hour taken (optional)" value={d.takenAtHour} onChange={(v) => set({ takenAtHour: v === undefined || v < 0 ? undefined : v })} hint="Hours from time zero of the flow figure. Leave empty if not known yet; the figure then lists the sample without a pin." testId="point-hour" />
          {d.flow && plan.holds?.some((h) => h.afterStepId === d.flow!.stepId) && (
            <label className="field">
              <span>Taken during a hold (optional)</span>
              <select
                value={d.flow.holdId ?? ""}
                data-testid="point-hold"
                onChange={(e) => {
                  const { holdId: _drop, ...rest } = d.flow!;
                  set({ flow: e.target.value ? { ...rest, holdId: e.target.value } : rest });
                }}
              >
                <option value="">Not during a hold</option>
                {plan.holds
                  .filter((h) => h.afterStepId === d.flow!.stepId)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <div className="row wrap">
          <label className="field">
            <span>Responsible for this sample</span>
            <select
              value={d.responsible?.party ?? ""}
              data-testid="point-responsible"
              onChange={(e) => {
                const party = e.target.value as (typeof RESPONSIBLE_PARTIES)[number] | "";
                const next = { ...d };
                if (party) next.responsible = { party, ...(d.responsible?.name ? { name: d.responsible.name } : {}) };
                else delete next.responsible;
                setD(next);
              }}
            >
              <option value="">Not chosen yet</option>
              {RESPONSIBLE_PARTIES.map((p) => (
                <option key={p} value={p}>
                  {RESPONSIBLE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          {d.responsible && (
            <label className="field">
              <span>Name {d.responsible.party === "other" ? "" : <span className="muted">(optional)</span>}</span>
              <input value={d.responsible.name ?? ""} onChange={(e) => set({ responsible: { party: d.responsible!.party, ...(opt(e.target.value) ? { name: e.target.value } : {}) } })} data-testid="point-responsible-name" />
            </label>
          )}
        </div>
        {byMethod && (
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
        )}
        {byMethod && (
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
        )}
        <fieldset className="stack fs">
          <legend>Handling and scope</legend>
          <div className="row wrap">
            <NumField label="Quantity per sample (optional)" value={d.quantity?.value} onChange={(v) => set({ quantity: v === undefined || v <= 0 ? undefined : { value: v, unit: d.quantity?.unit ?? "" } })} />
            <label className="field">
              <span>Quantity unit</span>
              <input value={d.quantity?.unit ?? ""} onChange={(e) => set({ quantity: d.quantity ? { ...d.quantity, unit: e.target.value } : undefined })} placeholder="e.g. mL" />
            </label>
            <TextField label="Storage condition" value={d.storageCondition} onChange={(v) => set({ storageCondition: v })} optional />
          </div>
          <div className="row wrap">
            <TextField label="Container" value={d.container} onChange={(v) => set({ container: v })} optional />
            <TextField label="Closure" value={d.closure} onChange={(v) => set({ closure: v })} optional />
            <TextField label="Transport condition" value={d.transportCondition} onChange={(v) => set({ transportCondition: v })} optional />
            <TextField label="Chain of custody" value={d.chainOfCustody} onChange={(v) => set({ chainOfCustody: v })} optional />
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
        </fieldset>
      </Group>

      <Group id="testing" title="Testing" summary={groupSummary(d, "testing")} count={check.byGroup.testing.length} open={isOpen("testing")} onToggle={() => toggleGroup("testing")}>
        <label className="field">
          <span>Attribute or test</span>
          <input value={d.attribute} onChange={(e) => set({ attribute: e.target.value })} data-testid="point-attribute" />
        </label>
        <div className="row wrap">
          <TextField label="Test method reference" value={d.testMethodRef} onChange={(v) => set({ testMethodRef: v })} optional />
          <TextField label="Destination lab" value={d.destinationLab} onChange={(v) => set({ destinationLab: v })} optional />
        </div>
      </Group>

      <Group id="acceptance" title="Acceptance and rationale" summary={groupSummary(d, "acceptance")} count={check.byGroup.acceptance.length} open={isOpen("acceptance")} onToggle={() => toggleGroup("acceptance")}>
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
            {d.type ? `Report only is not available for ${TYPE_LABEL[d.type].toLowerCase()} points. These points need an acceptance criterion.` : "Report only is available once the study type is chosen, and only for some types."}
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
      </Group>

      <Group id="reporting" title="Reporting instructions (what the CMO reports)" summary={groupSummary(d, "reporting")} count={check.byGroup.reporting.length} open={isOpen("reporting")} onToggle={() => toggleGroup("reporting")}>
        <div className="stack" data-testid="reporting-fields">
          <div role="group" aria-label="What to report" className="stack">
            <span className="small">What to report</span>
            <div className="check-grid">
              {REPORT_WHAT.map((w) => (
                <label key={w} className="check">
                  <input type="checkbox" checked={rep.what?.includes(w) ?? false} onChange={() => setRep({ what: toggle(rep.what ?? [], w) })} data-testid={`rep-what-${w}`} />
                  <span>{REPORT_WHAT_LABEL[w]}</span>
                </label>
              ))}
            </div>
          </div>
          {rep.what?.includes("other") && <TextField label="Other item to report" value={rep.whatOther} onChange={(v) => setRep({ whatOther: v })} />}
          <div role="group" aria-label="How to present the results" className="stack">
            <span className="small">How to present the results (optional)</span>
            <div className="check-grid">
              {REPORT_PRESENTATION.map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" checked={rep.presentation?.includes(p) ?? false} onChange={() => setRep({ presentation: toggle(rep.presentation ?? [], p) })} />
                  <span>{REPORT_PRESENTATION_LABEL[p]}</span>
                </label>
              ))}
            </div>
          </div>
          <TextField label="Deviation, OOS and OOT handling (the CMO's procedure)" value={rep.deviationRef} onChange={(v) => setRep({ deviationRef: v })} testId="rep-deviation" />
          <TextField label="Additional wording for the acceptance statement" value={rep.acceptanceExtra} onChange={(v) => setRep({ acceptanceExtra: v })} optional area />
          <TextField label="Additional instructions" value={rep.additional} onChange={(v) => setRep({ additional: v })} optional area />
          <section className="working ri-preview" aria-label={`Preview of ${ri.heading}`} data-testid="ri-preview">
            <h3>{ri.heading}</h3>
            <p className="muted small">This is how the block reads in the export. The CMO can copy it as it is.</p>
            {ri.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {ri.missing.length > 0 && <p className="small">Not given yet: {ri.missing.join("; ")}.</p>}
          </section>
        </div>
      </Group>

      <Group id="sources" title="Sources and agency requests" summary={groupSummary(d, "sources")} count={check.byGroup.sources.length} open={isOpen("sources")} onToggle={() => toggleGroup("sources")}>
        {plan.agencyRequests.length === 0 && sources.length === 0 && <p className="muted small">No sources in the register and no agency requests yet. Add sources on the Sources page; agency requests are recorded in the Agency requests section of the interview.</p>}
        {plan.agencyRequests.length > 0 && (
          <div role="group" aria-label="Agency requests this point answers" className="stack">
            <span className="small">Agency requests this point answers (optional)</span>
            <div className="check-grid">
              {plan.agencyRequests.map((r) => (
                <label key={r.id} className="check">
                  <input
                    type="checkbox"
                    checked={d.agencyRequestIds?.includes(r.id) ?? false}
                    onChange={() => {
                      const next = toggle(d.agencyRequestIds ?? [], r.id);
                      const copy = { ...d };
                      if (next.length) copy.agencyRequestIds = next;
                      else delete copy.agencyRequestIds;
                      setD(copy);
                    }}
                    data-testid={`link-${r.id}`}
                  />
                  <span>{requestTitle(r)}</span>
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
      </Group>

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
          {inline ? "Close" : "Cancel"}
        </button>
        <button type="submit" className="btn primary" data-testid="point-save">
          Save point
        </button>
      </div>
    </form>
  );
  return form;
}

/** Every type but ipc and release has a card of its own; those two have only the common entries. */
const TypeCardHasFields = (t: SamplingType): boolean => t !== "ipc" && t !== "release" && t !== "other";

export function PointDialog({ plan, point, onClose, onSave }: { plan: SamplingPlan; point: SamplingPoint; onClose: () => void; onSave: (d: SamplingPoint) => string | null }) {
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Point ${point.id}`} description="Fill in what you know. What you leave empty stays an open item; the tool never fills it in." wide>
      <PointForm plan={plan} point={point} onClose={onClose} onSave={onSave} />
    </Modal>
  );
}

