import { acceptSuggestion, addAgencyRequest, addPoint, removeAgencyRequest, removePoint, setParties, updateAgencyRequest, updatePlan, updatePoint, type PointSuggestion } from "@gap/engine";
import {
  AGENCY_REQUEST_KINDS,
  AGENCY_REQUEST_STATUSES,
  RESPONSIBLE_PARTIES,
  SAMPLING_TYPES,
  UNIT_OP_FINISHED_PRODUCT,
  UNIT_OP_NONE,
  type AgencyRequest,
  type PlanParty,
  type SamplingPlan,
  type SamplingPoint,
  type SamplingType,
} from "@gap/process-model";
import { AGENCY_KIND_LABEL, AGENCY_STATUS_LABEL, RESPONSIBLE_LABEL, STATUS_TEXT, TYPE_HELP, TYPE_LABEL, agencyCoverage, checkPoint, typeText } from "@gap/sampling";
import { useMemo, useState } from "react";
import { Empty } from "../components";
import { useStore } from "../store";
import { PointForm, useStepChoices } from "./SamplingPointDialog";

type Run = (fn: Parameters<ReturnType<typeof useStore.getState>["update"]>[0], status: string) => boolean;

/** The text beside the "View by" toggle. Kept here so the page and the tests say the same thing. */
export const VIEW_BY_LABEL = { step: "Process step", type: "Study type" } as const;
export type ViewBy = keyof typeof VIEW_BY_LABEL;

// ------------------------------------------------------------------ plan-level questions

