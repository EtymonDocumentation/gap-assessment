import { excipientClasses } from "@gap/content";
import { SPEC_RESULT_LABEL, addSpecRow, compareSpecRow, copyFromOtherSite, deleteSpecRow, findLibraryMatch, oftenComparedPrompts, specCounts, specCountsText, specPickerText, updateSpecRow, type SpecResult } from "@gap/engine";
import type { ExcipientAssessment, ExcipientLine, ExcipientSide, ExcipientSpecRow, Source } from "@gap/process-model";
import { useEffect, useRef, useState } from "react";
import { EXCIPIENT_PATH } from "../excipient-ui";
import { useExcipientRecords } from "../excipient-library-store";
import { href } from "../router";
import { useStore } from "../store";
import { ReasonDialog } from "./ReasonDialog";
import { SourcePicker, type Where } from "./TrdSourcePicker";

/** A result is always an icon plus words, never colour alone. "Not compared yet" is an open item, so it has the open symbol. */
const RESULT_ICON: Record<SpecResult, string> = { same: "✓", different: "▲", only_sending: "▲", only_receiving: "▲", not_compared: "○" };

const SIDE_TEXT: Record<ExcipientSide, string> = { sending: "Sending site", receiving: "Receiving site" };

/**
 * The Specifications tab: for one excipient, the tests of the sending and receiving site side by side. The tool only compares what was
 * written (the same number, a different number, a test at one site only) and shows the result in words; it never says whether a difference
 * is acceptable. Every box starts empty, nothing blocks saving, and a test never entered stays "Not compared yet" (an open item).
 */
