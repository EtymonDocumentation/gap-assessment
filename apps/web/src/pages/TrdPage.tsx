import { createTrd, trdOpenItems, trdOverrides, type TrdStart } from "@gap/engine";
import { parseTrdSeed, type TrdSeed } from "@gap/process-model";
import { useState } from "react";
import { PageBanner } from "../art";
import { Empty } from "../components";
import { dateTime } from "../lib";
import { href, navigate } from "../router";
import { useStore } from "../store";
import { useTrdWriteupLibrary } from "../trd-writeups-store";
import { TRD_SCOPE_TEXT, TRD_TABS, TrdEditor, type TrdTab } from "./TrdEditor";
import { useProjectSeed } from "./TrdUpdate";

type StartKind = "project" | "seed-import" | "blank";
const ORIGIN_TEXT = { project: "This project", "seed-import": "A seed file", blank: "Blank" } as const;

/** The TRD list and the "New TRD" form (no `trd` parameter) or the editor of one TRD. */
export function TrdPage({ params }: { params: URLSearchParams }) {
  const project = useStore((s) => s.project)!;
  const id = params.get("trd");
  const d = id ? project.trd.documents.find((x) => x.id === id) : undefined;
  const tab = params.get("tab");
  return d ? <TrdEditor d={d} initialTab={TRD_TABS.includes(tab as TrdTab) ? (tab as TrdTab) : "details"} /> : <List missing={id ?? undefined} preselect={params.get("start")} />;
}

