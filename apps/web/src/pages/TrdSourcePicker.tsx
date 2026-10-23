import { sourceLabel, sourceShort } from "@gap/engine";
import { addSource, TRD_SOURCE_DOC_TYPES, type Source } from "@gap/process-model";
import { useId, useRef, useState } from "react";
import { useStore } from "../store";

export type Where = Record<string, { section?: string; page?: string }>;

/**
 * The full name of a source as the picker shows it. A document reads "IDENTIFIER — Title (type)". An interview record carries its
 * register id and the stored label (which names the question), because "Interview (name, date)" alone looks the same for dozens of
 * answers and a person could not tell them apart.
 */
export function pickerName(s: Source): string {
  if (s.type === "interview_answer") return `${s.id}: ${sourceLabel(s)} (${s.responder?.name ?? "unknown responder"}, ${s.date.slice(0, 10)})`;
  return s.docRef ? `${sourceShort(s)} (${s.docRef.docType})` : `${s.id}: ${sourceShort(s)}`;
}

const isInterview = (s: Source) => s.type === "interview_answer";
const SHOWN = 40;

/**
 * One picker for every place a TRD cites sources (set point, NOR, PAR). The cited sources are a short list with their full names and
 * a Remove button; the register is searched in a panel, documents first, interview records in a closed group, and a new document can
 * be added on the spot. The citation (section and page) sits with each cited source. Nothing is cited unless the person chooses it.
 */
