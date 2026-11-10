import {
  MBR_EXCIPIENTS_CHANGED,
  MBR_EXCIPIENTS_COLUMNS,
  MBR_EXCIPIENTS_GONE,
  MBR_EXCIPIENTS_INTRO,
  MBR_EXCIPIENTS_TITLE,
  addExcipientsUsed,
  mbrExcipientNotices,
  mbrExcipientOffers,
  mbrExcipientTableRow,
  mbrExcipientValue,
  removeExcipientUsed,
  removeExcipientsUsedTable,
  updateExcipientUsed,
  type MbrExcipientNotice,
} from "@gap/engine";
import type { MbrExcipientUsed, MbrRecord } from "@gap/process-model";
import { useMemo, useRef, useState } from "react";
import { HelpTip } from "../HelpTip";
import { Modal } from "../components";
import { EXCIPIENT_PATH } from "../excipient-ui";
import { href } from "../router";
import { useStore } from "../store";
import { ReasonDialog } from "./ReasonDialog";

type Dialog = { kind: "add" } | { kind: "update"; row: MbrExcipientUsed; notice: MbrExcipientNotice } | { kind: "remove"; row: MbrExcipientUsed } | { kind: "table" } | null;

/**
 * The optional "Excipients used" table of a batch record (M13 job 4C). Nothing is in it until the author ticks lines in "Add excipients from
 * the excipient assessment"; only lines linked to this record's TRD are offered. Each row is a copy: when the excipient assessment moves on,
 * the row says so and offers an Update that shows old and new side by side (Keep or Change). A row, or the whole table, is removed with a
 * reason that is kept in the change log. The table decides nothing; an unknown value reads "Not established".
 */