function List({ missing, preselect }: { missing?: string | undefined; preselect: string | null }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const fromProject = useProjectSeed();
  const library = useTrdWriteupLibrary();
  const [title, setTitle] = useState("");
  const [docRef, setDocRef] = useState("");
  const [kind, setKind] = useState<StartKind | "">(preselect === "project" ? "project" : "");
  const [file, setFile] = useState<{ seed: TrdSeed; name: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const list = project.trd.documents;

  async function onFile(f: File | undefined) {
    setFileError("");
    setFile(null);
    if (!f) return;
    try {
      // The reader's own message names what is wrong (invalid JSON, a different major version, the field that is not valid).
      setFile({ seed: parseTrdSeed(await f.text()), name: f.name });
    } catch (e) {
      setFileError((e as Error).message);
    }
  }

  function create() {
    if (!title.trim()) return setError("Enter a title for the TRD.");
    if (!kind) return setError("Choose how the TRD starts.");
    let start: TrdStart;
    if (kind === "project") {
      if (!fromProject.seed) return setError(`The project could not be turned into a TRD seed: ${fromProject.problem}`);
      start = { kind: "project", seed: fromProject.seed };
    } else if (kind === "seed-import") {
      if (!file) return setError("Choose a TRD seed file first.");
      start = { kind: "seed-import", seed: file.seed };
    } else start = { kind: "blank" };
    let newId = "";
    const err = update((p, actor) => {
      const r = createTrd(p, { title: title.trim(), ...(docRef.trim() ? { docRef: docRef.trim() } : {}), start, library }, actor);
      newId = r.trdId;
      return r.project;
    }, "TRD created");
    if (err) return setError(err);
    setTitle("");
    setDocRef("");
    setError("");
    navigate("/trd", { trd: newId });
  }

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>TRD</h1>
      </PageBanner>
      <section className="card stack" aria-labelledby="trd-about">
        <h2 id="trd-about">What this is</h2>
        <p data-testid="trd-scope-text">{TRD_SCOPE_TEXT}</p>
        <ul className="plain-list">
          <li>A TRD (technology transfer document) can start from this project, from a TRD seed file, or blank.</li>
          <li>You can override any value. The project value stays beside yours, and the override is written to the change log.</li>
          <li>When the project changes, you get a notice and a list of differences. A value you overrode is never replaced unless you choose to.</li>
          <li>The set point, NOR and PAR are entered by you with sources from the source register. They do not come from the sampling plan.</li>
          <li>
            The seed itself is on the <a href={href("/trd-seed")}>TRD seed</a> page.
          </li>
          <li>
            The process descriptions of a TRD start as a copy of the <a href={href("/trd/writeups")} data-testid="trd-writeups-link">process description library</a>; edit, version or add your own there.
          </li>
        </ul>
      </section>

      {missing && (
        <p className="notice" role="alert">
          There is no TRD {missing} in this project.
        </p>
      )}

      <section className="card stack" aria-labelledby="trd-list">
        <h2 id="trd-list">TRDs in this project</h2>
        {list.length === 0 ? (
          <Empty>No TRD yet. Start one below.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="TRDs table" tabIndex={0}>
            <table className="data" data-testid="trd-list-table">
              <thead>
                <tr>
                  <th scope="col">TRD</th>
                  <th scope="col">Started from</th>
                  <th scope="col">Steps</th>
                  <th scope="col">Overrides</th>
                  <th scope="col">Open items</th>
                  <th scope="col">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">
                      <a href={href("/trd", { trd: d.id })}>
                        {d.id}: {d.title}
                      </a>
                    </th>
                    <td className="small">{ORIGIN_TEXT[d.origin.kind]}</td>
                    <td className="num">{d.steps.length}</td>
                    <td className="num">{trdOverrides(d).length}</td>
                    <td className="num">{trdOpenItems(d).length}</td>
                    <td className="small">{dateTime(d.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="trd-new">
        <h2 id="trd-new">New TRD</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="row wrap">
            <label className="field grow">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ARX-217 technology transfer document (fictional)" data-testid="trd-title-input" />
            </label>
            <label className="field">
              <span>Document reference (optional)</span>
              <input value={docRef} onChange={(e) => setDocRef(e.target.value)} data-testid="trd-docref-input" />
            </label>
          </div>
          <fieldset className="fs stack" data-testid="trd-start-options">
            <legend>How does the TRD start?</legend>
            <label className="check top">
              <input type="radio" name="trd-start" checked={kind === "project"} onChange={() => setKind("project")} data-testid="trd-start-project" />
              <span>
                <strong>From this project</strong>
                <span className="block muted small">Takes the receiving unit's values from the gap assessment. You can update the TRD from the project later.</span>
              </span>
            </label>
            <label className="check top">
              <input type="radio" name="trd-start" checked={kind === "seed-import"} onChange={() => setKind("seed-import")} data-testid="trd-start-file" />
              <span>
                <strong>From a TRD seed file (JSON)</strong>
                <span className="block muted small">A file made with "Download TRD seed" on the TRD seed page, from this or another project.</span>
              </span>
            </label>
            <label className="check top">
              <input type="radio" name="trd-start" checked={kind === "blank"} onChange={() => setKind("blank")} data-testid="trd-start-blank" />
              <span>
                <strong>Blank</strong>
                <span className="block muted small">No values at all. Every product and site detail reads "Not established" until you enter it, and you add the steps yourself.</span>
              </span>
            </label>
          </fieldset>
          {kind === "seed-import" && (
            <div className="stack">
              <label className="field">
                <span>TRD seed file (JSON)</span>
                <input type="file" accept=".json,application/json" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="trd-start-file-input" />
              </label>
              {fileError && (
                <p className="error" role="alert" data-testid="trd-start-file-error">
                  {fileError}
                </p>
              )}
              {file && (
                <p data-testid="trd-start-file-ok">
                  {file.name}: seed of project {file.seed.meta.project.name}, {file.seed.scope.included.length} process {file.seed.scope.included.length === 1 ? "step" : "steps"}.
                </p>
              )}
            </div>
          )}
          {kind === "project" && fromProject.problem && (
            <p className="notice" role="alert">
              The project could not be turned into a TRD seed: {fromProject.problem}
            </p>
          )}
          {error && (
            <p className="error" role="alert" data-testid="trd-create-error">
              {error}
            </p>
          )}
          <div>
            <button type="submit" className="btn primary" data-testid="trd-create">
              Create TRD
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
