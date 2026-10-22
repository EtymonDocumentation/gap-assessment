import { formatQuestionSide, questionLabel, setGapOverlay, sidesOf, type Gap } from "@gap/engine";
import { useState } from "react";
import { PageBanner } from "../art";
import { CategoryChip, Empty, ProvisionalFlag, RegulatoryFlag, SeverityBadge } from "../components";
import { href } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";
import { GapRiskLinks } from "./RiskLinks";

/** SU and RU side by side, per section, with a comparison marker on each row and a note per gap. */
export function ComparePage() {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  const [hideEqual, setHideEqual] = useState(false);
  const wording = useStageWording();

  const sections = content.sections.filter((s) => s.kind !== "scoping" && a.instances.some((i) => i.section.id === s.id));
  const gapsByQ = new Map<string, Gap[]>();
  for (const g of a.gaps) gapsByQ.set(g.questionId, [...(gapsByQ.get(g.questionId) ?? []), g]);

  return (
    <div className="stack-lg">
      <PageBanner art="page-compare">
        <h1>Side by side</h1>
      </PageBanner>
      <div className="row between wrap">
        <label className="row inline">
          <input type="checkbox" checked={hideEqual} onChange={(e) => setHideEqual(e.target.checked)} /> Hide equivalent rows
        </label>
      </div>
      <p className="small" data-testid="stage-line">
        <strong>Program stage:</strong> sending unit (SU) {wording.sourceLabel}; receiving unit (RU) {wording.targetLabel}.
      </p>
      <p className="muted">
        Every visible question, with the sending unit (SU) {wording.sourceValidated ? "validated" : "current"} state and the receiving unit (RU) planned state. Select a value to change it in the interview. Add a note to a difference here; it appears in the Notes column of the document.
      </p>
      {sections.length === 0 && <Empty>No unit operations are in scope yet. Answer the scoping questions first.</Empty>}
      {sections.map((sec) => {
        const qs = [...new Map(a.instances.filter((i) => i.section.id === sec.id).map((i) => [i.question.id, i.question])).values()];
        const rows = qs.filter((q) => {
          const gs = gapsByQ.get(q.id) ?? [];
          return !hideEqual || !gs.length || gs.some((g) => g.category !== "equivalent");
        });
        if (!rows.length) return null;
        return (
          <section key={sec.id} aria-labelledby={`cmp-${sec.id}`} className="card">
            <h2 id={`cmp-${sec.id}`}>{sec.title}</h2>
            <div className="table-scroll" role="region" aria-label={`${sec.title}, side by side`} tabIndex={0}>
              <table className="data compare">
                <thead>
                  <tr>
                    <th scope="col">Attribute</th>
                    <th scope="col">{wording.sourceValidated ? "SU (validated)" : "SU (current)"}</th>
                    <th scope="col">RU (planned)</th>
                    <th scope="col">Comparison</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((q) => {
                    const sides = sidesOf(q);
                    const gs = gapsByQ.get(q.id) ?? [];
                    const diff = gs.some((g) => g.category !== "equivalent" && g.category !== "information_required");
                    const vis = (side: "source" | "target") => a.instances.some((i) => i.question.id === q.id && i.side === side);
                    const cell = (side: "source" | "target") =>
                      sides.includes(side) && vis(side) ? (
                        <a href={href("/interview", { q: `${q.id}@${side}` })}>{formatQuestionSide(content, project, q, side)}</a>
                      ) : (
                        <span className="muted" title="Not asked on this side">
                          —
                        </span>
                      );
                    return (
                      <tr key={q.id} className={diff ? "row-diff" : undefined}>
                        <th scope="row">
                          {q.parent && <span aria-hidden="true">↳ </span>}
                          {questionLabel(q)}
                        </th>
                        <td>{cell("source")}</td>
                        <td>{cell("target")}</td>
                        <td>
                          <div className="markers">
                            {gs.length === 0 && <span className="muted small">Not compared</span>}
                            {gs.map((g) => (
                              <a key={g.key} href={href("/register", { gap: g.key })} className="marker" title={g.detail}>
                                <CategoryChip category={g.category} compact />
                                {g.category !== "equivalent" && <SeverityBadge severity={g.severity} />}
                                <RegulatoryFlag gap={g} />
                                <ProvisionalFlag item={g} />
                                {g.subKey && <span className="small">{g.attribute.split(": ").pop()}</span>}
                              </a>
                            ))}
                          </div>
                          {gs.filter((g) => g.category !== "equivalent").map((g) => (
                            <div key={g.key}>
                              <GapRiskLinks gapId={g.displayId} />
                            </div>
                          ))}
                        </td>
                        <td>
                          <div className="stack">
                            {gs.map((g) => (
                              <NoteCell key={g.key} g={g} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The note on one gap: shown when there is one, and edited in place for a difference. Same overlay as the owner and status on the Register page. */
function NoteCell({ g }: { g: Gap }) {
  const update = useStore((s) => s.update);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(g.notes ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = g.category !== "equivalent";
  const id = `note-${g.displayId}`;
  if (!editable && !g.notes) return <span className="muted">—</span>;
  return (
    <div className="note-cell">
      {g.notes ? (
        <p className="note-text">
          <span className="small muted">{g.displayId}: </span>
          {g.notes}
        </p>
      ) : (
        <span className="small muted">{g.displayId}: no note</span>
      )}
      {editable && !editing && (
        <button
          className="btn small"
          aria-expanded={false}
          aria-controls={id}
          onClick={() => {
            setText(g.notes ?? "");
            setMsg(null);
            setEditing(true);
          }}
        >
          {g.notes ? "Edit note" : "Add note"}
          <span className="visually-hidden"> for {g.displayId}</span>
        </button>
      )}
      {editable && editing && (
        <form
          id={id}
          className="stack"
          aria-label={`Note for ${g.displayId}`}
          onSubmit={(e) => {
            e.preventDefault();
            const err = update((p, actor) => setGapOverlay(p, g.key, { notes: text }, actor), `Note for ${g.displayId} saved`);
            if (err) setMsg({ ok: false, text: err });
            else {
              setMsg(null);
              setEditing(false);
            }
          }}
        >
          <label className="field compact">
            <span className="small">Note for {g.displayId}</span>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="row inline">
            <button type="submit" className="btn primary small">
              Save note<span className="visually-hidden"> for {g.displayId}</span>
            </button>
            <button type="button" className="btn small" onClick={() => setEditing(false)}>
              Cancel<span className="visually-hidden"> note for {g.displayId}</span>
            </button>
          </div>
          {msg && (
            <span role="alert" className="small error">
              {msg.text}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
