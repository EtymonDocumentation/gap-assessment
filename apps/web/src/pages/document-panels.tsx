import type { TemplateMode } from "@gap/docx";
import { BUILTIN_TEMPLATE_VERSION } from "@gap/docx/src/version";
import {
  addComment,
  commentDisplayId,
  issueRevision,
  reopenComment,
  replyToComment,
  resolveComment,
  revisionStatusLabel,
  type Assessment,
  type ContentBundle,
  type DocModel,
  type DocSection,
} from "@gap/engine";
import type { Actor, DocumentExport, Project, ReviewComment, RevisionStatus, TemplateRecord } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Modal } from "../components";
import { loadDocx, useDocx } from "../docx-loader";
import { dateTime, download, FORMAT_LABEL, MODE_HELP, MODE_LABEL, shortHash } from "../lib";
import { href } from "../router";
import { useStore } from "../store";
import { recordOf, useTemplates, type StoredTemplate } from "../templates-store";

export const BUILTIN_RECORD: TemplateRecord = { mode: "builtin", name: "Built-in default", version: BUILTIN_TEMPLATE_VERSION };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** "5. Detailed gap table" or "Appendix A. Source register". */
function sectionLabel(s: Pick<DocSection, "number" | "title" | "appendix">): string {
  return s.appendix ? `Appendix ${s.number}. ${s.title}` : `${s.number}. ${s.title}`;
}

function templateText(t: TemplateRecord): string {
  return `${t.name} ${t.version}${t.sha256 ? ` (${shortHash(t.sha256)})` : ""}`;
}

// ------------------------------------------------------------------ the Word choice (shared by the export panel and the revision dialog)

export interface WordChoice {
  mode: TemplateMode;
  setMode(m: TemplateMode): void;
  /** Library templates that can be used for the chosen kind of Word document. */
  candidates: StoredTemplate[];
  template: StoredTemplate | undefined;
  setTemplateId(id: string): void;
  /** What an export (or a revision) records about the chosen template. */
  record: TemplateRecord | undefined;
}

export function useWordChoice(): WordChoice {
  const items = useTemplates((s) => s.items);
  useEffect(() => {
    void useTemplates.getState().load();
  }, []);
  const [mode, setMode] = useState<TemplateMode>("builtin");
  const [pick, setPick] = useState("");
  const candidates = useMemo(() => (mode === "builtin" ? [] : items.filter((t) => t.analysis.usableModes.includes(mode))), [items, mode]);
  const template = candidates.find((t) => t.id === pick) ?? candidates[0];
  const record = mode === "builtin" ? BUILTIN_RECORD : template ? recordOf(mode, template) : undefined;
  return { mode, setMode, candidates, template, setTemplateId: setPick, record };
}

// ------------------------------------------------------------------ people

/** Name and role for a dialog: the last ones typed in this session, else the project's responder. */
function usePerson() {
  const last = useStore((s) => s.lastPerson);
  const resp = useStore((s) => s.project?.interview.responder);
  const [name, setName] = useState(last?.name ?? resp?.name ?? "");
  const [role, setRole] = useState(last?.role ?? resp?.role ?? "");
  return { name, role, setName, setRole };
}

function PersonFields({ p, nameLabel = "Your name" }: { p: ReturnType<typeof usePerson>; nameLabel?: string }) {
  return (
    <>
      <label className="field">
        <span>{nameLabel} (required)</span>
        <input value={p.name} onChange={(e) => p.setName(e.target.value)} autoComplete="name" />
      </label>
      <label className="field">
        <span>
          Role <span className="muted">(optional)</span>
        </span>
        <input value={p.role} onChange={(e) => p.setRole(e.target.value)} placeholder="e.g. QA reviewer" />
      </label>
      <p className="muted small">Recorded as free text. This proof of concept has no login, so a name is not attributable in a GMP sense.</p>
    </>
  );
}

