import { failureModes } from "@gap/content";
import {
  excipientRiskOffers,
  excipientTableRows,
  excipientTableText,
  startRiskItemFromExcipient,
  trdLinkText,
  trdMaterialChoices,
  trdUseState,
  updateExcipientLine,
  applyExcipientToTrd,
} from "@gap/engine";
import type { ExcipientAssessment, ExcipientLine } from "@gap/process-model";
import { useMemo, useRef, useState } from "react";
import { classText, useExcipientQuestions } from "../excipient-ui";
import { href } from "../router";
import { useRiskAllowed, useTrdAllowed } from "../risk-module";
import { useAssessment, useStore } from "../store";
import { ReasonDialog } from "./ReasonDialog";

/**
 * "Linked to" on the page of one excipient (spec section 7): the gaps it relates to, the draft risk items started from it, and the
 * technical requirements document (TRD) material it belongs to. Every link is stored on the excipient only. Nothing is chosen for the
 * person: each menu starts empty. Taking a link away asks for a reason that is kept in the change log. No link is needed to save, to
 * leave the page or to download the document.
 */

type Away = { kind: "gap"; id: string } | { kind: "risk"; assessmentId: string; itemId: string } | { kind: "trd" };

export function ExcipientLinksBox({ a, line }: { a: ExcipientAssessment; line: ExcipientLine }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const assessment = useAssessment();
  const riskAllowed = useRiskAllowed();
  const trdAllowed = useTrdAllowed();
  const questions = useExcipientQuestions(a);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [away, setAway] = useState<Away | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const run = (fn: Parameters<typeof update>[0], done: string): boolean => {
    const err = update(fn, done);
    setProblem(err ?? "");
    setMessage(err ? "" : done);
    return !err;
  };
  const takeAway = (e: React.MouseEvent<HTMLButtonElement>, what: Away) => {
    opener.current = e.currentTarget;
    setAway(what);
  };

  // ------------------------------------------------------------------ gaps
  const gaps = useMemo(() => (assessment?.gaps ?? []).filter((g) => g.displayId.startsWith("G-")), [assessment]);
  const [gapPick, setGapPick] = useState("");
  const linkedGaps = line.links.gapIds;
  const pickable = gaps.filter((g) => !linkedGaps.includes(g.displayId));
  const gapText = (id: string): string => {
    const g = gaps.find((x) => x.displayId === id);
    return g ? `${g.displayId}: ${g.attribute} (${g.sectionTitle})` : `${id} (not among the gaps now)`;
  };

  // ------------------------------------------------------------------ risk
  const [riskPick, setRiskPick] = useState("");
  const risks = project.risk.assessments;
  const riskChosen = risks.find((r) => r.id === riskPick);
  const offers = riskChosen ? excipientRiskOffers(failureModes, riskChosen, line) : [];

  // ------------------------------------------------------------------ TRD
  const choices = useMemo(() => trdMaterialChoices(project), [project]);
  const [trdPick, setTrdPick] = useState("");
  const link = line.links.trdItem;
  const state = link ? trdUseState(project, link.trdId) : undefined;
  const [docRef, setDocRef] = useState("");
  const [procRef, setProcRef] = useState("");
  const table = useMemo(() => {
    if (!link) return "";
    const amount = new Map(questions.map((q) => [q.key, q.current]));
    const rows = excipientTableRows(project, a.id, link.trdId, {
      role: (l) => classText(l) ?? "Role not chosen yet",
      composition: (l) => amount.get(`${l.id}/fact:amount`) ?? "Not established",
    });
    return excipientTableText(rows);
  }, [project, a.id, link, questions]);
  const [copied, setCopied] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(table);
      setCopied("Copied. Paste it into the Excipient solution table of the TRD.");
    } catch {
      setCopied("The text could not be copied from here. Select it in the box and copy it.");
    }
  };

  const none = linkedGaps.length === 0 && line.links.riskItems.length === 0 && !link;

  return (
    <section className="card stack" aria-labelledby="ex-links-h" data-testid="ex-links">
      <h2 id="ex-links-h">Linked to</h2>
      <p className="muted small">Links are optional. They only help a reader find the same item in another document. Nothing here is needed to save or to download.</p>
      {problem && (
        <p className="notice" role="alert" data-testid="ex-links-problem">
          {problem}
        </p>
      )}
      <div role="status" className="muted small" data-testid="ex-links-status">
        {message}
      </div>
      {none && <p data-testid="ex-links-none">Nothing is linked yet.</p>}

      <div className="stack" data-testid="ex-links-gaps">
        <h3>Gaps</h3>
        {linkedGaps.length > 0 ? (
          <ul className="plain-list">
            {linkedGaps.map((id) => (
              <li key={id} className="row" data-testid={`ex-gap-${id}`}>
                <span>{gapText(id)}</span>
                <button type="button" className="btn small" aria-label={`Take away the link to ${id}`} onClick={(e) => takeAway(e, { kind: "gap", id })} data-testid={`ex-gap-away-${id}`}>
                  Take away
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No gap is linked.</p>
        )}
        {gaps.length === 0 ? (
          <p className="muted">The project has no gaps to link yet.</p>
        ) : pickable.length > 0 ? (
          <div className="row">
            <label className="field">
              <span>Gap this excipient relates to</span>
              <select value={gapPick} onChange={(e) => setGapPick(e.target.value)} data-testid="ex-gap-pick">
                <option value="">Choose…</option>
                {pickable.map((g) => (
                  <option key={g.displayId} value={g.displayId}>
                    {g.displayId}: {g.attribute} ({g.sectionTitle})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              disabled={!gapPick}
              onClick={() => run((p, actor) => updateExcipientLine(p, a.id, line.id, { gapIds: [...linkedGaps, gapPick] }, actor), `Linked to ${gapPick}`) && setGapPick("")}
              data-testid="ex-gap-link"
            >
              Link this gap
            </button>
          </div>
        ) : null}
        <p className="muted small">A gap number follows the order of the gaps in the document, so it can change when answers change. Check the link after a large change.</p>
      </div>

      <div className="stack" data-testid="ex-links-risk">
        <h3>Risk items</h3>
        {line.links.riskItems.length > 0 ? (
          <ul className="plain-list">
            {line.links.riskItems.map((r) => {
              const ra = risks.find((x) => x.id === r.assessmentId);
              const item = ra?.items.find((i) => i.id === r.itemId);
              return (
                <li key={`${r.assessmentId}-${r.itemId}`} className="row" data-testid={`ex-risk-${r.itemId}`}>
                  <span>
                    {item ? (
                      <a href={href("/risk", { ra: r.assessmentId, tab: "items" })}>
                        Risk item {r.itemId}
                      </a>
                    ) : (
                      <>Risk item {r.itemId} (not in the risk assessment now)</>
                    )}{" "}
                    in {r.assessmentId}
                    {item ? `: ${item.failureMode}` : ""}
                  </span>
                  <button type="button" className="btn small" aria-label={`Take away the link to risk item ${r.itemId}`} onClick={(e) => takeAway(e, { kind: "risk", assessmentId: r.assessmentId, itemId: r.itemId })} data-testid={`ex-risk-away-${r.itemId}`}>
                    Take away
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No risk item was started from this excipient.</p>
        )}
        {!riskAllowed ? (
          <p className="muted">The risk assessment is not part of this project.</p>
        ) : risks.length === 0 ? (
          <p className="muted" data-testid="ex-risk-none">
            This project has no risk assessment yet. <a href={href("/risk")}>Start one on the risk page</a>, then come back to start an item from this excipient.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Start a risk item from this excipient, in</span>
              <select value={riskPick} onChange={(e) => setRiskPick(e.target.value)} data-testid="ex-risk-pick">
                <option value="">Choose a risk assessment…</option>
                {risks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id}: {r.title}
                  </option>
                ))}
              </select>
            </label>
            {riskChosen && (
              <ul className="plain-list" data-testid="ex-risk-offers">
                {offers.map((o) => (
                  <li key={o.key} className="stack" data-testid={`ex-risk-offer-${o.key}`}>
                    <strong className="block">{o.failureMode}</strong>
                    <span className="muted small block">{o.effect}</span>
                    {o.added ? (
                      <span className="block" data-testid={`ex-risk-added-${o.key}`}>
                        <span aria-hidden="true">✓</span> Started as risk item {o.itemId}
                      </span>
                    ) : (
                      <div>
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Start a draft risk item: ${o.failureMode}`}
                          onClick={() => {
                            let made = "";
                            run((p, actor) => {
                              const r = startRiskItemFromExcipient(p, a.id, line.id, riskChosen.id, o.key, failureModes, actor);
                              made = r.itemId;
                              return r.project;
                            }, "Draft risk item started") && setMessage(`Draft risk item ${made} started in ${riskChosen.id}. It has no score: the team gives it.`);
                          }}
                          data-testid={`ex-risk-start-${o.key}`}
                        >
                          Start a draft risk item
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="stack" data-testid="ex-links-trd">
        <h3>Technical requirements document</h3>
        {!trdAllowed ? (
          <p className="muted">The technical requirements document is not part of this project.</p>
        ) : link ? (
          <>
            <p className="row" data-testid="ex-trd-linked">
              <span>{trdLinkText(project, link)}</span>
              <button type="button" className="btn small" aria-label="Take away the link to the technical requirements document" onClick={(e) => takeAway(e, { kind: "trd" })} data-testid="ex-trd-away">
                Take away
              </button>
            </p>
            {state && (
              <div className="stack" data-testid="ex-trd-use">
                <h4>Use in the TRD</h4>
                <p className="muted small">
                  This writes the two blanks of the "Dilution buffer" section of {state.trdId}. A box left empty writes nothing and clears nothing.
                </p>
                <p className="small" data-testid="ex-trd-now">
                  The TRD holds now: assessment document {state.document ? `"${state.document}"` : "not typed"}; procedure {state.procedure ? `"${state.procedure}"` : "not typed"}.
                </p>
                <label className="field">
                  <span>Document reference of the approved excipient assessment</span>
                  <input value={docRef} onChange={(e) => setDocRef(e.target.value)} data-testid="ex-trd-doc" />
                </label>
                <label className="field">
                  <span>Procedure or agreement that governs the assessment</span>
                  <input value={procRef} onChange={(e) => setProcRef(e.target.value)} data-testid="ex-trd-proc" />
                </label>
                <div>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      const done = run((p, actor) => applyExcipientToTrd(p, a.id, line.id, { document: docRef, procedure: procRef }, actor), `Written to ${state.trdId}`);
                      if (done) {
                        setDocRef("");
                        setProcRef("");
                      }
                    }}
                    data-testid="ex-trd-use-button"
                  >
                    Use in the TRD
                  </button>
                </div>
                <label className="field">
                  <span>Excipients of {state.trdId} for the "Excipient solution" table (name and concentration)</span>
                  <textarea readOnly rows={Math.max(2, table.split("\n").length)} value={table} data-testid="ex-trd-table" />
                </label>
                <p className="muted small">The table is not filled in for you: copy these rows and paste them into the table of the section. The quantity column is yours to calculate.</p>
                <div className="row">
                  <button type="button" className="btn" onClick={copy} data-testid="ex-trd-copy">
                    Copy the rows
                  </button>
                  <span role="status" className="muted small" data-testid="ex-trd-copied">
                    {copied}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : choices.length === 0 ? (
          <p className="muted" data-testid="ex-trd-none">
            No technical requirements document has a buffer or diluent material yet. <a href={href("/trd")}>Open the TRD page</a>.
          </p>
        ) : (
          <div className="row">
            <label className="field">
              <span>Buffer or diluent this excipient belongs to</span>
              <select value={trdPick} onChange={(e) => setTrdPick(e.target.value)} data-testid="ex-trd-pick">
                <option value="">Choose…</option>
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.trdId}: {c.stepLabel}, {c.itemLabel}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              disabled={!trdPick}
              onClick={() => {
                const c = choices.find((x) => x.value === trdPick);
                if (c && run((p, actor) => updateExcipientLine(p, a.id, line.id, { trdItem: { trdId: c.trdId, stepKey: c.stepKey, itemKey: c.itemKey } }, actor), `Linked to ${c.trdId}`)) setTrdPick("");
              }}
              data-testid="ex-trd-link"
            >
              Link this material
            </button>
          </div>
        )}
      </div>

      {away && (
        <ReasonDialog
          title="Take this link away?"
          description={away.kind === "gap" ? `${line.name} is no longer linked to ${away.id}. The gap itself stays.` : away.kind === "risk" ? `${line.name} is no longer linked to risk item ${away.itemId}. The risk item itself stays.` : `${line.name} is no longer linked to the technical requirements document. The TRD keeps what was written there.`}
          confirmLabel="Take the link away"
          keepLabel="Keep the link"
          testId="ex-link-away"
          restoreFocus={() => opener.current}
          onClose={() => setAway(null)}
          onConfirm={(reason) =>
            update(
              (p, actor) =>
                updateExcipientLine(
                  p,
                  a.id,
                  line.id,
                  away.kind === "gap"
                    ? { gapIds: linkedGaps.filter((x) => x !== away.id), reason }
                    : away.kind === "risk"
                      ? { riskItems: line.links.riskItems.filter((r) => !(r.assessmentId === away.assessmentId && r.itemId === away.itemId)), reason }
                      : { trdItem: null, reason },
                  actor,
                ),
              "Link taken away",
            )
          }
        />
      )}
    </section>
  );
}
