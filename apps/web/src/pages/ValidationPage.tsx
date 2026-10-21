import {
  buildEquipmentQualification,
  buildValidationPlan,
  equipmentQualificationToCsv,
  READINESS_LABEL,
  READINESS_ORDER,
  stageBasis,
  validationPlanToCsv,
  type EquipmentRow,
  type LinkedGap,
  type PlanRow,
  type Readiness,
} from "@gap/engine";
import type { GapStatus, Severity } from "@gap/process-model";
import { useMemo, useState } from "react";
import { PageBanner } from "../art";
import { CategoryChip, Empty, ProvisionalFlag, SeverityBadge } from "../components";
import { download, SEVERITY_TEXT, slug, today } from "../lib";
import { href } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";

const STATUS_TEXT: Record<GapStatus, string> = { open: "Open", in_progress: "In progress", closed: "Closed", accepted_no_action: "Accepted, no action" };

/** Glyphs are decoration; the label is always shown beside them. */
const READINESS_ICON: Record<Readiness, string> = {
  evidence_available: "✓",
  planned: "◔",
  bridging_required: "◐",
  not_planned: "✕",
  information_required: "?",
  no_study: "–",
};

function ReadinessTag({ readiness }: { readiness: Readiness }) {
  return (
    <span className={`ready ready-${readiness}`}>
      <span aria-hidden="true" className="ready-icon">
        {READINESS_ICON[readiness]}
      </span>
      {READINESS_LABEL[readiness]}
    </span>
  );
}

function GapLinks({ gaps }: { gaps: LinkedGap[] }) {
  if (!gaps.length) return <span className="muted">—</span>;
  return (
    <ul className="plain-list link-list">
      {gaps.map((g) => (
        <li key={g.key}>
          <a href={href("/register", { gap: g.key })}>
            <strong>{g.displayId}</strong>
            <span className="visually-hidden"> {g.attribute}</span>
          </a>{" "}
          <CategoryChip category={g.category} />
          {g.status !== "open" && <span className="small muted"> ({STATUS_TEXT[g.status]})</span>}
        </li>
      ))}
    </ul>
  );
}

