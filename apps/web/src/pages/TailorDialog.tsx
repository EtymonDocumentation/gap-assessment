import { excludeTopic, includeTopic, isTopicExcluded, topicEntryCount, topicsOfUo } from "@gap/engine";
import { useRef, useState } from "react";
import { Modal } from "../components";
import { useContent, useStore } from "../store";

/**
 * "Tailor this section": switch topics of a unit-operation section off when the process does not have them.
 * GMP reason: leaving a topic out of a gap assessment is a scope decision, so the change is logged (who, when) and the
 * document scope lists it. A reason is offered but optional; without one the document says "No reason recorded". Nothing is deleted: recorded values stay as inactive entries and come back when the
 * topic is switched on again. The default (nothing switched off) is the most conservative choice.
 */

/** The topics of a section, or an empty list when it cannot be tailored (scoping, site and custom sections). */
export function useTailorTopics(sectionId: string) {
  const content = useContent();
  const uo = content.sectionById.get(sectionId)?.kind === "uo" ? content.sectionById.get(sectionId)?.uo : undefined;
  return { uo, topics: uo ? topicsOfUo(content, uo) : [] };
}

export function TailorButton({ sectionId, className = "btn ghost" }: { sectionId: string; className?: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { uo, topics } = useTailorTopics(sectionId);
  const project = useStore((s) => s.project)!;
  const [open, setOpen] = useState(false);
  if (!uo || topics.length === 0) return null;
  const off = topics.filter((t) => isTopicExcluded(project, uo, t.key)).length;
  return (
    <>
      <button type="button" ref={buttonRef} className={className} onClick={() => setOpen(true)} data-testid="tailor-open">
        Tailor this section{off > 0 ? ` (${off} left out)` : ""}
      </button>
      {open && <TailorDialog uo={uo} onClose={() => setOpen(false)} restoreFocus={() => buttonRef.current} />}
    </>
  );
}

function TailorDialog({ uo, onClose, restoreFocus }: { uo: string; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  const topics = topicsOfUo(content, uo);
  const uoLabel = content.catalog.unitOperations.find((u) => u.key === uo)?.label ?? uo;
  // What the dialog would change: topics ticked off with their reason, and topics already off that are ticked on again.
  const [wantOff, setWantOff] = useState<Record<string, boolean>>(() => Object.fromEntries(topics.map((t) => [t.key, isTopicExcluded(project, uo, t.key)])));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const newlyOff = topics.filter((t) => wantOff[t.key] && !isTopicExcluded(project, uo, t.key));
  const newlyOn = topics.filter((t) => !wantOff[t.key] && isTopicExcluded(project, uo, t.key));

  function save() {
    const err = update((p, actor) => {
      let cur = p;
      for (const t of newlyOn) cur = includeTopic(content, cur, uo, t.key, actor);
      for (const t of newlyOff) cur = excludeTopic(content, cur, uo, t.key, reasons[t.key], actor);
      return cur;
    }, "Scope of the section changed");
    if (err) {
      setError(err);
      return;
    }
    useStore.setState({ status: `Scope of ${uoLabel} changed: ${newlyOff.length} topic(s) left out, ${newlyOn.length} switched on again. It is in the change log.` });
    onClose();
  }

  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`Tailor ${uoLabel}`}
      description="Every topic is included unless you switch it off. A topic that is left out is hidden, is not compared, and is listed with its reason in the document scope."
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <ul className="tailor-list" aria-label="Topics of this section">
          {topics.map((t) => {
            const existing = project.tailoring.excluded.find((x) => x.uo === uo && x.topic === t.key);
            const kept = topicEntryCount(content, project, uo, t.key);
            const off = wantOff[t.key];
            const id = `tailor-${t.key}`;
            return (
              <li key={t.key} className={off ? "tailor-item is-off" : "tailor-item"}>
                <label className="check top">
                  <input
                    type="checkbox"
                    checked={!off}
                    onChange={(e) => setWantOff({ ...wantOff, [t.key]: !e.target.checked })}
                  />
                  <span>
                    <strong>{t.label}</strong> <span className="small muted">({t.questionIds.length} {t.questionIds.length === 1 ? "question" : "questions"})</span>
                    {t.description && <span className="small muted block">{t.description}</span>}
                  </span>
                </label>
                {off && (
                  <span className="tag tailor-state">Left out of the assessment</span>
                )}
                {existing && off && (
                  <p className="small muted tailor-reason">
                    Reason: {existing.reason ?? "No reason recorded"}. Recorded by {existing.by} on {existing.at.slice(0, 10)}.
                    {kept > 0 && ` ${kept} recorded ${kept === 1 ? "value is" : "values are"} kept and come back if you switch the topic on again.`}
                  </p>
                )}
                {off && !existing && (
                  <label className="field" htmlFor={id}>
                    <span>
                      Reason for leaving out “{t.label}” <span className="muted">(optional)</span>
                    </span>
                    <textarea
                      id={id}
                      rows={2}
                      value={reasons[t.key] ?? ""}
                      onChange={(e) => setReasons({ ...reasons, [t.key]: e.target.value })}
                      placeholder="e.g. Bulk is packed and labelled in one shift (fictional)"
                    />
                    {kept > 0 && <span className="small muted">{kept} recorded {kept === 1 ? "value is" : "values are"} kept and come back if you switch the topic on again.</span>}
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={newlyOff.length + newlyOn.length === 0}>
            Save scope
          </button>
        </div>
      </form>
    </Modal>
  );
}
