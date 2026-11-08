import {
  copyProject,
  ensureStartVersion,
  hasUnsavedChanges,
  historyOf,
  historyUsage,
  lastVersion,
  limitMessage,
  NO_VERSION_HISTORY,
  nextVersionNumber,
  REASON_MAX,
  savedVersionStamp,
  STAGE_SHORT,
  versionLabelOf,
  WORKING_COPY_LABEL,
  workingCopyStamp,
  type VersionStamp,
} from "@gap/engine";
import type { Project, ReviewDoc, ReviewItem } from "@gap/process-model";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Modal } from "./components";
import { download, projectFileStem, today } from "./lib";
import { href } from "./router";
import { SERVER_MODE } from "./server/mode";
import { useIsRemote } from "./server/ServerUi";
import { saveNewProject, useSync } from "./server/sync";
import { actorOf, READ_ONLY_MESSAGE, useStore } from "./store";

/** The documents a stage review can list, in the order the documents run. The names are the ones the menu uses. */
export const REVIEW_DOCS: readonly ReviewDoc[] = ["gap", "trd", "sampling", "mbr", "risk"];
export const DOC_NAME: Record<ReviewDoc, string> = { gap: "Gap assessment", trd: "TRD", sampling: "Sampling plan", mbr: "Batch record", risk: "Risk" };
/** The words of the "Go to ..." link under a review item. */
export const DOC_GO: Record<ReviewDoc, string> = {
  gap: "Go to the gap assessment (validation page)",
  trd: "Go to the TRD",
  sampling: "Go to the sampling plan",
  mbr: "Go to the batch record",
  risk: "Go to the risk assessment",
};

