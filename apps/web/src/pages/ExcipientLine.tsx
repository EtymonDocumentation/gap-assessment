import { excipientClasses, excipientWording } from "@gap/content";
import { answerExcipientQuestion, deleteExcipientLine, excipientMarkerExplanation, excipientOpenItems, excipientMarkers, excipientRegulatory, specCounts, specCountsText, updateExcipientLine, type ExcipientAnswer, type ExcipientQuestion } from "@gap/engine";
import { EXCIPIENT_FACTS, EXCIPIENT_FACT_GROUPS, EXCIPIENT_FACT_GROUP_LABEL, EXCIPIENT_SIDE_LABEL, type ExcipientAssessment, type ExcipientLine as Line, type ExcipientSide } from "@gap/process-model";
import { Fragment, useMemo, useRef, useState } from "react";
import { EXCIPIENT_PATH, classText, factCell, useExcipientQuestions } from "../excipient-ui";
import { PageHeader, type PagePill } from "../PageHeader";
import { dateTime } from "../lib";
import { openItemsCount } from "../open-count";
import { href, navigate } from "../router";
import { useStore } from "../store";
import { ExcipientCard } from "./ExcipientCard";
import { ExcipientLibraryBox } from "./ExcipientLibraryUse";
import { ExcipientLinksBox } from "./ExcipientLinks";
import { ReasonDialog } from "./ReasonDialog";

/**
 * The page of one excipient: every fact in groups, the sending and receiving site side by side, the change-risk markers in words, and what
 * the excipient is linked to. A fact is one question: "Answer" or "Change" opens the same card as the Questions tab, so there is one way to
 * answer. An unknown reads "Not established" and stays visible. Nothing here decides a filing category; a marker only says what differs.
 */
