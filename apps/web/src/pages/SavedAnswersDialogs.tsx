import { applySavedSet, buildSavedSet, reviewSavedSet, savedDay, type ReviewRow, type SetSides } from "@gap/engine";
import type { SavedAnswerSet } from "@gap/process-model";
import { useEffect, useId, useMemo, useState } from "react";
import { Modal } from "../components";
import { SIDE_SHORT } from "../lib";
import { href } from "../router";
import { newSetId, useSavedAnswers } from "../saved-answers-store";
import { useContent, useStore } from "../store";

/** "SU", "RU" or "SU and RU" for a set's units. */
export const setSidesText = (s: SetSides): string => (s === "both" ? "SU and RU" : SIDE_SHORT[s]);

const SIDE_CHOICES: { value: SetSides; label: string }[] = [
  { value: "source", label: "Sending unit (SU) answers only" },
  { value: "target", label: "Receiving unit (RU) answers only" },
  { value: "both", label: "Both units (SU and RU)" },
];

/**
 * Saves the open project's interview answers as a named set. The author chooses the unit(s); nothing is chosen for them. The dialog says
 * how many answers will be saved and how many were left out (TBD and "same as SU"), so a missing answer is never a surprise later.
 */
export function SaveAnswersDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: (set: SavedAnswerSet) => void }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const save = useSavedAnswers((s) => s.save);
  const [name, setName] = useState("");
  const [sides, setSides] = useState<SetSides | "">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const errId = useId();
  // Counted from the project as it is, for the chosen unit(s); the id and time here are placeholders for the count only.
  const preview = useMemo(() => (sides ? buildSavedSet(content, project, { name: "preview", sides, savedAt: "", id: "preview" }) : null), [content, project, sides]);

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("Give the set a name.");
    if (!sides) return setError("Choose which unit's answers to include.");
    const { set, skipped } = buildSavedSet(content, project, { name, sides, savedAt: new Date().toISOString(), id: newSetId() });
    if (set.answers.length === 0) return setError("Nothing is answered yet for that choice, so there is nothing to save.");
    setBusy(true);
    try {
      const saved = await save(set);
      const left = skipped.tbd + skipped.sameAsSource;
      useStore.setState({ status: `Saved answers "${saved.name}": ${saved.answers.length} ${saved.answers.length === 1 ? "answer" : "answers"} (${setSidesText(saved.sides)})${left ? `; ${left} left out` : ""}.` });
      onSaved?.(saved);
      onClose();
    } catch {
      setError("The set could not be saved. The reason is shown at the top of the page.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Save these answers" description="Keeps this project's interview answers as a named set that you can offer to another project.">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>Name of the set (required)</span>
          <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={200} autoFocus aria-describedby={error ? errId : undefined} data-testid="sa-save-name" />
        </label>
        <fieldset className="stack">
          <legend>Which answers to include (required)</legend>
          {SIDE_CHOICES.map((c) => (
            <label key={c.value} className="check">
              <input type="radio" name="sa-sides" value={c.value} checked={sides === c.value} onChange={() => { setSides(c.value); setError(""); }} data-testid={`sa-side-${c.value}`} />
              <span>{c.label}</span>
            </label>
          ))}
        </fieldset>
        {preview && (
          <p className="small" role="status" data-testid="sa-save-preview">
            {preview.set.answers.length} {preview.set.answers.length === 1 ? "answer" : "answers"} will be saved.
            {preview.skipped.tbd + preview.skipped.sameAsSource > 0 &&
              ` Left out: ${preview.skipped.tbd} TBD, ${preview.skipped.sameAsSource} "same as SU". A set holds only answers that state something.`}
          </p>
        )}
        <p className="small muted">Questions that are still open, and the scoping answers that decide which questions a project asks, are not saved.</p>
        {error && (
          <p id={errId} className="error" role="alert" data-testid="sa-save-error">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="sa-save-submit">
            Save answers
          </button>
        </div>
      </form>
    </Modal>
  );
}

const keysReady = (rows: ReviewRow[]) => new Set(rows.filter((r) => r.state === "ready").map((r) => r.key));

/**
 * Applies a saved set to the open project, always through a review: every answer of the set is listed with its saved value, ticked,
 * and the author unticks what they do not want. A row whose question already has a different answer in this project says so and shows
 * both values. Questions this project does not ask are listed as "not asked in this project" and skipped. Nothing is written until
 * the author presses Apply.
 */
export function ApplyAnswersDialog({ initialId, onClose, onApplied }: { initialId?: string; onClose: () => void; onApplied?: (applied: number) => void }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const items = useSavedAnswers((s) => s.items);
  const ready = useSavedAnswers((s) => s.ready);
  const load = useSavedAnswers((s) => s.load);
  useEffect(() => void load(), [load]);

  const [setId, setSetId] = useState(initialId ?? "");
  const set = items.find((x) => x.id === setId);
  const rows = useMemo(() => (set ? reviewSavedSet(content, project, set) : []), [content, project, set]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  // Every applicable row starts ticked (the product owner's decision): the author unticks, rather than ticks, what they do not want.
  useEffect(() => setTicked(keysReady(rows)), [setId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const applicable = rows.filter((r) => r.state === "ready");
  const skipped = rows.filter((r) => r.state !== "ready");
  const chosen = applicable.filter((r) => ticked.has(r.key));
  const overwrites = chosen.filter((r) => r.existing === "different" || r.existing === "tbd").length;

  const apply = () => {
    if (!set) return;
    setError("");
    let result = { applied: 0, failed: [] as { key: string; message: string }[] };
    const err = update((p, actor) => {
      const r = applySavedSet(p, content, set, ticked, actor);
      result = r;
      return r.project;
    }, "Saved answers applied");
    if (err) return setError(err);
    useStore.setState({
      status: `Applied ${result.applied} ${result.applied === 1 ? "answer" : "answers"} from "${set.name}".${result.failed.length ? ` ${result.failed.length} could not be applied.` : ""}`,
    });
    onApplied?.(result.applied);
    onClose();
  };

  const toggle = (key: string, on: boolean) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <Modal wide open onOpenChange={(o) => !o && onClose()} title="Apply saved answers" description="Choose a set, then untick any answer you do not want. Nothing is applied until you press Apply.">
      <div className="stack">
        {ready && items.length === 0 ? (
          <p className="notice">
            You have no saved answer sets yet. Save one from a project that is answered, or import a file, on the <a href={href("/saved-answers")}>Saved answers</a> page.
          </p>
        ) : (
          <label className="field">
            <span>Saved set</span>
            <select value={setId} onChange={(e) => setSetId(e.target.value)} data-testid="sa-apply-set" autoFocus>
              <option value="">Choose a set</option>
              {items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({setSidesText(s.sides)}, saved {savedDay(s.savedAt)})
                </option>
              ))}
            </select>
          </label>
        )}

        {set && (
          <>
            <p className="small" role="status" data-testid="sa-apply-summary">
              {set.answers.length} {set.answers.length === 1 ? "answer" : "answers"} in this set, saved {savedDay(set.savedAt)} from {set.sourceProject || "another project"}. {applicable.length} can be applied here
              {skipped.length ? `; ${skipped.length} cannot` : ""}. {chosen.length} ticked{overwrites ? `, ${overwrites} of them replace${overwrites === 1 ? "s" : ""} an answer this project already has` : ""}.
            </p>
            {applicable.length > 0 && (
              <div className="row wrap">
                <button type="button" className="btn small" onClick={() => setTicked(keysReady(rows))} data-testid="sa-tick-all">
                  Tick all
                </button>
                <button type="button" className="btn small" onClick={() => setTicked(new Set())} data-testid="sa-untick-all">
                  Untick all
                </button>
              </div>
            )}
            {applicable.length > 0 && (
              <ul className="sa-list" aria-label="Answers that can be applied">
                {applicable.map((r) => (
                  <li key={r.key} className="sa-row" data-testid={`sa-row-${r.key}`}>
                    <label className="check">
                      <input type="checkbox" checked={ticked.has(r.key)} onChange={(e) => toggle(r.key, e.target.checked)} />
                      <span>
                        <strong>{r.label}</strong> <span className="tag">{SIDE_SHORT[r.answer.side]}</span>
                        {r.sectionTitle && <span className="small muted"> {r.sectionTitle}</span>}
                      </span>
                    </label>
                    <p className="small sa-line">
                      <span className="muted">Saved answer: </span>
                      {r.savedText}
                    </p>
                    {r.existing === "different" && (
                      <p className="notice small sa-warn" data-testid={`sa-differs-${r.key}`}>
                        <strong>This project already has a different answer.</strong> Now: {r.existingText}. Saved set: {r.savedText}. Applying replaces the current answer; the old one stays in the change log.
                      </p>
                    )}
                    {r.existing === "tbd" && (
                      <p className="notice small sa-warn" data-testid={`sa-differs-${r.key}`}>
                        <strong>This project has this as TBD.</strong> Now: {r.existingText}. Applying replaces it with the saved answer.
                      </p>
                    )}
                    {r.existing === "same" && <p className="small muted sa-line">This project already has this answer.</p>}
                  </li>
                ))}
              </ul>
            )}
            {skipped.length > 0 && (
              <details className="stack" data-testid="sa-skipped">
                <summary>Not applied ({skipped.length}): not asked in this project, or no longer fitting</summary>
                <ul className="sa-list" aria-label="Answers that are skipped">
                  {skipped.map((r) => (
                    <li key={r.key} className="sa-row" data-testid={`sa-skip-${r.key}`}>
                      <p>
                        <strong>{r.label}</strong> <span className="tag">{SIDE_SHORT[r.answer.side]}</span>
                      </p>
                      <p className="small sa-line">
                        <span className="muted">Saved answer: </span>
                        {r.savedText}
                      </p>
                      <p className="small muted sa-line">{r.state === "not_asked" ? "Not asked in this project, so it is skipped." : `Cannot be applied here: ${r.problem}`}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {error && (
          <p className="error" role="alert" data-testid="sa-apply-error">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!set || chosen.length === 0} onClick={apply} data-testid="sa-apply-submit">
            Apply {chosen.length} {chosen.length === 1 ? "answer" : "answers"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

