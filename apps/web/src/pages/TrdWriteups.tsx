import {
  activeParts,
  addPart,
  addWriteupFromLibrary,
  differenceIsEmpty,
  differenceText,
  openBlankCount,
  plainOfSegments,
  removePart,
  removeWriteup,
  resolveBlank,
  segmentsOf,
  setBlankValue,
  setNotApplicable,
  setPartIncluded,
  setPartText,
  updateWriteupFromLibrary,
  writeupBlanks,
  writeupDifference,
  writeupLibraryStatus,
  writeupsAvailable,
  type BlankContext,
  type ResolvedBlank,
} from "@gap/engine";
import { TRD_PART_KIND_LABELS, TRD_PART_KINDS, type TrdDocument, type TrdPart, type TrdPartKind, type TrdWriteup } from "@gap/process-model";
import { Fragment, useMemo, useRef, useState } from "react";
import { href } from "../router";
import { useContent, useStore } from "../store";
import { useTrdWriteupLibrary } from "../trd-writeups-store";
import type { Run } from "./SamplingFlow";

/*
 * Step 3 of a TRD: the process descriptions. One card per write-up (a description per process step, in the TRD's step order, and the
 * TRD-level sections). Each paragraph can be edited, removed or, if optional, switched on. A blank shows its value and where it came
 * from, or stays a visible placeholder (blue, dotted underline, label in brackets). Nothing is filled in by the tool beyond what the
 * TRD and the project already say, and nothing here blocks saving or export.
 */

/** A text with its blanks drawn: a filled blank is its value, an open one is its label in brackets. */
function Rich({ text, ctx, w }: { text: string; ctx: BlankContext; w: TrdWriteup }) {
  const segs = useMemo(() => segmentsOf(text, (key, label) => resolveBlank(ctx, w, key, label)), [text, ctx, w]);
  return (
    <>
      {segs.map((s, i) => {
        const body = (inner: React.ReactNode) => (("bold" in s && s.bold) ? <strong>{inner}</strong> : inner);
        if ("blank" in s) {
          const b = s.blank;
          return (
            <Fragment key={i}>
              {body(
                b.filled ? (
                  <span className="blank-filled" title={b.where}>
                    {b.value}
                  </span>
                ) : (
                  <span className="blank-open">
                    <span className="visually-hidden">Open blank: </span>[{b.label}
                    {b.note ? `, ${b.note.toLowerCase().includes("tbd") ? "TBD" : b.note}` : ""}]
                  </span>
                ),
              )}
            </Fragment>
          );
        }
        return <Fragment key={i}>{body(s.text)}</Fragment>;
      })}
    </>
  );
}

