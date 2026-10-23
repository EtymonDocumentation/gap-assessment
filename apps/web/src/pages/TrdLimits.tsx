import { checkLimits, copyPulledValue, rangeText, setLimits, setPointText, sourceShort, type ItemRef } from "@gap/engine";
import { TRD_BASIS_LOADOUTS, type Source, type TrdItem, type TrdLimits, type TrdRange, type TrdSetPoint } from "@gap/process-model";
import { useId, useState } from "react";
import { useStore } from "../store";
import type { Run } from "./SamplingFlow";
import { SourcePicker, type Where } from "./TrdSourcePicker";

type Part = "setPoint" | "nor" | "par";
const PART_LABEL: Record<Part, string> = { setPoint: "Set point", nor: "Normal operating range (NOR)", par: "Proven acceptable range (PAR)" };
const PART_SHORT: Record<Part, string> = { setPoint: "set point", nor: "NOR", par: "PAR" };

interface Draft {
  on: boolean;
  value: string;
  min: string;
  max: string;
  unit: string;
  basis: string;
  sourceIds: string[];
  locations: Where;
  provisional: boolean;
}
const emptyDraft = (): Draft => ({ on: false, value: "", min: "", max: "", unit: "", basis: "", sourceIds: [], locations: {}, provisional: false });
const num = (n: number | undefined) => (n === undefined ? "" : String(n));

function draftOf(part: Part, limits: TrdLimits | undefined): Draft {
  if (part === "setPoint") {
    const s = limits?.setPoint;
    return s ? { ...emptyDraft(), on: true, value: num(s.value), unit: s.unit ?? "", sourceIds: [...s.sourceIds], locations: structuredClone(s.locations ?? {}), provisional: Boolean(s.provisional) } : emptyDraft();
  }
  const r = limits?.[part];
  return r ? { ...emptyDraft(), on: true, min: num(r.min), max: num(r.max), unit: r.unit ?? "", basis: r.basis ?? "", sourceIds: [...r.sourceIds], locations: structuredClone(r.locations ?? {}), provisional: Boolean(r.provisional) } : emptyDraft();
}

/** The citation part shared by all three: only sources still ticked keep a location. */
function citation(d: Draft) {
  const locations: Where = {};
  for (const id of d.sourceIds) {
    const l = d.locations[id];
    const clean = { ...(l?.section?.trim() ? { section: l.section.trim() } : {}), ...(l?.page?.trim() ? { page: l.page.trim() } : {}) };
    if (clean.section || clean.page) locations[id] = clean;
  }
  return { sourceIds: d.sourceIds, ...(Object.keys(locations).length ? { locations } : {}) };
}

/** Reads a typed number; empty is "not given", anything else must be a number. */
function parse(text: string, label: string): number | undefined {
  const t = text.trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
}

function build(drafts: Record<Part, Draft>): TrdLimits {
  const out: TrdLimits = {};
  const sp = drafts.setPoint;
  if (sp.on) {
    const value = parse(sp.value, "The set point");
    if (value === undefined) throw new Error("Enter the set point, or switch it off.");
    const s: TrdSetPoint = { value, ...(sp.unit.trim() ? { unit: sp.unit.trim() } : {}), ...citation(sp), ...(sp.provisional ? { provisional: true as const } : {}) };
    out.setPoint = s;
  }
  for (const part of ["nor", "par"] as const) {
    const d = drafts[part];
    if (!d.on) continue;
    const min = parse(d.min, `The ${PART_SHORT[part]} minimum`);
    const max = parse(d.max, `The ${PART_SHORT[part]} maximum`);
    if (min === undefined && max === undefined) throw new Error(`Enter a minimum, a maximum or both for the ${PART_SHORT[part]}, or switch it off.`);
    const r: TrdRange = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(d.unit.trim() ? { unit: d.unit.trim() } : {}), ...citation(d), ...(d.basis.trim() ? { basis: d.basis.trim() } : {}), ...(d.provisional ? { provisional: true as const } : {}) };
    out[part] = r;
  }
  return out;
}

export const sourceName = (s: Source): string => (s.docRef ? `${sourceShort(s)} (${s.docRef.docType})` : sourceShort(s));

/** Where a citation is found, in words: "DEMO-PD-217-01 (Process development report), section 5.1, page 12". */
export function citationText(sources: readonly Source[], sourceIds: readonly string[], locations?: Where): string {
  return sourceIds
    .map((id) => {
      const s = sources.find((x) => x.id === id);
      const l = locations?.[id];
      const at = [l?.section ? `section ${l.section}` : "", l?.page ? `page ${l.page}` : ""].filter(Boolean).join(", ");
      return `${s ? sourceName(s) : id}${at ? `, ${at}` : ""}`;
    })
    .join("; ");
}