function DialogButtons({ onClose, submit, danger }: { onClose: () => void; submit: string; danger?: boolean }) {
  return (
    <div className="row end">
      <button type="button" className="btn" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className={danger ? "btn danger" : "btn primary"}>
        {submit}
      </button>
    </div>
  );
}

/** Runs an engine change as the person named in a dialog. Returns the error message, or null. */
function useReviewAction() {
  const update = useStore((s) => s.update);
  const remember = useStore((s) => s.rememberPerson);
  return (who: { name: string; role: string }, fn: (p: Project, actor: Actor) => Project, status: string): string | null => {
    const name = who.name.trim();
    if (!name) return "Enter your name.";
    const role = who.role.trim();
    const actor: Actor = { name, ...(role ? { role } : {}), at: new Date().toISOString() };
    const err = update((p) => fn(p, actor), status);
    if (!err) remember(name, role);
    return err;
  };
}

// ------------------------------------------------------------------ Word document panel

interface Checks {
  blockers: string[];
  warnings: string[];
  notes: string[];
}

/** Everything worth knowing before a download. A blocker disables the button; the rest is information. */
function usePreExportChecks(choice: WordChoice, doc: DocModel): Checks | null {
  const { docx } = useDocx(choice.mode !== "builtin");
  const t = choice.template;
  return useMemo(() => {
    const out: Checks = { blockers: [], warnings: [], notes: [] };
    if (choice.mode === "builtin") return out;
    if (!t) {
      out.blockers.push("No template in the library works with this option. Add one on the Templates page.");
      return out;
    }
    if (!docx) return null;
    out.warnings.push(...t.analysis.warnings);
    if (choice.mode === "mapped") {
      if (!t.mapping) {
        out.blockers.push("This template has no saved heading mapping yet. Open the mapping editor, choose where the content goes, and save it.");
      } else {
        const r = docx.mappingReport(t.analysis, t.mapping, doc);
        out.blockers.push(...r.errors);
        if (r.unmappedBlocks.length) {
          const titles = r.unmappedBlocks.map((b) => b.title).join("; ");
          if (t.mapping.unmappedBlocks === "append") {
            out.notes.push(`${r.unmappedBlocks.length} ${r.unmappedBlocks.length === 1 ? "part" : "parts"} of the content ${r.unmappedBlocks.length === 1 ? "is" : "are"} not mapped to a heading and will be added at the end: ${titles}.`);
          } else {
            out.warnings.push(`${r.unmappedBlocks.length} ${r.unmappedBlocks.length === 1 ? "part" : "parts"} of the content will be left out of the Word document, as you chose in the mapping: ${titles}.`);
          }
        }
        if (r.flaggedHeadings.length) {
          out.notes.push(`${r.flaggedHeadings.length} ${r.flaggedHeadings.length === 1 ? "heading" : "headings"} will be marked "to be completed": ${r.flaggedHeadings.map((h) => h.text).join("; ")}.`);
        }
      }
    }
    if (choice.mode === "tags") {
      const tags = t.analysis.tags;
      if (!tags || !tags.found.length) out.warnings.push("The template contains no tags, so only the banner is filled in.");
      for (const e of tags?.errors ?? []) out.blockers.push(`Tag problem: ${e}`);
      for (const u of tags?.unknown ?? []) out.warnings.push(`The template has a tag that is not in the tag reference: {${u}}. It will show [not available].`);
      for (const m of tags?.missingRecommended ?? []) out.warnings.push(`The template does not use the recommended tag {${m}}.`);
    }
    return out;
  }, [choice.mode, t, docx, doc]);
}

const MODES: TemplateMode[] = ["builtin", "their_look", "mapped", "tags"];

