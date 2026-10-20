import { changeLogOptions, changeLogToCsv, changeLogView } from "@gap/engine";
import { useMemo, useState } from "react";
import { Empty } from "../components";
import { download, slug, today } from "../lib";
import { useContent, useStore } from "../store";

/** Every change made to the project, newest first, with who made it and the value before and after. */
export function ChangesPage() {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [section, setSection] = useState("");
  const [text, setText] = useState("");

  const options = useMemo(() => changeLogOptions(content, project), [content, project]);
  const filter = useMemo(
    () => ({ ...(actor ? { actor } : {}), ...(action ? { action } : {}), ...(section ? { section } : {}), ...(text.trim() ? { text } : {}) }),
    [actor, action, section, text],
  );
  const rows = useMemo(() => changeLogView(content, project, filter), [content, project, filter]);
  const filtered = Object.keys(filter).length > 0;

  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div>
          <h1>Change log</h1>
          <p className="muted">
            Every change to the project, newest first: answers, sources, verifications and gap decisions, each with the value before and after. Names are free
            text without a login, so they are not attributable in a GMP sense.
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => download(`${slug(project.meta.title)}-change-log-${today()}.csv`, changeLogToCsv(content, project, filter), "text/csv;charset=utf-8")}
        >
          Export CSV{filtered ? " (filtered)" : ""}
        </button>
      </div>

      <div className="filters" role="search" aria-label="Filter the change log">
        <label className="field">
          <span>Actor</span>
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">All actors</option>
            {options.actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Action</span>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {options.actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Section</span>
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All sections</option>
            {options.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Filter by text</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. verified, DEMO-PPQ, mixing" />
        </label>
        <p className="small muted filter-count" role="status" aria-live="polite">
          {rows.length} {rows.length === 1 ? "change" : "changes"} shown
        </p>
      </div>

      {rows.length === 0 ? (
        <Empty>No changes match the filter.</Empty>
      ) : (
        <div className="table-scroll" role="region" aria-label="Change log table" tabIndex={0}>
          <table className="data change-table">
            <thead>
              <tr>
                <th scope="col">No.</th>
                <th scope="col">Time</th>
                <th scope="col">Actor</th>
                <th scope="col">Change</th>
                <th scope="col">Subject</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no}>
                  <td className="small">{r.no}</td>
                  <td className="small">{r.time}</td>
                  <td className="small">{r.by}</td>
                  <th scope="row" className="normal wrap-text">
                    {r.actionLabel}
                  </th>
                  <td className="small wrap-text">
                    {r.subject}
                    {r.sectionTitle && <div className="muted">{r.sectionTitle}</div>}
                  </td>
                  <td className="small wrap-text">{r.before || "—"}</td>
                  <td className="small wrap-text">{r.after || "—"}</td>
                  <td className="small wrap-text">{r.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
