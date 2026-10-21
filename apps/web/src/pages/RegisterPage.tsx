import { activityLabel, CATEGORIES, gapsToCsv, SEVERITY_RANK, setGapOverlay, type Category, type ContentBundle, type Gap } from "@gap/engine";
import { verificationState, type GapStatus, type Severity } from "@gap/process-model";
import { useEffect, useMemo, useState } from "react";
import { PageBanner } from "../art";
import { CategoryChip, Empty, ProvisionalFlag, RegulatoryFlag, SeverityBadge } from "../components";
import { categoryShort, download, SEVERITY_TEXT, slug, today } from "../lib";
import { href } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";

type SortKey = "id" | "severity" | "category" | "section" | "status";

const STATUS_TEXT: Record<GapStatus, string> = { open: "Open", in_progress: "In progress", closed: "Closed", accepted_no_action: "Accepted, no action" };

export function RegisterPage() {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  const focusKey = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("gap");
  const [showEqual, setShowEqual] = useState(false);
  const [cat, setCat] = useState<Category | "">("");
  const [sev, setSev] = useState<Severity | "">("");
  const [section, setSection] = useState("");
  const [status, setStatus] = useState<GapStatus | "">("");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 });
  const [open, setOpen] = useState<string | null>(focusKey);

  useEffect(() => {
    if (focusKey) {
      setShowEqual(true);
      document.getElementById(`gap-${focusKey}`)?.scrollIntoView({ block: "center" });
    }
  }, [focusKey]);

  const order = useMemo(() => new Map(a.gaps.map((g, i) => [g.key, i])), [a.gaps]);
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    const out = a.gaps.filter(
      (g) =>
        (showEqual || g.category !== "equivalent" || g.key === focusKey) &&
        (!cat || g.category === cat) &&
        (!sev || g.severity === sev) &&
        (!section || g.sectionId === section) &&
        (!status || g.status === status) &&
        (!t || [g.displayId, g.attribute, g.sourceDisplay, g.targetDisplay, g.detail, g.ruleId].some((s) => s.toLowerCase().includes(t))),
    );
    const cmp = (x: Gap, y: Gap): number => {
      switch (sort.key) {
        case "severity":
          return SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity] || order.get(x.key)! - order.get(y.key)!;
        case "category":
          return CATEGORIES.indexOf(x.category) - CATEGORIES.indexOf(y.category) || order.get(x.key)! - order.get(y.key)!;
        case "status":
          return x.status.localeCompare(y.status) || order.get(x.key)! - order.get(y.key)!;
        default:
          return order.get(x.key)! - order.get(y.key)!;
      }
    };
    return out.sort((x, y) => cmp(x, y) * sort.dir);
  }, [a.gaps, showEqual, cat, sev, section, status, text, sort, order, focusKey]);

  const counts = useMemo(() => {
    const m = new Map<Category, number>();
    for (const g of a.gaps) m.set(g.category, (m.get(g.category) ?? 0) + 1);
    return m;
  }, [a.gaps]);

  const sections = content.sections.filter((s) => a.gaps.some((g) => g.sectionId === s.id));
  const sortBtn = (key: SortKey, label: string) => (
    <button
      className="th-sort"
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</span>
    </button>
  );
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined);

  return (
    <div className="stack-lg">
      <PageBanner art="page-register">
        <h1>Gap register</h1>
      </PageBanner>
      <div className="row end wrap">
        <button className="btn" onClick={() => download(`${slug(project.meta.title)}-gap-register-${today()}.csv`, gapsToCsv(content, rows, project), "text/csv;charset=utf-8")}>
          Export CSV ({rows.length} rows)
        </button>
      </div>

      <ul className="cat-summary" aria-label="Count by category">
        {CATEGORIES.map((c) => (
          <li key={c}>
            <button className={`cat-filter${cat === c ? " active" : ""}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? "" : c)}>
              <CategoryChip category={c} />
              <span className="count">{counts.get(c) ?? 0}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="filters card tight" role="search">
        <label className="field compact">
          <span className="small">Search</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="ID, attribute, value, rule…" />
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
        <label className="field compact">
          <span className="small">Section</span>
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field compact">
          <span className="small">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as GapStatus | "")}>
            <option value="">All</option>
            {Object.entries(STATUS_TEXT).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="row inline small">
          <input type="checkbox" checked={showEqual} onChange={(e) => setShowEqual(e.target.checked)} /> Show equivalent
        </label>
      </div>

      {rows.length === 0 ? (
        <Empty>No rows match these filters.</Empty>
      ) : (
        <div className="table-scroll" role="region" aria-label="Gap register table" tabIndex={0}>
          <table className="data register">
            <caption className="visually-hidden">Gap register, {rows.length} rows</caption>
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSort("id")}>
                  {sortBtn("id", "ID")}
                </th>
                <th scope="col">Attribute</th>
                <th scope="col">SU</th>
                <th scope="col">RU</th>
                <th scope="col" aria-sort={ariaSort("category")}>
                  {sortBtn("category", "Category")}
                </th>
                <th scope="col" aria-sort={ariaSort("severity")}>
                  {sortBtn("severity", "Severity")}
                </th>
                <th scope="col" aria-sort={ariaSort("status")}>
                  {sortBtn("status", "Status")}
                </th>
                <th scope="col">
                  <span className="visually-hidden">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <GapRow key={g.key} g={g} open={open === g.key} onToggle={() => setOpen(open === g.key ? null : g.key)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function interviewKey(content: ContentBundle, questionId: string): string {
  const q = content.questionById.get(questionId);
  const side = !q ? "target" : q.sides === "paired" ? "target" : q.sides;
  return `${questionId}@${side}`;
}

function GapRow({ g, open, onToggle }: { g: Gap; open: boolean; onToggle: () => void }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const detailId = `gap-detail-${g.displayId}`;
  const verified = g.inputRefs.filter((r) => verificationState(project, r).state === "verified").length;
  return (
    <>
      <tr id={`gap-${g.key}`} className={open ? "open" : undefined}>
        <td className="nowrap">
          <strong>{g.displayId}</strong>
        </td>
        <td>
          {g.attribute}
          <div className="small muted">{g.sectionTitle}</div>
        </td>
        <td>{g.sourceDisplay}</td>
        <td>{g.targetDisplay}</td>
        <td>
          <CategoryChip category={g.category} /> <RegulatoryFlag gap={g} /> <ProvisionalFlag item={g} />
        </td>
        <td>
          <SeverityBadge severity={g.severity} />
          {g.severityOverride && <span className="small muted"> (adjusted)</span>}
        </td>
        <td className="nowrap">
          {STATUS_TEXT[g.status]}
          {g.owner && <div className="small muted">{g.owner}</div>}
        </td>
        <td>
          <button className="btn small" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
            {open ? "Hide" : "Details"}
            <span className="visually-hidden"> for {g.displayId}</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={8} id={detailId}>
            <div className="gap-detail">
              <div className="stack">
                <p>
                  <strong>Finding:</strong> {g.detail}
                </p>
                {g.provisional && (
                  <p>
                    <ProvisionalFlag item={g} /> This result uses a best guess recorded as TBD. It changes when the value is confirmed.
                  </p>
                )}
                <p>
                  <strong>Rationale:</strong> {g.rationale}
                </p>
                {g.regulatoryNote && <p className="reg-note">{g.regulatoryNote}</p>}
                <p>
                  <strong>Implied activities:</strong>{" "}
                  {g.activities.length ? g.activities.map((x) => activityLabel(content, x)).join("; ") : "None"}
                </p>
                <p className="small muted">
                  Rule {g.ruleId} v{g.ruleVersion} — {g.ruleTitle} · comparator {g.comparator} · rule severity {SEVERITY_TEXT[g.ruleSeverity]}
                  {g.severityNote ? ` · ${g.severityNote}` : ""}
                </p>
                <p className="small muted">
                  Inputs: {g.inputRefs.join(", ")} · {verified ? `${verified} of ${g.inputRefs.length} verified` : "Unverified"} ·{" "}
                  <a href={href("/interview", { q: interviewKey(content, g.questionId) })}>Open in interview</a>
                </p>
              </div>
              <OverlayEditor g={g} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function OverlayEditor({ g }: { g: Gap }) {
  const wording = useStageWording();
  const update = useStore((s) => s.update);
  const [owner, setOwner] = useState(g.owner ?? "");
  const [status, setStatus] = useState<GapStatus>(g.status);
  const [notes, setNotes] = useState(g.notes ?? "");
  const [sev, setSev] = useState<Severity | "">(g.severityOverride?.value ?? "");
  const [just, setJust] = useState(g.severityOverride?.justification ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="overlay-editor stack"
      aria-label={`Decisions for ${g.displayId}`}
      onSubmit={(e) => {
        e.preventDefault();
        const err = update(
          (p, actor) =>
            setGapOverlay(
              p,
              g.key,
              {
                owner,
                status,
                notes,
                severityOverride: sev && sev !== g.ruleSeverity ? { value: sev, justification: just } : null,
              },
              actor,
            ),
          `${g.displayId} updated`,
        );
        setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved." });
      }}
    >
      <label className="field compact">
        <span className="small">Owner</span>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} />
      </label>
      <label className="field compact">
        <span className="small">Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as GapStatus)}>
          {Object.entries(STATUS_TEXT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field compact">
        <span className="small">Severity (rule: {SEVERITY_TEXT[g.ruleSeverity]})</span>
        <select value={sev} onChange={(e) => setSev(e.target.value as Severity | "")}>
          <option value="">As per rule</option>
          {(["high", "medium", "low", "none"] as const).map((s) => (
            <option key={s} value={s}>
              {SEVERITY_TEXT[s]}
            </option>
          ))}
        </select>
      </label>
      {sev && sev !== g.ruleSeverity && (
        <label className="field compact">
          <span className="small">Justification for the severity change (required)</span>
          <textarea rows={2} value={just} onChange={(e) => setJust(e.target.value)} />
        </label>
      )}
      <label className="field compact">
        <span className="small">Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="row inline">
        <button type="submit" className="btn primary small">
          Save decisions
        </button>
        {msg && (
          <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "small ok" : "small error"}>
            {msg.text}
          </span>
        )}
      </div>
      <p className="small muted">{categoryShort(wording.sourceValidated)[g.category]} is derived from the answers and cannot be edited here; change the answer instead.</p>
    </form>
  );
}
