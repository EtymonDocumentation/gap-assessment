import {
  mapAlsoDoneInText,
  mapMoreDetailText,
  mapNodeName,
  mapStatusStyle,
  mapStatusText,
  type InterviewMap,
  type InterviewMapWording,
  type MapIcon,
  type MapNode,
} from "@gap/engine";
import { FACILITY_GRADE_LABEL } from "@gap/process-model";
import { href } from "./router";

/*
 * The interview map (M14): ONE generic screen part for the maps of an interview, so the gap interview can use it later. It draws the
 * nodes the engine's `buildProcessMap` / `buildAreaMap` made, as process tiles or as read-only nested area cards. It holds no answer and
 * no count of its own: every number and every word comes from the engine and the wording file, so the map cannot disagree with the list.
 * Every state is said in words, with an icon and a border style, never by colour alone.
 */

const GLYPH: Record<MapIcon, string> = { check: "✓", circle: "○", "half-circle": "◐", dash: "–", question: "?" };

/** The icon, drawn as a character; the words beside it say the same thing, so it is hidden from a screen reader. */
function Icon({ name }: { name: MapIcon }) {
  return (
    <span className="imap-icon" aria-hidden="true">
      {GLYPH[name]}
    </span>
  );
}

export interface InterviewMapViewProps {
  map: InterviewMap;
  wording: InterviewMapWording;
  /** The heading of the map: the name of the view in the person's words. */
  title: string;
  hint: string;
  /** Opens the run for a node. Only called for a node that has questions in view. */
  onOpen: (node: MapNode) => void;
  /** The tile the person just came back from: it carries aria-current and gets the focus. */
  currentId?: string | null;
  /** Shown above the map, beside the title (the "Go to the next open question" button, the unit switch). */
  actions?: React.ReactNode;
  /** The text of the empty area state, when the unit has no areas. */
  emptyAreas?: React.ReactNode;
  /** Where the "Your areas" page opens (the area view only): the edit button, and the two buttons of the empty state. */
  areaLinks?: { edit: string; first: string; example: string };
  /** Prefix of the test ids (`<prefix>-node-<id>`). */
  testPrefix?: string;
}

const canOpen = (n: MapNode) => n.status !== "left_out" && n.questionKeys.length > 0;

/** "Left out of this project: <reason>" for a step the project leaves out but the interview still asks about (the state line then holds the counts). */
const leftOutNote = (n: MapNode, w: InterviewMapWording): string | undefined => (n.status !== "left_out" && n.reason ? w.status.leftOutWithReason.replace("{reason}", n.reason) : undefined);

