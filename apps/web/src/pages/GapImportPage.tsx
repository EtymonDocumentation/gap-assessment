import { gapImportSynonyms } from "@gap/content";
import {
  applyGapImport,
  checkGapValue,
  CONFIDENCE_LABEL,
  currentGapText,
  emptyGapField,
  GAP_SIDE_LABEL,
  gapCounts,
  gapFieldId,
  importSummaryText,
  isProjectStageQuestion,
  visibleInstances,
  type GapField,
  type GapImportSession,
  type GapRow,
  type GapSide,
} from "@gap/engine";
import { Fragment, useMemo, useRef, useState } from "react";
import { Empty } from "../components";
import { PageHeader } from "../PageHeader";
import { holdGapImport, useHeldGapImport } from "../gap-import-store";
import { href, navigate } from "../router";
import * as api from "../server/api";
import { SERVER_MODE } from "../server/mode";
import { useIsRemote } from "../server/ServerUi";
import { actorOf, useContent, useStore } from "../store";
import { GapFormButton, GapUploadButton } from "./GapUploadButton";
import { ImportDocPane } from "./ImportDocPane";

/**
 * The review screen of "Upload a gap assessment" (levels 1 to 3). One compact ROW per question: the question, the sending-unit answer,
 * the receiving-unit answer and where it was read. Rows are grouped by section, so a long assessment stays easy to scan. Nothing reaches
 * a project until it is accepted here; what nobody accepts stays open. On a phone every row stacks into one short block, and the
 * document it was read from sits below the rows (Show / Hide), as on the sampling plan review.
 */

type Mode = "" | "new" | "update";

interface Done {
  text: string;
  detail: string;
  warnings: string[];
  copy: string;
  mode: Mode;
}

export function GapImportPage() {
  const held = useHeldGapImport();
  if (!held) {
    return (
      <div className="stack-lg">
        <PageHeader title="Upload a gap assessment" purpose="Read a gap assessment you already have, check what was found, and make it the answers of a project." />
        <section className="card stack" data-testid="import-none">
          <Empty>No file is open. Choose a gap assessment file to start.</Empty>
          <div className="row wrap">
            <GapUploadButton testId="import-upload" />
          </div>
        </section>
      </div>
    );
  }
  return <Review key={held.session.fileName + held.file.size} session={held.session} file={held.file} />;
}

const closeUpload = () => {
  holdGapImport(null);
  navigate("/gap");
};

const SIDES: GapSide[] = ["source", "target"];

