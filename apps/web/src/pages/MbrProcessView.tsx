import { useEffectiveSuggestions } from "../expected-studies-store";
import { branchStatusAt, buildProcessView, expectedStudies, CLOCK_STATUS_TEXT, clockLabel, clockStatusAt, describeMoment, type ProcessView, type Severity, type ViewClock, type ViewEquipment, type ViewSample } from "@gap/engine";
import { SAMPLE_ACCESS, type MbrRecord, type SampleAccess } from "@gap/process-model";
import { useMemo, useState } from "react";
import { href } from "../router";
import { useStore } from "../store";
import { MbrFrame } from "./MbrFrame";
import { countOf } from "../lib";

/*
 * The Process view of one batch record: the equipment train, a moments slider, the clocks against their limits, the samples at their
 * ports and the findings of the fluid tracker. Everything comes from buildProcessView (engine), which never guesses a number: this page
 * only draws what it returns and says "Not enough data in the record" where the engine says so.
 */

const SEVERITY_TEXT: Record<Severity, string> = { major: "Major", minor: "Minor", note: "Note" };
// Shape as well as colour tells the severities apart (triangle, square, circle), so the cue is never colour alone.
const SEVERITY_ICON: Record<Severity, string> = { major: "M6 0.5 L11.5 11 L0.5 11 Z", minor: "M1 1 H11 V11 H1 Z", note: "M6 1 A5 5 0 1 1 5.99 1 Z" };

const num = (n: number, d = 3) => String(Math.round(n * 10 ** d) / 10 ** d);
const hoursText = (h: number) => `${num(h, 2)} h`;

/** A title cut into at most three short lines for the drawing (SVG text does not wrap). */
function wrap(text: string, max = 22): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if (line && `${line} ${w}`.length > max) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  if (lines.length > 3) return [...lines.slice(0, 2), `${lines[2]!.slice(0, max - 1)}…`];
  return lines;
}

/** The route page: picks the record by `?mbr=` and says so plainly when it is missing. */
/** True on a phone-width screen (checked once when the page opens). */
function isPhone(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches;
}

/** The "What this shows" card. Its own open state, so re-rendering (every move of the slider) never closes or reopens it. */
function PvAbout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(() => !isPhone());
  return (
    <details className="card stack pv-about" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <h2 id="pv-about">What this shows</h2>
      </summary>
      {children}
    </details>
  );
}

export function MbrProcessViewPage({ params }: { params: URLSearchParams }) {
  const project = useStore((s) => s.project)!;
  const id = params.get("mbr");
  const rec = id ? project.mbr.records.find((x) => x.id === id) : undefined;
  if (rec) return <MbrProcessView rec={rec} />;
  return (
    <div className="stack" data-testid="pv-missing-record">
      <h1>Process view</h1>
      <p className="notice">{id ? `There is no batch record ${id} in this project.` : "No batch record was chosen."}</p>
      <p>
        <a href={href("/mbr")}>All batch records</a>
      </p>
    </div>
  );
}