function Legend({ wording }: { wording: InterviewMapWording }) {
  const l = wording.legend;
  const items: [MapIcon, string, string][] = [
    ["check", "solid", l.allAnswered],
    ["circle", "dashed", l.someOpen],
    ["half-circle", "dashed", l.tbd],
    ["dash", "dotted", l.none],
    ["question", "dashed", l.notPlaced],
  ];
  return (
    <details className="imap-legend" data-testid="imap-legend">
      <summary>{l.title}</summary>
      <ul className="imap-legend-list">
        {items.map(([icon, border, text]) => (
          <li key={text}>
            <span className={`imap-swatch imap-b-${border}`} aria-hidden="true">
              <Icon name={icon} />
            </span>{" "}
            {text}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One tile or card body: name, state line and the extra lines. A step or "whole" node is a button when it can be opened. */
function Tile({ n, w, current, onOpen, prefix }: { n: MapNode; w: InterviewMapWording; current: boolean; onOpen: (n: MapNode) => void; prefix: string }) {
  const style = mapStatusStyle(n);
  const more = mapMoreDetailText(n, w);
  const note = leftOutNote(n, w);
  const cls = `imap-tile imap-b-${style.border}${n.status === "left_out" ? " imap-dim" : ""}${n.kind === "whole" || n.kind === "unplaced" ? " imap-wide" : ""}`;
  const body = (
    <>
      <span className="imap-head">
        {n.number !== undefined && (
          <>
            <span className="imap-num">{n.number}</span>{" "}
          </>
        )}
        <span className="imap-name">{n.label}</span>
      </span>{" "}
      <span className="imap-state" data-testid={`${prefix}-state-${n.id}`}>
        <Icon name={style.icon} />
        <span>{mapStatusText(n, w)}</span>
      </span>
      {note && <span className="imap-note small">{note}</span>}
      {n.kind === "step" && n.areaNames && n.areaNames.length > 0 && <span className="imap-note small">{w.areas.inside.replace("{area}", n.areaNames.join(", "))}</span>}
      {more && <span className="imap-note small">{more}</span>}
    </>
  );
  if (canOpen(n)) {
    return (
      <button type="button" className={cls} {...(current ? { "aria-current": "true" as const } : {})} data-node={n.id} data-testid={`${prefix}-node-${n.id}`} onClick={() => onOpen(n)}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-node={n.id} data-testid={`${prefix}-node-${n.id}`}>
      {body}
      {n.status === "left_out" && n.leftOutCause === "scope" && (
        <a className="small" href={href("/scope")}>
          {w.status.changeInScope}
        </a>
      )}
    </div>
  );
}

function StepsList({ n, w }: { n: MapNode; w: InterviewMapWording }) {
  if (!n.steps) return null;
  if (n.steps.length === 0) return <p className="muted small imap-none">{w.areas.noStepsHere}</p>;
  return (
    <>
      <p className="small imap-steps-title">
        <strong>{w.areas.stepsHere}</strong>
      </p>
      <ul className="imap-steps">
        {n.steps.map((s) => {
          const also = mapAlsoDoneInText(s, w);
          return (
            <li key={s.key} data-testid={`imap-step-${n.id}-${s.key}`}>
              {s.number}. {s.label}
              {s.leftOut ? ` (${w.status.leftOut.toLowerCase()})` : ""}
              {also && <span className="muted small"> ({also})</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A read-only area card with the areas inside it nested in its own list, parent first. */
function AreaCard({ n, all, w, current, currentId, onOpen, prefix }: { n: MapNode; all: readonly MapNode[]; w: InterviewMapWording; current: boolean; currentId?: string | null | undefined; onOpen: (n: MapNode) => void; prefix: string }) {
  const style = mapStatusStyle(n);
  const kids = all.filter((x) => x.parentId === n.id);
  const parent = n.parentId ? all.find((x) => x.id === n.parentId) : undefined;
  const hid = `imap-h-${n.id.replace(/[^\w-]/g, "_")}`;
  const note = leftOutNote(n, w);
  return (
    <li className={`imap-area imap-b-${style.border}${n.status === "left_out" ? " imap-dim" : ""}`} data-testid={`${prefix}-node-${n.id}`} data-node={n.id}>
      <h3 id={hid} className="imap-area-name">
        {n.label}
      </h3>
      <p className="small imap-grade" data-testid={`${prefix}-grade-${n.id}`}>
        <strong>{n.grade ? FACILITY_GRADE_LABEL[n.grade] : w.areas.gradeNotStated}</strong>
        {parent && <span> · {w.areas.inside.replace("{area}", parent.label)}</span>}
        {n.fromExample && <span> · {w.areas.fromExample}</span>}
      </p>
      <p className="imap-state" data-testid={`${prefix}-state-${n.id}`}>
        <Icon name={style.icon} />
        <span>{mapStatusText(n, w)}</span>
      </p>
      {note && <p className="small">{note}</p>}
      <StepsList n={n} w={w} />
      {canOpen(n) && (
        <button type="button" className="btn small imap-open" aria-label={`${w.run.answerHere}: ${mapNodeName(n, w)}`} {...(current ? { "aria-current": "true" as const } : {})} data-node={n.id} data-testid={`${prefix}-open-${n.id}`} onClick={() => onOpen(n)}>
          {w.run.answerHere}
        </button>
      )}
      {kids.length > 0 && (
        <ul className="imap-areas imap-nested" aria-label={`${w.areas.inside.replace("{area}", n.label)}`}>
          {kids.map((k) => (
            <AreaCard key={k.id} n={k} all={all} w={w} current={currentId === k.id} currentId={currentId} onOpen={onOpen} prefix={prefix} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function InterviewMapView({ map, wording: w, title, hint, onOpen, currentId, actions, emptyAreas, areaLinks, testPrefix = "imap" }: InterviewMapViewProps) {
  const prefix = testPrefix;
  const head = (
    <>
      <h2 id={`${prefix}-h`}>{title}</h2>
      <p className="muted small" data-testid={`${prefix}-hint`}>
        {hint}
      </p>
      {actions}
      {areaLinks && map.view === "areas" && !map.empty && (
        <p>
          <a className="btn small" href={areaLinks.edit} data-testid={`${prefix}-edit-areas`} data-tour="interview-areas-setup">
            {w.editor.edit}
          </a>
        </p>
      )}
    </>
  );
  if (map.empty) {
    return (
      <section className="card stack imap" aria-labelledby={`${prefix}-h`} data-testid={prefix}>
        {head}
        <p data-testid={`${prefix}-empty`}>{emptyAreas ?? w.explain.emptyAreas}</p>
        {areaLinks && (
          <div className="row wrap" data-tour="interview-areas-setup">
            <a className="btn primary" href={areaLinks.first} data-testid={`${prefix}-add-first`}>
              {w.explain.addFirst}
            </a>
            <a className="btn" href={areaLinks.example} data-testid={`${prefix}-start-example`}>
              {w.explain.startExample}
            </a>
          </div>
        )}
      </section>
    );
  }
  const whole = map.nodes.filter((n) => n.kind === "whole");
  const unplaced = map.nodes.filter((n) => n.kind === "unplaced");
  const rest = map.nodes.filter((n) => n.kind !== "whole" && n.kind !== "unplaced");
  const top = rest.filter((n) => !n.parentId);
  return (
    <section className="card stack imap" aria-labelledby={`${prefix}-h`} data-testid={prefix} data-view={map.view}>
      {head}
      <Legend wording={w} />
      {whole.map((n) => (
        <Tile key={n.id} n={n} w={w} current={currentId === n.id} onOpen={onOpen} prefix={prefix} />
      ))}
      {map.view === "process" ? (
        <ol className="imap-grid" aria-label={title}>
          {rest.map((n) => (
            <li key={n.id}>
              <Tile n={n} w={w} current={currentId === n.id} onOpen={onOpen} prefix={prefix} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="imap-areas imap-grid" aria-label={title}>
          {top.map((n) => (
            <AreaCard key={n.id} n={n} all={rest} w={w} current={currentId === n.id} currentId={currentId} onOpen={onOpen} prefix={prefix} />
          ))}
        </ul>
      )}
      {unplaced.map((n) => (
        <div key={n.id} className="stack imap-unplaced" data-testid={`${prefix}-unplaced`}>
          <p className="muted small">{w.status.notPlacedHint}</p>
          {/* The dashed border sits on this wrapper so the step list reads as part of the "Not placed" card;
              the list cannot go inside the tile itself because the tile is a button (no lists inside buttons). */}
          <div className="imap-unplaced-box imap-b-dashed">
            <Tile n={n} w={w} current={currentId === n.id} onOpen={onOpen} prefix={prefix} />
            <StepsList n={n} w={w} />
          </div>
        </div>
      ))}
    </section>
  );
}
