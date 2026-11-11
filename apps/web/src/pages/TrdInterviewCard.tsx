import { checkLimits, type AnswerPlace, type InterviewAnswer, type InterviewQuestion } from "@gap/engine";
import type { Source, TrdDocument, TrdItem, TrdLimits } from "@gap/process-model";
import { useId, useRef, useState, type Ref } from "react";
import { href } from "../router";
import { projectValueText, sourceText, statusOf } from "../trd-interview-lib";
import { InterviewCardBase, UnitControl, type CardCtx, type CardDraft, type CardExitDraft, type CardKit } from "./InterviewCardBase";
import { SourcePicker, type Where } from "./TrdSourcePicker";

type Part = "setPoint" | "nor" | "par";
const PARTS: Part[] = ["setPoint", "nor", "par"];
const PART_LABEL: Record<Part, string> = { setPoint: "Set point", nor: "Normal operating range (NOR)", par: "Proven acceptable range (PAR)" };

export interface CardProps {
  q: InterviewQuestion;
  d: TrdDocument;
  /** The section of the document the answer lands in (number and heading), when it lands in a numbered one. */
  place?: AnswerPlace | undefined;
  /**
   * The interview follows a template's headings: the whole sentence for where the answer lands in the Word file ("Lands under 6.2 Filling (your
   * template)."). It replaces the section sentence, because the number the Document tab shows is Cascade's own and the Word file prints the template's.
   */
  landsUnder?: string | undefined;
  /** The person has looked at the project value and kept it (a mark in this browser only). */
  kept: boolean;
  /** One-at-a-time: a large card whose heading takes the focus when the question changes. */
  large?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  sources: Source[];
  /** Writes one answer. Returns the engine's own message when it refuses, or null. */
  onSave: (q: InterviewQuestion, a: InterviewAnswer) => string | null;
  onKeep: (q: InterviewQuestion) => void;
  /** "Don't know yet": nothing is written. The one-at-a-time view moves on. */
  onDontKnow?: (q: InterviewQuestion) => void;
  /** One-at-a-time only: move on for this sitting. */
  onSkip?: (q: InterviewQuestion) => void;
  onFocusCard?: (q: InterviewQuestion) => void;
}

