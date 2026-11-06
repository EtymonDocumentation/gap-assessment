import { samplingSuggestions } from "@gap/content";
import { addExpectedVersion, currentExpectedVersion, expectedKeysInForce, removeExpectedVersion, shippedExpectedKeys, type ExpectedListVersion } from "@gap/engine";
import { UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE } from "@gap/process-model";
import { TYPE_LABEL } from "@gap/sampling";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../PageHeader";
import { Modal } from "../components";
import { useExpectedStudies } from "../expected-studies-store";
import { dateTime } from "../lib";
import { useContent } from "../store";

/**
 * The account's "Expected studies" list: which catalog entries the sampling design review (check D2) expects a plan to cover when the
 * plan has the step. GMP reason: what a typical PPQ must cover is the company's own judgement, so the shipped marks are only a start.
 * Every save is a new version with an optional reason; every version can be removed, with a confirmation and a logged reason.
 */

const LONG_LIST = 12;

export function ExpectedStudiesPage() {
  const content = useContent();
  const doc = useExpectedStudies((s) => s.doc);
  const ready = useExpectedStudies((s) => s.ready);
  const error = useExpectedStudies((s) => s.error);
  const load = useExpectedStudies((s) => s.load);
  const commit = useExpectedStudies((s) => s.commit);
  useEffect(() => void load(), [load]);

  const shipped = useMemo(() => new Set(shippedExpectedKeys(samplingSuggestions)), []);
  const cur = currentExpectedVersion(doc);
  const inForce = useMemo(() => expectedKeysInForce(samplingSuggestions, doc), [doc]);
  // The ticks being edited. They start from the list in force and start again whenever a version is saved or removed.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(inForce));
  const forceKey = inForce.join("|");
  useEffect(() => setPicked(new Set(inForce)), [forceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reason, setReason] = useState("");
  const [find, setFind] = useState("");
  const [msg, setMsg] = useState("");

  // Two catalog groups are not process steps; they get plain names instead of their keys.
  const labelOf = useMemo(() => new Map([...content.catalog.unitOperations.map((u) => [u.key, u.label] as const), [UNIT_OP_FINISHED_PRODUCT, "Finished product"] as const, [UNIT_OP_NONE, "Not tied to one step"] as const]), [content]);
  const catalogKeys = useMemo(() => new Set(samplingSuggestions.candidates.map((c) => c.key)), []);
  const groups = useMemo(() => {
    const q = find.trim().toLowerCase();
    const by = new Map<string, typeof samplingSuggestions.candidates>();
    for (const c of samplingSuggestions.candidates) {
      if (q && !`${c.attribute} ${TYPE_LABEL[c.type]} ${labelOf.get(c.uo) ?? c.uo}`.toLowerCase().includes(q)) continue;
      by.set(c.uo, [...(by.get(c.uo) ?? []), c]);
    }
    return [...by.entries()];
  }, [find, labelOf]);
  // Listed keys a newer catalog no longer has: kept in the saved list and shown here, left out of the check.
  const gone = [...picked, ...inForce].filter((k, i, a) => !catalogKeys.has(k) && a.indexOf(k) === i);

  const same = picked.size === inForce.length && inForce.every((k) => picked.has(k));
  const isShipped = !cur;
  const toggle = (key: string) => setPicked((p) => (p.has(key) ? new Set([...p].filter((k) => k !== key)) : new Set([...p, key])));
  const run = (p: Promise<void>, ok: string) => p.then(() => setMsg(ok), () => setMsg(""));

  return (
    <div className="stack-lg">
      <PageHeader
        title="Expected studies"
        purpose="The design review asks about these studies when a plan has the step but no sample for it."
        about={{
          art: "page-document",
          children: (
            <>
              <p>
                Each study here is a suggestion from the catalog. The ticked ones are the ones the design review asks about. Your company decides which studies a plan is expected to cover, so you can add or remove ticks. The shipped list is only a starting point.
              </p>
              <p>
                Every save makes a new version, so you can see what the list said before. Questions you already answered will say "look again" so the team can see the list has changed. Nothing is blocked either way.
              </p>
            </>
          ),
        }}
      />
      {error && (
        <p className="notice" role="alert" data-testid="exp-error">
          {error}
        </p>
      )}
      <p data-testid="exp-current">
        {!ready ? "Loading the list." : cur ? `In use: version ${cur.number}, saved ${dateTime(cur.at)}${cur.reason ? `. Reason: ${cur.reason}` : ""}.` : "In use: the shipped list. You have not saved a version of your own yet."}
      </p>

      <section className="card stack" aria-labelledby="exp-list-h">
        <h2 id="exp-list-h">Studies by step ({picked.size} expected)</h2>
        {samplingSuggestions.candidates.length > LONG_LIST && (
          <label className="field">
            <span>Find a study</span>
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} data-testid="exp-find" />
          </label>
        )}
        {groups.length === 0 && <p className="muted">No study matches what you typed.</p>}
        {groups.map(([uo, rows]) => (
          <fieldset key={uo} className="stack" data-testid={`exp-group-${uo}`}>
            <legend>
              <strong>{labelOf.get(uo) ?? uo}</strong>
            </legend>
            <ul className="plain-list stack">
              {rows.map((c) => (
                <li key={c.key} className="row wrap" data-testid={`exp-row-${c.key}`}>
                  <label className="row">
                    <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} data-testid={`exp-tick-${c.key}`} />
                    <span>
                      <strong>{c.attribute}</strong> <span className="muted small">({TYPE_LABEL[c.type]})</span>
                      {/* Say "Expected" only on ticked rows: a word on every row read as if every study were already expected. */}
                      {picked.has(c.key) && <span className="small"> · Expected</span>}
                    </span>
                  </label>
                  {picked.has(c.key) && !shipped.has(c.key) && (
                    <span className="tag" data-testid={`exp-tag-${c.key}`}>
                      Not in the shipped list
                    </span>
                  )}
                  {!picked.has(c.key) && shipped.has(c.key) && (
                    <span className="tag" data-testid={`exp-tag-${c.key}`}>
                      In the shipped list
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
        {gone.length > 0 && (
          <fieldset className="stack" data-testid="exp-gone">
            <legend>
              <strong>No longer in the catalog</strong>
            </legend>
            <p className="small muted">These were on your list, but the catalog does not have them any more. The design review leaves them out. Untick one and save to take it off the list.</p>
            <ul className="plain-list stack">
              {gone.map((k) => (
                <li key={k}>
                  <label className="row">
                    <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} data-testid={`exp-tick-${k}`} />
                    <span>
                      <code>{k}</code> <span className="small">no longer in the catalog</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <label className="field">
          <span>
            Why are you changing the list? <span className="muted">(optional)</span>
          </span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="exp-reason" />
        </label>
        <div className="row wrap">
          <button
            type="button"
            className="btn primary"
            disabled={same || !ready}
            data-testid="exp-save"
            onClick={() =>
              run(
                commit(addExpectedVersion(doc, samplingSuggestions, [...picked], "edited", reason)).then(() => setReason("")),
                "Saved as a new version. The earlier list is kept in the history.",
              )
            }
          >
            Save as a new version
          </button>
          <button
            type="button"
            className="btn"
            disabled={!ready || (isShipped && same)}
            data-testid="exp-reset"
            onClick={() =>
              run(
                commit(addExpectedVersion(doc, samplingSuggestions, shippedExpectedKeys(samplingSuggestions), "reset", reason.trim() || "Reset to the shipped list")).then(() => setReason("")),
                "The shipped list is back, saved as a new version.",
              )
            }
          >
            Reset to the shipped list
          </button>
        </div>
        <div role="status" aria-live="polite">
          {msg && (
            <p className="small" data-testid="exp-msg">
              {msg}
            </p>
          )}
        </div>
        <p className="small muted">
          Catalog version {samplingSuggestions.catalog.version}. {!same && "You have changes that are not saved yet."}
        </p>
      </section>

      <section className="card stack" aria-labelledby="exp-hist-h">
        <h2 id="exp-hist-h">History ({doc.versions.length})</h2>
        {doc.versions.length === 0 ? (
          <p className="muted">No versions yet. Until you save one, the shipped list is used.</p>
        ) : (
          <ul className="plain-list stack" data-testid="exp-history">
            {[...doc.versions].reverse().map((v, i) => (
              <VersionRow key={v.id} v={v} current={i === 0} onRemove={(why) => run(commit(removeExpectedVersion(doc, v.id, why)), `Version ${v.number} removed. The reason is kept in the log.`)} />
            ))}
          </ul>
        )}
        {doc.removed.length > 0 && (
          <details>
            <summary>Removed versions ({doc.removed.length})</summary>
            <ul className="plain-list small" data-testid="exp-removed">
              {[...doc.removed].reverse().map((r) => (
                <li key={`${r.at}-${r.number}`}>
                  {dateTime(r.at)}: version {r.number} (saved {dateTime(r.savedAt)}) was removed. Reason: {r.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

function VersionRow({ v, current, onRemove }: { v: ExpectedListVersion; current: boolean; onRemove: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  return (
    <li className="row wrap" data-testid={`exp-version-${v.number}`}>
      <span className="grow">
        <strong>Version {v.number}</strong> {current && <span className="tag">In use</span>}{" "}
        <span className="small">
          {dateTime(v.at)}. {v.keys.length} expected{v.kind === "reset" ? ", the shipped list" : ""}. {v.reason ? `Reason: ${v.reason}` : "No reason given."} <span className="muted">(catalog {v.catalogVersion})</span>
        </span>
      </span>
      <button
        type="button"
        className="btn danger"
        data-testid={`exp-remove-${v.number}`}
        onClick={(e) => {
          opener.current = e.currentTarget;
          setOpen(true);
        }}
      >
        Remove version {v.number}
      </button>
      {open && (
        <Modal open onOpenChange={(o) => !o && setOpen(false)} title={`Remove version ${v.number}?`} description={current ? "The list goes back to the version before it, or to the shipped list if there is none." : "The list in use does not change."} restoreFocus={() => opener.current}>
          <label className="field">
            <span>
              Why are you removing it? <span className="muted">(kept in the log)</span>
            </span>
            <input value={why} onChange={(e) => setWhy(e.target.value)} autoFocus data-testid="exp-remove-reason" />
          </label>
          <div className="row end">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="exp-remove-confirm"
              onClick={() => {
                setOpen(false);
                onRemove(why);
              }}
            >
              Remove version {v.number}
            </button>
          </div>
        </Modal>
      )}
    </li>
  );
}
