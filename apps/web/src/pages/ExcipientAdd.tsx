import { excipientClasses } from "@gap/content";
import { addExcipientLine } from "@gap/engine";
import type { ExcipientAssessment } from "@gap/process-model";
import { useState } from "react";
import { useStore } from "../store";

/**
 * "Add an excipient": one name and one button. The class, the supplier and every other fact are asked afterwards, in the questions or on the
 * excipient's own page, so nothing is chosen for the person and nothing has to be known to add a line. The name is the one word the
 * technical requirements document table will use.
 */
export function AddExcipientForm({ a, onAdded, label = "Excipient name", testIdPrefix = "ex-add" }: { a: ExcipientAssessment; onAdded?: (lineId: string) => void; label?: string; testIdPrefix?: string }) {
  const update = useStore((s) => s.update);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function add() {
    let lineId = "";
    const err = update((p, actor) => {
      const r = addExcipientLine(p, a.id, { name }, actor, { classKeys: excipientClasses.classes.map((c) => c.key) });
      lineId = r.lineId;
      return r.project;
    }, "Excipient added");
    if (err) {
      setError(err);
      return;
    }
    setName("");
    setError("");
    onAdded?.(lineId);
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <div className="row wrap end-align">
        <label className="field grow">
          <span>{label}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Excipient A (fictional)" data-testid={`${testIdPrefix}-name`} aria-describedby={error ? `${testIdPrefix}-error` : undefined} />
        </label>
        <button type="submit" className="btn primary" data-testid={`${testIdPrefix}-btn`}>
          Add excipient
        </button>
      </div>
      {error && (
        <p className="error" role="alert" id={`${testIdPrefix}-error`} data-testid={`${testIdPrefix}-error`}>
          {error}
        </p>
      )}
    </form>
  );
}