/**
 * What was entered for a parameter or in-process control, and what the check found, in words. Findings carry a word, not only a colour.
 * The heading says "TRD limits" so these entries are never read as the project's own set point or range, which a card shows apart
 * under "From the project". A project value can be copied into a limit with one button; that is always the person's choice.
 */
export function LimitsSummary({ item, sources, testId, docId, itemRef, run }: { item: TrdItem; sources: readonly Source[]; testId: string; docId: string; itemRef: ItemRef; run: Run }) {
  const l = item.limits;
  const { findings, working } = checkLimits(l);
  const copies = (["setPoint", "nor", "par"] as const)
    .filter((part) => !l?.[part])
    .flatMap((part) => item.fields.map((f) => ({ part, f, v: copyPulledValue(f, part) })).filter((x) => x.v !== undefined));
  const copy = (part: Part, v: TrdSetPoint | TrdRange, label: string) =>
    run((p, actor) => setLimits(p, docId, itemRef, { ...(l ?? {}), [part]: v }, actor), `${item.label}: project value of "${label}" copied into the ${PART_SHORT[part]}`);
  return (
    <div className="stack" data-testid={`${testId}-limits`}>
      <p className="small">
        <strong>TRD limits (set point / NOR / PAR with sources):</strong> {l ? "" : "none entered yet."}
      </p>
      {l && (
        <dl className="trd-limits-dl">
          {l.setPoint && (
            <div>
              <dt>Set point</dt>
              <dd>
                {setPointText(l.setPoint)}
                {l.setPoint.sourceIds.length > 0 && <span className="muted small"> Source: {citationText(sources, l.setPoint.sourceIds, l.setPoint.locations)}</span>}
              </dd>
            </div>
          )}
          {(["nor", "par"] as const).map((p) => {
            const r = l[p];
            return r ? (
              <div key={p}>
                <dt>{p.toUpperCase()}</dt>
                <dd>
                  {rangeText(r)}
                  {r.basis && <span className="muted small"> Basis: {r.basis}.</span>}
                  {r.sourceIds.length > 0 && <span className="muted small"> Source: {citationText(sources, r.sourceIds, r.locations)}</span>}
                </dd>
              </div>
            ) : null;
          })}
        </dl>
      )}
      {findings.length > 0 && (
        <ul className="plain-list small" data-testid={`${testId}-findings`}>
          {findings.map((f, i) => (
            <li key={i}>
              <strong>{f.level === "problem" ? "Check: " : f.level === "open" ? "Open item: " : "Note: "}</strong>
              {f.text}.
            </li>
          ))}
        </ul>
      )}
      {copies.length > 0 && (
        <div className="row wrap no-print">
          {copies.map(({ part, f, v }) => (
            <button key={`${part}-${f.key}`} type="button" className="btn small" data-testid={`${testId}-copy-${part}-${f.key}`} onClick={() => copy(part, v!, f.label)}>
              Copy project value "{f.label}" into the {PART_SHORT[part]}
            </button>
          ))}
        </div>
      )}
      {working.length > 0 && (
        <details className="small">
          <summary>How this was checked</summary>
          <ul className="plain-list">
            {working.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
/**
 * Editor for the set point, NOR and PAR of one parameter or in-process control. They are entered here by the team and cited to
 * documents from the source register; they are never taken from the sampling plan, and a project value is copied in only when the
 * person presses the button (so a project range is never silently called a PAR or a NOR). The check beside it only reports.
 */
export function LimitsEditor({ docId, item, itemRef, run, onDone }: { docId: string; item: TrdItem; itemRef: ItemRef; run: Run; onDone: () => void }) {
  const project = useStore((s) => s.project)!;
  const [drafts, setDrafts] = useState<Record<Part, Draft>>({ setPoint: draftOf("setPoint", item.limits), nor: draftOf("nor", item.limits), par: draftOf("par", item.limits) });
  const [error, setError] = useState("");
  const sources = project.sources.filter((s) => !s.supersededBy);
  const set = (part: Part, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [part]: { ...d[part], ...patch } }));

  function save() {
    let limits: TrdLimits;
    try {
      limits = build(drafts);
    } catch (e) {
      return setError((e as Error).message);
    }
    setError("");
    if (run((p, actor) => setLimits(p, docId, itemRef, limits, actor), `${item.label}: set point, NOR and PAR saved`)) onDone();
  }

  return (
    <div className="stack trd-limits" data-testid="trd-limits-editor">
      <p className="muted small">
        Enter the set point, NOR and PAR the team has, and cite where each comes from. Nothing here is taken from the sampling plan. The check below each range only reports; it never blocks saving.
      </p>
      {(["setPoint", "nor", "par"] as const).map((part) => (
        <PartEditor key={part} part={part} item={item} draft={drafts[part]} set={(patch) => set(part, patch)} sources={sources} />
      ))}
      {error && (
        <p className="error" role="alert" data-testid="trd-limits-error">
          {error}
        </p>
      )}
      <div className="row wrap">
        <button type="button" className="btn primary small" onClick={save} data-testid="trd-limits-save">
          Save set point, NOR and PAR
        </button>
        <button type="button" className="btn small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PartEditor({ part, item, draft, set, sources }: { part: Part; item: TrdItem; draft: Draft; set: (patch: Partial<Draft>) => void; sources: Source[] }) {
  const uid = useId();
  const isRange = part !== "setPoint";
  // A project value can be copied in on purpose. Offered only for fields whose project value can stand as this kind of entry.
  const copyable = item.fields.map((f) => ({ f, v: copyPulledValue(f, part) })).filter((x) => x.v !== undefined);

  function copyIn(v: TrdSetPoint | TrdRange) {
    if (part === "setPoint") {
      const s = v as TrdSetPoint;
      set({ on: true, value: num(s.value), unit: s.unit ?? "", provisional: Boolean(s.provisional), ...(s.sourceIds.length ? { sourceIds: s.sourceIds.filter((id) => sources.some((x) => x.id === id)) } : {}) });
    } else {
      const r = v as TrdRange;
      set({ on: true, min: num(r.min), max: num(r.max), unit: r.unit ?? "", provisional: Boolean(r.provisional), ...(r.sourceIds.length ? { sourceIds: r.sourceIds.filter((id) => sources.some((x) => x.id === id)) } : {}) });
    }
  }

  return (
    <fieldset className="fs stack" data-testid={`trd-limits-${part}`}>
      <legend>{PART_LABEL[part]}</legend>
      <label className="check">
        <input type="checkbox" checked={draft.on} onChange={(e) => set({ on: e.target.checked })} data-testid={`trd-limits-${part}-on`} /> <span>Enter a {PART_SHORT[part]} for {item.label}</span>
      </label>
      {draft.on && (
        <>
          {draft.provisional && <p className="small">This value was copied from a TBD best guess in the project. It is shown as provisional.</p>}
          <div className="row wrap end-align">
            {isRange ? (
              <>
                <label className="field">
                  <span>Minimum</span>
                  <input inputMode="decimal" value={draft.min} onChange={(e) => set({ min: e.target.value })} data-testid={`trd-limits-${part}-min`} />
                </label>
                <label className="field">
                  <span>Maximum</span>
                  <input inputMode="decimal" value={draft.max} onChange={(e) => set({ max: e.target.value })} data-testid={`trd-limits-${part}-max`} />
                </label>
              </>
            ) : (
              <label className="field">
                <span>Value</span>
                <input inputMode="decimal" value={draft.value} onChange={(e) => set({ value: e.target.value })} data-testid={`trd-limits-${part}-value`} />
              </label>
            )}
            <label className="field">
              <span>Unit</span>
              <input value={draft.unit} onChange={(e) => set({ unit: e.target.value })} data-testid={`trd-limits-${part}-unit`} />
            </label>
          </div>
          {isRange && (
            <label className="field">
              <span>Basis (free text; the suggestions are only a help)</span>
              <input value={draft.basis} onChange={(e) => set({ basis: e.target.value })} list={`${uid}-basis`} data-testid={`trd-limits-${part}-basis`} />
              <datalist id={`${uid}-basis`}>
                {TRD_BASIS_LOADOUTS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
          )}
          {copyable.length > 0 && (
            <div className="row wrap">
              {copyable.map(({ f, v }) => (
                <button key={f.key} type="button" className="btn small" data-testid={`trd-copy-${part}-${f.key}`} onClick={() => copyIn(v!)}>
                  Copy the project value of "{f.label}" into the {PART_SHORT[part]}
                </button>
              ))}
            </div>
          )}
          <SourcePicker testId={`trd-limits-${part}`} newKey={part} label={PART_SHORT[part]} sources={sources} selected={draft.sourceIds} locations={draft.locations} onChange={(n) => set({ sourceIds: n.sourceIds, locations: n.locations })} />
        </>
      )}
    </fieldset>
  );
}