const numOf = (t: string): number | undefined => {
  const s = t.trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * One question of the technical requirements document interview. The card itself is the shared one (InterviewCardBase, also used by the
 * excipient assessment); this file holds what only the TRD has: the project value to keep or change, the "Where is this written?" box, the
 * yes/no about a step, and the set point / NOR / PAR fields. A project value is shown as such and counts only after "Keep this" or a change.
 */
export function InterviewCard(props: CardProps) {
  const { q, d, place, landsUnder, kept, large, headingRef, sources, onSave, onKeep, onDontKnow, onSkip, onFocusCard } = props;
  const t = q.target;
  const limitsAnswer = useRef<() => InterviewAnswer | string>(() => "");
  const projectNow = q.state === "from_project";
  const typedOver = projectValueText(d, q);
  const hasReasonBox = (t.kind === "field" || t.kind === "detail") && q.input !== "limits";

  const kit: CardKit<InterviewQuestion, InterviewAnswer> = {
    status: statusOf,
    // Typed text of the document and of a sentence blank is the person's own earlier answer, so it is shown to be edited; everything else starts empty.
    prefill: (x) => (x.state === "answered" && (x.target.kind === "document" || x.target.kind === "blank") && (x.input === "text" || x.input === "long_text" || x.input === "date") ? (x.current ?? "") : ""),
    nowText: (x) => {
      const here = x.state !== "open" && x.current !== undefined && !projectNow && x.state !== "tbd" && x.current && x.input !== "limits";
      return here || (x.input === "limits" && x.current) ? `Now in the TRD: ${x.current}` : undefined;
    },
    fromElsewhere: () => projectNow,
    naLabel: "Why is it not applicable? (optional)",
    tbdGuess: true,
    build(x, dr: CardDraft) {
      if (x.input === "limits") return limitsAnswer.current();
      if (t.kind === "presence") return dr.performed ? { kind: "presence", performed: dr.performed === "yes" } : "Please choose Yes or No, or choose Don't know yet.";
      const why = t.kind === "field" || t.kind === "detail" ? (dr.reason.trim() ? { reason: dr.reason.trim() } : {}) : {};
      if (x.input === "range") {
        const lo = numOf(dr.min);
        const hi = numOf(dr.max);
        if (Number.isNaN(lo)) return "Please enter the lowest value as a number, for example 12.5.";
        if (Number.isNaN(hi)) return "Please enter the highest value as a number, for example 12.5.";
        return { kind: "range", ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}), ...(dr.unit ? { unit: dr.unit } : {}), ...why };
      }
      if (x.input === "multi_choice") return { kind: "value", values: dr.values, ...why };
      const numeric = x.input === "number" || x.input === "quantity";
      return { kind: "value", value: numeric ? dr.value.trim().replace(",", ".") : dr.value, ...(dr.unit ? { unit: dr.unit } : {}), ...why };
    },
    exitAnswer(_x, kind, dr: CardExitDraft) {
      if (t.kind === "limits" && !dr.part) return "Please choose which one this is about.";
      const part = dr.part ? { part: dr.part as Part } : {};
      return kind === "na" ? { kind: "not_applicable", ...(dr.reason.trim() ? { reason: dr.reason.trim() } : {}), ...part } : { kind: "tbd", ...(dr.guess.trim() ? { bestGuess: dr.guess.trim() } : {}), ...(dr.owner.trim() ? { owner: dr.owner.trim() } : {}), ...(dr.due ? { due: dr.due } : {}), ...part };
    },
    before: (_x, ctx: CardCtx) => (
      <>
        {projectNow && (
          <div className="iv-project stack" data-testid="iv-project">
            <p>
              <strong>{sourceText(q) || "From the project"}:</strong> <span data-testid="iv-project-value">{q.current}</span>
            </p>
            <div className="row wrap">
              <button type="button" className="btn small" data-testid="iv-keep" disabled={kept} onClick={() => onKeep(q)}>
                {kept ? "Kept" : "Keep this"}
              </button>
              <button type="button" className="btn small" data-testid="iv-change" aria-expanded={ctx.changing} onClick={() => ctx.setChanging((v) => !v)}>
                {ctx.changing ? "Keep the project value" : "Change it"}
              </button>
            </div>
          </div>
        )}
        {!projectNow && q.source && q.source.kind === "uploaded file" && q.state === "answered" && <p className="small muted">{sourceText(q)}</p>}
        {typedOver !== undefined && (
          <p className="small muted" data-testid="iv-project-beside">
            Project value: {typedOver}
          </p>
        )}
      </>
    ),
    customInput(x, ctx: CardCtx) {
      if (x.input === "limits") return <LimitsFields q={x} d={d} sources={sources} labelledBy={ctx.ids.h} describedBy={ctx.describedBy} onChange={ctx.touch} expose={(f) => (limitsAnswer.current = f)} />;
      if (t.kind === "presence") {
        const opts = x.choices.length ? x.choices : [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
        return (
          <div role="radiogroup" aria-labelledby={ctx.ids.h} aria-describedby={ctx.describedBy} className="row wrap iv-radios">
            {opts.map((o) => (
              <label key={o.value} className="check">
                <input type="radio" name={ctx.ids.input} checked={ctx.draft.performed === o.value} data-testid={`iv-option-${o.value}`} onChange={() => ctx.set({ performed: o.value === "yes" ? "yes" : "no" })} /> <span>{o.label}</span>
              </label>
            ))}
          </div>
        );
      }
      return undefined;
    },
    afterInput: (_x, ctx: CardCtx) =>
      hasReasonBox ? (
        <label className="field">
          <span>Where is this written? (optional)</span>
          <input value={ctx.draft.reason} onChange={(e) => ctx.set({ reason: e.target.value })} data-testid="iv-reason" />
        </label>
      ) : null,
    exitBefore: (_x, ctx: CardCtx) => {
      if (t.kind !== "limits") return null;
      const own = PARTS.filter((p) => t.parts.includes(p));
      const all = own.length ? own : PARTS;
      return (
        <label className="field compact">
          <span>Which one is this about?</span>
          <select value={ctx.exitDraft.part} onChange={(e) => ctx.setExitDraft({ part: e.target.value })} data-testid="iv-exit-part">
            <option value="">Choose...</option>
            {all.map((p) => (
              <option key={p} value={p}>
                {PART_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      );
    },
    asideExtra: (x) =>
      x.usedIn.length > 0 || place || landsUnder ? (
        <>
          {x.usedIn.length > 0 && (
            <p className="small muted" data-testid="iv-used-in">
              Used in: {x.usedIn.map((u) => u.title).join("; ")}
            </p>
          )}
          {/* Where the answer lands: the section as the document numbers it, and a link that opens the Document tab at that section. */}
          {(landsUnder || place) && (
            <p className="small iv-lands" data-testid="iv-lands">
              <span className="muted">{landsUnder ?? `Lands in section ${place!.number}, ${place!.heading}.`}</span>{" "}
              <a href={href("/trd", { trd: d.id, tab: "output", ...(place ? { section: place.sectionId } : {}) })} data-testid="iv-see-in-document">
                See it in the document
              </a>
            </p>
          )}
        </>
      ) : null,
  };

  return (
    <InterviewCardBase
      q={q}
      kit={kit}
      kept={kept}
      {...(large !== undefined ? { large } : {})}
      {...(headingRef ? { headingRef } : {})}
      onSave={onSave}
      {...(onDontKnow ? { onDontKnow } : {})}
      {...(onSkip ? { onSkip } : {})}
      {...(onFocusCard ? { onFocusCard } : {})}
      errorLabel={q.blankLabel ?? q.stepLabel}
    />
  );
}


// ------------------------------------------------------------------ the limits card

interface PartDraft {
  value: string;
  min: string;
  max: string;
  unit: string;
  sourceIds: string[];
  locations: Where;
}
const emptyPart = (): PartDraft => ({ value: "", min: "", max: "", unit: "", sourceIds: [], locations: {} });
const num = (n: number | undefined) => (n === undefined ? "" : String(n));

function itemOf(d: TrdDocument, q: InterviewQuestion): TrdItem | undefined {
  const t = q.target;
  if (t.kind !== "limits") return undefined;
  return d.steps.find((s) => s.key === t.unitOp)?.items.find((i) => i.collection === t.collection && i.key === t.itemKey);
}

function initialParts(limits: TrdLimits | undefined): Record<Part, PartDraft> {
  const sp = limits?.setPoint;
  return {
    setPoint: sp ? { ...emptyPart(), value: num(sp.value), unit: sp.unit ?? "", sourceIds: [...sp.sourceIds], locations: structuredClone(sp.locations ?? {}) } : emptyPart(),
    nor: limits?.nor ? { ...emptyPart(), min: num(limits.nor.min), max: num(limits.nor.max), unit: limits.nor.unit ?? "", sourceIds: [...limits.nor.sourceIds], locations: structuredClone(limits.nor.locations ?? {}) } : emptyPart(),
    par: limits?.par ? { ...emptyPart(), min: num(limits.par.min), max: num(limits.par.max), unit: limits.par.unit ?? "", sourceIds: [...limits.par.sourceIds], locations: structuredClone(limits.par.locations ?? {}) } : emptyPart(),
  };
}

const cleanWhere = (loc: Where, ids: string[]): Where => {
  const out: Where = {};
  for (const id of ids) {
    const l = loc[id];
    const c = { ...(l?.section?.trim() ? { section: l.section.trim() } : {}), ...(l?.page?.trim() ? { page: l.page.trim() } : {}) };
    if (c.section || c.page) out[id] = c;
  }
  return out;
};

/**
 * Set point, NOR and PAR as three small labelled groups (stacked on a phone), each with "Where is this from?" using the same source picker
 * as the form. The check beside them is the form's own (`checkLimits`): it reports and never blocks. Only the parts the person changed are
 * sent, so a part they did not touch (and its basis) stays exactly as it is.
 */
function LimitsFields({ q, d, sources, labelledBy, describedBy, onChange, expose }: { q: InterviewQuestion; d: TrdDocument; sources: Source[]; labelledBy: string; describedBy: string; onChange: () => void; expose: (build: () => InterviewAnswer | string) => void }) {
  const item = itemOf(d, q);
  const start = useRef(initialParts(item?.limits));
  const [parts, setParts] = useState<Record<Part, PartDraft>>(start.current);
  const set = (p: Part, patch: Partial<PartDraft>) => {
    setParts((x) => ({ ...x, [p]: { ...x[p], ...patch } }));
    onChange();
  };
  const units = q.units;

  const changed = (p: Part) => JSON.stringify(parts[p]) !== JSON.stringify(start.current[p]);
  const empty = (p: Part) => (p === "setPoint" ? !parts.setPoint.value.trim() : !parts[p].min.trim() && !parts[p].max.trim());

  expose(() => {
    const a: Extract<InterviewAnswer, { kind: "limits" }> = { kind: "limits" };
    for (const p of PARTS) {
      if (!changed(p)) continue;
      const x = parts[p];
      if (empty(p)) {
        a[p] = null;
        continue;
      }
      const cite = x.sourceIds.length || JSON.stringify(x.sourceIds) !== JSON.stringify(start.current[p].sourceIds) ? { sourceIds: x.sourceIds, locations: cleanWhere(x.locations, x.sourceIds) } : {};
      if (p === "setPoint") {
        const v = numOf(x.value);
        if (v === undefined || Number.isNaN(v)) return "Please enter the set point as a number, for example 12.5.";
        a.setPoint = { value: v, ...(x.unit.trim() ? { unit: x.unit.trim() } : {}), ...cite };
      } else {
        const lo = numOf(x.min);
        const hi = numOf(x.max);
        if (Number.isNaN(lo) || Number.isNaN(hi)) return `Please enter the ${p === "nor" ? "NOR" : "PAR"} values as numbers, for example 12.5.`;
        const have = item?.limits?.[p];
        a[p] = { ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}), ...(x.unit.trim() ? { unit: x.unit.trim() } : {}), ...(have?.basis ? { basis: have.basis } : {}), ...cite };
      }
    }
    if (a.setPoint === undefined && a.nor === undefined && a.par === undefined) return "Please enter a value, or choose Don't know yet.";
    return a;
  });

  // The form's own check, run on what is typed. It never stops a save and never decides anything.
  const draft: TrdLimits = {};
  const sp = numOf(parts.setPoint.value);
  if (sp !== undefined && !Number.isNaN(sp)) draft.setPoint = { value: sp, ...(parts.setPoint.unit ? { unit: parts.setPoint.unit } : {}), sourceIds: parts.setPoint.sourceIds };
  for (const p of ["nor", "par"] as const) {
    const lo = numOf(parts[p].min);
    const hi = numOf(parts[p].max);
    const okLo = lo !== undefined && !Number.isNaN(lo);
    const okHi = hi !== undefined && !Number.isNaN(hi);
    if (okLo || okHi) draft[p] = { ...(okLo ? { min: lo } : {}), ...(okHi ? { max: hi } : {}), ...(parts[p].unit ? { unit: parts[p].unit } : {}), sourceIds: parts[p].sourceIds };
  }
  const findings = Object.keys(draft).length ? checkLimits(draft).findings : [];
  const uid = useId().replace(/:/g, "");

  return (
    <div className="iv-limits stack" data-testid="iv-limits" role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <div className="iv-limits-grid">
        {PARTS.map((p) => {
          const isRange = p !== "setPoint";
          return (
            <fieldset key={p} className="fs stack iv-limit" data-testid={`iv-limit-${p}`}>
              <legend>{PART_LABEL[p]}</legend>
              <div className="row wrap end-align">
                {isRange ? (
                  <>
                    <label className="field compact">
                      <span>Lowest value</span>
                      <input inputMode="decimal" value={parts[p].min} onChange={(e) => set(p, { min: e.target.value })} data-testid={`iv-${p}-min`} />
                    </label>
                    <label className="field compact">
                      <span>Highest value</span>
                      <input inputMode="decimal" value={parts[p].max} onChange={(e) => set(p, { max: e.target.value })} data-testid={`iv-${p}-max`} />
                    </label>
                  </>
                ) : (
                  <label className="field compact">
                    <span>Value</span>
                    <input inputMode="decimal" value={parts[p].value} onChange={(e) => set(p, { value: e.target.value })} data-testid={`iv-${p}-value`} />
                  </label>
                )}
                <UnitControl id={`${uid}-${p}-u`} label="Unit" units={units} value={parts[p].unit} onChange={(v) => set(p, { unit: v })} />
              </div>
              <details className="small" data-testid={`iv-${p}-source`}>
                <summary>Where is this from?{parts[p].sourceIds.length ? ` (${parts[p].sourceIds.length} cited)` : " (optional)"}</summary>
                <SourcePicker testId={`iv-${p}`} newKey={`iv-${p}`} label={p === "setPoint" ? "set point" : p.toUpperCase()} sources={sources} selected={parts[p].sourceIds} locations={parts[p].locations} onChange={(n) => set(p, { sourceIds: n.sourceIds, locations: n.locations })} />
              </details>
            </fieldset>
          );
        })}
      </div>
      {findings.length > 0 && (
        <ul className="plain-list small" data-testid="iv-limits-findings" aria-label="What the check found">
          {findings.map((f, i) => (
            <li key={i}>
              <strong>{f.level === "problem" ? "Check: " : f.level === "open" ? "Open item: " : "Note: "}</strong>
              {f.text}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
