import { setControl, type ItemRef } from "@gap/engine";
import { TRD_CONTROL_METHODS, TRD_CONTROL_METHOD_LABEL, type TrdControl, type TrdControlMethod, type TrdItem } from "@gap/process-model";
import { useState } from "react";
import type { Run } from "./SamplingFlow";

/**
 * Classification evidence and data map of one parameter: the quality attribute it protects, the evidence for its classification, how it
 * is controlled and where it is recorded. The TRD generates its "Parameter classification" and "Data map" tables from these entries.
 * Every field starts empty and reads "Not established" in the document: the tool offers the choices, never an answer.
 */
export function ControlEditor({ docId, item, itemRef, run }: { docId: string; item: TrdItem; itemRef: ItemRef; run: Run }) {
  const c = item.control;
  const [cqa, setCqa] = useState(c?.cqa ?? "");
  const [evidence, setEvidence] = useState(c?.evidence ?? "");
  const [controlledBy, setControlledBy] = useState<TrdControlMethod | "">(c?.controlledBy ?? "");
  const [recordedIn, setRecordedIn] = useState(c?.recordedIn ?? "");
  const tid = `trd-control-${itemRef.stepId}-${item.key}`;

  function save() {
    const control: TrdControl = { cqa, evidence, recordedIn, ...(controlledBy ? { controlledBy } : {}) };
    run((p, actor) => setControl(p, docId, itemRef, control, actor), `${item.label}: classification evidence and data map saved`);
  }

  return (
    <fieldset className="fs stack" data-testid={tid}>
      <legend>Classification evidence and data map</legend>
      <p className="muted small">
        Optional. The classification itself (CPP, KPP or not critical) is the field above. Here you say which quality attribute the parameter protects, what the evidence is, how it is controlled and where its value is recorded. An entry left empty reads "Not established" in the document.
      </p>
      <label className="field">
        <span>Quality attribute protected</span>
        <input value={cqa} onChange={(e) => setCqa(e.target.value)} data-testid={`${tid}-cqa`} />
      </label>
      <label className="field">
        <span>Evidence for the classification</span>
        <input value={evidence} onChange={(e) => setEvidence(e.target.value)} data-testid={`${tid}-evidence`} />
      </label>
      <label className="field">
        <span>How it is controlled</span>
        <select value={controlledBy} onChange={(e) => setControlledBy(e.target.value as TrdControlMethod | "")} data-testid={`${tid}-controlled-by`}>
          <option value="">Not established</option>
          {TRD_CONTROL_METHODS.map((m) => (
            <option key={m} value={m}>
              {TRD_CONTROL_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Where it is recorded</span>
        <input value={recordedIn} onChange={(e) => setRecordedIn(e.target.value)} data-testid={`${tid}-recorded-in`} />
      </label>
      <div>
        <button type="button" className="btn small" onClick={save} data-testid={`${tid}-save`}>
          Save classification evidence and data map
        </button>
      </div>
    </fieldset>
  );
}

/** One line under a collapsed parameter: what the team entered, in words (nothing when nothing was entered). */
export function ControlSummary({ item }: { item: TrdItem }) {
  const c = item.control;
  if (!c) return null;
  const parts = [c.cqa ? `protects: ${c.cqa}` : "", c.controlledBy ? `controlled by: ${TRD_CONTROL_METHOD_LABEL[c.controlledBy]}` : "", c.recordedIn ? `recorded in: ${c.recordedIn}` : ""].filter(Boolean);
  return (
    <p className="small" data-testid={`trd-control-summary-${item.key}`}>
      <strong>Classification evidence and data map</strong> <span className="muted">{parts.length ? parts.join("; ") : "evidence entered"}</span>
    </p>
  );
}
