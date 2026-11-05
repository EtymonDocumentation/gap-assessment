import { countedItems, reviewProgress, setReviewItemReviewed } from "@gap/engine";
import type { ReviewItem, StageReview } from "@gap/process-model";
import { useId, useState } from "react";
import { PageHeader } from "../PageHeader";
import { href } from "../router";
import { READ_ONLY_MESSAGE, useStore } from "../store";
import { dayOf, DOC_GO, DOC_NAME, REVIEW_DOCS, SaveVersionButton, stageName, useRealProject, useUnsaved } from "../version-ui";

/** "Clinical to PPQ", or "The project stage was set to Clinical" for the first time. */
const changeText = (r: StageReview) => (r.fromStage ? `${stageName(r.fromStage)} to ${stageName(r.toStage)}` : `Stage set to ${stageName(r.toStage)}`);

/**
 * One thing to look at: the real text before and after, what to check, a link to the place, and the tick. The tick is a free-text name
 * and a time, not a signature. Nothing is ticked for the person, and there is no "tick everything" button: reviewing means looking.
 */
function ReviewItemView({ review, item }: { review: StageReview; item: ReviewItem }) {
  const update = useStore((s) => s.update);
  const viewing = useStore((s) => !!s.viewing);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const boxId = useId();
  const noteId = useId();
  const carried = item.carried;
  const replaced = !!item.replaced;

  const tick = (on: boolean) => {
    const problem = update((p, actor) => setReviewItemReviewed(p, review.id, item.key, on, actor, on ? note : ""), on ? `Reviewed: ${item.title}` : `Reopened: ${item.title}`);
    setError(problem ?? "");
    if (!problem) setNote("");
  };

  return (
    <li className="review-item card stack" data-testid={`review-item-${item.key}`}>
      <h4>{item.title}</h4>
      {carried && (
        <p className="small">
          <span className="tag">Still open</span> Open since the change to {stageName(carried.sinceStage)} ({carried.sinceLabel}).
        </p>
      )}
      <div className="review-ba">
        <div>
          <p className="review-label">Before</p>
          <p className="review-text">{item.before}</p>
        </div>
        <div>
          <p className="review-label">After</p>
          <p className="review-text">{item.after}</p>
        </div>
      </div>
      <p>
        <strong>What to check:</strong> {item.check}
      </p>
      <p>
        <a href={href(item.link)}>{DOC_GO[item.doc]}</a>
      </p>
      {replaced ? (
        <p className="small muted">This item was carried into a later review. Tick it there.</p>
      ) : (
        <div className="stack review-tick">
          <div className="row wrap">
            <input id={boxId} type="checkbox" className="review-box" checked={!!item.reviewed} disabled={viewing} onChange={(e) => tick(e.target.checked)} aria-label={`Reviewed: ${item.title}`} />
            <label htmlFor={boxId}>Reviewed</label>
            {item.reviewed && (
              <span className="small">
                by {item.reviewed.by}, {dayOf(item.reviewed.at)}
                {item.reviewed.note ? `. Note: ${item.reviewed.note}` : ""}
              </span>
            )}
          </div>
          {!item.reviewed && (
            <label className="field" htmlFor={noteId}>
              <span>Note (optional)</span>
              <input id={noteId} type="text" maxLength={300} value={note} disabled={viewing} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {viewing && <p className="small muted">{READ_ONLY_MESSAGE}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** One review: the change, the progress, then a section per document. */
function ReviewBlock({ review }: { review: StageReview }) {
  const { done, total } = reviewProgress(review);
  const unsaved = useUnsaved();
  const counted = countedItems(review);
  const finished = total > 0 && done === total;
  const headId = useId();
  return (
    <section className="stack" aria-labelledby={headId} data-testid={`review-${review.versionLabel}`}>
      <h2 id={headId}>
        {changeText(review)} ({review.versionLabel})
      </h2>
      <p>
        <strong>Why:</strong> {review.reason || "No reason was given."}
        <br />
        <span className="muted">Changed by {review.by} on {dayOf(review.at)}.</span>
      </p>
      <p role="status" className="review-progress" data-testid="review-progress">
        <strong>
          {done} of {total} reviewed
        </strong>
      </p>
      {total === 0 && <p className="muted">This change left nothing in your documents to review.</p>}
      {REVIEW_DOCS.map((doc) => {
        const items = review.items.filter((i) => i.doc === doc);
        if (items.length === 0) return null;
        const mine = counted.filter((i) => i.doc === doc);
        return (
          <div key={doc} className="stack">
            <h3>
              {DOC_NAME[doc]}{" "}
              <span className="muted normal">
                ({mine.filter((i) => i.reviewed).length} of {mine.length} reviewed)
              </span>
            </h3>
            <ul className="plain-list review-list">
              {items.map((i) => (
                <ReviewItemView key={i.key} review={review} item={i} />
              ))}
            </ul>
          </div>
        );
      })}
      {finished && unsaved && (
        <div className="notice row wrap" data-testid="review-finished">
          <span>Save a version with the review finished?</span>
          <SaveVersionButton className="btn small">Save a version</SaveVersionButton>
        </div>
      )}
    </section>
  );
}

/**
 * The stage review: after the project stage changes, what the new stage changes in each document and what to look at. Each item stays open
 * until it is ticked. The newest review is shown first; earlier ones that are still open (or finished) are under "Earlier changes".
 */
export function StageReviewPage() {
  const project = useRealProject()!;
  const reviews = [...(project.versionHistory?.reviews ?? [])].reverse();
  const [latest, ...earlier] = reviews;
  const openEarlier = earlier.filter((r) => reviewProgress(r).done < reviewProgress(r).total).length;

  return (
    <div className="stack-lg stage-review-page">
      <PageHeader
        title="Stage review"
        purpose="After the project stage changes, look at each item below and tick it when you have checked it. Nothing is changed for you."
      />
      {!latest ? (
        <section className="card stack">
          <p className="muted" data-testid="review-none">
            No stage change has been made yet, so there is nothing to review. When you change the project stage, the items to check appear here.
          </p>
          <p>
            <a href={href("/versions")}>Go to the version history</a>
          </p>
        </section>
      ) : (
        <div className="card stack">
          <ReviewBlock review={latest} />
        </div>
      )}
      {earlier.length > 0 && (
        <section className="stack" aria-labelledby="earlier-h">
          <h2 id="earlier-h">Earlier changes ({earlier.length})</h2>
          {openEarlier > 0 && <p className="small muted">{openEarlier} of them still have items to review.</p>}
          {earlier.map((r) => {
            const p = reviewProgress(r);
            return (
              <details key={r.id} className="card" open={p.done < p.total}>
                <summary>
                  {changeText(r)} ({r.versionLabel}): {p.done} of {p.total} reviewed
                </summary>
                <ReviewBlock review={r} />
              </details>
            );
          })}
        </section>
      )}
      <p className="small">
        <a href={href("/versions")}>Version history</a>
      </p>
    </div>
  );
}