export function WordPanel({
  choice,
  doc,
  content,
  project,
  assessment,
  generatedAt,
  fileBase,
  onExported,
}: {
  choice: WordChoice;
  doc: DocModel;
  content: ContentBundle;
  project: Project;
  assessment: Assessment;
  generatedAt: string;
  fileBase: string;
  onExported: (template: TemplateRecord) => void;
}) {
  const checks = usePreExportChecks(choice, doc);
  const items = useTemplates((s) => s.items);
  const hasPdf = items.some((t) => t.analysis.sourceFormat === "pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ file: string; template: TemplateRecord; warnings: string[]; omitted: string[] } | null>(null);
  const t = choice.template;

  async function exportWord() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const m = await loadDocx();
      try {
        const res = await m.renderDocx({
          doc,
          tagData: m.buildTagData(content, project, assessment, doc),
          mode: choice.mode,
          generatedAt,
          ...(choice.mode !== "builtin" && t
            ? { template: { name: t.name, version: t.version, sha256: t.sha256, fileName: t.fileName, bytes: t.bytes, analysis: t.analysis, ...(t.mapping ? { mapping: t.mapping } : {}) } }
            : {}),
        });
        const file = `${fileBase}.docx`;
        download(file, res.bytes, DOCX_MIME);
        onExported(res.templateRecord);
        setResult({ file, template: res.templateRecord, warnings: res.warnings, omitted: res.omittedBlocks });
      } catch (e) {
        setError(e instanceof m.TemplateError ? e.message : `The Word document could not be created: ${(e as Error).message}`);
      }
    } catch (e) {
      setError(`The Word tools could not be loaded: ${(e as Error).message}. Check your connection and reload the page.`);
    } finally {
      setBusy(false);
    }
  }

  const blocked = !checks || checks.blockers.length > 0;
  return (
    <section className="card stack no-print" aria-labelledby="word-title">
      <h2 id="word-title">Word document</h2>
      <p className="small muted">
        Creates a .docx file in this browser with the same content as the document below. Word may lay it out slightly differently from this preview, so check it in Word before you use it. The
        banner "Proof of concept. Not validated. Not for GMP use." is always included.
      </p>
      <fieldset className="stack">
        <legend>Kind of Word document</legend>
        {MODES.map((m) => (
          <label key={m} className="check top">
            <input
              type="radio"
              name="word-mode"
              value={m}
              checked={choice.mode === m}
              onChange={() => {
                choice.setMode(m);
                setResult(null);
                setError("");
              }}
            />
            <span>
              <strong>{MODE_LABEL[m]}</strong>
              <span className="block muted small">{MODE_HELP[m]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {choice.mode !== "builtin" && (
        <div className="stack">
          {choice.candidates.length === 0 ? (
            <p className="notice">
              No template in the library works with "{MODE_LABEL[choice.mode]}".{hasPdf && choice.mode !== "mapped" ? " A PDF template can only be used with \"Map to their headings\"." : ""} Add one on the{" "}
              <a href={href("/templates")}>Templates page</a>.
            </p>
          ) : (
            <label className="field">
              <span>Template</span>
              <select value={t?.id ?? ""} onChange={(e) => choice.setTemplateId(e.target.value)}>
                {choice.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (version {c.version}, {shortHash(c.sha256)})
                  </option>
                ))}
              </select>
            </label>
          )}
          {choice.mode === "mapped" && t && (
            <p className="small">
              <a href={href(`/templates/${t.id}/mapping`)}>{t.mapping ? "Edit the heading mapping" : "Create the heading mapping"}</a> for {t.name}.
            </p>
          )}
        </div>
      )}

      <div className="stack" aria-live="polite">
        <h3>Before you download</h3>
        {!checks ? (
          <p className="small muted">Checking the template…</p>
        ) : (
          <>
            {checks.blockers.length > 0 && (
              <div id="word-blockers">
                <p className="error">The Word document cannot be created yet:</p>
                <ul className="plain-list small">
                  {checks.blockers.map((b) => (
                    <li key={b} className="error">
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {checks.warnings.length > 0 && (
              <div>
                <p className="small">
                  <strong>Warnings</strong>
                </p>
                <ul className="plain-list small">
                  {checks.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {checks.notes.length > 0 && (
              <div>
                <p className="small">
                  <strong>Please note</strong>
                </p>
                <ul className="plain-list small">
                  {checks.notes.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {checks.blockers.length + checks.warnings.length + checks.notes.length === 0 && <p className="small muted">No problems found.</p>}
          </>
        )}
      </div>

      <div className="row wrap">
        <button type="button" className="btn primary" disabled={blocked || busy} aria-describedby={checks?.blockers.length ? "word-blockers" : undefined} onClick={() => void exportWord()}>
          {busy ? "Creating…" : "Download Word document"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {result && (
          <div className="stack">
            <p>
              Downloaded <strong>{result.file}</strong> using {MODE_LABEL[result.template.mode]}: {templateText(result.template)}.
            </p>
            {result.omitted.length > 0 && <p className="small">Left out by choice: {result.omitted.join("; ")}.</p>}
            {result.warnings.length > 0 && (
              <div>
                <p className="small">
                  <strong>Warnings from the export</strong>
                </p>
                <ul className="plain-list small">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ export history

export function ExportHistory({ exports }: { exports: DocumentExport[] }) {
  const rows = [...exports].reverse();
  return (
    <section className="card stack no-print" aria-labelledby="export-history-title">
      <h2 id="export-history-title">Export history</h2>
      {rows.length === 0 ? (
        <Empty>Nothing has been downloaded from this project yet.</Empty>
      ) : (
        <div className="table-scroll" role="region" aria-label="Export history table" tabIndex={0}>
          <table className="data export-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Format</th>
                <th scope="col">Template</th>
                <th scope="col">Revision</th>
                <th scope="col">Content changed since revision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.at}-${i}`}>
                  <td className="small">
                    {dateTime(r.at)}
                    {r.by && <div className="muted">{r.by}</div>}
                  </td>
                  <td>{FORMAT_LABEL[r.format]}</td>
                  <td className="small">
                    {r.template.name} {r.template.version}
                    {r.template.sha256 && (
                      <div className="muted">
                        SHA-256 <code title={r.template.sha256}>{shortHash(r.template.sha256)}</code>
                      </div>
                    )}
                  </td>
                  <td>{r.revision ?? "None issued"}</td>
                  <td>{r.revision === undefined ? "Not applicable" : r.changedSinceRevision ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ revisions

export function RevisionsPanel({
  project,
  state,
  doc,
  choice,
}: {
  project: Project;
  state: { latest?: { number: number; status: RevisionStatus; at: string }; changedSinceIssue: boolean };
  doc: DocModel;
  choice: WordChoice;
}) {
  const [open, setOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const revisions = [...project.document.revisions].reverse();
  const latest = state.latest;

  let sentence = "No revision has been issued yet.";
  if (latest) {
    sentence =
      latest.status === "draft"
        ? `Revision ${latest.number}, saved as a draft on ${latest.at.slice(0, 10)}.`
        : `Revision ${latest.number}, ${revisionStatusLabel(latest.status).toLowerCase()} on ${latest.at.slice(0, 10)}.`;
    if (state.changedSinceIssue) sentence += " The content has changed since this revision was issued.";
  }

  return (
    <section className="card stack no-print" aria-labelledby="revisions-title">
      <div className="row between wrap">
        <h2 id="revisions-title" ref={headingRef} tabIndex={-1}>
          Revisions
        </h2>
        <button type="button" id="issue-revision-button" className="btn" onClick={() => setOpen(true)}>
          Issue revision
        </button>
      </div>
      <p className={state.changedSinceIssue ? "notice" : undefined} id="revision-state">
        {state.changedSinceIssue && (
          <span aria-hidden="true" className="warn-icon">
            ⚠{" "}
          </span>
        )}
        {sentence}
      </p>
      <p className="small muted">A revision records the document as a draft or as issued for review. It is not an approval and not a signature: the tool has no electronic signature.</p>
      {revisions.length > 0 && (
        <div className="table-scroll" role="region" aria-label="Revisions table" tabIndex={0}>
          <table className="data revisions-table">
            <thead>
              <tr>
                <th scope="col">Revision</th>
                <th scope="col">Status</th>
                <th scope="col">Date</th>
                <th scope="col">By</th>
                <th scope="col">Summary</th>
                <th scope="col">Template</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.number}>
                  <th scope="row">{r.number}</th>
                  <td>{revisionStatusLabel(r.status)}</td>
                  <td className="small">{r.at.slice(0, 10)}</td>
                  <td className="small">
                    {r.by}
                    {r.role && <div className="muted">{r.role}</div>}
                  </td>
                  <td className="small wrap-text">{r.summary}</td>
                  <td className="small">{r.template ? templateText(r.template) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <IssueRevisionDialog doc={doc} choice={choice} onClose={() => setOpen(false)} restoreFocus={() => document.getElementById("issue-revision-button") ?? headingRef.current} />}
    </section>
  );
}

function IssueRevisionDialog({ doc, choice, onClose, restoreFocus }: { doc: DocModel; choice: WordChoice; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const act = useReviewAction();
  const person = usePerson();
  const [status, setStatus] = useState<RevisionStatus>("draft");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Issue revision"
      description="A revision records the document as it is now, as a draft or as issued for review. It is not an approval or a signature."
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!person.name.trim()) return setError("Enter your name.");
          if (!summary.trim()) return setError("Enter a summary of what changed or why this revision is issued.");
          const err = act(
            person,
            (p, actor) => issueRevision(p, doc, { status, summary, ...(choice.record ? { template: choice.record } : {}) }, actor),
            "Revision issued",
          );
          if (err) setError(err);
          else onClose();
        }}
      >
        <fieldset className="stack">
          <legend>Status</legend>
          <label className="check">
            <input type="radio" name="rev-status" checked={status === "draft"} onChange={() => setStatus("draft")} />
            <span>Draft</span>
          </label>
          <label className="check">
            <input type="radio" name="rev-status" checked={status === "issued_for_review"} onChange={() => setStatus("issued_for_review")} />
            <span>Issued for review</span>
          </label>
        </fieldset>
        <label className="field">
          <span>Summary of change (required)</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} autoFocus />
        </label>
        <PersonFields p={person} nameLabel="Issued by" />
        {choice.record && <p className="small muted">Word template recorded with this revision: {templateText(choice.record)}.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <DialogButtons onClose={onClose} submit="Issue revision" />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ reviewer comments

type Filter = "open" | "resolved" | "all";
type CommentDialog =
  | { kind: "add" }
  | { kind: "reply" | "resolution" | "reopen"; comment: ReviewComment }
  | null;

/** Sections whose comments can point at one gap row. */
const GAP_SECTIONS = new Set(["differences", "gap-table", "risk", "validation-plan"]);

const KIND_TEXT = { reply: "Reply", resolution: "Resolution", reopen: "Reopened" } as const;

export function CommentsPanel({ project, doc, assessment }: { project: Project; doc: DocModel; assessment: Assessment }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [dialog, setDialog] = useState<CommentDialog>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [focusId, setFocusId] = useState("add-comment-button");
  const restoreFocus = () => document.getElementById(focusId) ?? document.getElementById("add-comment-button") ?? headingRef.current;
  const open = (d: CommentDialog, id: string) => {
    setFocusId(id);
    setDialog(d);
  };

  const all = project.document.comments;
  const counts = { open: all.filter((c) => c.status === "open").length, resolved: all.filter((c) => c.status === "resolved").length, all: all.length };
  const shown = all.filter((c) => filter === "all" || c.status === filter);

  const groups = useMemo(() => {
    const out: { id: string; label: string; items: ReviewComment[]; open: number; resolved: number }[] = [];
    const known = new Set(doc.sections.map((s) => s.id));
    const make = (id: string, label: string) => {
      const items = all.filter((c) => c.anchor.sectionId === id);
      const sel = items.filter((c) => filter === "all" || c.status === filter);
      if (sel.length) out.push({ id, label, items: sel, open: items.filter((c) => c.status === "open").length, resolved: items.filter((c) => c.status === "resolved").length });
    };
    for (const s of doc.sections) make(s.id, sectionLabel(s));
    for (const id of new Set(all.map((c) => c.anchor.sectionId))) if (!known.has(id)) make(id, id);
    return out;
  }, [all, doc.sections, filter]);

  const docComment = (c: ReviewComment) => doc.comments.find((d) => d.id === commentDisplayId(c.seq));

  return (
    <section className="card stack no-print" aria-labelledby="comments-title">
      <div className="row between wrap">
        <h2 id="comments-title" ref={headingRef} tabIndex={-1}>
          Reviewer comments
        </h2>
        <button type="button" id="add-comment-button" className="btn" onClick={() => open({ kind: "add" }, "add-comment-button")}>
          Add comment
        </button>
      </div>
      <p className="small muted">
        Comments are kept in the project and appear in Appendix D of the document and as Word comments in the Word document. They never change the assessment. Names are free text without a login.
      </p>
      <fieldset className="row wrap filter-set">
        <legend>Show comments</legend>
        {(["open", "resolved", "all"] as const).map((f) => (
          <label key={f} className="check">
            <input type="radio" name="comment-filter" checked={filter === f} onChange={() => setFilter(f)} />
            <span>
              {f === "open" ? "Open" : f === "resolved" ? "Resolved" : "All"} ({counts[f]})
            </span>
          </label>
        ))}
      </fieldset>

      {shown.length === 0 ? (
        <Empty>{all.length === 0 ? "No reviewer comments have been recorded." : `No ${filter} comments.`}</Empty>
      ) : (
        <div className="stack">
          {groups.map((g) => (
            <section key={g.id} className="stack" aria-labelledby={`cg-${g.id}`}>
              <h3 id={`cg-${g.id}`}>
                {g.label}{" "}
                <span className="muted small normal">
                  ({g.open} open, {g.resolved} resolved)
                </span>
              </h3>
              <ul className="comment-list">
                {g.items.map((c) => {
                  const id = commentDisplayId(c.seq);
                  const d = docComment(c);
                  return (
                    <li key={c.seq} className="comment" id={`comment-${c.seq}`}>
                      <div className="row between wrap">
                        <strong>
                          {id}
                          <span className={`tag status-${c.status === "open" ? "open" : "resolved"}`}>
                            <span aria-hidden="true">{c.status === "open" ? "○ " : "✓ "}</span>
                            {c.status === "open" ? "Open" : "Resolved"}
                          </span>
                        </strong>
                        <span className="row wrap">
                          <button type="button" id={`reply-${c.seq}`} className="btn small" aria-label={`Reply to ${id}`} onClick={() => open({ kind: "reply", comment: c }, `reply-${c.seq}`)}>
                            Reply
                          </button>
                          {c.status === "open" ? (
                            <button type="button" id={`resolve-${c.seq}`} className="btn small" aria-label={`Resolve ${id}`} onClick={() => open({ kind: "resolution", comment: c }, `resolve-${c.seq}`)}>
                              Resolve
                            </button>
                          ) : (
                            <button type="button" id={`reopen-${c.seq}`} className="btn small" aria-label={`Reopen ${id}`} onClick={() => open({ kind: "reopen", comment: c }, `reopen-${c.seq}`)}>
                              Reopen
                            </button>
                          )}
                        </span>
                      </div>
                      {d && <p className="small muted">About: {d.anchorText}</p>}
                      <p className="comment-text">{c.text}</p>
                      <p className="small muted">
                        By {c.by}
                        {c.role ? ` (${c.role})` : ""}, {c.at.slice(0, 10)}
                      </p>
                      {c.replies.length > 0 && (
                        <ul className="comment-replies" aria-label={`Responses to ${id}`}>
                          {c.replies.map((r, i) => (
                            <li key={i}>
                              <span className="small muted">
                                {KIND_TEXT[r.kind]} by {r.by}
                                {r.role ? ` (${r.role})` : ""}, {r.at.slice(0, 10)}:
                              </span>{" "}
                              {r.text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {dialog?.kind === "add" && <AddCommentDialog doc={doc} assessment={assessment} onClose={() => setDialog(null)} restoreFocus={restoreFocus} />}
      {dialog && dialog.kind !== "add" && <RespondDialog kind={dialog.kind} comment={dialog.comment} onClose={() => setDialog(null)} restoreFocus={restoreFocus} />}
    </section>
  );
}

function AddCommentDialog({ doc, assessment, onClose, restoreFocus }: { doc: DocModel; assessment: Assessment; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const act = useReviewAction();
  const person = usePerson();
  const [sectionId, setSectionId] = useState(doc.sections[0]?.id ?? "");
  const [gapKey, setGapKey] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const gaps = useMemo(() => assessment.gaps.filter((g) => g.category !== "equivalent"), [assessment]);
  const withGaps = GAP_SECTIONS.has(sectionId);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Add comment" description="The comment is kept in the project and does not change the assessment." restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!person.name.trim()) return setError("Enter your name.");
          if (!text.trim()) return setError("Enter the comment.");
          const err = act(person, (p, actor) => addComment(p, { sectionId, ...(withGaps && gapKey ? { gapKey } : {}), text }, actor), "Comment added");
          if (err) setError(err);
          else onClose();
        }}
      >
        <label className="field">
          <span>Section</span>
          <select
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              setGapKey("");
            }}
          >
            {doc.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {sectionLabel(s)}
              </option>
            ))}
          </select>
        </label>
        {withGaps && (
          <label className="field">
            <span>
              Gap <span className="muted">(optional)</span>
            </span>
            <select value={gapKey} onChange={(e) => setGapKey(e.target.value)}>
              <option value="">Whole section</option>
              {gaps.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.displayId}: {g.attribute}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Comment (required)</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus />
        </label>
        <PersonFields p={person} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <DialogButtons onClose={onClose} submit="Add comment" />
      </form>
    </Modal>
  );
}

const RESPOND = {
  reply: { title: "Reply to", label: "Reply (required)", submit: "Add reply", status: "Reply added", fn: replyToComment, empty: "Enter your reply." },
  resolution: { title: "Resolve", label: "How it was resolved (required)", submit: "Resolve comment", status: "Comment resolved", fn: resolveComment, empty: "Enter how the comment was resolved." },
  reopen: { title: "Reopen", label: "Reason for reopening (required)", submit: "Reopen comment", status: "Comment reopened", fn: reopenComment, empty: "Enter the reason for reopening the comment." },
} as const;

function RespondDialog({ kind, comment, onClose, restoreFocus }: { kind: "reply" | "resolution" | "reopen"; comment: ReviewComment; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const act = useReviewAction();
  const person = usePerson();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const cfg = RESPOND[kind];
  const id = commentDisplayId(comment.seq);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${cfg.title} ${id}`} description={comment.text} restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return setError(cfg.empty);
          const err = act(person, (p, actor) => cfg.fn(p, comment.seq, text, actor), cfg.status);
          if (err) setError(err);
          else onClose();
        }}
      >
        <label className="field">
          <span>{cfg.label}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus />
        </label>
        <PersonFields p={person} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <DialogButtons onClose={onClose} submit={cfg.submit} />
      </form>
    </Modal>
  );
}
