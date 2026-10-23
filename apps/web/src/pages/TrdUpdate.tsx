import { applyTrdUpdate, buildTrdSeed, diffTrdAgainstSeed, finishTrdReview, pickAllUnprotected, seedIsFromOtherProject, trdSourceChanged, type TrdDiffRow } from "@gap/engine";
import { parseTrdSeed, type TrdDocument, type TrdSeed } from "@gap/process-model";
import { useMemo, useRef, useState } from "react";
import { APP_VERSION } from "../lib";
import { useContent, useStore } from "../store";
import type { Run } from "./SamplingFlow";

const KIND_TEXT: Record<TrdDiffRow["kind"], string> = {
  step_added: "New step",
  step_removed: "Step no longer in the project",
  item_added: "New item",
  item_removed: "Item no longer in the project",
  field_added: "New value",
  field_removed: "Value no longer in the project",
  field_changed: "Changed value",
};

/** The seed the project would give right now, checked against the seed format like the TRD seed page does. */
export function useProjectSeed(): { seed: TrdSeed | null; problem: string } {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  return useMemo(() => {
    try {
      // A fixed export time: the comparison must not change because the clock moved.
      return { seed: parseTrdSeed(JSON.parse(JSON.stringify(buildTrdSeed(content, project, { exportedAt: "1970-01-01T00:00:00.000Z", appVersion: APP_VERSION })))), problem: "" };
    } catch (e) {
      return { seed: null, problem: (e as Error).message };
    }
  }, [content, project]);
}

/**
 * Notice and review for a TRD that started from the project or from a seed file. A change in the project is a NOTICE, never a block:
 * the person may keep working and look at the differences when ready. In the review, a value the team overrode is never replaced on
 * its own. "Accept all not overridden" takes every other row; an overridden row needs its own choice, between keeping the team's
 * value (the project value then sits beside it) and taking the project value (the override goes, and the change log keeps it).
 */
