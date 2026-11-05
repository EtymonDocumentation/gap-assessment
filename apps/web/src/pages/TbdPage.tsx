import { isOverdue, localDate, openReviewItems, TBD_DEFINITION, tbdItems, tbdSummary, tbdSummaryText } from "@gap/engine";
import { useMemo } from "react";
import { Empty } from "../components";
import { href } from "../router";
import { useAssessment, useContent, useStore } from "../store";
import { DOC_NAME, stageName, useRealProject } from "../version-ui";

/**
 * Every value recorded as TBD (to be decided), with its best guess, owner, due date and note. A TBD is a commitment to find
 * a value out, not a value: the list is how the team keeps track of what is still to be decided.
 */
export function TbdPage() {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const a = useAssessment()!;
  const items = useMemo(() => tbdItems(content, project, a), [content, project, a]);
  // Today's date is read when the page is drawn: overdue is a statement about now, so it is never stored.
  const today = localDate();
  const summary = tbdSummary(items, today);
  // Stage-review items are open items too: they stay here until each one is ticked. They live in the real project's history, which a saved
  // version being viewed does not carry, so this reads the real project.
  const real = useRealProject();
  const review = useMemo(() => (real ? openReviewItems(real) : []), [real]);

  return (
    <div className="stack-lg">
      <div>
        <h1>TBD (to be decided)</h1>
        <p className="muted">
          {TBD_DEFINITION} A best guess, when given, is compared as if it were established and every result that depends on it is labelled
          “Provisional — based on a TBD value”. A TBD cannot be verified.
        </p>
        <p role="status" className="tbd-summary">
          <strong>{tbdSummaryText(summary)}</strong>
        </p>
      </div>
      {review.length > 0 && (
        <section className="card stack" aria-labelledby="tbd-review-h" data-testid="tbd-stage-review">
          <h2 id="tbd-review-h">Stage review</h2>
          <p role="status" className="tbd-summary">
            <strong>
              {review.length} {review.length === 1 ? "item is" : "items are"} still to be reviewed after a change of the project stage.
            </strong>
          </p>
          <ul className="plain-list">
            {review.map(({ review: r, item }) => (
              <li key={`${r.id}-${item.key}`}>
                {DOC_NAME[item.doc]}: {item.title} <span className="muted">(after {r.fromStage ? `the change from ${stageName(r.fromStage)} to ${stageName(r.toStage)}` : `the stage was set to ${stageName(r.toStage)}`}, {r.versionLabel})</span>
              </li>
            ))}
          </ul>
          <p>
            <a href={href("/stage-review")}>Go to the stage review</a>
          </p>
        </section>
      )}
      {items.length === 0 ? (
        <Empty>No value is recorded as TBD.</Empty>
      ) : (
        <div className="table-scroll" role="region" aria-label="TBD values table" tabIndex={0}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Side</th>
                <th scope="col">Question</th>
                <th scope="col">Best guess</th>
                <th scope="col">Owner</th>
                <th scope="col">Due</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.ref}>
                  <td>{i.sideText}</td>
                  <th scope="row">
                    <a href={href("/interview", { q: `${i.questionId}@${i.side}` })}>{i.attribute}</a>
                    <div className="small muted normal">{i.sectionTitle}</div>
                  </th>
                  <td>{i.bestGuess ?? <span className="muted">No best guess</span>}</td>
                  <td>{i.owner ?? <span className="muted">Not set</span>}</td>
                  <td>
                    {i.due ?? <span className="muted">Not set</span>}
                    {isOverdue(i.due, today) && <span className="tag tag-overdue">Overdue</span>}
                  </td>
                  <td>{i.note ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