function Review({ session, file }: { session: GapImportSession; file: File }) {
  const project = useStore((s) => s.project);
  const content = useContent();
  const remote = SERVER_MODE && useIsRemote();
  const [decisions, setDecisions] = useState<Record<string, { value: string }>>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(project ? "update" : "new");
  const [title, setTitle] = useState("");
  const [who, setWho] = useState({ name: project?.interview.responder?.name ?? "", role: project?.interview.responder?.role ?? "" });
  const [keepCopy, setKeepCopy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [bulk, setBulk] = useState("");
  const [docOpen, setDocOpen] = useState(() => session.rows.length <= 40 && (typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1000px)").matches)); // a whole export is a very long page: it starts hidden
  const docPane = useRef<HTMLDivElement>(null);

  const updating = mode === "update" && !!project;
  const instances = useMemo(() => (project ? new Map(visibleInstances(content, project, "paired").map((i) => [i.key, i])) : new Map()), [content, project]);
  const counts = useMemo(() => gapCounts(session, decisions), [session, decisions]);
  const fieldMap = useMemo(() => new Map(session.fields.map((f) => [f.id, f])), [session]);
  const rowById = useMemo(() => new Map(session.rows.map((r) => [r.questionId, r])), [session]);
  /** A side the file gave nothing for still has a box the person can type in: a field with no value (it is not established). */
  const fieldFor = (row: GapRow, side: GapSide): GapField => fieldMap.get(gapFieldId(row.questionId, side)) ?? emptyGapField(row.questionId, side, "");
  const allFields = (row: GapRow) => row.sides.map((s) => fieldFor(row, s));

  const nowOf = (f: GapField) => (updating && project ? currentGapText(content, project, instances, f) : undefined);
  /** A suggestion can be taken in bulk when it is readable, not decided yet, and (update mode) would not replace a different answer the project has. */
  const bulkable = (f: GapField, kind: "exact" | "matched"): boolean => {
    if (decisions[f.id] || f.change || f.unreadable || f.value === "" || f.confidence !== kind) return false;
    const now = nowOf(f);
    if (updating && !instances.has(`${f.row}@${f.side}`)) return false;
    return !now || !now.exists || now.text === f.value;
  };
  const kind: "exact" | "matched" = session.level === 3 ? "matched" : "exact";
  const bulkIn = (rows: GapRow[]) => rows.flatMap(allFields).filter((f) => bulkable(f, kind));
  const totalBulk = bulkIn(session.rows).length;

  const sections = useMemo(() => {
    const out: { id: string; title: string; rows: GapRow[] }[] = [];
    for (const r of session.rows) {
      let s = out[out.length - 1];
      if (!s || s.id !== r.sectionId) {
        s = { id: r.sectionId, title: r.sectionTitle, rows: [] };
        out.push(s);
      }
      s.rows.push(r);
    }
    return out;
  }, [session]);
  // Which sections start open: a short list shows everything; a long one opens the sections that need a look (changed, not found, unreadable).
  const needsLook = (rows: GapRow[]) => rows.some((r) => allFields(r).some((f) => f.change || f.unreadable || f.notUsedWhy));
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(sections.map((s) => [s.id, session.rows.length <= 40 || needsLook(s.rows) || session.level === 3])));

  const set = (id: string, value: string) => setDecisions((d) => ({ ...d, [id]: { value } }));
  const clear = (id: string) =>
    setDecisions((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  const take = (fs: GapField[]) => setDecisions((d) => ({ ...d, ...Object.fromEntries(fs.map((f) => [f.id, { value: f.value }])) }));
  const qOf = (id: string) => content.questionById.get(id)!;

  function saveEdit() {
    if (!editing) return;
    const f = parseId(editing.id);
    const text = editing.text.replace(/[ \t]+/g, " ").trim();
    const why = checkGapValue(content, qOf(f.questionId), f.side, text, gapImportSynonyms);
    if (why) return setError(`${rowById.get(f.questionId)?.label ?? f.questionId}: ${why}`);
    setError("");
    if (text) set(editing.id, text);
    else clear(editing.id);
    setEditing(null);
  }

  function takeText(text: string) {
    if (!picking) return;
    const f = parseId(picking);
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    const why = checkGapValue(content, qOf(f.questionId), f.side, clean, gapImportSynonyms);
    if (why) setError(`${rowById.get(f.questionId)?.label ?? f.questionId}: ${why}`);
    else {
      setError("");
      set(picking, clean);
    }
    setPicking(null);
  }

  function showInDocument(ids: string[]) {
    const key = ids.map((id) => session.fieldCells[id]?.[0]).find(Boolean);
    setDocOpen(true);
    requestAnimationFrame(() => {
      const el = key ? document.getElementById(`imp-cell-${key.replace(/:/g, "-")}`) : null;
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    });
  }
  function showTable(block: number) {
    setDocOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(`imp-table-${block}`);
      el?.scrollIntoView({ block: "start" });
      el?.focus();
    });
  }

  // A second press while the first is still being answered must not make a second project.
  const sending = useRef(false);
  async function submit() {
    if (sending.current) return;
    sending.current = true;
    try {
      await submitOnce();
    } finally {
      sending.current = false;
    }
  }
  async function submitOnce() {
    setError("");
    if (!mode) return setError("Choose whether this makes a new project or updates the open one.");
    const newTitle = title.trim() || session.title.value.trim();
    if (mode === "new") {
      if (!newTitle) return setError("Give the new project a name, or use the name from the file.");
      if (!who.name.trim()) return setError("Say who is answering: enter your name.");
      if (project && !remote && !window.confirm("This replaces the project currently open in this browser. Export it first if you want to keep it. Continue?")) return;
    }
    let result: ReturnType<typeof applyGapImport> | undefined;
    const run = (p: NonNullable<typeof project>) => {
      result = applyGapImport(p, session, decisions, { actor: actorOf(p), content, syn: gapImportSynonyms });
      return result.project;
    };
    let err: string | null = null;
    if (mode === "new") {
      // Refused while the open project's save has failed or has a conflict. Nothing is put into the open project then: the answers are
      // still on this page, and the reason is shown.
      const refused = await useStore.getState().newProject(newTitle, { name: who.name.trim(), ...(who.role.trim() ? { role: who.role.trim() } : {}) });
      if (refused) return setError(refused);
      err = useStore.getState().update((p) => run(p), `Gap assessment imported from ${session.fileName}`);
    } else err = useStore.getState().update((p) => run(p), `Gap assessment imported from ${session.fileName}`);
    if (err || !result) return setError(err || "The answers could not be put in.");
    const r = result;
    const finish = (copy: string) =>
      setDone({
        text: importSummaryText(r.counts, session.level),
        detail: `${r.applied} ${r.applied === 1 ? "answer" : "answers"} recorded${r.unchanged ? `, ${r.unchanged} already the same` : ""}.`,
        warnings: r.warnings,
        copy,
        mode,
      });
    if (SERVER_MODE && keepCopy) {
      api.uploadMyFile(file, "", () => undefined).done.then(
        () => finish("A copy of the file was kept in My files."),
        (e: Error) => finish(`The copy could not be kept in My files: ${e.message}`),
      );
    } else finish("");
  }

  if (done) {
    return (
      <div className="stack-lg">
        <PageHeader title="Upload a gap assessment" purpose="Done. The accepted answers are part of the project now." />
        <section className="card stack" data-testid="import-done" aria-labelledby="import-done-h">
          <h2 id="import-done-h">{done.mode === "new" ? "New project made" : "Project updated"}</h2>
          <p data-testid="import-summary" role="status">
            {done.text}
          </p>
          <p data-testid="import-added">{done.detail}</p>
          {done.copy && <p className="small">{done.copy}</p>}
          {done.warnings.length > 0 && (
            <div className="notice" data-testid="import-warnings">
              <strong>Left open:</strong>
              <ul className="plain-list">
                {done.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small">Questions you did not accept stay open in the interview. The gap register is worked out again from the answers.</p>
          <div className="row wrap">
            <a className="btn primary" href={href("/interview")} data-testid="import-open-interview">
              Open the interview
            </a>
            <a className="btn" href={href("/register")} data-testid="import-open-register">
              Open the gap register
            </a>
            <button type="button" className="btn ghost" onClick={closeUpload}>
              Close this upload
            </button>
          </div>
        </section>
      </div>
    );
  }

  function parseId(id: string): { questionId: string; side: GapSide } {
    const m = /^gap\.q\.(.+)\.(source|target|shared)$/.exec(id)!;
    return { questionId: m[1]!, side: m[2] as GapSide };
  }

  function renderCell(row: GapRow, f: GapField, colSpan?: number) {
    const decided = decisions[f.id];
    const now = nowOf(f);
    const head = GAP_SIDE_LABEL[f.side];
    const name = `${head}, ${row.label}`;
    const common = { "data-label": head, ...(colSpan ? { colSpan } : {}) };
    if (editing?.id === f.id) {
      const id = `edit-${f.id}`;
      return (
        <td {...common} className="sp-import-cell">
          <label className="visually-hidden" htmlFor={id}>
            {name}
          </label>
          <input id={id} type="text" value={editing.text} onChange={(e) => setEditing({ id: f.id, text: e.target.value })} data-testid="import-edit-input" />
          <span className="import-actions">
            <button type="button" className="btn small" onClick={saveEdit} data-testid="import-edit-save">
              Save
            </button>
            {session.level === 3 && (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  setEditing(null);
                  setPicking(f.id);
                  setDocOpen(true);
                  docPane.current?.scrollIntoView({ block: "start" });
                }}
              >
                Pick from document
              </button>
            )}
            <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </span>
        </td>
      );
    }
    if (f.change) {
      const keep = f.known?.[0]?.text ?? "";
      const state = decided === undefined ? "" : decided.value === f.change.new ? "Taken from the file" : "Kept the exported answer";
      return (
        <td {...common} className="sp-import-cell import-changed" data-testid="import-changed">
          <span className="tag status-partial status">{CONFIDENCE_LABEL.changed}</span>
          <span className="import-value">
            <span className="import-old">{f.change.old || "(empty)"}</span> <span className="import-new">{f.change.new || "(empty)"}</span>
          </span>
          {f.unreadable && <span className="import-cell-state">{f.unreadable}</span>}
          {state && (
            <span className="import-cell-state" data-testid="import-state">
              {state}
            </span>
          )}
          {/* The project stage is changed on the Home page: no button here puts it in (the cell says why). */}
          {!isProjectStageQuestion(f.row, f.side) && (
            <span className="import-actions">
              <button type="button" className="btn small" disabled={!!f.unreadable} onClick={() => set(f.id, f.change!.new)} aria-label={`Use the file's answer: ${name}`} data-testid="import-use-file">
                Use the file's
              </button>
              <button type="button" className="btn small ghost" onClick={() => set(f.id, keep)} aria-label={`Keep the exported answer: ${name}`} data-testid="import-keep">
                Keep the exported
              </button>
              <button type="button" className="btn small ghost" onClick={() => setEditing({ id: f.id, text: f.change!.new })} aria-label={`Edit: ${name}`}>
                Edit
              </button>
              {decided !== undefined && (
                <button type="button" className="btn small ghost" onClick={() => clear(f.id)}>
                  Undo
                </button>
              )}
            </span>
          )}
        </td>
      );
    }
    const shown = decided?.value ?? f.value;
    const missingInProject = updating && !instances.has(`${f.row}@${f.side}`);
    return (
      <td {...common} className="sp-import-cell" data-testid={`import-cell-${f.side}`}>
        {f.side === "shared" && <span className="import-both muted small">Both units</span>}
        <span className="import-value">{shown || <span className="muted" aria-label="No answer read">&mdash;</span>}</span>
        <span className="import-word">
          <span className="tag">{decided ? (decided.value === f.value ? "Accepted" : "Accepted (edited)") : f.value ? CONFIDENCE_LABEL[f.confidence] : CONFIDENCE_LABEL.not_found}</span>
        </span>
        {!decided && f.unreadable && <span className="import-cell-state">Cannot be taken as it stands: {f.unreadable}</span>}
        {f.side === "shared" && !decided && f.source && session.level === 3 && <span className="import-cell-state">Read from: {f.source}</span>}
        {!decided && f.notUsedWhy && (
          <span className="import-cell-state" data-testid="import-not-used-why">
            {f.notUsedWhy}
          </span>
        )}
        {now?.exists && now.text !== "" && now.text !== shown && <span className="import-cell-state">The project has: {now.text}</span>}
        {now?.exists && now.text !== "" && now.text === shown && <span className="import-cell-state">Same as the project</span>}
        {missingInProject && <span className="import-cell-state">This project does not ask this question (yet), so it cannot be put in.</span>}
        <span className="import-actions">
          {decided ? (
            <button type="button" className="btn small ghost" onClick={() => clear(f.id)} aria-label={`Undo: ${name}`}>
              Undo
            </button>
          ) : (
            <>
              {f.value !== "" && (
                <button type="button" className="btn small" disabled={!!f.unreadable} onClick={() => set(f.id, f.value)} aria-label={`Accept: ${name}: ${f.value}`} data-testid="import-accept">
                  Accept
                </button>
              )}
              {/* The project stage is changed on the Home page, so no answer is typed for it here (the cell says why). */}
              {!isProjectStageQuestion(f.row, f.side) && (
                <button type="button" className="btn small ghost" onClick={() => setEditing({ id: f.id, text: f.value })} aria-label={`${f.value ? "Edit" : "Type an answer"}: ${name}`}>
                  {f.value ? "Edit" : "Type an answer"}
                </button>
              )}
              {session.fieldCells[f.id] && (
                <button type="button" className="btn small ghost" onClick={() => showInDocument([f.id])} aria-label={`Show in the document: ${name}`}>
                  Show
                </button>
              )}
            </>
          )}
        </span>
      </td>
    );
  }

  const where = (r: GapRow) => (session.level === 3 ? (r.where ?? "") : session.level === 1 ? "The data stored in the Word file" : "The form");

  return (
    <div className="stack-lg" data-testid="import-review">
      <PageHeader title="Upload a gap assessment" purpose={`Check what was read from ${session.fileName}. Nothing goes into a project until you accept it; what you leave alone stays open.`} />
      <section className="card stack" aria-labelledby="import-what-h">
        <h2 id="import-what-h">What was read</h2>
        <p data-testid="import-read-as">{session.readAs}</p>
        <p className="muted small" data-testid="import-explain">
          {session.level === 3
            ? "Each row below is one question found in your document and matched to a question of this tool by its wording (fixed word rules, no AI). Every answer marked Matched is a suggestion: check it against the document, then accept it, edit it, or pick another value from the document. Not found means the answer did not fit the question and stays open."
            : "Each row below is one question with the sending unit (SU) and receiving unit (RU) answer. Accept an answer, edit it, or leave it open. The word under an answer says how sure the reading is: Exact (read straight from our own data), or Changed in Word (somebody typed over it in the file)."}
        </p>
        <p role="status" aria-live="polite" data-testid="import-live-summary">
          {importSummaryText(counts, session.level)}
        </p>
        {session.notUsed.length > 0 && (
          <details className="notice import-not-used" open={session.notUsed.length <= 8} data-testid="import-not-used">
            <summary>
              <strong>Not used yet ({session.notUsed.length}):</strong> things in your document that were not put into the project
            </summary>
            <ul className="plain-list">
              {session.notUsed.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
        {session.level === 3 && (session.matchedTables?.length ?? 0) > 0 && (
          <div className="stack" data-testid="import-matched-tables">
            <h3>Tables with matches</h3>
            <p className="muted small">Look at the table in your document, then accept everything matched in it with one press, or accept answer by answer below.</p>
            <ul className="plain-list import-table-list">
              {session.matchedTables!.map((t) => {
                const fs = session.fields.filter((f) => f.table === t.block && bulkable(f, "matched"));
                return (
                  <li key={t.block} className="row wrap" data-testid="import-matched-table">
                    <span>{t.label}</span>
                    <button
                      type="button"
                      className="btn small"
                      disabled={fs.length === 0}
                      onClick={() => {
                        take(fs);
                        setBulk(`${fs.length} matched ${fs.length === 1 ? "answer" : "answers"} from ${t.label} accepted.`);
                      }}
                      aria-label={`Accept all matched in this table (${fs.length}): ${t.label}`}
                      data-testid="import-accept-table"
                    >
                      Accept all matched in this table ({fs.length})
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => showTable(t.block)} aria-label={`Show table: ${t.label}`}>
                      Show table
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="row wrap">
          {session.level !== 3 && (
            <button
              type="button"
              className="btn"
              disabled={totalBulk === 0}
              onClick={() => {
                take(bulkIn(session.rows));
                setBulk(`${totalBulk} exact ${totalBulk === 1 ? "answer" : "answers"} accepted.`);
              }}
              data-testid="import-accept-exact"
            >
              Accept all exact ({totalBulk})
            </button>
          )}
          {sections.length > 1 && (
            <>
              <button type="button" className="btn small ghost" onClick={() => setOpen(Object.fromEntries(sections.map((s) => [s.id, true])))}>
                Open all sections
              </button>
              <button type="button" className="btn small ghost" onClick={() => setOpen(Object.fromEntries(sections.map((s) => [s.id, false])))}>
                Close all sections
              </button>
            </>
          )}
          <span role="status" aria-live="polite" className="small" data-testid="import-bulk-status">
            {bulk}
          </span>
        </div>
      </section>

      <div className="import-panes sp-import-panes">
        <section className="import-fields stack" aria-labelledby="import-fields-h" data-testid="import-fields">
          <h2 id="import-fields-h">Questions</h2>
          {session.rows.length === 0 ? (
            <Empty>No question was found. Use "Not used yet" above to see why, or fill in the blank gap assessment form.</Empty>
          ) : (
            sections.map((sec) => {
              const secBulk = bulkIn(sec.rows);
              return (
                <details
                  key={sec.id}
                  className="gap-import-section"
                  open={!!open[sec.id]}
                  onToggle={(e) => {
                    const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                    setOpen((o) => (o[sec.id] === isOpen ? o : { ...o, [sec.id]: isOpen }));
                  }}
                  data-testid="import-section"
                >
                  <summary>
                    <strong>{sec.title}</strong> <span className="muted small">({sec.rows.length} {sec.rows.length === 1 ? "question" : "questions"})</span>
                  </summary>
                  <div className="row wrap gap-import-section-bar">
                    <button
                      type="button"
                      className="btn small"
                      disabled={secBulk.length === 0}
                      onClick={() => {
                        take(secBulk);
                        setBulk(`${secBulk.length} ${kind === "exact" ? "exact" : "matched"} ${secBulk.length === 1 ? "answer" : "answers"} in ${sec.title} accepted.`);
                      }}
                      aria-label={`Accept all ${kind} in this section (${secBulk.length}): ${sec.title}`}
                      data-testid="import-accept-section"
                    >
                      Accept all {kind} in this section ({secBulk.length})
                    </button>
                  </div>
                  <div className="table-scroll" role="region" aria-label={`Questions of ${sec.title} read from the file`} tabIndex={0}>
                    <table className="data sp-import-table" data-testid="import-rows">
                      <thead>
                        <tr>
                          <th scope="col">Question</th>
                          <th scope="col">{GAP_SIDE_LABEL.source}</th>
                          <th scope="col">{GAP_SIDE_LABEL.target}</th>
                          <th scope="col">Where it was read</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sec.rows.map((r) => {
                          const shared = r.sides[0] === "shared";
                          return (
                            <tr key={r.questionId} data-testid="import-row">
                              <th scope="row" className="sp-import-point gap-import-q" data-label="Question">
                                {r.label}
                              </th>
                              {shared ? (
                                renderCell(r, fieldFor(r, "shared"), 2)
                              ) : (
                                SIDES.map((s) =>
                                  r.sides.includes(s) ? (
                                    <Fragment key={s}>{renderCell(r, fieldFor(r, s))}</Fragment>
                                  ) : (
                                    <td key={s} data-label={GAP_SIDE_LABEL[s]} className="sp-import-cell muted">
                                      Not asked of this unit
                                    </td>
                                  ),
                                )
                              )}
                              <td data-label="Where it was read" className="sp-import-cell small">
                                {where(r)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })
          )}
        </section>

        <ImportDocPane
          blocks={session.blocks}
          cellFields={session.cellFields}
          anyChanged={(ids) => ids.some((id) => fieldMap.get(id)?.change)}
          picking={picking ? `${GAP_SIDE_LABEL[parseId(picking).side]}, ${rowById.get(parseId(picking).questionId)?.label ?? ""}` : null}
          onTake={takeText}
          onCancelPick={() => setPicking(null)}
          open={docOpen}
          setOpen={setDocOpen}
          innerRef={docPane}
        />
      </div>

      <section className="card stack" aria-labelledby="import-make-h" data-testid="import-make">
        <h2 id="import-make-h">Put the answers in a project</h2>
        {project && (
          <fieldset className="stack">
            <legend>A project is open. What should this upload do?</legend>
            <label className="check">
              <input type="radio" name="import-target" checked={mode === "update"} onChange={() => setMode("update")} data-testid="import-target-update" />
              <span>Update the open project ({project.meta.title}): only the answers you accept are changed</span>
            </label>
            <label className="check">
              <input type="radio" name="import-target" checked={mode === "new"} onChange={() => setMode("new")} data-testid="import-target-new" />
              <span>Make a new project from this file{remote ? "" : " (it replaces the project open in this browser)"}</span>
            </label>
          </fieldset>
        )}
        {updating && <p className="muted small">An answer the project already has is replaced only if you accept the file's answer for it, one by one. "Accept all" skips those.</p>}
        {mode === "new" && (
          <div className="stack">
            <label className="field">
              <span>Name of the new project</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="import-title" />
            </label>
            {session.title.value && (
              <div className="row wrap">
                <span className="small">
                  The file's name: <strong>{session.title.value}</strong>
                </span>
                <button type="button" className="btn small" onClick={() => setTitle(session.title.value)} data-testid="import-use-title">
                  Use this name
                </button>
              </div>
            )}
            <div className="row wrap">
              <label className="field">
                <span>Who is answering (name)</span>
                <input type="text" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} data-testid="import-who-name" />
              </label>
              <label className="field">
                <span>Role (optional)</span>
                <input type="text" value={who.role} onChange={(e) => setWho({ ...who, role: e.target.value })} data-testid="import-who-role" />
              </label>
            </div>
          </div>
        )}
        {SERVER_MODE && (
          <label className="check">
            <input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} data-testid="import-keep-copy" />
            <span>Keep a copy in My files</span>
          </label>
        )}
        {!SERVER_MODE && <p className="muted small">The file was read in your browser and has not been sent anywhere.</p>}
        {error && (
          <p className="error" role="alert" data-testid="import-error">
            {error}
          </p>
        )}
        <div className="row wrap">
          <button type="button" className="btn primary" onClick={submit} data-testid="import-create">
            {mode === "update" ? "Update the project" : "Make the project"}
          </button>
          <button type="button" className="btn ghost" onClick={closeUpload}>
            Cancel
          </button>
          <GapFormButton testId="import-blank-form" className="btn ghost" />
        </div>
      </section>
    </div>
  );
}