export function ExcipientLinePage({ a, line }: { a: ExcipientAssessment; line: Line }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const questions = useExcipientQuestions(a);
  const byKey = useMemo(() => new Map(questions.map((q) => [q.key, q])), [questions]);
  const [editing, setEditing] = useState<string | undefined>();
  const [name, setName] = useState(line.name);
  const [reference, setReference] = useState(line.links.regulatoryReference ?? "");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const sources = project.sources.filter((s) => !s.supersededBy);

  const markers = excipientMarkers(project, a.id, line);
  const regulatory = excipientRegulatory(project, a.id, line);
  const counts = specCounts(line);
  // The one count word (EOU-14/15/25): the same entries the assessment's pill and Open items tab count, for this excipient only.
  const openHere = excipientOpenItems(project, a).filter((o) => o.lineId === line.id).length;

  const run = (fn: Parameters<typeof update>[0], status: string) => {
    const err = update(fn, status);
    setError(err ?? "");
    return err;
  };
  const saveAnswer = (q: ExcipientQuestion, ans: ExcipientAnswer): string | null => update((p, actor) => answerExcipientQuestion(p, q, ans, actor, { classes: excipientClasses }), "Answer saved");

  const pills: PagePill[] = [
    { label: classText(line) ?? "Role not chosen yet", testId: "ex-line-pill-class" },
    { label: markers.length ? `${markers.length} ${markers.length === 1 ? "marker" : "markers"}` : "No markers", warning: markers.length > 0, testId: "ex-line-pill-markers" },
    { label: openItemsCount(openHere), warning: openHere > 0, testId: "ex-line-pill-open" },
  ];

  // A fact with one value for the whole product is said to be for both sites, in the heading, the visible label and the button's name.
  const cell = (q: ExcipientQuestion | undefined, label: string, both = false, showBoth = false) => {
    const c = factCell(q);
    return (
      <div className="ex-cell">
        <span className={c.open ? "ex-open" : ""}>
          {showBoth && <span className="muted small ex-both-label">Both sites: </span>}
          <span aria-hidden="true">{c.icon}</span> {c.text}
        </span>
        {q && (
          <button type="button" className="btn small" aria-label={`${q.state === "answered" || q.state === "same_as_sending" ? "Change" : "Answer"}: ${label}${both ? ", both sites" : ""}`} onClick={() => setEditing(editing === q.key ? undefined : q.key)} aria-expanded={editing === q.key} data-testid={`ex-edit-${q.key}`}>
            {q.state === "answered" || q.state === "same_as_sending" ? "Change" : "Answer"}
          </button>
        )}
      </div>
    );
  };

  const classQ = byKey.get(`${line.id}/line:class`);
  const sideKey = (key: string, side?: ExcipientSide) => `${line.id}/fact:${key}${side ? `.${side}` : ""}`;
  const editingQ = editing ? byKey.get(editing) : undefined;
  const card = editingQ && (
    <tr key={`${editingQ.key}-card`}>
      <td colSpan={3}>
        <div className="ex-edit-card" data-testid="ex-edit-card">
          <ExcipientCard key={editingQ.key} q={editingQ} sources={sources} onSave={saveAnswer} />
          <button type="button" className="btn small" onClick={() => setEditing(undefined)} data-testid="ex-edit-close">
            Close
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="stack-lg" data-testid="ex-line-page">
      <PageHeader
        title={line.name}
        crumb={`${a.title}: ${line.name}`}
        purpose="Everything known about this excipient at the sending and the receiving site. Anything you don't know stays open."
        pills={pills}
        meta={`Last changed ${dateTime(line.updatedAt)}`}
        actions={
          <a className="btn" href={href(EXCIPIENT_PATH, { excipient: a.id, tab: "excipients" })} data-testid="ex-line-back">
            Back to the excipients
          </a>
        }
      />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      <section className="card stack" aria-labelledby="ex-line-name-h">
        <h2 id="ex-line-name-h">Name</h2>
        <label className="field">
          <span>Excipient name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (!name.trim()) return setName(line.name);
              if (name.trim() !== line.name) run((p, actor) => updateExcipientLine(p, a.id, line.id, { name: name.trim() }, actor), "Excipient renamed");
            }}
            data-testid="ex-line-name"
          />
        </label>
      </section>

      <section className="card stack" aria-labelledby="ex-markers-h" data-testid="ex-markers">
        <h2 id="ex-markers-h">What differs between the sites</h2>
        {markers.length === 0 ? (
          <p>Nothing differs so far in what has been entered. Open facts are not counted as a difference: they are listed below as not established.</p>
        ) : (
          <ul className="plain-list">
            {markers.map((m) => (
              <li key={m.key} data-testid={`ex-marker-${m.key}`}>
                <strong>
                  <span aria-hidden="true">{m.regulatory ? "▲" : "△"}</span> {m.label}
                </strong>
                <span className="block muted small">{excipientMarkerExplanation(project, excipientWording, m.key)}</span>
              </li>
            ))}
          </ul>
        )}
        {regulatory.required && (
          <div className="notice stack" data-testid="ex-regulatory">
            <p>
              <strong data-testid="ex-regulatory-sentence">{regulatory.sentence}</strong>
            </p>
            <label className="field">
              <span>Where the regulatory affairs assessment is written (optional)</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                onBlur={() => reference.trim() !== (line.links.regulatoryReference ?? "") && run((p, actor) => updateExcipientLine(p, a.id, line.id, { regulatoryReference: reference.trim() }, actor), "Reference saved")}
                data-testid="ex-regulatory-ref"
              />
            </label>
            <p className="muted small">The sentence stays whether or not a reference is written. The tool does not name a filing category.</p>
          </div>
        )}
      </section>

      {EXCIPIENT_FACT_GROUPS.map((g) => {
        // Only the facts that apply to this excipient have a question (the animal-origin ones appear when the origin calls for them).
        const facts = EXCIPIENT_FACTS.filter((f) => f.group === g && (byKey.has(sideKey(f.key)) || byKey.has(sideKey(f.key, "sending")) || byKey.has(sideKey(f.key, "receiving"))));
        const showClass = g === "identity";
        // A group of single-value facts has one column, "Both sites"; a mixed group keeps the two site columns and its single rows span them.
        const bothOnly = facts.every((f) => !byKey.has(sideKey(f.key, "sending")) && !byKey.has(sideKey(f.key, "receiving")));
        if (!facts.length && !showClass) return null;
        return (
          <section key={g} className="card stack" aria-labelledby={`ex-g-${g}`} data-testid={`ex-group-${g}`}>
            <h2 id={`ex-g-${g}`}>{EXCIPIENT_FACT_GROUP_LABEL[g]}</h2>
            <div className="table-scroll" role="region" aria-label={`${EXCIPIENT_FACT_GROUP_LABEL[g]} facts`} tabIndex={0}>
              <table className="data ex-facts" data-stack="true">
                <colgroup>
                  <col className="ex-col-fact" />
                  <col className="ex-col-site" />
                  <col className="ex-col-site" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Fact</th>
                    {bothOnly ? (
                      <th scope="col" colSpan={2}>
                        Both sites
                      </th>
                    ) : (
                      <>
                        <th scope="col">{EXCIPIENT_SIDE_LABEL.sending}</th>
                        <th scope="col">{EXCIPIENT_SIDE_LABEL.receiving}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {showClass && classQ && (
                    <Fragment>
                      <tr>
                        <th scope="row">Role of the excipient</th>
                        <td colSpan={2} data-label="Both sites">{cell(classQ, "Role of the excipient", true)}</td>
                      </tr>
                      {editing === classQ.key && card}
                    </Fragment>
                  )}
                  {facts.map((f) => {
                    const both = byKey.get(sideKey(f.key));
                    const s = byKey.get(sideKey(f.key, "sending"));
                    const r = byKey.get(sideKey(f.key, "receiving"));
                    const label = f.label;
                    const open = [both, s, r].find((x) => x && x.key === editing);
                    return (
                      <Fragment key={f.key}>
                        <tr>
                          <th scope="row">{label}</th>
                          {both ? <td colSpan={2} data-label="Both sites">{cell(both, label, true, !bothOnly)}</td> : (
                            <>
                              <td data-label="Sending site">{cell(s, `${label}, sending site`)}</td>
                              <td data-label="Receiving site">{cell(r, `${label}, receiving site`)}</td>
                            </>
                          )}
                        </tr>
                        {open && card}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section className="card stack" aria-labelledby="ex-line-specs-h" data-testid="ex-line-specs">
        <h2 id="ex-line-specs-h">Specifications</h2>
        <p>{specCountsText(counts)}</p>
        <div>
          <a className="btn" href={href(EXCIPIENT_PATH, { excipient: a.id, tab: "specs", of: line.id })} data-testid="ex-line-specs-link">
            Open the specifications of this excipient
          </a>
        </div>
      </section>

      <ExcipientLinksBox a={a} line={line} />

      <ExcipientLibraryBox a={a} line={line} />

      <section className="card stack no-print" aria-labelledby="ex-line-delete-h">
        <h2 id="ex-line-delete-h">Remove this excipient</h2>
        <p className="muted small">The excipient leaves the assessment. The change log keeps what it said and why you removed it.</p>
        <div>
          <button
            type="button"
            className="btn danger"
            data-testid="ex-line-remove"
            onClick={(e) => {
              opener.current = e.currentTarget;
              setRemoving(true);
            }}
          >
            Remove excipient
          </button>
        </div>
      </section>
      {removing && (
        <ReasonDialog
          title="Remove this excipient?"
          description={`${line.name} leaves ${a.title}, with its facts and ${line.specs.length === 1 ? "1 test" : `${line.specs.length} tests`}.`}
          confirmLabel="Remove excipient"
          keepLabel="Keep the excipient"
          testId="ex-line-remove"
          restoreFocus={() => opener.current}
          onClose={() => setRemoving(false)}
          onConfirm={(reason) => {
            const err = update((p, actor) => deleteExcipientLine(p, a.id, line.id, reason, actor), "Excipient removed");
            if (!err) navigate(EXCIPIENT_PATH, { excipient: a.id, tab: "excipients" });
            return err;
          }}
        />
      )}
    </div>
  );
}