export function TrdWriteups({ d, run }: { d: TrdDocument; run: Run }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const library = useTrdWriteupLibrary();
  const ctx = useMemo<BlankContext>(() => ({ project, doc: d, content }), [project, d, content]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const writeups = d.writeups ?? [];
  const available = useMemo(() => writeupsAvailable(d, library), [d, library]);
  const [pick, setPick] = useState("");
  const addSelect = useRef<HTMLSelectElement>(null);
  const totalOpen = writeups.reduce((n, w) => n + openBlankCount(ctx, w), 0);
  const stepTitle = (w: TrdWriteup) => {
    const s = d.steps.find((x) => x.id === w.stepId);
    return s ? s.label || s.key || s.id : "";
  };
  const toggle = (id: string) =>
    setOpenIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <section className="card stack" aria-labelledby="twu-h" data-testid="trd-writeups">
        <h2 id="twu-h">Process descriptions</h2>
        <p>
          The text of the technology transfer document, one description per process step and the TRD-level sections. They start as a copy of the <a href={href("/trd/writeups")}>process description library</a>; edit any paragraph, remove one, or switch an optional one on. A blank that the TRD or the project can answer shows that value and its source. A blank with no value stays visible: nothing is filled in for you.
        </p>
        <p data-testid="twu-summary">
          {writeups.length} description{writeups.length === 1 ? "" : "s"}, {totalOpen} open blank{totalOpen === 1 ? "" : "s"}. Open blanks do not stop saving or exporting; they appear in the document in square brackets, highlighted.
        </p>
        <div className="row wrap end-align">
          <label className="field grow">
            <span>Add a description from the library</span>
            <select ref={addSelect} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="twu-add-select">
              <option value="">Choose a description</option>
              {available.map((a) => {
                const v = `${a.lib.id}|${a.step?.id ?? ""}`;
                return (
                  <option key={v} value={v}>
                    {a.lib.title}
                    {a.step ? ` (step: ${a.step.label || a.step.key || a.step.id})` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            data-testid="twu-add"
            disabled={!pick}
            onClick={() => {
              const [libId, stepId] = pick.split("|");
              const lib = library.find((x) => x.id === libId);
              if (!lib) return;
              let newId = "";
              if (run((p, a) => {
                const r = addWriteupFromLibrary(p, d.id, lib, stepId || undefined, a);
                newId = r.writeupId;
                return r.project;
              }, "Process description added")) {
                setPick("");
                setOpenIds((s) => new Set(s).add(newId));
              }
            }}
          >
            Add description
          </button>
        </div>
      </section>

      {writeups.length === 0 ? (
        <p className="card" data-testid="twu-empty">
          This TRD has no process descriptions yet. Add one from the library above. A TRD made before process descriptions existed stays as it was; nothing is added to it by itself.
        </p>
      ) : (
        writeups.map((w) => (
          <WriteupCard key={w.id} d={d} w={w} ctx={ctx} library={library} open={openIds.has(w.id)} onToggle={() => toggle(w.id)} run={run} stepTitle={stepTitle(w)} />
        ))
      )}
    </>
  );
}

function WriteupCard({
  d,
  w,
  ctx,
  library,
  open,
  onToggle,
  run,
  stepTitle,
}: {
  d: TrdDocument;
  w: TrdWriteup;
  ctx: BlankContext;
  library: ReturnType<typeof useTrdWriteupLibrary>;
  open: boolean;
  onToggle: () => void;
  run: Run;
  stepTitle: string;
}) {
  const status = writeupLibraryStatus(w, library);
  const lib = library.find((x) => x.id === w.libraryId);
  const openCount = openBlankCount(ctx, w);
  const [diffShown, setDiffShown] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const diff = useMemo(() => (lib ? writeupDifference(w, lib) : undefined), [w, lib]);
  const updateBtn = useRef<HTMLButtonElement>(null);
  const [addKind, setAddKind] = useState<TrdPartKind>("paragraph");
  const [addText, setAddText] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const parts = w.notApplicable?.on ? [] : w.parts;
  // Letters of consecutive lettered steps, counted over the parts that are in the document.
  const letters = useMemo(() => {
    const m = new Map<string, string>();
    let n = 0;
    for (const p of activeParts(w)) {
      if (p.kind === "step") m.set(p.id, String.fromCharCode(97 + (n++ % 26)));
      else n = 0;
    }
    return m;
  }, [w]);
  const blanks = useMemo(() => writeupBlanks(ctx, w), [ctx, w]);

  return (
    <section className="card stack" aria-labelledby={`twu-h-${w.id}`} data-testid={`twu-card-${w.id}`}>
      <div className="twu-head-row">
        <h3 id={`twu-h-${w.id}`}>
          {w.title}
          {stepTitle && <span className="muted small"> (step: {stepTitle})</span>}
        </h3>
        <span className="row wrap">
          <span className="small" data-testid={`twu-count-${w.id}`}>
            {openCount} open blank{openCount === 1 ? "" : "s"}
          </span>
          <button type="button" className="btn small twu-toggle" aria-expanded={open} aria-controls={`twu-body-${w.id}`} data-testid={`twu-toggle-${w.id}`} onClick={onToggle}>
            {open ? "Close" : "Open"}
            <span className="visually-hidden"> {w.title}</span>
          </button>
        </span>
      </div>

      {status.kind === "newer" && (
        <div className="notice" data-testid={`twu-newer-${w.id}`}>
          <p>
            The library has version {status.libraryVersion} of this description; this TRD uses version {status.usedVersion}.{" "}
            <button ref={updateBtn} type="button" className="btn small" data-testid={`twu-update-${w.id}`} aria-expanded={diffShown} onClick={() => setDiffShown((v) => !v)}>
              Update from library
            </button>
          </p>
          {diffShown && diff && lib && (
            <div className="twu-diff stack" data-testid={`twu-diff-${w.id}`} role="group" aria-label="What the update changes">
              <p>{differenceIsEmpty(diff) ? `The update changes no text (${differenceText(diff)}). It brings the version number up to date.` : `The update would make: ${differenceText(diff)}.`}</p>
              <span className="row wrap">
                <button
                  type="button"
                  className="btn primary small"
                  data-testid={`twu-update-confirm-${w.id}`}
                  onClick={() => {
                    if (run((p, a) => updateWriteupFromLibrary(p, d.id, w.id, lib, a), "Process description updated from the library")) {
                      setDiffShown(false);
                      setTimeout(() => updateBtn.current?.focus(), 0);
                    }
                  }}
                >
                  Update now
                </button>
                <button type="button" className="btn small" onClick={() => setDiffShown(false)}>
                  Not now
                </button>
              </span>
            </div>
          )}
        </div>
      )}
      {status.kind === "missing" && (
        <p className="muted small" data-testid={`twu-missing-${w.id}`}>
          The library no longer holds this description. The TRD keeps its own copy.
        </p>
      )}

      {open && (
        <div id={`twu-body-${w.id}`} className="stack" data-testid={`twu-body-${w.id}`}>
          {w.appliesWhen && <p className="muted small">When it fits: {w.appliesWhen}</p>}
          {w.notApplicable && (
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(w.notApplicable.on)}
                data-testid={`twu-na-${w.id}`}
                onChange={(e) => run((p, a) => setNotApplicable(p, d.id, w.id, e.target.checked, a), e.target.checked ? "Marked not applicable" : "Marked applicable")}
              />
              <span>Not applicable: {w.notApplicable.condition}</span>
            </label>
          )}
          {w.notApplicable?.on && (
            <p className="twu-text" data-testid={`twu-na-text-${w.id}`}>
              <Rich text={w.notApplicable.text} ctx={ctx} w={w} />
            </p>
          )}
          {parts.map((p) => (
            <PartRow key={p.id} d={d} w={w} p={p} ctx={ctx} letter={letters.get(p.id)} run={run} />
          ))}

          <fieldset className="fs stack" data-testid={`twu-add-part-${w.id}`}>
            <legend>Add a paragraph of your own</legend>
            <div className="row wrap end-align">
              <label className="field">
                <span>Kind</span>
                <select value={addKind} onChange={(e) => setAddKind(e.target.value as TrdPartKind)} data-testid={`twu-add-kind-${w.id}`}>
                  {TRD_PART_KINDS.filter((k) => k !== "table" && k !== "figure").map((k) => (
                    <option key={k} value={k}>
                      {TRD_PART_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              {(addKind === "subsection" || addKind === "heading") && (
                <label className="field grow">
                  <span>Title</span>
                  <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} />
                </label>
              )}
            </div>
            {addKind !== "subsection" && addKind !== "heading" && (
              <label className="field">
                <span>Text (a blank is written {"{{key|Label}}"})</span>
                <textarea rows={2} value={addText} onChange={(e) => setAddText(e.target.value)} data-testid={`twu-add-text-${w.id}`} />
              </label>
            )}
            <div>
              <button
                type="button"
                className="btn small"
                data-testid={`twu-add-part-btn-${w.id}`}
                disabled={addKind === "subsection" || addKind === "heading" ? !addTitle.trim() : !addText.trim()}
                onClick={() => {
                  const input = addKind === "subsection" || addKind === "heading" ? { kind: addKind, text: "", title: addTitle.trim() } : { kind: addKind, text: addText.trim() };
                  if (run((pr, a) => addPart(pr, d.id, w.id, input, a).project, "Paragraph added")) {
                    setAddText("");
                    setAddTitle("");
                  }
                }}
              >
                Add paragraph
              </button>
            </div>
          </fieldset>

          <Blanks d={d} w={w} blanks={blanks} run={run} />

          <div>
            {!confirmRemove ? (
              <button type="button" className="btn small" data-testid={`twu-remove-${w.id}`} onClick={() => setConfirmRemove(true)}>
                Remove this description
              </button>
            ) : (
              <p className="row wrap" role="group" aria-label={`Remove ${w.title}`}>
                <span>Remove "{w.title}" from this TRD? It stays in the library and the change log.</span>
                <button type="button" className="btn small danger" data-testid={`twu-remove-confirm-${w.id}`} onClick={() => run((p, a) => removeWriteup(p, d.id, w.id, a), "Process description removed")}>
                  Remove
                </button>
                <button type="button" className="btn small" autoFocus onClick={() => setConfirmRemove(false)}>
                  Keep it
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PartRow({ d, w, p, ctx, letter, run }: { d: TrdDocument; w: TrdWriteup; p: TrdPart; ctx: BlankContext; letter: string | undefined; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.text);
  const [title, setTitle] = useState(p.title ?? "");
  const editBtn = useRef<HTMLButtonElement>(null);
  const isHeading = p.kind === "subsection" || p.kind === "heading";
  const off = Boolean(p.optional && !p.included);
  const close = () => {
    setEditing(false);
    // Focus returns to the Edit button when the paragraph goes back to reading.
    setTimeout(() => editBtn.current?.focus(), 0);
  };
  const label = isHeading ? p.title ?? "heading" : p.text.slice(0, 40);

  return (
    <div className="twu-part" data-testid={`twu-part-${w.id}-${p.id}`}>
      <span className="twu-kind">
        {TRD_PART_KIND_LABELS[p.kind]}
        {p.edited ? ", edited here" : ""}
        {p.optional ? `, optional: ${p.optional.condition}` : ""}
      </span>
      {p.optional && (
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(p.included)}
            data-testid={`twu-optional-${w.id}-${p.id}`}
            onChange={(e) => run((pr, a) => setPartIncluded(pr, d.id, w.id, p.id, e.target.checked, a), e.target.checked ? "Optional paragraph included" : "Optional paragraph left out")}
          />
          <span>Include in the document ({p.optional.condition})</span>
        </label>
      )}
      {!editing ? (
        <>
          {isHeading ? (
            <p className="twu-head" data-testid={`twu-text-${w.id}-${p.id}`}>
              {p.title}
            </p>
          ) : p.kind === "table" ? (
            <div className="table-scroll" role="region" aria-label={`Table: ${(p.columns ?? []).join(", ")}`} tabIndex={0}>
              <table className="data">
                <thead>
                  <tr>
                    {(p.columns ?? []).map((c, i) => (
                      <th key={i} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(p.rows?.length ? p.rows : [(p.columns ?? []).map(() => "")]).map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={`twu-text twu-${p.kind}`} data-letter={letter} data-testid={`twu-text-${w.id}-${p.id}`}>
              {p.kind === "figure" && <strong>Figure to be added: </strong>}
              <Rich text={p.text} ctx={ctx} w={w} />
            </p>
          )}
          {off && <span className="muted small">Left out of the document until you include it.</span>}
          <span className="row wrap">
            {p.kind !== "table" && (
              <button
                ref={editBtn}
                type="button"
                className="btn small"
                aria-label={`Edit: ${label}`}
                data-testid={`twu-edit-${w.id}-${p.id}`}
                onClick={() => {
                  setText(p.text);
                  setTitle(p.title ?? "");
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
            <button type="button" className="btn small" aria-label={`Remove: ${label}`} data-testid={`twu-part-remove-${w.id}-${p.id}`} onClick={() => run((pr, a) => removePart(pr, d.id, w.id, p.id, a), "Paragraph removed")}>
              Remove
            </button>
          </span>
        </>
      ) : (
        <span className="stack">
          {isHeading ? (
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid={`twu-title-${w.id}-${p.id}`} />
            </label>
          ) : (
            <label className="field">
              <span>Text. A blank is written {"{{key|Label}}"}; **bold** makes bold.</span>
              <textarea rows={Math.min(10, Math.max(3, Math.ceil(text.length / 90)))} value={text} onChange={(e) => setText(e.target.value)} data-testid={`twu-text-input-${w.id}-${p.id}`} />
            </label>
          )}
          <span className="row wrap">
            <button
              type="button"
              className="btn primary small"
              data-testid={`twu-save-${w.id}-${p.id}`}
              onClick={() => {
                if (run((pr, a) => setPartText(pr, d.id, w.id, p.id, isHeading ? { title } : { text }, a), "Paragraph saved")) close();
              }}
            >
              Save paragraph
            </button>
            <button type="button" className="btn small" onClick={close}>
              Cancel
            </button>
          </span>
        </span>
      )}
    </div>
  );
}

/** Every blank of the description with its state, its source, and a place to type a value. */
function Blanks({ d, w, blanks, run }: { d: TrdDocument; w: TrdWriteup; blanks: ResolvedBlank[]; run: Run }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  if (!blanks.length) return null;
  return (
    <fieldset className="fs stack" data-testid={`twu-blanks-${w.id}`}>
      <legend>Blanks ({blanks.filter((b) => !b.filled).length} open of {blanks.length})</legend>
      <p className="muted small">A value you type here is used for this blank in every description of this TRD, and replaces a value from the TRD or the project.</p>
      <ul className="twu-blanks">
        {blanks.map((b) => {
          const v = vals[b.key] ?? "";
          return (
            <li key={b.key} className="twu-blank" data-testid={`twu-blank-${w.id}-${b.key}`}>
              <div className="field">
                <span>
                  <span className="twu-state">{b.filled ? "Filled" : "Open"}:</span> {b.label}
                </span>
                {b.filled ? (
                  <span className="small">
                    <strong>{b.value}</strong> (source: {b.where})
                  </span>
                ) : (
                  <span className="small muted">{b.note ?? "No value in the TRD or the project."}</span>
                )}
              </div>
              <label className="field">
                <span className="visually-hidden">Value for {b.label}</span>
                <input value={v} placeholder={b.filled ? "Type another value" : "Type a value"} onChange={(e) => setVals({ ...vals, [b.key]: e.target.value })} data-testid={`twu-blank-input-${w.id}-${b.key}`} />
              </label>
              <button
                type="button"
                className="btn small"
                aria-label={`Use value for ${b.label}`}
                data-testid={`twu-blank-set-${w.id}-${b.key}`}
                disabled={!v.trim()}
                onClick={() => {
                  if (run((p, a) => setBlankValue(p, d.id, w.id, b.key, v, a), "Blank value saved")) setVals((x) => ({ ...x, [b.key]: "" }));
                }}
              >
                Use value
              </button>
              {b.origin === "entered" && (
                <button type="button" className="btn small" aria-label={`Clear typed value for ${b.label}`} data-testid={`twu-blank-clear-${w.id}-${b.key}`} onClick={() => run((p, a) => clearTyped(p, d.id, b.key, a), "Typed value cleared")}>
                  Clear typed value
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** A typed value can sit in any write-up of the TRD (it is shared), so clearing removes it wherever it was typed. */
function clearTyped(project: Parameters<Parameters<Run>[0]>[0], trdId: string, key: string, actor: Parameters<Parameters<Run>[0]>[1]) {
  const doc = project.trd.documents.find((x) => x.id === trdId);
  let next = project;
  for (const w of doc?.writeups ?? []) if (w.values?.[key]) next = setBlankValue(next, trdId, w.id, key, "", actor);
  return next;
}

export { plainOfSegments };