export function MbrProcessView({ rec }: { rec: MbrRecord }) {
  const project = useStore((s) => s.project)!;
  const suggestions = useEffectiveSuggestions();
  const view = useMemo(() => buildProcessView(project, rec, { expected: expectedStudies(suggestions) }), [project, rec, suggestions]);
  const [index, setIndex] = useState(0);
  // Ease-of-use pass (EOU-30): a record with no sections has nothing to draw. One line and a way back to where sections are added,
  // not the long explanation, the legend and a slider over two moments ("Before the first step", "After the last step").
  if (rec.sections.length === 0)
    return (
      <MbrFrame rec={rec} tab="view">
        <p className="notice" data-testid="pv-empty">
          This batch record has no sections yet, so there is nothing to draw. Add them on the <a href={href("/mbr", { mbr: rec.id })}>Edit tab</a>, and the equipment train appears here.
        </p>
      </MbrFrame>
    );
  const last = view.moments.length - 1;
  const at = Math.min(index, last);
  const moment = view.moments[at]!;
  const section = moment.sectionId ? rec.sections.find((s) => s.id === moment.sectionId) : undefined;
  const clocksNow = view.clocks.map((c) => ({ c, status: clockStatusAt(c, at) })).filter((x) => x.status !== "not_here");
  const samplesNow = view.samples.filter((s) => s.momentIndex === at);
  const volume = view.momentVolumes[at]!;
  const conditions = section ? section.blocks.flatMap((b) => b.params).filter((p) => !/range/i.test(p.label) && p.mbrValue) : [];
  const counts = (["major", "minor", "note"] as const).map((s) => [s, view.findings.filter((f) => f.severity === s).length] as const);

  return (
    <MbrFrame rec={rec} tab="view">
    <div className="stack-lg" data-testid="pv-page">
      {/* Open on a wide screen, closed on a phone: there the controls ("Where is the product?") would otherwise sit below two long
          paragraphs and the legend. The explanation is one tap away. */}
      <PvAbout>
        <p>
          The batch record drawn as an equipment train. Move through its steps with the slider to see where the product is, which clocks are running against their limits, and which samples are taken at that moment. Fixed rules check the record
          and list review prompts. The same record always gives the same answer.
        </p>
        <p className="small muted">
          The record has no clock times, so the picture does not run a timeline. Every number comes from the record or its linked TRD and sampling plan; where a check needs a number the record does not state, it says &quot;Not enough data
          in the record&quot; and does not guess. Findings are prompts for a person to review. They do not approve anything and do not decide a filing category.
        </p>
        <Legend view={view} />
      </PvAbout>

      <section className="card stack" aria-labelledby="pv-moments">
        <h2 id="pv-moments">Where is the product?</h2>
        <div className="pv-ctl">
          <button type="button" className="btn" onClick={() => setIndex(Math.max(0, at - 1))} disabled={at === 0} data-testid="pv-prev">
            Previous
          </button>
          <label className="pv-slider">
            <span>
              Moment <span data-testid="pv-moment-num">{at + 1}</span> of {view.moments.length}
            </span>
            <input type="range" min={1} max={view.moments.length} step={1} value={at + 1} onChange={(e) => setIndex(Number(e.target.value) - 1)} aria-valuetext={`Moment ${at + 1} of ${view.moments.length}: ${moment.title}`} data-testid="pv-slider" />
          </label>
          <button type="button" className="btn" onClick={() => setIndex(Math.min(last, at + 1))} disabled={at === last} data-testid="pv-next">
            Next
          </button>
          <label className="field pv-jump">
            <span>Jump to a moment</span>
            <select value={at} onChange={(e) => setIndex(Number(e.target.value))} data-testid="pv-jump">
              {view.moments.map((m) => (
                <option key={m.index} value={m.index}>
                  {m.index + 1}. {m.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <h3 className="pv-title" data-testid="pv-moment-title">
          {moment.title}
        </h3>
        <p className="small muted">
          {view.split ? `Part ${moment.part}. ` : ""}
          {moment.stepRange ? `Steps ${moment.stepRange}.` : "No steps at this moment."}
        </p>
        <p className="pv-describe" role="status" aria-live="polite" data-testid="pv-describe">
          {describeMoment(view, at)}
        </p>
        <div className="pv-diagram" role="region" aria-label="Equipment train diagram. It scrolls sideways on a narrow screen." tabIndex={0} data-testid="pv-diagram">
          <Train view={view} at={at} />
        </div>
      </section>

      <div className="pv-panels">
        <section className="card stack" aria-labelledby="pv-here" data-testid="pv-panel-here">
          <h2 id="pv-here">The product now</h2>
          <p>
            {moment.kind === "start" && "Nothing has started: no step has been done."}
            {moment.kind === "end" && "Every step of the record has been done."}
            {(moment.kind === "block" || moment.kind === "hold_start" || moment.kind === "hold_end") && (
              <>
                {moment.kind === "block" ? "In " : "At the "}
                <strong>{moment.kind === "block" ? `section ${moment.sectionNumber}: ${section?.title}` : moment.title.toLowerCase()}</strong>.
              </>
            )}
          </p>
          <h3>Volume</h3>
          {volume.statedL !== undefined ? (
            <ul className="plain-list small" data-testid="pv-volume">
              <li>
                Batch volume the section states: {num(volume.statedL)} L (row {volume.statedRowId}).
              </li>
              <li>Taken as samples in this section up to this moment: {num(volume.withdrawnL)} L.</li>
              {volume.flushedL > 0 && <li data-testid="pv-flushed">Flushed to waste before those samples (stated volumes only): {num(volume.flushedL)} L.</li>}
              <li>
                Left after those samples{volume.flushedL > 0 ? " and flushes" : ""}: {num(volume.remainingL ?? 0)} L. Other losses in lines and filters are not stated and are not subtracted.
              </li>
            </ul>
          ) : moment.sectionNumber !== undefined ? (
            <div className="small" data-testid="pv-volume">
              <p>Not enough data in the record: {volume.missing}.</p>
              <p>Taken as samples in this section up to this moment: {num(volume.withdrawnL)} L.</p>
              {volume.flushedL > 0 && <p data-testid="pv-flushed">Flushed to waste before those samples (stated volumes only): {num(volume.flushedL)} L.</p>}
              {volume.planBatches && <p>Batch sizes of the linked sampling plan: {volume.planBatches.map((b) => `${b.label} ${num(b.sizeL)} L`).join("; ")}. The record is not tied to one batch.</p>}
            </div>
          ) : (
            <p className="small muted">No section is active at this moment.</p>
          )}
          <h3>Conditions the section states</h3>
          {conditions.length === 0 ? (
            <p className="small" data-testid="pv-conditions">Not stated: this section has no parameter row with a value.</p>
          ) : (
            <ul className="plain-list small" data-testid="pv-conditions">
              {conditions.slice(0, 8).map((p) => (
                <li key={p.id}>
                  {p.label}: {p.mbrValue} {p.mbrUnit ?? ""}
                  {p.studyPoint ? " (study point)" : ""}
                </li>
              ))}
              {conditions.length > 8 && <li>and {conditions.length - 8} more rows in the batch record.</li>}
            </ul>
          )}
        </section>

        <section className="card stack" aria-labelledby="pv-clocks" data-testid="pv-panel-clocks">
          <h2 id="pv-clocks">Clocks against their limits</h2>
          {clocksNow.length === 0 ? (
            <p className="small">No clock runs or applies at this moment.</p>
          ) : (
            clocksNow.map(({ c, status }) => <ClockBar key={c.id} clock={c} status={CLOCK_STATUS_TEXT[status]} />)
          )}
          <p className="small muted">
            {view.clocks.length} clocks in all; see the table of all clocks below.
          </p>
        </section>

        <section className="card stack" aria-labelledby="pv-samples" data-testid="pv-panel-samples">
          <h2 id="pv-samples">Samples at this moment</h2>
          {samplesNow.length === 0 ? (
            <p className="small">No sample is taken at this moment.</p>
          ) : (
            <ul className="plain-list small" data-testid="pv-samples-now">
              {samplesNow.map((s) => (
                <li key={s.rowId}>
                  <strong>{s.pointId}</strong>: {s.test}. Quantity: {s.quantityText ?? "not stated"}. {s.stepNumber ? `Step ${s.stepNumber}. ` : "On the hold entry. "}
                  {s.port ? `Taken at: ${s.port}.` : "No port named in the step."}
                  {s.method && <span data-testid={`pv-method-${s.pointId}`}> How it is taken: {s.method.text}.</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Findings view={view} counts={counts} go={setIndex} />
      <Tables view={view} go={setIndex} />

      <section className="card stack" aria-labelledby="pv-ass" data-testid="pv-assumptions">
        <h2 id="pv-ass">What the tracker assumes</h2>
        <ol className="plain-list">
          {view.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      </section>
    </div>
    </MbrFrame>
  );
}

// ------------------------------------------------------------------ pieces

function Legend({ view }: { view: ProcessView }) {
  const kinds = SAMPLE_ACCESS.filter((a) => view.samples.some((s) => s.method?.access === a));
  return (
    <ul className="pv-legend" aria-label="Legend">
      <li>
        <svg width="26" height="16" aria-hidden="true">
          <rect x="1.5" y="1.5" width="23" height="13" className="pv-shape now" />
        </svg>
        Product is here now
      </li>
      <li>
        <svg width="26" height="16" aria-hidden="true">
          <rect x="1.5" y="1.5" width="23" height="13" className="pv-shape done" />
        </svg>
        Product has been through
      </li>
      <li>
        <svg width="26" height="16" aria-hidden="true">
          <rect x="1.5" y="1.5" width="23" height="13" className="pv-shape todo" />
        </svg>
        Not reached yet
      </li>
      <li>
        <svg width="16" height="16" aria-hidden="true">
          <path d="M8 1 L15 8 L8 15 L1 8 Z" className="pv-mark now" />
        </svg>
        Volume sample
      </li>
      <li>
        <svg width="16" height="16" aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" className="pv-mark now" />
        </svg>
        Sample counted in units (syringes)
      </li>
      <li>
        <svg width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" className="pv-mark now" />
        </svg>
        Sample with no readable quantity
      </li>
      <li>Marker outline: bold = taken now, solid = taken earlier, dotted = taken later</li>
      {kinds.map((a) => (
        <li key={a} data-testid={`pv-legend-${a}`}>
          <svg width="34" height="18" viewBox="-2 -1 34 18" aria-hidden="true">
            <AccessGlyph access={a} added={false} />
          </svg>
          {ACCESS_LEGEND[a]}
        </li>
      ))}
      {view.samples.some((s) => s.method?.addedForStudy) && (
        <li data-testid="pv-legend-added">
          <svg width="34" height="18" viewBox="-2 -1 34 18" aria-hidden="true">
            <AccessGlyph access="added_y_connector" added />
          </svg>
          Dashed part: added only for the study (the tag says PPQ only or study only)
        </li>
      )}
      {view.samples.some((s) => s.method?.flush?.volumeText) && (
        <li data-testid="pv-legend-flush">
          <svg width="44" height="18" viewBox="0 -1 44 18" aria-hidden="true">
            <FlushDrawing />
          </svg>
          Flushed or discarded to waste before the sample (volume as written in the plan)
        </li>
      )}
    </ul>
  );
}

const ACCESS_LEGEND: Record<SampleAccess, string> = {
  dedicated_port: "Dedicated sampling port",
  shared_port: "Shared port (a thin line joins the samples drawn from it)",
  added_y_connector: "Y-connector",
  bag_sample_manifold: "Bag sample manifold",
  aseptic_connector: "Aseptic connector",
  grab_open: "Open grab sample",
  other: "Other way of taking the sample (see the sample list)",
};

/**
 * How the sample leaves the closed system, drawn in a 30 x 16 box: decoration next to text (the sample list and the tables say the same
 * in words). A dashed line means the part was added only for the study. Only the line style differs, so the cue is not colour.
 */
function AccessGlyph({ access, added }: { access: SampleAccess; added: boolean }) {
  const cls = `pv-glyph${added ? " added" : ""}`;
  switch (access) {
    case "dedicated_port": // pipe with one stub and a cap
      return <path d="M0 14 H30 M15 14 V4 M11 4 H19" className={cls} />;
    case "shared_port": // the same stub with a ring: more than one sample leaves here
      return (
        <g>
          <path d="M0 14 H30 M15 14 V7"className={cls} />
          <circle cx="15" cy="4" r="3" className={cls} />
        </g>
      );
    case "added_y_connector": // trunk with two arms
      return <path d="M0 8 H11 M11 8 L24 1 M11 8 L24 15" className={cls} />;
    case "bag_sample_manifold": // a comb: spine with teeth
      return <path d="M0 14 H30 M5 14 V3 M12 14 V3 M19 14 V3 M26 14 V3" className={cls} />;
    case "aseptic_connector": // two halves with a gap
      return <path d="M0 8 H10 M10 2 V14 M10 2 H14 M10 14 H14 M20 2 V14 M20 2 H16 M20 14 H16 M20 8 H30" className={cls} />;
    case "grab_open": // an open cup, always dashed: nothing closed about it
      return <path d="M5 2 L8 14 H22 L25 2" className="pv-glyph added" />;
    default: // another way, described in words
      return <circle cx="15" cy="8" r="5" className={cls} />;
  }
}

/** The flush: an arrow to a waste mark (an open container). */
function FlushDrawing() {
  return <path d="M0 8 H15 M11 4 L16 8 L11 12 M20 2 V14 H34 V2" className="pv-waste" />;
}

const CELL_W = 190;
const CELL_H = 270;
const PER_ROW = 6;
const MARK_ROW = 24;
const MARK_MAX = 12;

interface MarkPos {
  s: ViewSample;
  x: number;
  y: number;
}

/**
 * Where the sample markers of one piece of equipment sit. A marker with no method answer keeps its small place (three to a row). A marker
 * with a method gets a row of its own, because the glyph, the study tag and the flush to waste need the width of the cell; the flush
 * adds a second line. Nothing is drawn for a point that says nothing about how it is taken.
 */
function layoutMarks(marks: ViewSample[]): { items: MarkPos[]; height: number } {
  const shown = marks.slice(0, MARK_MAX);
  const plain = shown.filter((s) => !s.method);
  const items: MarkPos[] = plain.map((s, k) => ({ s, x: 4 + (k % 3) * 62, y: Math.floor(k / 3) * MARK_ROW }));
  let y = Math.ceil(plain.length / 3) * MARK_ROW;
  for (const s of shown.filter((x) => x.method)) {
    items.push({ s, x: 4, y });
    y += s.method!.flush?.volumeText ? MARK_ROW + 22 : MARK_ROW + 2;
  }
  return { items, height: y };
}

/**
 * Cell position: rows run left to right, then right to left, so the pipe between rows is a straight drop. `rowTop` holds where each
 * row starts below the band of side branches (rows have their own heights, see Train).
 */
function cellAt(i: number, top = 0, rowTop: number[] = []) {
  const row = Math.floor(i / PER_ROW);
  const col = i % PER_ROW;
  return { x: 20 + (row % 2 === 0 ? col : PER_ROW - 1 - col) * CELL_W, y: 10 + top + (rowTop[row] ?? row * CELL_H), row };
}

/**
 * Which equipment is drawn as a side branch. A buffer preparation is a parallel preparation that is added INTO a compounding step, so it
 * hangs above the main train with an arrow into the pipe that carries the product into that step. That needs a main-line step before the
 * target in the first row of the train (the arrow joins the pipe between the two); where it does not fit, the preparation stays in the
 * line as before, which is the engine's fallback too (no compounding step after it).
 */
function splitBranches(equipment: ViewEquipment[]): { main: ViewEquipment[]; branches: { eq: ViewEquipment; target: number }[] } {
  let candidates = equipment.filter((e) => e.feedsInto);
  for (;;) {
    const main = equipment.filter((e) => !candidates.includes(e));
    const fit = candidates.filter((e) => {
      const t = main.findIndex((m) => m.sectionId === e.feedsInto);
      return t >= 1 && t < PER_ROW;
    });
    if (fit.length === candidates.length) return { main, branches: candidates.map((eq) => ({ eq, target: main.findIndex((m) => m.sectionId === eq.feedsInto) })) };
    candidates = fit;
  }
}

/** Exported so a unit test can draw it for a hand-made record and check the layout (branches never overlap, no empty space below). */
export function Train({ view, at }: { view: ProcessView; at: number }) {
  const moment = view.moments[at]!;
  // Which equipment the product has been through: those first used at or before this moment (a hold counts once its start is reached).
  const firstUse = new Map<string, number>();
  for (const m of view.moments) if (m.equipmentId && !firstUse.has(m.equipmentId)) firstUse.set(m.equipmentId, m.index);
  const stateOf = (e: ViewEquipment): "now" | "done" | "todo" => (moment.equipmentId === e.id ? "now" : (firstUse.get(e.id) ?? Infinity) < at ? "done" : "todo");
  const { main, branches } = splitBranches(view.equipment);
  // A sample of a buffer section is drawn under the branch, even when the step that takes it is in the compounding step.
  const ownerOf = (s: ViewSample) => branches.find((b) => b.eq.number === s.sectionNumber)?.eq.id ?? view.moments[s.momentIndex]?.equipmentId;
  const marksOf = (e: ViewEquipment) => view.samples.filter((s) => s.momentIndex >= 0 && ownerOf(s) === e.id);
  // The band above the main train holds the branches: shape and title, status and clock lines, and their sample markers. Each branch has a
  // band row of its own, sitting straight above the step it feeds. Two preparations that feed the same step (or neighbouring steps) used
  // to share one row and were drawn on top of each other. The branch of the later step goes in the upper row, so the arrow of an upper
  // branch drops down on the right of every lower branch and never crosses one.
  const bandRows = [...branches]
    .sort((a, b) => b.target - a.target)
    .reduce<{ eq: ViewEquipment; target: number; top: number }[]>((acc, b) => {
      const last = acc[acc.length - 1];
      const top = last ? last.top + 232 + layoutMarks(marksOf(last.eq)).height : 10;
      return [...acc, { ...b, top }];
    }, []);
  const lastBand = bandRows[bandRows.length - 1];
  const bandH = lastBand ? lastBand.top - 10 + 232 + layoutMarks(marksOf(lastBand.eq)).height : 0;
  // Every row of the train has its own height: a row grows when its markers need more than the usual four rows (a method row is taller
  // than a plain marker). The last row is only as tall as what it holds, so no empty space is left under the diagram.
  const rows = Math.ceil(main.length / PER_ROW);
  const needOf = (e: ViewEquipment) => 168 + layoutMarks(marksOf(e)).height + (marksOf(e).length > MARK_MAX ? 16 : 6);
  const rowH = Array.from({ length: rows }, (_, r) => {
    const need = Math.max(...main.slice(r * PER_ROW, (r + 1) * PER_ROW).map(needOf));
    return r === rows - 1 ? need : Math.max(CELL_H, need);
  });
  const rowTop = rowH.map((_, r) => rowH.slice(0, r).reduce((a, b) => a + b, 0));
  const width = 20 + Math.min(PER_ROW, main.length) * CELL_W;
  const height = bandH + rowH.reduce((a, b) => a + b, 0) + 20;
  // Where each marker with a method sits in the whole drawing, so the thin line of a shared port can join the samples that use it.
  const anchors = new Map<string, { x: number; y: number }>();
  main.forEach((e, i) => {
    const p = cellAt(i, bandH, rowTop);
    for (const m of layoutMarks(marksOf(e)).items) if (m.s.method) anchors.set(m.s.pointId, { x: p.x + m.x + 81, y: p.y + 168 + m.y + 8 });
  });
  bandRows.forEach(({ eq: e, target, top }) => {
    const bx = cellAt(target, bandH, rowTop).x - CELL_W;
    for (const m of layoutMarks(marksOf(e)).items) if (m.s.method) anchors.set(m.s.pointId, { x: bx + m.x + 81, y: top + 194 + m.y + 8 });
  });
  const sharedLines = new Map<string, [{ x: number; y: number }, { x: number; y: number }]>();
  for (const s of view.samples) {
    const a = anchors.get(s.pointId);
    for (const other of s.method?.sharedWith ?? []) {
      const b = anchors.get(other);
      if (a && b) sharedLines.set([s.pointId, other].sort().join("+"), [a, b]);
    }
  }
  const where = moment.equipmentId ? view.equipment.find((e) => e.id === moment.equipmentId)?.title : undefined;
  const nMethod = view.samples.filter((s) => s.method).length;
  const methodNote = nMethod ? ` ${nMethod} ${nMethod === 1 ? "sample shows" : "samples show"} how it is taken; the sample list below says it in words.` : "";
  const branchNote = branches.length ? ` ${branches.length === 1 ? "One side preparation feeds" : `${branches.length} side preparations feed`} the main line.` : "";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`Equipment train of ${countOf(main.length, "item")}.${branchNote} ${where ? `The product is in ${where}.` : "The product is not in any equipment at this moment."}${methodNote}`} className="pv-svg">
      <defs>
        <pattern id="pv-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="pv-hatch" />
        </pattern>
      </defs>
      {main.slice(1).map((e, k) => {
        const a = cellAt(k, bandH, rowTop);
        const b = cellAt(k + 1, bandH, rowTop);
        // Same row: a line between the two shapes. Next row: the pipe runs down the outer edge of the train (right edge after a
        // left-to-right row, left edge after a right-to-left one), so it never crosses the sample markers or the next title.
        const horiz = a.row === b.row;
        const dir = b.x > a.x ? 1 : -1;
        const side = a.row % 2 === 0 ? 1 : -1;
        const edge = a.x + 95 + side * 87;
        const d = horiz ? `M${a.x + 95 + dir * 62} ${a.y + 62} H${b.x + 95 - dir * 62}` : `M${a.x + 95 + side * 62} ${a.y + 62} H${edge} V${b.y + 62} H${b.x + 95 + side * 62}`;
        return <path key={e.id} d={d} className="pv-pipe" markerEnd="url(#pv-arrow)" />;
      })}
      <defs>
        <marker id="pv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1 L9 5 L1 9 Z" className="pv-arrowhead" />
        </marker>
      </defs>
      {/* The thin line of a shared port: drawn under the markers, from one sample that uses the port to the next. */}
      {[...sharedLines].map(([key, [a, b]]) => (
        // In one cell the line runs as a bracket to the right of the glyphs, so it never crosses the "to waste" text between two samples.
        <path key={key} d={Math.abs(a.x - b.x) < 5 ? `M${a.x + 15} ${a.y} H${a.x + 27} V${b.y} H${b.x + 15}` : `M${a.x} ${a.y} L${b.x} ${b.y}`} className="pv-share" data-testid={`pv-share-${key}`} />
      ))}
      {main.map((e, i) => {
        const p = cellAt(i, bandH, rowTop);
        const state = stateOf(e);
        const marks = marksOf(e);
        return (
          <g key={e.id} transform={`translate(${p.x} ${p.y})`} data-testid={`pv-eq-${e.id}`} data-state={state}>
            <text x="95" y="14" textAnchor="middle" className="pv-eqn">
              {e.id === "EQ-HOLD" ? "Hold" : `${e.number}. `}
              {e.id === "EQ-HOLD" ? "" : wrap(e.title)[0]}
            </text>
            {(e.id === "EQ-HOLD" ? wrap(e.title) : wrap(e.title).slice(1)).map((l, k) => (
              <text key={k} x="95" y={28 + k * 13} textAnchor="middle" className="pv-eqn">
                {l}
              </text>
            ))}
            <g transform="translate(35 38)">
              <ShapeDrawing shape={e.shape} state={state} />
            </g>
            <text x="95" y="146" textAnchor="middle" className="pv-eqs">
              {state === "now" ? "Product is here" : state === "done" ? "Done" : "Not yet"}
              {view.split ? ` (Part ${e.part})` : ""}
            </text>
            {!e.known && (
              <text x="95" y="159" textAnchor="middle" className="pv-eqs">
                generic shape
              </text>
            )}
            {layoutMarks(marks).items.map((m) => (
              <Marker key={m.s.rowId} sample={m.s} x={m.x} y={168 + m.y} at={at} />
            ))}
            {marks.length > MARK_MAX && (
              <text x="95" y={168 + layoutMarks(marks).height + 8} textAnchor="middle" className="pv-eqs">
                and {marks.length - MARK_MAX} more samples
              </text>
            )}
          </g>
        );
      })}
      {bandRows.map(({ eq: e, target, top }) => {
        // The arrow joins the pipe that carries the product into the step the buffer is added to (the middle of the gap before it), so it
        // reads as "added into step N", not as a step of the line. The branch sits in the cell just left of that step, in its own band row.
        const into = cellAt(target, bandH, rowTop);
        const joinX = into.x;
        const bx = joinX - CELL_W;
        const by = top;
        const state = stateOf(e);
        const marks = marksOf(e);
        const clock = view.clocks.find((c) => c.onBranch && c.kind === "hold" && c.sectionNumber === e.number);
        const running = clock !== undefined && clockStatusAt(clock, at) === "running";
        const clockLines = clock ? wrap(`${clock.label}${clock.limitText ? `, limit ${clock.limitText}` : ", no limit stated"}`, 34).slice(0, 2) : [];
        return (
          <g key={e.id}>
            <path d={`M${bx + 157} ${by + 62} H${joinX} V${into.y + 60}`} className="pv-pipe" markerEnd="url(#pv-arrow)" data-testid={`pv-feed-${e.id}`} />
            <g transform={`translate(${bx} ${by})`} data-testid={`pv-eq-${e.id}`} data-state={state} data-branch="true">
              <text x="95" y="14" textAnchor="middle" className="pv-eqn">
                {e.number}. {wrap(e.title)[0]}
              </text>
              {[...wrap(e.title).slice(1), `Side branch, feeds step ${e.feedsIntoNumber}`].map((l, j) => (
                <text key={j} x="95" y={28 + j * 13} textAnchor="middle" className="pv-eqn">
                  {l}
                </text>
              ))}
              <g transform="translate(35 38)">
                <ShapeDrawing shape={e.shape} state={state} />
                {clock && (
                  <g data-testid={`pv-clock-icon-${e.id}`} data-running={running ? "true" : "false"}>
                    <circle cx="104" cy="22" r="11" className={`pv-shape ${running ? "now" : "todo"}`} />
                    <path d="M104 22 V14 M104 22 L110 26" className="pv-line" />
                  </g>
                )}
              </g>
              <text x="95" y="146" textAnchor="middle" className="pv-eqs" data-testid={`pv-branch-status-${e.id}`}>
                {branchStatusAt(e, at, clock !== undefined)}
              </text>
              {clockLines.map((l, j) => (
                <text key={j} x="95" y={159 + j * 13} textAnchor="middle" className="pv-eqs">
                  {l}
                </text>
              ))}
              {layoutMarks(marks).items.map((m) => (
                <Marker key={m.s.rowId} sample={m.s} x={m.x} y={194 + m.y} at={at} />
              ))}
              {marks.length > MARK_MAX && (
                <text x="95" y={194 + layoutMarks(marks).height + 8} textAnchor="middle" className="pv-eqs">
                  and {marks.length - MARK_MAX} more samples
                </text>
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function Marker({ sample, x, y, at }: { sample: ViewSample; x: number; y: number; at: number }) {
  const state = sample.momentIndex === at ? "now" : sample.momentIndex < at ? "done" : "todo";
  const shape = sample.kind === "volume" ? <path d="M8 1 L15 8 L8 15 L1 8 Z" /> : sample.kind === "units" ? <rect x="2" y="2" width="12" height="12" /> : <circle cx="8" cy="8" r="6" />;
  const method = sample.method;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`pv-mark ${state}`} data-testid={`pv-mark-${sample.pointId}`} data-state={state}>
        {shape}
        <text x="19" y="12" className="pv-marktx">
          {sample.pointId}
        </text>
        {method && <title>{`${sample.pointId}, ${method.text}`}</title>}
      </g>
      {/* The glyph, tag and flush are decoration next to the words of the sample list; nothing is drawn for a point with no method. */}
      {method?.access && (
        <g transform="translate(66 0)" data-testid={`pv-glyph-${sample.pointId}`} data-access={method.access} data-added={method.addedForStudy ? "true" : "false"}>
          <AccessGlyph access={method.access} added={method.addedForStudy === true} />
        </g>
      )}
      {method?.addedForStudy && (
        <text x="100" y="12" className="pv-marktx pv-studytag" data-testid={`pv-tag-${sample.pointId}`}>
          {method.studyTag}
        </text>
      )}
      {method?.flush?.volumeText && (
        <g transform="translate(4 24)" data-testid={`pv-waste-${sample.pointId}`}>
          <FlushDrawing />
          <text x="40" y="12" className="pv-marktx">
            {method.flush.volumeText} to waste
          </text>
        </g>
      )}
    </g>
  );
}

/** A schematic of the kind of equipment, 120 by 90. The shape follows the unit operation; positions and pipes are not process data. */
function ShapeDrawing({ shape, state }: { shape: ViewEquipment["shape"]; state: "now" | "done" | "todo" }) {
  const cls = `pv-shape ${state}`;
  switch (shape) {
    case "filter":
      return (
        <g>
          <rect x="35" y="4" width="50" height="82" rx="10" className={cls} />
          <path d="M45 22 H75 M45 36 H75 M45 50 H75 M45 64 H75" className="pv-line" />
          <path d="M60 0 V4 M60 86 V90" className="pv-line" />
        </g>
      );
    case "filler":
      return (
        <g>
          <rect x="10" y="4" width="100" height="40" rx="4" className={cls} />
          <path d="M30 44 V76 M60 44 V76 M90 44 V76" className="pv-line" />
          <rect x="22" y="76" width="16" height="12" className={cls} />
          <rect x="52" y="76" width="16" height="12" className={cls} />
          <rect x="82" y="76" width="16" height="12" className={cls} />
        </g>
      );
    case "thaw":
      // Frozen drug substance bottles standing on a rack, a frost mark on each and a drop falling from the rack: thawing, not a vessel.
      return (
        <g>
          {[20, 52, 84].map((x) => (
            <g key={x}>
              <rect x={x + 5} y="16" width="14" height="7" className={cls} />
              <rect x={x + 7} y="23" width="10" height="10" className={cls} />
              <rect x={x} y="33" width="24" height="37" rx="5" className={cls} />
              <path d={`M${x + 12} 42 V56 M${x + 5} 49 H${x + 19} M${x + 7} 44 L${x + 17} 54 M${x + 7} 54 L${x + 17} 44`} className="pv-line" />
            </g>
          ))}
          <rect x="8" y="70" width="104" height="8" className={cls} />
          <path d="M14 78 V88 M106 78 V88" className="pv-line" />
          <path d="M36 80 q-3 4 0 6 q3 -2 0 -6 M68 80 q-3 4 0 6 q3 -2 0 -6 M100 80 q-3 4 0 6 q3 -2 0 -6" className="pv-line" />
        </g>
      );
    case "inspection":
      return (
        <g>
          <rect x="10" y="12" width="100" height="70" rx="6" className={cls} />
          <circle cx="60" cy="47" r="18" className="pv-line" />
          <path d="M73 60 L90 77" className="pv-line" />
        </g>
      );
    case "packing":
      return (
        <g>
          <rect x="15" y="22" width="90" height="62" className={cls} />
          <path d="M15 22 L30 6 H90 L105 22 M60 22 V84" className="pv-line" />
        </g>
      );
    case "container":
      return (
        <g>
          <rect x="8" y="20" width="104" height="52" rx="3" className={cls} />
          <path d="M28 20 V72 M48 20 V72 M68 20 V72 M88 20 V72" className="pv-line" />
          <circle cx="30" cy="80" r="7" className={cls} />
          <circle cx="90" cy="80" r="7" className={cls} />
        </g>
      );
    case "storage":
      return (
        <g>
          <rect x="22" y="4" width="76" height="82" rx="4" className={cls} />
          <path d="M22 32 H98 M22 58 H98" className="pv-line" />
        </g>
      );
    case "document":
      return (
        <g>
          <path d="M30 4 H78 L94 20 V86 H30 Z" className={cls} />
          <path d="M78 4 V20 H94 M40 38 H84 M40 52 H84 M40 66 H72" className="pv-line" />
        </g>
      );
    case "hold":
      return (
        <g>
          <circle cx="60" cy="46" r="36" className={cls} />
          <path d="M60 46 V24 M60 46 L76 56" className="pv-line" />
        </g>
      );
    case "vessel":
      return (
        <g>
          <path d="M22 10 H98 V70 Q98 86 82 86 H38 Q22 86 22 70 Z" className={cls} />
          <path d="M60 0 V54 M46 54 H74" className="pv-line" />
        </g>
      );
    default:
      // Unknown or custom unit operation: a plain vessel, labelled "generic shape" under it.
      return (
        <g>
          <path d="M22 10 H98 V70 Q98 86 82 86 H38 Q22 86 22 70 Z" className={cls} />
        </g>
      );
  }
}

function ClockBar({ clock: c, status }: { clock: ViewClock; status: string }) {
  const max = Math.max(c.limitHours ?? 0, c.plannedHours ?? 0) * 1.15 || 1;
  const over = c.limitHours !== undefined && c.plannedHours !== undefined && c.plannedHours > c.limitHours;
  return (
    <div className="pv-clock" data-testid={`pv-clock-${c.id}`}>
      <div className="pv-clock-h">
        <strong>{clockLabel(c)}</strong>
        <span className={`pv-tag ${status.startsWith("Running") ? "run" : ""}`}>{status}</span>
      </div>
      {c.limitHours !== undefined || c.plannedHours !== undefined ? (
        <div className="pv-bar" role="img" aria-label={`Planned ${c.plannedHours !== undefined ? hoursText(c.plannedHours) : "not stated"} against the limit ${c.limitHours !== undefined ? hoursText(c.limitHours) : "not stated"}`}>
          {c.plannedHours !== undefined && <i className={over ? "over" : ""} style={{ width: `${(c.plannedHours / max) * 100}%` }} />}
          {c.limitHours !== undefined && <b className="lim" style={{ left: `${(c.limitHours / max) * 100}%` }} />}
        </div>
      ) : null}
      <p className="small">
        {c.limitText ? `Limit ${c.limitText}` : "No limit stated"}
        {c.limitSource ? ` (${c.limitSource})` : ""}.{" "}
        {c.plannedText ? (
          <>
            Planned {c.plannedText} ({c.plannedSource}){over ? (c.studyPoint ? ". Longer than the limit by design: the record marks it as a study point." : ". Longer than the limit, and no row marks it as a study point.") : "."}
          </>
        ) : (
          "No planned time stated."
        )}{" "}
        {c.storage ? `Held at ${c.storage}. ` : ""}
        <span className="muted">Span: {c.spanText}.</span>
      </p>
    </div>
  );
}

function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span className={`pv-sev ${severity}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d={SEVERITY_ICON[severity]} fill="currentColor" />
      </svg>
      {SEVERITY_TEXT[severity]}
    </span>
  );
}

const CHECK_STATUS: Record<string, string> = { ok: "No finding", finding: "Review", no_data: "Not enough data", na: "Not applicable" };

function Findings({ view, counts, go }: { view: ProcessView; counts: (readonly [Severity, number])[]; go: (i: number) => void }) {
  return (
    <section className="card stack" aria-labelledby="pv-find" data-testid="pv-findings">
      <h2 id="pv-find">Review prompts</h2>
      <p className="small muted">
        Each rule runs on the record&apos;s own data. Major: the record contradicts its own numbers. Minor: a gap or an inconsistency to look at. Note: worth knowing. A rule that lacks data says so instead of guessing.
      </p>
      <p data-testid="pv-counts">
        {counts.map(([s, n]) => (
          <span key={s} className="pv-count">
            <SeverityTag severity={s} /> {n}
          </span>
        ))}
        <span className="pv-count">Rules lacking data: {view.checks.filter((c) => c.status === "no_data").length}</span>
      </p>
      {view.findings.length === 0 && <p className="notice">No finding. {view.missingData.length > 0 ? "Some rules could not run: see below." : ""}</p>}
      {view.findings.map((f) => (
        <article key={f.id} className={`pv-find ${f.severity}`} data-testid={`pv-finding-${f.id}`}>
          <h3>
            <SeverityTag severity={f.severity} /> {f.id} ({f.checkId}): {f.title}
          </h3>
          <p>{f.detail}</p>
          <p className="small muted">
            {f.steps.length > 0 && <>Steps: {f.steps.join(", ")}. </>}
            {f.rows.length > 0 && <>Rows: {f.rows.join(", ")}. </>}
          </p>
          {f.moments.length > 0 && (
            <button type="button" className="btn small" onClick={() => go(f.moments[0]!)}>
              Show at moment {f.moments[0]! + 1}
            </button>
          )}
          {/* The sampling-plan difference is in the batch record, not in the picture: its open items name the points and its sample tables the rows. */}
          {f.checkId === "S7" && (
            <p>
              <a href={href("/mbr", { mbr: view.recordId })}>Open the batch record</a>
            </p>
          )}
        </article>
      ))}
      <h3>Not enough data in the record</h3>
      {view.missingData.length === 0 ? (
        <p className="small" data-testid="pv-missing">Every rule that applies had the data it needs.</p>
      ) : (
        <ul className="plain-list" data-testid="pv-missing">
          {view.checks
            .filter((c) => c.status === "no_data")
            .map((c) => (
              <li key={c.id}>
                <strong>
                  {c.id}: {c.title}.
                </strong>{" "}
                Not enough data in the record: {c.missing.join("; ")}.
              </li>
            ))}
        </ul>
      )}
      <h3>All rules</h3>
      <div className="table-scroll" role="region" aria-label="All tracker rules" tabIndex={0}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Group</th>
              <th scope="col">What it checks</th>
              <th scope="col">Needs</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {view.checks.map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.id}</th>
                <td>{c.group}</td>
                <td>{c.title}</td>
                <td className="small">{c.needs}</td>
                <td>
                  <strong>{CHECK_STATUS[c.status]}.</strong> {c.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tables({ view, go }: { view: ProcessView; go: (i: number) => void }) {
  return (
    <section className="card stack" aria-labelledby="pv-tables" data-testid="pv-tables">
      <h2 id="pv-tables">Clocks, samples and volumes in full</h2>
      <h3>All clocks</h3>
      <div className="table-scroll" role="region" aria-label="All clocks" tabIndex={0}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Clock</th>
              <th scope="col">Limit</th>
              <th scope="col">Planned</th>
              <th scope="col">Span</th>
            </tr>
          </thead>
          <tbody>
            {view.clocks.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  {clockLabel(c)} <span className="muted small">({c.id})</span>
                </th>
                <td>{c.limitText ? `${c.limitText} (${c.limitSource})` : "No limit stated"}</td>
                <td>{c.plannedText ? `${c.plannedText} (${c.plannedSource})${c.studyPoint ? ", study point" : ""}` : "Not stated"}</td>
                <td>{c.spanText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Samples</h3>
      <div className="table-scroll" role="region" aria-label="All samples" tabIndex={0}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th scope="col">Test</th>
              <th scope="col">Quantity</th>
              <th scope="col">Taken at</th>
              <th scope="col">Port named</th>
              <th scope="col">How it is taken (sampling plan)</th>
            </tr>
          </thead>
          <tbody>
            {view.samples.map((s) => (
              <tr key={s.rowId}>
                <th scope="row">{s.pointId}</th>
                <td>{s.test}</td>
                <td>{s.quantityText ?? "Not stated"}</td>
                <td>
                  <button type="button" className="btn small" onClick={() => go(s.momentIndex)}>
                    Moment {s.momentIndex + 1}
                  </button>{" "}
                  {s.tiedToStep ? (s.stepNumber ? `step ${s.stepNumber}` : "hold entry") : "no step takes it"}
                </td>
                <td>{s.port ?? "None named"}</td>
                <td>{s.method?.text ?? "Not stated"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Sample volumes against the batch volume of each section</h3>
      <div className="table-scroll" role="region" aria-label="Sample volume per section" tabIndex={0}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Section</th>
              <th scope="col">Batch volume stated</th>
              <th scope="col">Samples (volume)</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {view.volumeSections
              .filter((v) => v.sampleCount > 0 || v.statedL !== undefined)
              .map((v) => (
                <tr key={v.sectionNumber}>
                  <th scope="row">
                    {v.sectionNumber}. {v.sectionTitle}
                  </th>
                  <td>{v.statedL !== undefined ? `${num(v.statedL)} L (row ${v.statedRowId})` : `Not enough data: ${v.missing}`}</td>
                  <td>
                    {num(v.sampleMl / 1000)} L in {countOf(v.sampleCount, "sample")}
                    {v.flushMl > 0 ? `; plus ${num(v.flushMl / 1000)} L flushed to waste (not sample volume)` : ""}
                  </td>
                  <td>{v.percent !== undefined ? `${num(v.percent, 2)} %` : "Not enough data"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <h3>Volume filled against the batch sizes of the sampling plan</h3>
      {view.volumeBatches.length === 0 ? (
        <p className="small">Not enough data in the record: no sampling plan with batches is linked.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Volume filled per batch" tabIndex={0}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Batch</th>
                <th scope="col">Batch size</th>
                <th scope="col">Planned units</th>
                <th scope="col">Filled (units x fill volume)</th>
                <th scope="col">Not filled</th>
              </tr>
            </thead>
            <tbody>
              {view.volumeBatches.map((b) => (
                <tr key={b.batchId}>
                  <th scope="row">{b.label}</th>
                  <td>{b.batchSizeL !== undefined ? `${num(b.batchSizeL)} L` : "Not stated"}</td>
                  <td>{b.units !== undefined ? b.units.toLocaleString("en") : "Not stated"}</td>
                  <td>{b.filledL !== undefined ? `${num(b.filledL)} L` : "Not enough data"}</td>
                  <td>
                    {b.leftoverL !== undefined ? `${num(b.leftoverL)} L${b.status === "over" ? " (negative: more filled than made)" : ""}` : `Not enough data: ${b.missing.join("; ")}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Equipment drawn</h3>
      <div className="table-scroll" role="region" aria-label="Equipment drawn" tabIndex={0}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Drawn item</th>
              <th scope="col">Unit operation</th>
              <th scope="col">Shape</th>
            </tr>
          </thead>
          <tbody>
            {view.equipment.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.id === "EQ-HOLD" ? e.title : `${e.number}. ${e.title}`}</th>
                <td>{e.unitOp ?? "None (custom section)"}</td>
                <td>{e.known ? e.shape : "generic (no known shape for this unit operation)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
