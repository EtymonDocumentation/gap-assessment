import { formatValue, STATUS_TEXT } from "@gap/engine";
import { allEntries, verificationState, type Entry, type Project, type Source } from "@gap/process-model";
import { useMemo, useState } from "react";
import { Empty } from "../components";
import { content, useAssessment, useStore } from "../store";

function entryText(project: Project, e: Entry): string {
  if (e.sameAsSource) return "Same as source";
  if (e.status === "established" && e.value !== undefined) return formatValue(content, undefined, e.value);
  if (e.status === "not_applicable") return `Not applicable: ${e.justification ?? ""}`;
  void project;
  return STATUS_TEXT[e.status as keyof typeof STATUS_TEXT] ?? e.status;
}

function sourceText(s: Source | undefined): string {
  if (!s) return "(missing source)";
  if (s.type === "document_reference") return s.docRef?.identifier ?? s.label;
  if (s.type === "interview_answer") return `Interview, ${s.responder?.name ?? "?"}, ${s.date.slice(0, 10)}${s.supersededBy ? " (superseded)" : ""}`;
  return s.label;
}

/** Read-only view of the structured model: every entry with its status, sources and verification. */
export function ModelPage() {
  const project = useStore((s) => s.project)!;
  const a = useAssessment()!;
  const [filter, setFilter] = useState("");
  const sources = useMemo(() => new Map(project.sources.map((s) => [s.id, s])), [project.sources]);
  const inactive = new Set(a.inactive.map((e) => e.path));
  const entries = [...allEntries(project)].filter((e) => !filter || e.path.includes(filter.trim()));

  return (
    <div className="stack-lg">
      <h1>Model</h1>
      <p className="muted">
        The structured process model behind the interview. Every value is an entry with a status and at least one source. Editing happens in the
        interview in this version; an editable builder comes later.
      </p>
      <dl className="stats card tight">
        <div>
          <dt>Entries</dt>
          <dd>{[...allEntries(project)].length}</dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd>{project.sources.length}</dd>
        </div>
        <div>
          <dt>Change log events</dt>
          <dd>{project.changeLog.length}</dd>
        </div>
        <div>
          <dt>Inactive answers</dt>
          <dd>{a.inactive.length}</dd>
        </div>
      </dl>
      <label className="field compact">
        <span className="small">Filter by path</span>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. target.uo.aseptic_filling" />
      </label>
      {entries.length === 0 ? (
        <Empty>No entries yet.</Empty>
      ) : (
        <div className="table-scroll" role="region" aria-label="Model entries table" tabIndex={0}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Value or status</th>
                <th scope="col">Sources</th>
                <th scope="col">Verification</th>
                <th scope="col">Revision</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const v = verificationState(project, e.path);
                return (
                  <tr key={e.id} className={inactive.has(e.path) ? "inactive" : undefined}>
                    <td>
                      <code>{e.path}</code>
                      {inactive.has(e.path) && <div className="small tag">Inactive — question no longer applies</div>}
                    </td>
                    <td>{entryText(project, e)}</td>
                    <td className="small">{e.sourceIds.map((id) => sourceText(sources.get(id))).join("; ")}</td>
                    <td className="small">{v.state === "verified" ? `Verified by ${v.by}` : v.state === "withdrawn" ? "Withdrawn (value changed)" : "Unverified"}</td>
                    <td className="small">{e.revision}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