/** Who does what: the parties named at plan level. A party needs a name; the kind is chosen, never assumed. */
export function PartiesCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const [rows, setRows] = useState<{ party: PlanParty["party"] | ""; name: string; role: string }[]>(plan.parties.map((p) => ({ party: p.party, name: p.name, role: p.role ?? "" })));
  const complete = rows.filter((r) => r.party !== "") as { party: PlanParty["party"]; name: string; role: string }[];
  const dirty = JSON.stringify(complete.map((r) => [r.party, r.name.trim(), r.role.trim()])) !== JSON.stringify(plan.parties.map((p) => [p.party, p.name, p.role ?? ""])) || complete.length !== rows.length;
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section className="card stack" aria-labelledby="sp-parties" data-testid="parties-card">
      <h2 id="sp-parties">Who does what ({plan.parties.length})</h2>
      <p className="muted small">Name who takes the samples, who tests them and who writes the PPQ summary report. The kind of party is your choice; nothing is assumed.</p>
      {rows.length === 0 && <Empty>No parties named yet. Add the first one below.</Empty>}
      {rows.map((r, i) => (
        <div key={i} className="row wrap end-align list-row">
          <label className="field">
            <span>Party</span>
            <select value={r.party} onChange={(e) => set(i, { party: e.target.value as PlanParty["party"] | "" })} data-testid={`party-${i}-kind`}>
              <option value="">Choose</option>
              {RESPONSIBLE_PARTIES.map((p) => (
                <option key={p} value={p}>
                  {RESPONSIBLE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Name</span>
            <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} data-testid={`party-${i}-name`} />
          </label>
          <label className="field grow">
            <span>
              Role <span className="muted">(optional)</span>
            </span>
            <input value={r.role} onChange={(e) => set(i, { role: e.target.value })} data-testid={`party-${i}-role`} />
          </label>
          <button type="button" className="btn small danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove party ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => setRows([...rows, { party: "", name: "", role: "" }])} data-testid="party-add">
          Add a party
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!dirty}
          data-testid="parties-save"
          onClick={() => run((p, actor) => setParties(p, plan.id, complete.map((r) => ({ party: r.party, name: r.name, ...(r.role.trim() ? { role: r.role } : {}) })), actor), "Responsible parties saved")}
        >
          Save parties
        </button>
      </div>
      {rows.some((r) => r.party === "") && <p className="muted small">A row without a kind of party is not saved.</p>}
    </section>
  );
}

/** The register of agency requests. The question is kept as quoted; the tool never says what a request means for a filing. */
export function AgencyCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const project = useStore((s) => s.project)!;
  const coverage = agencyCoverage(plan);
  const [agency, setAgency] = useState("");
  const [question, setQuestion] = useState("");
  const sources = project.sources.filter((s) => !s.supersededBy);
  return (
    <section className="card stack" aria-labelledby="sp-agency" data-testid="agency-card">
      <h2 id="sp-agency">Agency requests ({plan.agencyRequests.length})</h2>
      <p className="muted small">
        Are there agency requests or answers (information requests, deficiency letters, commitments) that refer to PPQ samples or studies? Record them here and link the points that answer them. The tool states no filing category; where a filing question arises it reads "Requires regulatory affairs assessment".
      </p>
      {plan.agencyRequests.length === 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={plan.noAgencyRequests === true}
            data-testid="no-agency-requests"
            onChange={(e) => run((p, actor) => updatePlan(p, plan.id, { noAgencyRequests: e.target.checked }, actor), "Agency request answer saved")}
          />
          <span>There are no such agency requests or answers.</span>
        </label>
      )}
      {coverage.map((c) => (
        <RequestEditor key={`${c.request.id}-${c.request.updatedAt}`} request={c.request} coverageText={c.text} sources={sources} plan={plan} run={run} />
      ))}
      <form
        className="row wrap end-align"
        aria-label="Add an agency request"
        onSubmit={(e) => {
          e.preventDefault();
          if (!agency.trim() && !question.trim()) return;
          if (run((p, actor) => addAgencyRequest(p, plan.id, { agency, question, sourceIds: [] }, actor).project, "Agency request added")) {
            setAgency("");
            setQuestion("");
          }
        }}
      >
        <label className="field">
          <span>Agency</span>
          <input value={agency} onChange={(e) => setAgency(e.target.value)} data-testid="agency-new-agency" placeholder="e.g. Example Agency (fictional)" />
        </label>
        <label className="field grow">
          <span>Question or commitment, as received</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="agency-new-question" />
        </label>
        <button type="submit" className="btn" data-testid="agency-add" disabled={!agency.trim() && !question.trim()}>
          Add agency request
        </button>
      </form>
    </section>
  );
}

function RequestEditor({ request, coverageText, sources, plan, run }: { request: AgencyRequest; coverageText: string; sources: { id: string; label: string }[]; plan: SamplingPlan; run: Run }) {
  const [d, setD] = useState(request);
  const set = (patch: Partial<AgencyRequest>) => setD((cur) => ({ ...cur, ...patch }));
  const dirty = JSON.stringify({ ...d, updatedAt: 0 }) !== JSON.stringify({ ...request, updatedAt: 0 });
  const text = (k: keyof AgencyRequest, label: string, testId: string, area?: boolean) => (
    <label className="field">
      <span>{label}</span>
      {area ? (
        <textarea rows={2} value={(d[k] as string | undefined) ?? ""} onChange={(e) => set({ [k]: e.target.value } as Partial<AgencyRequest>)} data-testid={testId} />
      ) : (
        <input value={(d[k] as string | undefined) ?? ""} onChange={(e) => set({ [k]: e.target.value } as Partial<AgencyRequest>)} data-testid={testId} />
      )}
    </label>
  );
  return (
    <fieldset className="stack fs" data-testid={`agency-${request.id}`}>
      <legend>{request.id}</legend>
      <div className="row wrap">
        {text("agency", "Agency", `agency-${request.id}-agency`)}
        {text("marketCode", "Market code (optional)", `agency-${request.id}-market`)}
        {text("reference", "Reference (optional)", `agency-${request.id}-reference`)}
        <label className="field">
          <span>Kind</span>
          <select value={d.kind ?? ""} onChange={(e) => set({ kind: (e.target.value || undefined) as AgencyRequest["kind"] })}>
            <option value="">Not chosen</option>
            {AGENCY_REQUEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {AGENCY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={d.status ?? ""} onChange={(e) => set({ status: (e.target.value || undefined) as AgencyRequest["status"] })} data-testid={`agency-${request.id}-status`}>
            <option value="">Not chosen</option>
            {AGENCY_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {AGENCY_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row wrap">
        <label className="field">
          <span>Date received</span>
          <input type="date" value={d.dateReceived ?? ""} onChange={(e) => set({ dateReceived: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span>Response date</span>
          <input type="date" value={d.responseDate ?? ""} onChange={(e) => set({ responseDate: e.target.value || undefined })} />
        </label>
      </div>
      {text("question", "Question, as received", `agency-${request.id}-question`, true)}
      {text("response", "Response given or commitment made", `agency-${request.id}-response`, true)}
      {sources.length > 0 && (
        <div role="group" aria-label={`Sources cited by ${request.id}`} className="stack">
          <span className="small">Letter and response cited from the source register (optional)</span>
          <div className="check-grid">
            {sources.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" checked={d.sourceIds.includes(s.id)} onChange={() => set({ sourceIds: d.sourceIds.includes(s.id) ? d.sourceIds.filter((x) => x !== s.id) : [...d.sourceIds, s.id] })} />
                <span>
                  {s.label} <span className="muted">({s.id})</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <p className="small" data-testid={`agency-${request.id}-coverage`}>
        {coverageText}
      </p>
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={!dirty}
          data-testid={`agency-${request.id}-save`}
          onClick={() => {
            const { id: _i, createdAt: _c, updatedAt: _u, ...patch } = d;
            run((p, actor) => updateAgencyRequest(p, plan.id, request.id, patch, actor), `Agency request ${request.id} saved`);
          }}
        >
          Save request
        </button>
        <button type="button" className="btn danger" onClick={() => run((p, actor) => removeAgencyRequest(p, plan.id, request.id, actor), `Agency request ${request.id} removed`)}>
          Remove request
        </button>
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ the interview: both views edit the same points

/** One point in the interview: a summary line, and the full editor when it is the selected point. */
function PointCard({ plan, point, step, selected, onSelect, run, onRemove }: { plan: SamplingPlan; point: SamplingPoint; step: string; selected: boolean; onSelect: (id: string | null) => void; run: Run; onRemove: () => void }) {
  const check = useMemo(() => checkPoint(plan, point), [plan, point]);
  return (
    <article className="point-card" data-testid={`card-${point.id}`} aria-label={`Point ${point.id}`}>
      <div className="row wrap between">
        <div>
          <h4>
            {point.id}: {point.attribute.trim() || "Not named"}
          </h4>
          <p className="small muted">
            {step}; {typeText(point)}
          </p>
        </div>
        <div className="row wrap">
          <span className={`sp-status sp-status-${check.status}`} data-testid={`card-status-${point.id}`}>
            <span aria-hidden="true">{check.status === "complete" ? "✓ " : "○ "}</span>
            {STATUS_TEXT[check.status]}
            {check.problems.length > 0 ? `, ${check.problems.length} open` : ""}
          </span>
          <button type="button" className="btn small" aria-expanded={selected} onClick={() => onSelect(selected ? null : point.id)} aria-label={`${selected ? "Close" : "Open"} point ${point.id}`} data-testid={`card-open-${point.id}`}>
            {selected ? "Close" : "Open"}
          </button>
          <button type="button" className="btn small danger" onClick={onRemove} aria-label={`Remove point ${point.id}`}>
            Remove
          </button>
        </div>
      </div>
      {selected && (
        <PointForm
          key={`${point.id}-${point.updatedAt}`}
          plan={plan}
          point={point}
          inline
          onClose={() => onSelect(null)}
          onSave={(d) => {
            const { id: _id, origin: _o, createdAt: _c, updatedAt: _u, ...patch } = d;
            const ok = run((p, actor) => updatePoint(p, plan.id, point.id, patch, actor), `Point ${d.id} saved`);
            return ok ? null : "The point was not saved. See the message on the page.";
          }}
        />
      )}
    </article>
  );
}

export function Interview({
  plan,
  suggestions,
  selected,
  onSelect,
  view,
  onView,
  run,
  labelOf,
}: {
  plan: SamplingPlan;
  suggestions: PointSuggestion[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  view: ViewBy;
  onView: (v: ViewBy) => void;
  run: Run;
  labelOf: (k: string) => string;
}) {
  const steps = useStepChoices();
  const remove = (p: SamplingPoint) => run((pr, actor) => removePoint(pr, plan.id, p.id, actor), `Point ${p.id} removed`);

  // Steps shown: every step that has a suggestion or a point (suggestions already leave out steps outside the scope), then the two
  // fixed ones at the end.
  const used = new Set([...suggestions.map((s) => s.uo), ...plan.points.map((p) => p.unitOp)]);
  const stepList = [...steps.filter((s) => s.key !== UNIT_OP_FINISHED_PRODUCT && s.key !== UNIT_OP_NONE && used.has(s.key)), ...steps.filter((s) => s.key === UNIT_OP_FINISHED_PRODUCT || s.key === UNIT_OP_NONE)];
  const knownKeys = new Set(stepList.map((s) => s.key));
  for (const p of plan.points) if (!knownKeys.has(p.unitOp)) (knownKeys.add(p.unitOp), stepList.push({ key: p.unitOp, label: labelOf(p.unitOp) }));

  return (
    <div className="stack-lg" data-testid="interview">
      <section className="card stack" aria-labelledby="sp-interview">
        <h2 id="sp-interview">Sampling interview</h2>
        <p className="muted small">One set of points, two ways to look at it. Switching the view keeps the point you have open.</p>
        <div role="group" aria-label="View by" className="row wrap seg" data-testid="view-by">
          <span className="small">View by:</span>
          {(Object.keys(VIEW_BY_LABEL) as ViewBy[]).map((v) => (
            <button key={v} type="button" className={view === v ? "btn primary" : "btn"} aria-pressed={view === v} onClick={() => onView(v)} data-testid={`view-${v}`}>
              {VIEW_BY_LABEL[v]}
            </button>
          ))}
        </div>
      </section>

      {view === "step" ? (
        stepList.map((s) => (
          <StepSection key={s.key} plan={plan} step={s} suggestions={suggestions.filter((x) => x.uo === s.key)} selected={selected} onSelect={onSelect} run={run} labelOf={labelOf} onRemove={remove} />
        ))
      ) : (
        <>
          {SAMPLING_TYPES.map((t) => (
            <TypeSection key={t} plan={plan} type={t} selected={selected} onSelect={onSelect} run={run} labelOf={labelOf} steps={steps} onRemove={remove} />
          ))}
          <TypeSection plan={plan} type={null} selected={selected} onSelect={onSelect} run={run} labelOf={labelOf} steps={steps} onRemove={remove} />
        </>
      )}
    </div>
  );
}

function progress(plan: SamplingPlan, points: SamplingPoint[]): string {
  const incomplete = points.filter((p) => checkPoint(plan, p).status === "incomplete").length;
  if (points.length === 0) return "No points yet";
  return `${points.length} ${points.length === 1 ? "point" : "points"}, ${points.length - incomplete} complete, ${incomplete} incomplete`;
}

function StepSection({ plan, step, suggestions, selected, onSelect, run, labelOf, onRemove }: { plan: SamplingPlan; step: { key: string; label: string }; suggestions: PointSuggestion[]; selected: string | null; onSelect: (id: string | null) => void; run: Run; labelOf: (k: string) => string; onRemove: (p: SamplingPoint) => void }) {
  const points = plan.points.filter((p) => p.unitOp === step.key);
  const [type, setType] = useState<SamplingType | "">("");
  const [attribute, setAttribute] = useState("");
  return (
    <section className="card stack" aria-labelledby={`step-${step.key}`} data-testid={`step-${step.key}`}>
      <h3 id={`step-${step.key}`}>{step.label}</h3>
      <p className="small muted" data-testid={`step-progress-${step.key}`}>
        {progress(plan, points)}
      </p>
      {suggestions.length > 0 && (
        <div role="group" aria-label={`Which samples and studies happen at ${step.label}?`} className="stack">
          <span className="small">Which samples and studies happen at this step? Tick to add one as an incomplete point.</span>
          <div className="check-grid">
            {suggestions.map((s) => (
              <label key={s.id} className="check" title={s.why}>
                <input
                  type="checkbox"
                  checked={s.added}
                  disabled={s.added}
                  data-testid={`suggest-${s.id}`}
                  onChange={() => run((p, actor) => acceptSuggestion(p, plan.id, s, actor).project, "Point added from a suggestion")}
                />
                <span>
                  {s.attribute} <span className="muted">({TYPE_LABEL[s.type]}{s.added ? ", added" : ""})</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <form
        className="row wrap end-align"
        aria-label={`Add your own at ${step.label}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!type) return;
          let id = "";
          const ok = run((p, actor) => {
            const r = addPoint(p, plan.id, { unitOp: step.key, type, ...(attribute.trim() ? { attribute: attribute.trim() } : {}) }, actor);
            id = r.pointId;
            return r.project;
          }, "Point added");
          if (ok) {
            setAttribute("");
            onSelect(id);
          }
        }}
      >
        <label className="field">
          <span>Add your own: study type</span>
          <select value={type} onChange={(e) => setType(e.target.value as SamplingType | "")} data-testid={`own-type-${step.key}`}>
            <option value="">Choose</option>
            {SAMPLING_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>
            Attribute or test <span className="muted">(optional now)</span>
          </span>
          <input value={attribute} onChange={(e) => setAttribute(e.target.value)} data-testid={`own-attribute-${step.key}`} />
        </label>
        <button type="submit" className="btn" disabled={!type} data-testid={`own-add-${step.key}`}>
          Add point
        </button>
      </form>
      {points.map((p) => (
        <PointCard key={p.id} plan={plan} point={p} step={labelOf(p.unitOp)} selected={selected === p.id} onSelect={onSelect} run={run} onRemove={() => onRemove(p)} />
      ))}
    </section>
  );
}

function TypeSection({ plan, type, selected, onSelect, run, labelOf, steps, onRemove }: { plan: SamplingPlan; type: SamplingType | null; selected: string | null; onSelect: (id: string | null) => void; run: Run; labelOf: (k: string) => string; steps: { key: string; label: string }[]; onRemove: (p: SamplingPoint) => void }) {
  const points = plan.points.filter((p) => (type ? p.type === type : !p.type));
  const [unitOp, setUnitOp] = useState("");
  const [attribute, setAttribute] = useState("");
  // Points without a type only appear when there are some (migrated files); nothing is guessed for them.
  if (!type && points.length === 0) return null;
  const key = type ?? "none";
  const title = type ? TYPE_LABEL[type] : "Study type not chosen yet";
  return (
    <section className="card stack" aria-labelledby={`type-${key}`} data-testid={`type-${key}`}>
      <h3 id={`type-${key}`}>
        {title} ({points.length})
      </h3>
      <p className="small muted">{type ? TYPE_HELP[type] : "These points came from an older file and still need a study type. Open one to choose it."}</p>
      <p className="small muted" data-testid={`type-progress-${key}`}>
        {progress(plan, points)}
      </p>
      {type && (
        <form
          className="row wrap end-align"
          aria-label={`Add a ${title.toLowerCase()}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!unitOp) return;
            let id = "";
            const ok = run((p, actor) => {
              const r = addPoint(p, plan.id, { unitOp, type, ...(attribute.trim() ? { attribute: attribute.trim() } : {}) }, actor);
              id = r.pointId;
              return r.project;
            }, "Point added");
            if (ok) {
              setAttribute("");
              onSelect(id);
            }
          }}
        >
          <label className="field">
            <span>Process step</span>
            <select value={unitOp} onChange={(e) => setUnitOp(e.target.value)} data-testid={`add-step-${key}`}>
              <option value="">Choose</option>
              {steps.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>
              Attribute or test <span className="muted">(optional now)</span>
            </span>
            <input value={attribute} onChange={(e) => setAttribute(e.target.value)} data-testid={`add-attribute-${key}`} />
          </label>
          <button type="submit" className="btn" disabled={!unitOp} data-testid={`add-${key}`}>
            Add a {title.toLowerCase()} point
          </button>
        </form>
      )}
      {points.map((p) => (
        <PointCard key={p.id} plan={plan} point={p} step={labelOf(p.unitOp)} selected={selected === p.id} onSelect={onSelect} run={run} onRemove={() => onRemove(p)} />
      ))}
    </section>
  );
}
