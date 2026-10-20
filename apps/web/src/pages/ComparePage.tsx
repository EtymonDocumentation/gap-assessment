import { formatQuestionSide, questionLabel, sidesOf, type Gap } from "@gap/engine";
import { useState } from "react";
import { CategoryChip, Empty, RegulatoryFlag, SeverityBadge } from "../components";
import { href } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";

/** Source and target side by side, per section, with a comparison marker on each row. */
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
      <div className="row between wrap">
        <h1>Side by side</h1>
        <label className="row inline">
          <input type="checkbox" checked={hideEqual} onChange={(e) => setHideEqual(e.target.checked)} /> Hide equivalent rows
        </label>
      </div>
      <p className="small" data-testid="stage-line">
        <strong>Program stage:</strong> source {wording.sourceLabel}; target {wording.targetLabel}.
      </p>
      <p className="muted">
        Every visible question, with the source {wording.sourceValidated ? "validated" : "current"} state and the target planned state. Select a value to change it in the interview.
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
                    <th scope="col">{wording.sourceValidated ? "Source (validated)" : "Source (current)"}</th>
                    <th scope="col">Target (planned)</th>
                    <th scope="col">Comparison</th>
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
                                {g.subKey && <span className="small">{g.attribute.split(": ").pop()}</span>}
                              </a>
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