export function SourcePicker({
  testId,
  newKey,
  label,
  sources,
  selected,
  locations,
  onChange,
}: {
  /** Prefix of the test ids, for example "trd-limits-par". */
  testId: string;
  /** Suffix of the "add a document" test ids ("par" gives trd-newsrc-type-par). */
  newKey: string;
  /** What the sources are for, for the screen reader ("PAR"). */
  label: string;
  sources: Source[];
  selected: string[];
  locations: Where;
  onChange: (next: { sourceIds: string[]; locations: Where }) => void;
}) {
  const update = useStore((s) => s.update);
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [docType, setDocType] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [addError, setAddError] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const openBtn = useRef<HTMLButtonElement>(null);

  const chosen = selected.map((id) => ({ id, s: sources.find((x) => x.id === id) }));
  const q = query.trim().toLowerCase();
  const free = sources.filter((s) => !selected.includes(s.id) && (!q || pickerName(s).toLowerCase().includes(q)));
  const docs = free.filter((s) => !isInterview(s));
  const interviews = free.filter(isInterview);
  const interviewTotal = sources.filter((s) => isInterview(s) && !selected.includes(s.id)).length;

  const set = (sourceIds: string[], loc: Where = locations) => {
    const keep: Where = {};
    for (const id of sourceIds) if (loc[id]) keep[id] = loc[id]!;
    onChange({ sourceIds, locations: keep });
  };
  const cite = (id: string) => {
    set([...selected, id]);
    // The row that was clicked is gone from the list, so focus goes back to the search box.
    setTimeout(() => search.current?.focus(), 0);
  };
  const setLoc = (id: string, patch: { section?: string; page?: string }) => onChange({ sourceIds: selected, locations: { ...locations, [id]: { ...locations[id], ...patch } } });

  function addDocument() {
    setAddError("");
    if (!docType.trim() || !identifier.trim()) return setAddError("Enter the document type and the identifier.");
    let newId = "";
    const err = update((p, actor) => {
      const r = addSource(p, { type: "document_reference", docRef: { docType: docType.trim(), identifier: identifier.trim(), ...(title.trim() ? { title: title.trim() } : {}), ...(version.trim() ? { version: version.trim() } : {}) } }, actor);
      newId = r.source.id;
      return r.project;
    }, `${identifier.trim()} added to the source register`);
    if (err) return setAddError(err);
    set([...selected, newId]);
    setAdding(false);
    setDocType("");
    setIdentifier("");
    setTitle("");
    setVersion("");
  }

  const row = (s: Source) => (
    <li key={s.id} className="row between wrap">
      <span className="grow small">{pickerName(s)}</span>
      <button type="button" className="btn small" aria-label={`Cite ${pickerName(s)} for the ${label}`} data-testid={`${testId}-src-add-${s.id}`} onClick={() => cite(s.id)}>
        Cite
      </button>
    </li>
  );
  const list = (items: Source[]) => (
    <>
      <ul className="plain-list trd-src-list">{items.slice(0, SHOWN).map(row)}</ul>
      {items.length > SHOWN && <p className="muted small">{items.length - SHOWN} more match. Type more of the name to narrow the list.</p>}
    </>
  );

  return (
    <fieldset className="fs stack trd-src-picker" data-testid={`${testId}-sources`}>
      <legend>Sources cited for the {label}</legend>
      {chosen.length === 0 ? (
        <p className="muted small" data-testid={`${testId}-src-none`}>
          No source cited yet. Without one, the check lists it as an open item.
        </p>
      ) : (
        <ul className="plain-list stack" aria-label={`Cited sources for the ${label}`} data-testid={`${testId}-src-selected`}>
          {chosen.map(({ id, s }) => (
            <li key={id} className="stack trd-src-chip">
              <div className="row between wrap">
                <span className="grow" data-testid={`${testId}-src-${id}`}>
                  {s ? pickerName(s) : `${id} (no longer in the register)`}
                </span>
                <button type="button" className="btn small" aria-label={`Remove ${s ? pickerName(s) : id} from the ${label}`} data-testid={`${testId}-src-remove-${id}`} onClick={() => set(selected.filter((x) => x !== id))}>
                  Remove
                </button>
              </div>
              <div className="row wrap end-align">
                <label className="field">
                  <span>Section (optional)</span>
                  <input value={locations[id]?.section ?? ""} onChange={(e) => setLoc(id, { section: e.target.value })} />
                </label>
                <label className="field">
                  <span>Page (optional)</span>
                  <input value={locations[id]?.page ?? ""} onChange={(e) => setLoc(id, { page: e.target.value })} />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="row wrap">
        <button ref={openBtn} type="button" className="btn small" aria-expanded={open} aria-controls={`${uid}-panel`} data-testid={`${testId}-src-open`} onClick={() => setOpen((v) => !v)}>
          {open ? "Close the source list" : "Add a source from the register"}
        </button>
        {!adding && (
          <button type="button" className="btn small" data-testid={`${testId}-add-source`} onClick={() => setAdding(true)}>
            Add a new document source
          </button>
        )}
      </div>

      {open && (
        <div id={`${uid}-panel`} className="stack" role="group" aria-label={`Find a source for the ${label}`}>
          <label className="field">
            <span>Search the register (name, identifier, question or responder)</span>
            <input ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} data-testid={`${testId}-src-search`} autoFocus />
          </label>
          <div className="stack" data-testid={`${testId}-src-docs`}>
            <h4 className="trd-src-h">Documents ({docs.length})</h4>
            {docs.length === 0 ? <p className="muted small">No document matches. You can add one below.</p> : list(docs)}
          </div>
          {interviewTotal > 0 && (
            <details className="trd-src-interviews" open={q.length > 0 ? true : undefined} data-testid={`${testId}-src-interviews`}>
              <summary>Interview records ({interviews.length}{q ? ` of ${interviewTotal}` : ""})</summary>
              {interviews.length === 0 ? <p className="muted small">No interview record matches.</p> : list(interviews)}
            </details>
          )}
        </div>
      )}

      {adding && (
        <div className="stack" role="group" aria-label="Add a document">
          <label className="field">
            <span>Document type (free text; the suggestions are only a help)</span>
            <input value={docType} onChange={(e) => setDocType(e.target.value)} list={`${uid}-types`} data-testid={`trd-newsrc-type-${newKey}`} />
            <datalist id={`${uid}-types`}>
              {TRD_SOURCE_DOC_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Identifier</span>
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} data-testid={`trd-newsrc-id-${newKey}`} />
          </label>
          <label className="field">
            <span>Title (optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Version (optional)</span>
            <input value={version} onChange={(e) => setVersion(e.target.value)} />
          </label>
          {addError && (
            <p className="error" role="alert">
              {addError}
            </p>
          )}
          <div className="row wrap">
            <button type="button" className="btn small primary" onClick={addDocument} data-testid={`trd-newsrc-add-${newKey}`}>
              Add and cite
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setAdding(false);
                setTimeout(() => openBtn.current?.focus(), 0);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