export function ExcipientSpecs({ a, lineId, onPick }: { a: ExcipientAssessment; lineId?: string | undefined; onPick: (lineId: string) => void }) {
  const update = useStore((s) => s.update);
  const project = useStore((s) => s.project)!;
  const line = a.lines.find((l) => l.id === lineId) ?? a.lines[0];
  const [test, setTest] = useState("");
  const [error, setError] = useState("");
  const sources = project.sources.filter((s) => !s.supersededBy);
  const { items: saved } = useExcipientRecords();

  if (!line) {
    return (
      <section className="card stack" data-testid="ex-specs-empty">
        <h2>Specifications</h2>
        <p>Add an excipient first (tab 1), then compare its tests here.</p>
        <a className="btn" href={href(EXCIPIENT_PATH, { excipient: a.id, tab: "excipients" })}>
          Go to the Excipients tab
        </a>
      </section>
    );
  }
  const prompts = oftenComparedPrompts(line, excipientClasses);
  const counts = specCounts(line);
  // The team's own prompts from the saved excipient with the same name (the project stores no link to the library). Only tests not in the table yet are offered.
  const libPrompts = (findLibraryMatch(saved, line.name)?.prompts ?? []).filter((t) => !line.specs.some((r) => r.test.toLowerCase() === t.toLowerCase()));
  const add = (t: string, promptKey?: string) => {
    const err = update((p, actor) => addSpecRow(p, a.id, line.id, { test: t, ...(promptKey ? { promptKey } : {}) }, actor).project, "Test added");
    setError(err ?? "");
    if (!err) setTest("");
  };

  return (
    <div className="stack" data-testid="ex-specs">
      <section className="card stack" aria-labelledby="ex-specs-h" data-tour="excipient-specs">
        <h2 id="ex-specs-h">Specifications compared</h2>
        <label className="field">
          <span>Excipient</span>
          <select value={line.id} onChange={(e) => onPick(e.target.value)} data-testid="ex-specs-line">
            {a.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {specPickerText(l.name, l)}
              </option>
            ))}
          </select>
        </label>
        <p role="status" data-testid="ex-specs-counts">
          {specCountsText(counts)}
        </p>
        <p className="muted small">Write what each site's specification says, exactly as written. The tool compares the two and says what it sees. Whether a difference is acceptable is for your team to decide.</p>
        {prompts.length > 0 && (
          <div className="stack" data-testid="ex-specs-prompts">
            <p className="small">
              <strong>Often compared for this kind of excipient</strong> (select one to add it to the table):
            </p>
            <div className="row wrap">
              {prompts.map((p) => (
                <button key={p.key} type="button" className="btn small" onClick={() => add(p.test, p.key)} data-testid={`ex-prompt-${p.key}`}>
                  Add {p.test}
                </button>
              ))}
            </div>
          </div>
        )}
        {libPrompts.length > 0 && (
          <div className="stack" data-testid="ex-specs-lib-prompts">
            <p className="small">
              <strong>From your library</strong> (select one to add it to the table):
            </p>
            <div className="row wrap">
              {libPrompts.map((t) => (
                <button key={t} type="button" className="btn small" onClick={() => add(t)} data-testid={`ex-libprompt-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                  Add {t}
                </button>
              ))}
            </div>
          </div>
        )}
        <form
          className="row wrap end-align"
          onSubmit={(e) => {
            e.preventDefault();
            add(test);
          }}
        >
          <label className="field grow">
            <span>Add a test by hand</span>
            <input value={test} onChange={(e) => setTest(e.target.value)} placeholder="e.g. Assay (fictional)" data-testid="ex-spec-new" />
          </label>
          <button type="submit" className="btn primary" data-testid="ex-spec-add">
            Add test
          </button>
        </form>
        {error && (
          <p className="error" role="alert" data-testid="ex-spec-error">
            {error}
          </p>
        )}
      </section>

      {line.specs.length === 0 ? (
        <p className="empty" data-testid="ex-specs-none">
          No tests entered yet. Add one above.
        </p>
      ) : (
        <ul className="plain-list ex-rows" aria-label={`Tests of ${line.name}`}>
          {line.specs.map((row) => (
            <li key={row.id}>
              <SpecRowCard a={a} line={line} row={row} sources={sources} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SpecRowCard({ a, line, row, sources }: { a: ExcipientAssessment; line: ExcipientLine; row: ExcipientSpecRow; sources: Source[] }) {
  const update = useStore((s) => s.update);
  const [note, setNote] = useState(row.note ?? "");
  const [name, setName] = useState(row.test);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const result = compareSpecRow(row);

  const save = (patch: Parameters<typeof updateSpecRow>[4]) => {
    const err = update((p, actor) => updateSpecRow(p, a.id, line.id, row.id, patch, actor), "Specification saved");
    setError(err ?? "");
    return err;
  };

  return (
    <article className="card stack ex-row" aria-labelledby={`ex-row-${row.id}`} data-testid={`ex-row-${row.id}`}>
      <div className="row wrap between">
        <h3 id={`ex-row-${row.id}`} className="grow">
          <input className="ex-name" aria-label="Test name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== row.test && save({ test: name.trim() })} data-testid={`ex-row-name-${row.id}`} />
        </h3>
        <span className={`tag status ${result === "same" ? "status-established" : "status-tbd"}`} data-testid={`ex-result-${row.id}`}>
          <span aria-hidden="true">{RESULT_ICON[result]}</span> {SPEC_RESULT_LABEL[result]}
        </span>
      </div>
      <div className="ex-sides">
        {(["sending", "receiving"] as const).map((side) => (
          <SideFields key={side} side={side} row={row} sources={sources} onSave={save} />
        ))}
      </div>
      <label className="field">
        <span>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (row.note ?? "") && save({ note })} data-testid={`ex-row-note-${row.id}`} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button
          type="button"
          className="btn danger small"
          data-testid={`ex-row-remove-${row.id}`}
          onClick={(e) => {
            opener.current = e.currentTarget;
            setRemoving(true);
          }}
        >
          Remove this test
        </button>
      </div>
      {removing && (
        <ReasonDialog
          title="Remove this test?"
          description={`${row.test} leaves the comparison table of ${line.name}. The change log keeps what it said.`}
          confirmLabel="Remove test"
          keepLabel="Keep the test"
          testId="ex-row-remove"
          restoreFocus={() => opener.current}
          onClose={() => setRemoving(false)}
          onConfirm={(reason) => update((p, actor) => deleteSpecRow(p, a.id, line.id, row.id, reason, actor), "Test removed")}
        />
      )}
    </article>
  );
}

function SideFields({ side, row, sources, onSave }: { side: ExcipientSide; row: ExcipientSpecRow; sources: Source[]; onSave: (patch: Parameters<typeof updateSpecRow>[4]) => string | null }) {
  const s = row[side];
  const [method, setMethod] = useState(s.method ?? "");
  const [criterion, setCriterion] = useState(s.criterion ?? "");
  const [unit, setUnit] = useState(s.unit ?? "");
  const notTested = s.state === "not_tested";
  const where: Where = (s.sourceLocations ?? {}) as Where;
  const id = `${row.id}-${side}`;
  // A copy from the other site changes the stored values from outside the boxes, so each box follows its own stored value.
  useEffect(() => setMethod(s.method ?? ""), [s.method]);
  useEffect(() => setCriterion(s.criterion ?? ""), [s.criterion]);
  useEffect(() => setUnit(s.unit ?? ""), [s.unit]);
  // What the other site's entries could add to the empty boxes of this side (nothing already written is replaced).
  const copyPatch = copyFromOtherSite(row, side);

  // The state follows what was written: a criterion means "stated", the tick means "not tested", otherwise it stays open (never guessed).
  const commit = (over: { method?: string; criterion?: string; unit?: string; notTested?: boolean } = {}) => {
    const nt = over.notTested ?? notTested;
    const c = over.criterion ?? criterion;
    const patch = nt ? { state: "not_tested" as const } : c.trim() ? { state: "stated" as const, criterion: c.trim() } : { state: "open" as const, criterion: "" };
    onSave({ [side]: { ...patch, method: (over.method ?? method).trim(), unit: (over.unit ?? unit).trim() } });
  };

  return (
    <fieldset className="fs stack ex-side" data-testid={`ex-side-${id}`}>
      <legend>{SIDE_TEXT[side]}</legend>
      {copyPatch && (
        <div>
          <button type="button" className="btn small" onClick={() => onSave({ [side]: copyPatch })} data-testid={`ex-copy-${id}`} aria-describedby={`ex-copy-hint-${id}`}>
            Copy from the {side === "sending" ? "receiving" : "sending"} site
          </button>
          <span className="muted small block" id={`ex-copy-hint-${id}`}>
            Fills only the empty boxes. What you wrote stays.
          </span>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={notTested} onChange={(e) => commit({ notTested: e.target.checked })} data-testid={`ex-nottested-${id}`} /> <span>This site's specification has no such test</span>
      </label>
      <label className="field">
        <span>Method</span>
        <input value={method} disabled={notTested} onChange={(e) => setMethod(e.target.value)} onBlur={() => method.trim() !== (s.method ?? "") && commit()} data-testid={`ex-method-${id}`} />
      </label>
      <div className="row wrap">
        <label className="field grow">
          <span>Acceptance criterion</span>
          <input value={criterion} disabled={notTested} onChange={(e) => setCriterion(e.target.value)} onBlur={() => criterion.trim() !== (s.criterion ?? "") && commit()} data-testid={`ex-criterion-${id}`} />
        </label>
        <label className="field">
          <span>Unit</span>
          <input value={unit} disabled={notTested} onChange={(e) => setUnit(e.target.value)} onBlur={() => unit.trim() !== (s.unit ?? "") && commit()} data-testid={`ex-unit-${id}`} />
        </label>
      </div>
      <details className="small" data-testid={`ex-src-${id}`}>
        <summary>Where is this written?{s.sourceIds.length ? ` (${s.sourceIds.length} cited)` : " (optional)"}</summary>
        <SourcePicker
          testId={`ex-srcp-${id}`}
          newKey={`ex-srcp-${id}`}
          label={`${row.test}, ${SIDE_TEXT[side].toLowerCase()}`}
          sources={sources}
          selected={s.sourceIds}
          locations={where}
          onChange={(n) => onSave({ [side]: { sourceIds: n.sourceIds, sourceLocations: n.locations } })}
        />
      </details>
    </fieldset>
  );
}
