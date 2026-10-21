import type { ImportedTemplate, TemplateAnalysis, TemplateMode } from "@gap/docx";
import { useEffect, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { loadDocx, useDocx } from "../docx-loader";
import { dateTime, download, MODE_LABEL, shortHash, slug } from "../lib";
import { fetchSample, SAMPLE_TEMPLATES } from "../sample-templates";
import { href } from "../router";
import { BrowserLibraryPanel, useIsRemote } from "../server/ServerUi";
import { SERVER_MODE } from "../server/mode";
import { useStore } from "../store";
import { newTemplateId, nameFromFile, parseTemplateFile, sha256Hex, templateFileJson, useTemplates, type StoredTemplate } from "../templates-store";

const FORMAT_TEXT = { docx: "Word document (.docx)", dotx: "Word template (.dotx)", docm: "Word macro-enabled document (.docm)", pdf: "PDF" } as const;

/** An error whose message is already plain language for the user (same convention as the Word package's TemplateError). */
function userError(message: string): Error {
  const e = new Error(message);
  e.name = "TemplateError";
  return e;
}

/** Messages from the Word package are plain language; anything else gets a prefix so it is clear what failed. */
function messageOf(e: unknown, what: string): string {
  const err = e as Error;
  return err?.name === "TemplateError" ? err.message : `${what}: ${err?.message ?? String(e)}`;
}

type Dialog = { kind: "edit"; t: StoredTemplate } | { kind: "delete"; t: StoredTemplate } | null;

/** The template library: Word and PDF templates kept in this browser, reusable across projects. */
export function TemplatesPage() {
  const items = useTemplates((s) => s.items);
  const ready = useTemplates((s) => s.ready);
  const storageError = useTemplates((s) => s.error);
  const project = useStore((s) => s.project);
  const { docx, error: docxError } = useDocx();
  const remote = SERVER_MODE && useIsRemote();

  useEffect(() => {
    void useTemplates.getState().load();
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{ fileName: string; imp: ImportedTemplate } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreFocus = () => headingRef.current;

  const fail = (e: unknown, what: string) => setError(messageOf(e, what));

  async function readUpload(file: File) {
    setError("");
    setNotice("");
    setPending(null);
    setBusy(true);
    try {
      const m = await loadDocx();
      const imp = await m.importTemplateFile(file.name, new Uint8Array(await file.arrayBuffer()));
      const dup = useTemplates.getState().items.find((i) => i.sha256 === imp.sha256);
      if (dup) throw userError(`This file is already in the library as "${dup.name}" (version ${dup.version}).`);
      setPending({ fileName: file.name, imp });
    } catch (e) {
      fail(e, "The file could not be read");
    } finally {
      setBusy(false);
    }
  }

  async function addSamples() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const m = await loadDocx();
      let added = 0;
      let skipped = 0;
      for (const s of SAMPLE_TEMPLATES) {
        const imp = await m.importTemplateFile(s.fileName, await fetchSample(s.url));
        if (useTemplates.getState().items.some((i) => i.sha256 === imp.sha256)) {
          skipped++;
          continue;
        }
        await useTemplates.getState().add(toStored(s.name, "1", s.fileName, imp));
        added++;
      }
      setNotice(`${added} sample ${added === 1 ? "template" : "templates"} added${skipped ? `; ${skipped} already in the library` : ""}. They are fictional.`);
    } catch (e) {
      fail(e, "The sample templates could not be added");
    } finally {
      setBusy(false);
    }
  }

  async function importTemplateFile(file: File) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const m = await loadDocx();
      const tf = parseTemplateFile(await file.text());
      // The document inside must still match the checksum the file states (the copy kept in the file, or the original when none is given).
      if ((await sha256Hex(tf.bytes)) !== (tf.storedSha256 ?? tf.sha256)) {
        throw userError("This template file is damaged or has been changed: its checksum (SHA-256) does not match the document inside it. It was not added.");
      }
      const imp = await m.importTemplateFile(tf.fileName, tf.bytes);
      if (useTemplates.getState().items.some((i) => i.sha256 === tf.sha256)) throw userError(`This template is already in the library: the file with checksum ${shortHash(tf.sha256)} was added before.`);
      const stored = toStored(tf.name, tf.version, tf.fileName, imp);
      stored.sha256 = tf.sha256;
      stored.analysis = { ...stored.analysis, stripped: [...new Set([...tf.stripped, ...stored.analysis.stripped])] };
      if (tf.mapping) stored.mapping = tf.mapping;
      await useTemplates.getState().add(stored);
      setNotice(`Template "${stored.name}" imported.`);
    } catch (e) {
      fail(e, "The template file could not be imported");
    } finally {
      setBusy(false);
    }
  }

  async function downloadStarter() {
    setError("");
    try {
      const m = await loadDocx();
      download("starter-tag-template.docx", m.buildStarterTemplate(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch (e) {
      fail(e, "The starter template could not be created");
    }
  }

  return (
    <div className="stack-lg">
      <PageBanner art="page-templates">
        <h1 ref={headingRef} tabIndex={-1}>
          Templates
        </h1>
      </PageBanner>
      <div>
        <p className="muted">
          Keep your own Word or PDF templates here and choose one when you create a Word document.{" "}
          {remote
            ? "The library is kept on the server under your account, so it follows you to any computer."
            : "The library is stored only in this browser."}{" "}
          It is not part of the project file, so the same templates can be used for every project.{" "}
          {remote ? "Export a template as a file to keep a copy of your own." : "Export a template as a file to back it up or move it to another browser."} Macros in a template are never run and are removed.
        </p>
      </div>

      {(error || storageError) && (
        <p className="error" role="alert">
          {error || storageError}
        </p>
      )}
      {docxError && (
        <p className="error" role="alert">
          {docxError}
        </p>
      )}
      <p className="small muted" role="status" aria-live="polite">
        {busy ? "Working…" : notice}
      </p>

      {remote && <BrowserLibraryPanel />}

      <section className="card stack" aria-labelledby="add-title">
        <h2 id="add-title">Add a template</h2>
        <label className="field">
          <span>Template file (.docx, .dotx, .docm or .pdf)</span>
          <input
            type="file"
            accept=".docx,.dotx,.docm,.pdf,.doc,.rtf,.odt"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void readUpload(f);
            }}
          />
        </label>
        <p className="small muted">
          Word files give the most options. A PDF can only supply its headings. Older formats (.doc, .rtf, .odt) cannot be read: the message will explain how to save them as .docx.
        </p>

        {pending && (
          <AddForm
            key={pending.imp.sha256}
            fileName={pending.fileName}
            imp={pending.imp}
            onCancel={() => setPending(null)}
            onAdd={async (name, version) => {
              await useTemplates.getState().add(toStored(name, version, pending.fileName, pending.imp));
              setPending(null);
              setNotice(`Template "${name}" added to the library.`);
            }}
          />
        )}

        <div className="row wrap">
          <button type="button" className="btn" disabled={busy} onClick={() => void addSamples()}>
            Add the fictional sample templates
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void downloadStarter()}>
            Download starter tag template
          </button>
          <button
            type="button"
            className="btn"
            disabled={!docx}
            onClick={() => docx && download("gap-assessment-tag-reference.md", docx.tagReferenceMarkdown(), "text/markdown;charset=utf-8")}
          >
            Download tag reference (Markdown)
          </button>
        </div>
        <label className="field">
          <span>Import a template file (.gap-template.json)</span>
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importTemplateFile(f);
            }}
          />
        </label>
      </section>

      <section className="stack" aria-labelledby="library-title">
        <h2 id="library-title">Library ({items.length})</h2>
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <Empty>The library is empty. Add a template above, or add the fictional sample templates to try the options.</Empty>
        ) : (
          <ul className="template-list">
            {items.map((t) => (
              <li key={t.id}>
                <TemplateCard t={t} hasProject={!!project} onEdit={() => setDialog({ kind: "edit", t })} onDelete={() => setDialog({ kind: "delete", t })} onError={(m) => setError(m)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <TagReference />

      {dialog?.kind === "edit" && (
        <EditDialog
          t={dialog.t}
          restoreFocus={() => document.getElementById(`edit-template-${dialog.t.id}`) ?? headingRef.current}
          onClose={() => setDialog(null)}
          onSave={async (name, version) => {
            await useTemplates.getState().patch(dialog.t.id, { name, version });
            setNotice(`Template "${name}" updated.`);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <Modal
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={`Delete ${dialog.t.name}?`}
          description={`The template is removed from ${remote ? "your library on the server" : "this browser only"}. Word documents already created from it are not affected, and the export history keeps its name and checksum.`}
          restoreFocus={restoreFocus}
        >
          <div className="row end">
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                const t = dialog.t;
                void useTemplates
                  .getState()
                  .remove(t.id)
                  .then(() => setNotice(`Template "${t.name}" deleted.`))
                  .catch(() => undefined);
                setDialog(null);
              }}
            >
              Delete template
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function toStored(name: string, version: string, fileName: string, imp: ImportedTemplate): StoredTemplate {
  return {
    id: newTemplateId(),
    name: name.trim(),
    version: version.trim(),
    fileName,
    sourceFormat: imp.analysis.sourceFormat,
    sha256: imp.sha256,
    storedSha256: imp.storedSha256,
    addedAt: new Date().toISOString(),
    bytes: imp.bytes,
    analysis: imp.analysis,
  };
}

function usableText(modes: TemplateMode[]): string {
  const m = modes.filter((x) => x !== "builtin").map((x) => MODE_LABEL[x]);
  return m.length ? m.join(", ") : "none";
}

function AddForm({
  fileName,
  imp,
  onAdd,
  onCancel,
}: {
  fileName: string;
  imp: ImportedTemplate;
  onAdd: (name: string, version: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(nameFromFile(fileName));
  const [version, setVersion] = useState("1");
  const [err, setErr] = useState("");
  const a = imp.analysis;
  return (
    <form
      className="stack notice-box"
      aria-label={`Add ${fileName} to the library`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setErr("Enter a name for the template.");
        if (!version.trim()) return setErr("Enter a version for the template, for example 1.");
        onAdd(name, version).catch((x: Error) => setErr(x.message));
      }}
    >
      <p>
        <strong>{fileName}</strong> was read: {FORMAT_TEXT[a.sourceFormat]}, {a.outline.length} {a.outline.length === 1 ? "heading" : "headings"}. It can be used for: {usableText(a.usableModes)}.
        {a.stripped.length > 0 && ` Removed for safety: ${a.stripped.join("; ")}.`}
      </p>
      <div className="row wrap">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Version (required)</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
      </div>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
      <div className="row end">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Add to library
        </button>
      </div>
    </form>
  );
}

function TemplateCard({
  t,
  hasProject,
  onEdit,
  onDelete,
  onError,
}: {
  t: StoredTemplate;
  hasProject: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onError: (m: string) => void;
}) {
  const canMap = t.analysis.usableModes.includes("mapped");
  const mapped = t.mapping?.headings.filter((h) => h.blocks.length > 0).length ?? 0;
  return (
    <article className="card stack" aria-labelledby={`tpl-${t.id}`}>
      <div className="row between wrap">
        <h3 id={`tpl-${t.id}`}>
          {t.name} <span className="tag">Version {t.version}</span>
        </h3>
        <div className="row wrap">
          <button type="button" id={`edit-template-${t.id}`} className="btn small" aria-label={`Rename / version of ${t.name}`} onClick={onEdit}>
            Rename / version
          </button>
          <button
            type="button"
            className="btn small"
            aria-label={`Export template file for ${t.name}`}
            onClick={() => {
              try {
                download(`${slug(t.name) || "template"}.gap-template.json`, templateFileJson(t), "application/json;charset=utf-8");
              } catch (e) {
                onError(`The template file could not be created: ${(e as Error).message}`);
              }
            }}
          >
            Export template file
          </button>
          <button type="button" className="btn small danger" aria-label={`Delete ${t.name}`} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      <dl className="facts">
        <dt>File</dt>
        <dd>
          {t.fileName} ({FORMAT_TEXT[t.sourceFormat]})
        </dd>
        <dt>Added</dt>
        <dd>{dateTime(t.addedAt)}</dd>
        <dt>SHA-256</dt>
        <dd>
          <code title={t.sha256}>{shortHash(t.sha256)}</code>
          <span className="muted small"> (of the file as uploaded; full value in the report below)</span>
        </dd>
        <dt>Can be used for</dt>
        <dd>{usableText(t.analysis.usableModes)}</dd>
        {canMap && (
          <>
            <dt>Heading mapping</dt>
            <dd>
              {t.mapping ? `Saved: content assigned to ${mapped} of ${t.analysis.outline.length} headings.` : "Not saved yet."}{" "}
              {hasProject ? (
                <a href={href(`/templates/${t.id}/mapping`)} aria-label={`${t.mapping ? "Edit" : "Create"} mapping for ${t.name}`}>
                  {t.mapping ? "Edit mapping" : "Create mapping"}
                </a>
              ) : (
                <span className="muted small">Open a project to edit the mapping, because the mapping lists that project's content.</span>
              )}
            </dd>
          </>
        )}
      </dl>
      <details className="report">
        <summary>
          <span className="visually-hidden">Analysis report for {t.name}: </span>
          Analysis report
        </summary>
        <AnalysisReport a={t.analysis} sha256={t.sha256} storedSha256={t.storedSha256} />
      </details>
    </article>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="plain-list small">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

function AnalysisReport({ a, sha256, storedSha256 }: { a: TemplateAnalysis; sha256: string; storedSha256: string }) {
  const cm = (twips: number) => (twips / 567).toFixed(1);
  const yes = (v: boolean) => (v ? "Yes" : "No");
  return (
    <div className="stack">
      <h4>What was read</h4>
      <dl className="facts">
        <dt>Format</dt>
        <dd>{FORMAT_TEXT[a.sourceFormat]}</dd>
        <dt>SHA-256 of the uploaded file</dt>
        <dd>
          <code className="hash">{sha256}</code>
        </dd>
        {storedSha256 !== sha256 && (
          <>
            <dt>SHA-256 of the copy kept here</dt>
            <dd>
              <code className="hash">{storedSha256}</code>
            </dd>
          </>
        )}
        {a.page && (
          <>
            <dt>Page</dt>
            <dd>
              {a.page.orientation === "landscape" ? "Landscape" : "Portrait"}, {cm(a.page.widthTwips)} × {cm(a.page.heightTwips)} cm
            </dd>
          </>
        )}
        {a.sourceFormat !== "pdf" && (
          <>
            <dt>Header</dt>
            <dd>{yes(a.hasHeader)}</dd>
            <dt>Footer</dt>
            <dd>{yes(a.hasFooter)}</dd>
            <dt>Logo or picture</dt>
            <dd>{yes(a.hasLogo)}</dd>
          </>
        )}
      </dl>

      <h4>Removed for safety</h4>
      <List items={a.stripped} empty="Nothing was removed." />

      {a.styles && (
        <>
          <h4>Styles found</h4>
          <ul className="plain-list small">
            {a.styles.headings.map((h) => (
              <li key={h.styleId}>
                Heading level {h.level}: {h.name}
                {h.numbered ? " (numbered automatically)" : ""}
              </li>
            ))}
            {a.styles.title && <li>Title: {a.styles.title}</li>}
            {a.styles.normal && <li>Body text: {a.styles.normal}</li>}
            {a.styles.table && <li>Table: {a.styles.table}</li>}
            {a.styles.listParagraph && <li>List: {a.styles.listParagraph}</li>}
            {a.styles.headings.length === 0 && !a.styles.title && !a.styles.normal && <li>No named styles were recognised.</li>}
          </ul>
        </>
      )}

      <h4>Outline ({a.outline.length})</h4>
      {a.outline.length === 0 ? (
        <p className="muted small">No headings were found, so this template cannot be used with the heading mapping.</p>
      ) : (
        <ol className="outline small" aria-label="Headings found in the template">
          {a.outline.map((h) => (
            <li key={h.index} style={{ paddingInlineStart: `${(h.level - 1) * 1.25}rem` }}>
              {h.number ? `${h.number} ` : ""}
              {h.text}
              {h.hasBody && <span className="muted"> (has text under it)</span>}
            </li>
          ))}
        </ol>
      )}

      {a.sourceFormat !== "pdf" && (
        <>
          <h4>Placeholder tags</h4>
          {a.tags ? (
            <ul className="plain-list small">
              <li>Found: {a.tags.found.length ? a.tags.found.map((t) => `{${t}}`).join(", ") : "none"}</li>
              <li>Not in the tag reference: {a.tags.unknown.length ? a.tags.unknown.map((t) => `{${t}}`).join(", ") : "none"}</li>
              <li>Recommended tags missing: {a.tags.missingRecommended.length ? a.tags.missingRecommended.map((t) => `{${t}}`).join(", ") : "none"}</li>
              <li>
                Errors: {a.tags.errors.length ? "" : "none"}
                {a.tags.errors.length > 0 && (
                  <ul>
                    {a.tags.errors.map((e) => (
                      <li key={e} className="error">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            </ul>
          ) : (
            <p className="muted small">No placeholder tags were found.</p>
          )}
        </>
      )}

      <h4>Warnings</h4>
      <List items={a.warnings} empty="No warnings." />
    </div>
  );
}

function EditDialog({
  t,
  onSave,
  onClose,
  restoreFocus,
}: {
  t: StoredTemplate;
  onSave: (name: string, version: string) => Promise<void>;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [name, setName] = useState(t.name);
  const [version, setVersion] = useState(t.version);
  const [err, setErr] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Rename ${t.name}`} description="The name and version are recorded with every Word document made from this template." restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setErr("Enter a name for the template.");
          if (!version.trim()) return setErr("Enter a version for the template.");
          onSave(name.trim(), version.trim()).catch((x: Error) => setErr(x.message));
        }}
      >
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Version (required)</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        {err && (
          <p className="error" role="alert">
            {err}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}

const KIND_TEXT = { text: "Text", loop: "Loop", raw: "Raw (whole sections)" } as const;

/** Every placeholder tag a template may use, from the Word package itself so the page cannot drift from the code. */
function TagReference() {
  const { docx } = useDocx();
  return (
    <section className="stack" aria-labelledby="tags-title">
      <h2 id="tags-title">Tag reference</h2>
      <p className="muted">
        For the "Placeholder tags" option. Type a tag in your Word template where the value should appear, for example <code>{"{program}"}</code>. A loop repeats what is between its start and
        end tags, for example one table row per gap. No expressions are evaluated: a tag is only looked up by name. The starter template above uses the main tags.
      </p>
      {!docx ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Tag reference table" tabIndex={0}>
          <table className="data tag-table">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col">Kind</th>
                <th scope="col">Description</th>
                <th scope="col">Fields inside a loop</th>
              </tr>
            </thead>
            <tbody>
              {docx.TAG_REFERENCE.map((r) => (
                <tr key={`${r.kind}-${r.tag}`}>
                  <th scope="row" className="normal">
                    <code>{r.kind === "loop" ? `{#${r.tag}} … {/${r.tag}}` : r.kind === "raw" ? `{@${r.tag}}` : `{${r.tag}}`}</code>
                    {r.recommended && <span className="tag">Recommended</span>}
                  </th>
                  <td>{KIND_TEXT[r.kind]}</td>
                  <td className="small">{r.description}</td>
                  <td className="small">
                    {r.fields ? (
                      <ul className="plain-list">
                        {r.fields.map((f) => (
                          <li key={f.name}>
                            <code>{`{${f.name}}`}</code>: {f.description}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