/** "TRD 3, Sampling plan 4": how many items each document has. */
export function docCountsText(items: readonly ReviewItem[]): string {
  return REVIEW_DOCS.map((d) => ({ d, n: items.filter((i) => i.doc === d).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${DOC_NAME[x.d]} ${x.n}`)
    .join(", ");
}

/** A stage key as people read it ("PPQ"); "not set" when there is none. */
export const stageName = (key: string | undefined): string => ((key && (STAGE_SHORT as Record<string, string>)[key]) || "not set");

/** "Clinical to PPQ" for a stage change, "project stage PPQ" otherwise. */
export function stageWords(stage: string | undefined, fromStage: string | undefined, changed: boolean): string {
  return changed ? `${stageName(fromStage)} to ${stageName(stage)}` : `project stage ${stageName(stage)}`;
}

export const dayOf = (iso: string): string => iso.slice(0, 10);

/** The real project (the working copy while a saved version is open). The version and review pages always read this one. */
export function useRealProject(): Project | null {
  return useStore((s) => s.working ?? s.project);
}

/**
 * What a document made now says about its version. A saved version that is open says its own label and day (it exports its own data);
 * otherwise it is the working copy. Worked out together with the document, not after a delay, so an export clicked straight after a
 * change never claims "no changes since it was saved".
 */
export function useVersionStamp(): VersionStamp {
  const viewing = useStore((s) => s.viewing);
  const real = useRealProject();
  return useMemo(
    () => (viewing ? savedVersionStamp(viewing) : real ? workingCopyStamp(real) : { row: NO_VERSION_HISTORY, label: "", saved: "" }),
    [viewing, real],
  );
}

/** The address of the compare page for two sides (a version label such as "v2", or "Working copy"). */
export const compareHref = (a: string, b: string): string => href("/versions/compare", { a, b });

const unsavedCache = new WeakMap<Project, boolean>();

/**
 * True when the working copy differs from its newest saved version. The comparison hashes the whole project, so it is worked out a moment
 * after the last change (not on every key press) and once per project object, however many places show it.
 */
export function useUnsaved(): boolean {
  const p = useRealProject();
  const [value, setValue] = useState(() => (p ? (unsavedCache.get(p) ?? false) : false));
  useEffect(() => {
    if (!p) {
      setValue(false);
      return;
    }
    const known = unsavedCache.get(p);
    if (known !== undefined) {
      setValue(known);
      return;
    }
    const timer = window.setTimeout(() => {
      const v = hasUnsavedChanges(p);
      unsavedCache.set(p, v);
      setValue(v);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [p]);
  return value;
}

/**
 * "Working copy after v2.1, changed since then". The words used to be "unsaved changes", which reads as if the person's work could be lost.
 * It cannot: the project is kept as it is edited. What differs is only that no version has been saved since (a version is a frozen copy).
 */
export function workingCopyText(p: Project, unsaved: boolean): string {
  const last = lastVersion(p);
  return `Working copy${last ? ` after ${last.label}` : ""}${unsaved ? ", changed since then" : ""}`;
}

/**
 * The "v2" chip beside the stage chip. It opens the version history. On a wide screen it says "Changed since v2" in words; on a narrow
 * one it shows a dot, and the words are in its accessible name either way (the cue is never colour alone).
 */
export function VersionChip({ short }: { short?: boolean }) {
  const real = useRealProject();
  const viewing = useStore((s) => s.viewing);
  const unsaved = useUnsaved();
  const label = real ? lastVersion(real)?.label : undefined;
  if (!label) return null;
  const text = viewing ? `Viewing ${viewing.label}` : unsaved && !short ? `Changed since ${label}` : label;
  const name = viewing ? `Viewing ${viewing.label}, read-only. Open the version history` : `${unsaved ? `Changed since ${label}` : `Version ${label}`}. Open the version history`;
  return (
    <a className="stage-chip version-chip" href={href("/versions")} data-testid="version-chip" data-tour="version-chip" aria-label={name}>
      {unsaved && short && !viewing && <span className="stage-dot" aria-hidden="true" />}
      <span>{text}</span>
    </a>
  );
}

// ------------------------------------------------------------------ the banner above every page while a saved version is open

/**
 * "You are looking at v2 (Clinical to PPQ), saved 2026-11-04 by <name>. Read-only: nothing here can be changed." It is a status (polite),
 * not an alert: nothing is wrong. It is the same on every page, so a person who opens a version never mistakes it for the working copy.
 */
export function VersionBanner() {
  const viewing = useStore((s) => s.viewing);
  const closeVersion = useStore((s) => s.closeVersion);
  const remote = SERVER_MODE && useIsRemote();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  // The banner is the same element for every version, so a note about a copy made from one must not follow to the next.
  const entryId = viewing?.entryId;
  useEffect(() => {
    setNote("");
    setProblem("");
  }, [entryId]);
  if (!viewing) return null;

  const what = viewing.kind === "stage-change" ? stageWords(viewing.stage, viewing.fromStage, true) : stageWords(viewing.stage, undefined, false);

  /**
   * A copy is made from the FROZEN version and gets its own start version, so it is a project in its own right. On the server it is saved
   * as a new project in My projects. In the browser there is only one open project slot (replacing it would lose the working copy), so the
   * copy is downloaded as a project file that Home can import.
   */
  const copy = async () => {
    const s = useStore.getState();
    if (!s.project || !s.working) return;
    setBusy(true);
    setNote("");
    setProblem("");
    try {
      const actor = actorOf(s.project);
      const taken = remote ? useSync.getState().list.map((x) => x.title) : [s.working.meta.title];
      const made = await ensureStartVersion(copyProject(s.project, actor, taken), actor);
      if (remote) {
        const c = await saveNewProject(made);
        setNote(`Copied ${viewing.label} as a new project called ${c.title}. Open it from My projects on the Home page.`);
      } else {
        download(`${projectFileStem(made.meta)}-${viewing.label}-${today()}.json`, JSON.stringify(made, null, 2), "application/json");
        setNote(`The copy of ${viewing.label} was downloaded as a project file called ${made.meta.title}. On the Home page, import it to open it as a new project.`);
      }
    } catch (e) {
      setProblem(`${viewing.label} could not be copied. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="version-banner" role="status" data-testid="version-banner">
      <p>
        <strong>
          You are looking at {viewing.label} ({what}), saved {dayOf(viewing.at)} by {viewing.by}.
        </strong>{" "}
        Read-only: nothing here can be changed.
      </p>
      <div className="row wrap">
        <button type="button" className="btn primary" onClick={closeVersion}>
          Back to the working copy
        </button>
        <a className="btn" href={compareHref(viewing.label, WORKING_COPY_LABEL)} data-testid="banner-compare">
          Compare with the working copy
        </a>
        <button type="button" className="btn" disabled={busy} onClick={() => void copy()}>
          {busy ? "Copying…" : "Copy this version as a new project"}
        </button>
      </div>
      {note && <p className="small">{note}</p>}
      {problem && <p className="small error">{problem}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ "Save a version"

/**
 * The dialog behind every "Save a version" button. A version is a frozen copy of the whole project as it is now; the optional note says
 * what it is for. Nothing is written until the button is pressed.
 */
export function SaveVersionDialog({ open, onClose, restoreFocus }: { open: boolean; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const real = useRealProject();
  const saveVersionNow = useStore((s) => s.saveVersionNow);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const errId = useId();
  if (!real) return null;
  const next = nextVersionNumber(historyOf(real), "manual");
  const usage = historyUsage(real);

  const close = () => {
    setNote("");
    setError("");
    onClose();
  };
  const save = async () => {
    setBusy(true);
    setError("");
    const r = await saveVersionNow(note);
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    close();
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} title="Save a version" description="A version is a saved copy of the whole project as it is now. You can open it later to look at it." restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          // The dialog is a portal inside the page tree: without this a submit here would also reach a surrounding form (the interview question).
          e.stopPropagation();
          void save();
        }}
      >
        <p className="small">
          Version {versionLabelOf(next.major, next.minor)} will be saved.
          {next.minor > 0 && ` It is a smaller step after v${next.major}. A change of the project stage makes the next main version.`}
        </p>
        {usage.atLimit && (
          <p className="notice" data-testid="version-limit">
            {limitMessage(real)} <a href={href("/versions")}>Go to the version history</a> to remove one.
          </p>
        )}
        <label className="field" htmlFor={noteId}>
          <span>What is this version for? (optional)</span>
          <textarea id={noteId} rows={2} maxLength={REASON_MAX} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={error ? errId : undefined} />
        </label>
        {error && (
          <p className="error" role="alert" id={errId}>
            {error}
          </p>
        )}
        <div className="row wrap">
          <button type="submit" className="btn primary" disabled={busy || usage.atLimit}>
            {busy ? "Saving…" : `Save ${versionLabelOf(next.major, next.minor)}`}
          </button>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A button that opens the Save a version dialog and gives focus back to itself afterwards. Off while a saved version is open. */
export function SaveVersionButton({ className = "btn", children = "Save a version" }: { className?: string; children?: string }) {
  const viewing = useStore((s) => s.viewing);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        data-testid="save-version-button"
        disabled={!!viewing}
        title={viewing ? READ_ONLY_MESSAGE : undefined}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <SaveVersionDialog open={open} onClose={() => setOpen(false)} restoreFocus={() => ref.current} />
    </>
  );
}

/** Home's project panel: the newest version, whether the working copy has moved on from it, and the buttons that belong to versions. */
export function HomeVersion() {
  const real = useRealProject();
  const unsaved = useUnsaved();
  const viewing = useStore((s) => s.viewing);
  if (!real) return null;
  const last = lastVersion(real);
  // While a saved version is open, the panel shows that version's data, so naming the working copy's latest label here
  // (for example "v2.1" while looking at v2) would contradict the banner above it.
  const text = viewing ? `Viewing ${viewing.label} (read-only)` : last ? workingCopyText(real, unsaved) : "No version yet";
  return (
    <span className="stage-row" data-testid="home-version">
      <span>{text}</span>
      <SaveVersionButton className="btn small" />
      <a href={href("/versions")}>Version history</a>
    </span>
  );
}