export function TrdUpdate({ d, run }: { d: TrdDocument; run: Run }) {
  const fromProject = d.origin.kind === "project";
  const project = useProjectSeed();
  const [file, setFile] = useState<{ seed: TrdSeed; name: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (d.origin.kind === "blank") return null;
  const seed = fromProject ? project.seed : (file?.seed ?? null);
  const rows = seed ? diffTrdAgainstSeed(d, seed) : [];
  const changed = seed ? trdSourceChanged(d, seed) : false;

  async function onFile(f: File | undefined) {
    setFileError("");
    if (!f) return;
    try {
      setFile({ seed: parseTrdSeed(await f.text()), name: f.name });
      setOpen(true);
    } catch (e) {
      setFile(null);
      setFileError((e as Error).message);
    }
  }

  const accept = (r: TrdDiffRow, choice: "take" | "keep") => {
    if (!seed) return;
    run((p, actor) => applyTrdUpdate(p, d.id, seed, [{ rowId: r.id, choice }], actor), choice === "take" ? "Project value taken" : "Your value kept");
  };

  return (
    <section className="card stack no-print" aria-labelledby="trd-upd-h" data-testid="trd-update">
      <h2 id="trd-upd-h">{fromProject ? "Update from the project" : "Update from a newer seed file"}</h2>
      {fromProject && project.problem && (
        <p className="notice" role="alert">
          The project could not be turned into a TRD seed: {project.problem}
        </p>
      )}
      {!fromProject && (
        <div className="stack">
          <p className="muted small">This TRD started from a seed file. To bring in a newer one, choose it here. Nothing changes until you accept a row.</p>
          <label className="field">
            <span>Newer TRD seed file (JSON)</span>
            <input ref={fileInput} type="file" accept=".json,application/json" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="trd-update-file" />
          </label>
          {fileError && (
            <p className="error" role="alert" data-testid="trd-update-file-error">
              {fileError}
            </p>
          )}
          {file && seedIsFromOtherProject(d, file.seed) && (
            <p className="notice" data-testid="trd-update-other">
              This file is from another project ({file.seed.meta.project.name}), not the one this TRD started from. Check the rows before you accept any.
            </p>
          )}
        </div>
      )}
      {/* A notice needs a difference to point at. A changed fingerprint with no differing row (for example the change log moved) says nothing useful, so the page then reads "up to date". */}
      {seed && changed && rows.length > 0 && (
        <p className="notice" role="status" data-testid="trd-changed-notice">
          {fromProject ? "The project has changed since this TRD was last updated." : "This file differs from the seed this TRD was last updated with."} {`${rows.length} ${rows.length === 1 ? "row differs" : "rows differ"}.`} You can keep working; nothing changes until you accept a row.
        </p>
      )}
      {seed && rows.length === 0 && !open && (
        <p data-testid="trd-uptodate">
          {fromProject ? "The TRD is up to date with the project." : `The TRD is up to date with ${file?.name ?? "the file"}.`}
        </p>
      )}
      {seed && rows.length > 0 && (
        <div className="row wrap">
          <button ref={toggle} type="button" className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="trd-review-toggle">
            {open ? "Hide the review" : `Review ${rows.length} ${rows.length === 1 ? "difference" : "differences"}`}
          </button>
        </div>
      )}
      {seed && open && (
        <div className="stack" data-testid="trd-review">
          {rows.length === 0 ? (
            <p>No difference is left. Mark the TRD as up to date to close the notice.</p>
          ) : (
            <>
              <div className="table-scroll" role="region" aria-label="Differences between the TRD and its source" tabIndex={0}>
                <table className="data" data-testid="trd-review-table">
                  <caption className="visually-hidden">What the {fromProject ? "project" : "file"} says now compared with the TRD</caption>
                  <thead>
                    <tr>
                      <th scope="col">Where</th>
                      <th scope="col">Kind</th>
                      <th scope="col">{fromProject ? "Project now" : "File now"}</th>
                      <th scope="col">TRD now</th>
                      <th scope="col">Choice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} data-testid="trd-review-row" data-overridden={r.overridden ? "true" : "false"}>
                        <th scope="row">{r.where}</th>
                        <td className="small">
                          {KIND_TEXT[r.kind]}
                          {r.statusChanged && <span className="tag status status-tbd"> Status changed</span>}
                        </td>
                        <td>{r.projectNow}</td>
                        <td>
                          {r.trdNow}
                          {r.overridden && <span className="tag tag-override"> Overridden</span>}
                        </td>
                        <td>
                          <div className="stack">
                            {r.protectedRow && <span className="small muted">{r.overridden ? "Your override is kept unless you choose otherwise." : r.note}</span>}
                            <span className="row wrap">
                              <button type="button" className="btn small" aria-label={`${r.protectedRow ? "Take the project value for" : "Accept"} ${r.where}`} data-testid="trd-review-accept" onClick={() => accept(r, "take")}>
                                {r.protectedRow ? "Take the project value" : "Accept"}
                              </button>
                              {r.overridden && (
                                <button type="button" className="btn small" aria-label={`Keep my value for ${r.where}`} data-testid="trd-review-keep" onClick={() => accept(r, "keep")}>
                                  Keep my value
                                </button>
                              )}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn primary"
                  disabled={rows.every((r) => r.protectedRow)}
                  data-testid="trd-review-accept-all"
                  onClick={() => run((p, actor) => applyTrdUpdate(p, d.id, seed, pickAllUnprotected(rows), actor), "Differences accepted (overridden values kept)")}
                >
                  Accept all not overridden
                </button>
              </div>
            </>
          )}
          <div className="row wrap">
            <button
              type="button"
              className="btn"
              data-testid="trd-review-finish"
              onClick={() => {
                if (run((p, actor) => finishTrdReview(p, d.id, seed, actor), "Review finished")) setOpen(false);
              }}
            >
              {rows.length === 0 ? "Mark the TRD as up to date" : "Finish the review and leave the rest as it is"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