export function MbrExcipients({ rec }: { rec: MbrRecord }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const [dialog, setDialog] = useState<Dialog>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = (d: Dialog) => (e: React.MouseEvent<HTMLElement>) => {
    opener.current = e.currentTarget;
    setDialog(d);
  };
  const rows = rec.excipients ?? [];
  const notices = useMemo(() => new Map(mbrExcipientNotices(project, rec).map((n) => [n.rowId, n])), [project, rec]);
  const offers = useMemo(() => mbrExcipientOffers(project, rec), [project, rec]);
  const close = () => setDialog(null);
  const restoreFocus = () => (opener.current && opener.current.isConnected ? opener.current : document.getElementById("mbr-excipients-h"));

  return (
    <section className="card stack" aria-labelledby="mbr-excipients-h" data-testid="mbr-excipients" data-tour="mbr-excipients">
      <div className="row wrap between">
        <h2 id="mbr-excipients-h" tabIndex={-1}>
          {MBR_EXCIPIENTS_TITLE}
        </h2>
        <HelpTip label="the excipients used table" text="An optional list of the excipients the excipient assessment links to this record's TRD, with the grade and specification reference as they were when you added each one. Nothing is added unless you tick it, and a row only changes when you press Update." />
      </div>
      {rows.length === 0 ? <p className="small muted">No excipients are listed in this record.</p> : <p className="small">{MBR_EXCIPIENTS_INTRO}</p>}

      {rows.length > 0 && (
        <div className="table-scroll" role="region" aria-label="Excipients used in this record" tabIndex={0}>
          <table className="data" data-testid="mbr-excipients-table">
            <caption className="visually-hidden">{MBR_EXCIPIENTS_TITLE}</caption>
            <thead>
              <tr>
                {MBR_EXCIPIENTS_COLUMNS.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const n = notices.get(x.id);
                const cells = mbrExcipientTableRow(x);
                return (
                  <tr key={x.id} data-testid={`mbr-excipient-${x.id}`}>
                    {/* The name, what changed and the buttons share the first cell, so on a phone (where the table scrolls sideways) they are never out of sight. */}
                    <th scope="row">
                      <span data-testid={`mbr-excipient-name-${x.id}`}>{cells[0]}</span>
                      {n?.state === "changed" && (
                        <p className="notice small" role="status" data-testid={`mbr-excipient-changed-${x.id}`}>
                          <span className="warn-icon" aria-hidden="true">{"\u25B2 "}</span>
                          {MBR_EXCIPIENTS_CHANGED}.{" "}
                          <button type="button" className="btn small" aria-label={`Update ${x.name} from the excipient assessment`} data-testid={`mbr-excipient-update-${x.id}`} onClick={open({ kind: "update", row: x, notice: n })}>
                            Update
                          </button>
                        </p>
                      )}
                      {n?.state === "gone" && (
                        <p className="notice small" role="status" data-testid={`mbr-excipient-gone-${x.id}`}>
                          <span className="warn-icon" aria-hidden="true">{"\u25B2 "}</span>
                          {MBR_EXCIPIENTS_GONE}
                        </p>
                      )}
                      <button type="button" className="btn small" aria-label={`Remove ${x.name} from the excipients used`} data-testid={`mbr-excipient-remove-${x.id}`} onClick={open({ kind: "remove", row: x })}>
                        Remove
                      </button>
                    </th>
                    <td>{cells[1]}</td>
                    <td>{cells[2]}</td>
                    <td>
                      <a href={href(EXCIPIENT_PATH, { excipient: x.from.assessmentId, tab: "excipients" })}>{cells[3]}</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="row wrap">
        <button type="button" className="btn" data-testid="mbr-excipients-add" onClick={open({ kind: "add" })}>
          Add excipients from the excipient assessment
        </button>
        {rows.length > 0 && (
          <button type="button" className="btn" data-testid="mbr-excipients-remove-table" onClick={open({ kind: "table" })}>
            Remove the whole table
          </button>
        )}
      </div>

      {dialog?.kind === "add" && <AddDialog rec={rec} offers={offers} onClose={close} restoreFocus={restoreFocus} />}
      {dialog?.kind === "update" && <UpdateDialog rec={rec} row={dialog.row} notice={dialog.notice} onClose={close} restoreFocus={restoreFocus} />}
      {dialog?.kind === "remove" && (
        <ReasonDialog
          title="Remove this excipient from the table?"
          description={`${dialog.row.name} leaves the excipients used in this record. The excipient assessment is not changed.`}
          confirmLabel="Remove from the table"
          keepLabel="Keep the row"
          testId="mbr-excipient-remove"
          restoreFocus={restoreFocus}
          onClose={close}
          onConfirm={(reason) => update((p, a) => removeExcipientUsed(p, rec.id, dialog.row.id, reason, a), "Excipient removed from the table")}
        />
      )}
      {dialog?.kind === "table" && (
        <ReasonDialog
          title="Remove the whole table?"
          description={`All ${rows.length} ${rows.length === 1 ? "row leaves" : "rows leave"} the excipients used in this record. The excipient assessment is not changed.`}
          confirmLabel="Remove the table"
          keepLabel="Keep the table"
          testId="mbr-excipients-table-remove"
          restoreFocus={restoreFocus}
          onClose={close}
          onConfirm={(reason) => update((p, a) => removeExcipientsUsedTable(p, rec.id, reason, a), "Excipients used table removed")}
        />
      )}
    </section>
  );
}

/** The tick-list. Nothing is ticked at first: the author chooses. When there is nothing to offer, one sentence says why. */
function AddDialog({ rec, offers, onClose, restoreFocus }: { rec: MbrRecord; offers: ReturnType<typeof mbrExcipientOffers>; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const update = useStore((s) => s.update);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const keyOf = (o: { assessmentId: string; lineId: string }) => `${o.assessmentId}/${o.lineId}`;
  const toggle = (k: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Add excipients from the excipient assessment" description={`Only excipients linked to ${rec.trdId ?? "the TRD of this record"} are offered. Tick the ones to add; each is copied as the assessment says now.`} restoreFocus={restoreFocus} wide>
      {offers.offers.length === 0 ? (
        <p data-testid="mbr-excipients-none">
          {offers.none}{" "}
          <a href={href(EXCIPIENT_PATH, {})} data-testid="mbr-excipients-none-link">
            Open the excipient assessment
          </a>
        </p>
      ) : (
        <fieldset className="stack" data-testid="mbr-excipients-offers">
          <legend className="visually-hidden">Excipients linked to the TRD of this record</legend>
          {offers.offers.map((o) => {
            const k = keyOf(o);
            return (
              <label key={k} className="check top" data-testid={`mbr-excipients-offer-${o.lineId}`}>
                <input type="checkbox" checked={ticked.has(k)} onChange={() => toggle(k)} data-testid={`mbr-excipients-pick-${o.assessmentId}-${o.lineId}`} />
                <span>
                  <strong>{o.name}</strong> <span className="muted">({o.assessmentTitle}, {o.assessmentId} {o.lineId})</span>
                  <span className="small block">Grade: {mbrExcipientValue(o.grade)}. Specification reference: {mbrExcipientValue(o.specification)}.</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      {msg && (
        <p className="error" role="alert" data-testid="mbr-excipients-add-msg">
          {msg}
        </p>
      )}
      <div className="row end">
        <button type="button" className="btn" autoFocus onClick={onClose} data-testid="mbr-excipients-add-cancel">
          {offers.offers.length === 0 ? "Close" : "Cancel"}
        </button>
        {offers.offers.length > 0 && (
          <button
            type="button"
            className="btn primary"
            data-testid="mbr-excipients-add-confirm"
            onClick={() => {
              const picks = offers.offers.filter((o) => ticked.has(keyOf(o))).map((o) => ({ assessmentId: o.assessmentId, lineId: o.lineId }));
              if (!picks.length) return setMsg("Tick at least one excipient to add, or cancel.");
              const err = update((p, a) => addExcipientsUsed(p, rec.id, picks, a), picks.length === 1 ? "Excipient added to the table" : "Excipients added to the table");
              if (err) setMsg(err);
              else onClose();
            }}
          >
            Add the ticked excipients
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Old and new side by side. Keep leaves the row as it is; Change is the one click that copies the new values (one logged edit). */
function UpdateDialog({ rec, row, notice, onClose, restoreFocus }: { rec: MbrRecord; row: MbrExcipientUsed; notice: MbrExcipientNotice; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const update = useStore((s) => s.update);
  const [msg, setMsg] = useState("");
  const now = notice.now;
  const lines: { label: string; key: "name" | "grade" | "specification"; old: string; next: string }[] = [
    { label: MBR_EXCIPIENTS_COLUMNS[0], key: "name", old: row.name, next: now?.name ?? "" },
    { label: MBR_EXCIPIENTS_COLUMNS[1], key: "grade", old: mbrExcipientValue(row.grade), next: mbrExcipientValue(now?.grade) },
    { label: MBR_EXCIPIENTS_COLUMNS[2], key: "specification", old: mbrExcipientValue(row.specification), next: mbrExcipientValue(now?.specification) },
  ];
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${MBR_EXCIPIENTS_CHANGED}`} description={`${row.name}: the line changed after this row was copied. Nothing changes unless you press Change.`} restoreFocus={restoreFocus} wide>
      <div className="table-scroll" role="region" aria-label="Old and new values of the excipient row" tabIndex={0}>
        <table className="data" data-testid="mbr-excipient-update-table">
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">In this record now</th>
              <th scope="col">In the excipient assessment now</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <th scope="row">{l.label}</th>
                <td>{l.old}</td>
                <td>{l.next}</td>
                <td>{notice.differs.includes(l.key) ? "Different" : "The same"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && (
        <p className="error" role="alert" data-testid="mbr-excipient-update-msg">
          {msg}
        </p>
      )}
      <div className="row end">
        <button type="button" className="btn" autoFocus onClick={onClose} data-testid="mbr-excipient-update-keep">
          Keep the row as it is
        </button>
        <button
          type="button"
          className="btn primary"
          data-testid="mbr-excipient-update-change"
          onClick={() => {
            const err = update((p, a) => updateExcipientUsed(p, rec.id, row.id, a), "Excipient row updated");
            if (err) setMsg(err);
            else onClose();
          }}
        >
          Change to the new values
        </button>
      </div>
    </Modal>
  );
}