export function ValidationPage() {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  const plan = useMemo(() => buildValidationPlan(content, project, a), [content, project, a]);
  const equipment = useMemo(() => buildEquipmentQualification(content, project, a), [content, project, a]);

  const basis = stageBasis(useStageWording());
  const [ready, setReady] = useState<Readiness | "">("");
  const [sev, setSev] = useState<Severity | "">("");
  const [text, setText] = useState("");

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return plan.filter(
      (r) =>
        (!ready || r.readiness === ready) &&
        (!sev || r.severity === sev) &&
        (!t || [r.label, r.description, ...r.gaps.map((g) => g.displayId), ...r.studies.map((s) => `${s.label} ${s.uoLabel}`)].some((s) => s.toLowerCase().includes(t))),
    );
  }, [plan, ready, sev, text]);

  const name = slug(project.meta.title);
  return (
    <div className="stack-lg">
      <PageBanner art="page-validation">
        <h1>Validation</h1>
      </PageBanner>
      <p className="lede muted">
        What the differences in the gap register imply for validation, and how the receiving unit (RU) equipment is qualified. Everything here is derived from the answers; nothing is assumed.
      </p>

      <section className="stack" aria-labelledby="plan-h">
        <div className="row between wrap">
          <h2 id="plan-h">Validation plan</h2>
          <button className="btn" disabled={!rows.length} onClick={() => download(`${name}-validation-plan-${today()}.csv`, validationPlanToCsv(rows), "text/csv;charset=utf-8")}>
            Export CSV ({rows.length} rows)
          </button>
        </div>

        <section className="card tight stack" aria-labelledby="stage-basis-h">
          <h3 id="stage-basis-h">Stage basis</h3>
          <p>{basis.statement}</p>
          <ul>
            <li>{basis.sourcePoint}</li>
            <li>{basis.targetPoint}</li>
          </ul>
          <p className="small muted">{basis.closing}</p>
        </section>

        {plan.length === 0 ? (
          <Empty>No validation activities implied yet. Answer the interview or load the demo.</Empty>
        ) : (
          <>
            <div className="filters card tight" role="search" aria-label="Filter the validation plan">
              <label className="field compact">
                <span className="small">Search</span>
                <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Activity, gap ID, study…" />
              </label>
              <label className="field compact">
                <span className="small">Readiness</span>
                <select value={ready} onChange={(e) => setReady(e.target.value as Readiness | "")}>
                  <option value="">All</option>
                  {READINESS_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {READINESS_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field compact">
                <span className="small">Severity</span>
                <select value={sev} onChange={(e) => setSev(e.target.value as Severity | "")}>
                  <option value="">All</option>
                  {(["high", "medium", "low", "none"] as const).map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_TEXT[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {rows.length === 0 ? (
              <Empty>No activities match these filters.</Empty>
            ) : (
              <div className="table-scroll" role="region" aria-label="Validation plan table" tabIndex={0}>
                <table className="data validation-plan">
                  <caption className="visually-hidden">Validation plan, {rows.length} activities, most severe first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Activity</th>
                      <th scope="col">Implied by gaps</th>
                      <th scope="col">Linked studies</th>
                      <th scope="col">Readiness</th>
                      <th scope="col">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <PlanRowView key={r.activityKey} r={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="stack" aria-labelledby="equip-h">
        <div className="row between wrap">
          <h2 id="equip-h">Equipment qualification</h2>
          <button
            className="btn"
            disabled={!equipment.length}
            onClick={() => download(`${name}-equipment-qualification-${today()}.csv`, equipmentQualificationToCsv(equipment), "text/csv;charset=utf-8")}
          >
            Export CSV ({equipment.length} rows)
          </button>
        </div>
        {equipment.length === 0 ? (
          <Empty>No equipment qualification information yet. Answer the equipment qualification questions in the interview, or load the demo.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Equipment qualification table" tabIndex={0}>
            <table className="data equipment-qualification">
              <caption className="visually-hidden">Equipment qualification, {equipment.length} items</caption>
              <thead>
                <tr>
                  <th scope="col">Unit operation</th>
                  <th scope="col">Equipment</th>
                  <th scope="col">SU status</th>
                  <th scope="col">RU status</th>
                  <th scope="col">Qualified range vs required</th>
                  <th scope="col">Gaps</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((e) => (
                  <EquipmentRowView key={`${e.uoKey}.${e.equipKey}`} e={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PlanRowView({ r }: { r: PlanRow }) {
  return (
    <tr id={`activity-${r.activityKey}`}>
      <th scope="row">
        {r.label}
        <ProvisionalFlag item={r} />
        <div className="small muted normal">{r.description}</div>
        {r.stageNote && <div className="small muted normal">Program stage: {r.stageNote}</div>}
        {r.openGaps === 0 && <div className="small muted normal">All implying gaps are closed or accepted.</div>}
      </th>
      <td>
        <GapLinks gaps={r.gaps} />
      </td>
      <td>
        {r.studies.length === 0 ? (
          <span className="muted">No study linked</span>
        ) : (
          <ul className="plain-list">
            {r.studies.map((s) => (
              <li key={`${s.uoKey}.${s.key}`}>
                <strong>{s.label}</strong> <span className="small muted">({s.uoLabel})</span>
                <div className="small">
                  SU: {s.source.display} · RU: {s.target.display}
                </div>
                {s.details.map((d) => (
                  <div className="small muted" key={d.label}>
                    {d.label}: SU {d.source.display}, RU {d.target.display}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        <ReadinessTag readiness={r.readiness} />
        {r.openItems > 0 && (
          <div className="small muted">
            {r.openItems} open information {r.openItems === 1 ? "item" : "items"}
          </div>
        )}
      </td>
      <td>
        <SeverityBadge severity={r.severity} />
        {r.regulatoryNote && (
          <div className="small reg-note">
            <span className="reg">RA</span> {r.regulatoryNote}
          </div>
        )}
      </td>
    </tr>
  );
}

function EquipmentRowView({ e }: { e: EquipmentRow }) {
  return (
    <tr>
      <td>{e.uoLabel}</td>
      <th scope="row">
        {e.equipLabel}
        {e.custom && <span className="tag tag-custom">Custom</span>}
      </th>
      <td>{e.source.display}</td>
      <td>{e.target.display}</td>
      <td>
        {e.ranges.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul className="plain-list">
            {e.ranges.map((x) => (
              <li key={x.attribute}>
                <strong>{x.attribute}</strong>
                <div className="small">Qualified (RU): {x.qualified.display}</div>
                <div className="small">{x.required ? `Required: ${x.required.display} (${x.required.basis})` : "Required: not derived from the rules"}</div>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        <GapLinks gaps={e.gaps} />
      </td>
    </tr>
  );
}
