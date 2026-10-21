import { sourceLabel } from "@gap/engine";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, PocBanner, PocFooter } from "../components";
import { dateTime, shortHash, slug, today, download } from "../lib";
import { useStore } from "../store";
import { readBrowserLibrary, removeFromBrowserLibrary, useTemplates, type StoredTemplate } from "../templates-store";
import type { ApiError, FileMeta } from "./api";
import * as api from "./api";
import { formatBytes, useFiles } from "./files";
import { planLine } from "./plan";
import { useSession } from "./session-store";
import { closeProject, deleteProjectById, flush, keepMine, loadList, loadNewerVersion, openProject, useSync } from "./sync";

/** Everything the server mode adds to the screen. Imported only behind `SERVER_MODE`, so the static build leaves it out. */

/** True when the signed-in account keeps projects, templates and files on the server. */
export function useIsRemote(): boolean {
  return useSession((s) => s.phase === "ready" && s.storage === "server");
}

// ------------------------------------------------------------------ sign-in page

/** Shows the sign-in page until the person is signed in, then the app. Checks the server on first load. */
export function ServerGate({ children }: { children: ReactNode }) {
  const phase = useSession((s) => s.phase);
  useEffect(() => {
    void useSession.getState().start();
  }, []);
  if (phase === "ready") return <>{children}</>;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <PocBanner sub="Fictional data only." />
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Gap Assessment Generator</span>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {phase === "loading" ? <p className="muted">Loading…</p> : phase === "unreachable" ? <Unreachable /> : <SignInPage />}
      </main>
      <PocFooter />
    </>
  );
}

function Unreachable() {
  const problem = useSession((s) => s.problem);
  return (
    <div className="stack">
      <h1>The server cannot be reached</h1>
      <p className="error" role="alert">
        {problem}
      </p>
      <div>
        <button type="button" className="btn primary" onClick={() => void useSession.getState().start()}>
          Try again
        </button>
      </div>
    </div>
  );
}

function messageOf(e: unknown): string {
  const err = e as ApiError;
  if (err.code === "rate-limited" && typeof err.body.retryAfterSeconds === "number" && !/\d/.test(err.message)) {
    return `${err.message} Try again in about ${Math.max(1, Math.ceil(err.body.retryAfterSeconds / 60))} minutes.`;
  }
  return err.message || "Something went wrong. Try again.";
}

const PASSWORD_RULES = "Use at least 7 characters. Do not use a password from another site.";

function SignInPage() {
  const storage = useSession((s) => s.storage);
  const notice = useSession((s) => s.notice);
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <div className="stack-lg">
      <div>
        <h1 ref={headingRef} tabIndex={-1}>
          Sign in
        </h1>
        <p className="muted">
          This copy of the Gap Assessment Generator needs an account. Accounts are by invitation only.{" "}
          {storage === "client"
            ? "Your projects and documents stay in this browser; the server holds only your account."
            : "Your projects, templates and files are kept on the server, so they follow you to any computer."}
        </p>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="auth-grid">
        <SignInForm />
        <CreateAccountForm />
      </div>
    </div>
  );
}

function SignInForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card stack"
      aria-labelledby="signin-h"
      onSubmit={(e) => {
        e.preventDefault();
        if (!username.trim() || !password) return setError("Enter your username and password.");
        setBusy(true);
        setError("");
        useSession
          .getState()
          .signIn(username.trim(), password)
          .catch((x) => {
            setError(messageOf(x));
            setBusy(false);
          });
      }}
    >
      <h2 id="signin-h">Sign in</h2>
      <label className="field">
        <span>Username</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}

function CreateAccountForm() {
  const [invite, setInvite] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card stack"
      aria-labelledby="signup-h"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invite.trim()) return setError("Enter your invite code.");
        if (!/^[a-z0-9._-]{3,40}$/i.test(username.trim())) return setError("The username must be 3 to 40 characters: letters, numbers, dots, dashes or underscores.");
        if (!displayName.trim()) return setError("Enter the name to show next to your account.");
        if (password.length < 7) return setError("The password must be at least 7 characters.");
        if (password !== confirm) return setError("The two passwords are not the same.");
        setBusy(true);
        setError("");
        useSession
          .getState()
          .signUp({ inviteCode: invite.trim().toUpperCase(), username: username.trim(), displayName: displayName.trim(), password })
          .catch((x) => {
            setError(messageOf(x));
            setBusy(false);
          });
      }}
    >
      <h2 id="signup-h">Have an invite code? Create account</h2>
      <label className="field">
        <span>Invite code</span>
        <input value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
      </label>
      <div className="field">
        <label htmlFor="signup-username">Choose a username</label>
        <input id="signup-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby="username-rules" />
        <span id="username-rules" className="small muted">
          3 to 40 letters, numbers, dots, dashes or underscores.
        </span>
      </div>
      <label className="field">
        <span>Display name</span>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
      </label>
      <div className="field">
        <label htmlFor="signup-password">Choose a password</label>
        <input id="signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-describedby="password-rules" />
        <span id="password-rules" className="small muted">
          {PASSWORD_RULES}
        </span>
      </div>
      <label className="field">
        <span>Confirm password</span>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ signed-in bar

/** Who is signed in, the plan, sign out and change password, and (with server storage) whether the project is saved. */
export function AccountBar() {
  const user = useSession((s) => s.user);
  const storage = useSession((s) => s.storage);
  const [changing, setChanging] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  if (!user) return null;
  return (
    <section className="account-bar" aria-label="Account">
      <p className="account-who">
        Signed in as <strong>{user.displayName}</strong>
        <span className="muted"> · {planLine(user)}</span>
      </p>
      {storage === "server" ? <SaveStatus /> : <p className="small muted account-note">Your projects and documents stay in this browser; the server holds only your account.</p>}
      <div className="row wrap account-actions">
        <button type="button" ref={changeRef} className="btn small" onClick={() => setChanging(true)}>
          Change password
        </button>
        <button type="button" className="btn small" onClick={() => void useSession.getState().signOut()}>
          Sign out
        </button>
      </div>
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} restoreFocus={() => changeRef.current} />}
    </section>
  );
}

/** "Saved to server", "Saving…" or the problem, for the open project. */
function SaveStatus() {
  const phase = useSync((s) => s.phase);
  const error = useSync((s) => s.error);
  const hasProject = useStore((s) => !!s.project);
  let text = "";
  if (hasProject) {
    if (phase === "saved") text = "Saved to server";
    else if (phase === "saving" || phase === "dirty") text = "Saving…";
    else if (phase === "conflict") text = "Not saved: this project was changed on another computer";
  }
  return (
    <div className="save-status small">
      <span role="status" aria-live="polite">
        {text}
      </span>
      {hasProject && phase === "error" && error && (
        <>
          <span className="error" role="alert">
            {error}
          </span>{" "}
          <button type="button" className="btn small" onClick={() => void flush()}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}

function ChangePasswordDialog({ onClose, restoreFocus }: { onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Change password" description="Other computers where you are signed in will be signed out." restoreFocus={restoreFocus}>
      {done ? (
        <div className="stack">
          <p role="status">Your password was changed.</p>
          <div className="row end">
            <button type="button" className="btn primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!current) return setError("Enter your current password.");
            if (next.length < 7) return setError("The new password must be at least 7 characters.");
            if (next !== confirm) return setError("The two new passwords are not the same.");
            setBusy(true);
            setError("");
            api
              .changePassword(current, next)
              .then(() => setDone(true))
              .catch((x) => setError(messageOf(x)))
              .finally(() => setBusy(false));
          }}
        >
          <label className="field">
            <span>Current password</span>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
          </label>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-describedby="newpw-rules" />
            <span id="newpw-rules" className="small muted">
              {PASSWORD_RULES}
            </span>
          </div>
          <label className="field">
            <span>Confirm new password</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row end">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ save conflict

/** Shown on any page when the server holds a newer version of the open project than the one this computer started from. */
export function ConflictDialog() {
  const phase = useSync((s) => s.phase);
  const conflict = useSync((s) => s.conflict);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = phase === "conflict";
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    fn()
      .catch((x) => setError((x as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      open={open}
      onOpenChange={() => undefined}
      title="This project was changed on another computer"
      description={`The server has a newer version${conflict?.updatedAt ? ` (saved ${dateTime(conflict.updatedAt)})` : ""}. Choose which version to keep. Nothing is changed until you choose.`}
    >
      <div className="stack">
        <p>
          <strong>Load the newer version</strong> replaces what is on this screen with the server's version. Your unsaved change is downloaded as a JSON file first, so nothing is lost.
        </p>
        <p>
          <strong>Keep mine</strong> saves what is on this screen over the newer version on the server.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end wrap">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              run(() =>
                loadNewerVersion((mine) => download(`${slug(mine.meta.title) || "project"}-unsaved-${today()}.json`, JSON.stringify(mine, null, 2), "application/json")),
              )
            }
          >
            Load the newer version (download mine first)
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => run(keepMine)}>
            Keep mine (overwrite)
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Project page: my projects

export function ProjectListCard() {
  const list = useSync((s) => s.list);
  const state = useSync((s) => s.listState);
  const listError = useSync((s) => s.listError);
  const currentId = useSync((s) => s.projectId);
  const [confirm, setConfirm] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void loadList();
  }, []);

  return (
    <section className="card stack" aria-labelledby="mine-h">
      <h2 id="mine-h" ref={headingRef} tabIndex={-1}>
        My projects
      </h2>
      <p className="muted small">Saved on the server under your account, so you can open them from any computer.</p>
      {state === "loading" && list.length === 0 && <p className="muted">Loading…</p>}
      {state === "error" && (
        <p className="error" role="alert">
          Your projects could not be listed. {listError}{" "}
          <button type="button" className="link-btn" onClick={() => void loadList()}>
            Try again
          </button>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state === "ready" && list.length === 0 && <p className="empty">You have no saved projects yet. Start one below.</p>}
      {list.length > 0 && (
        <ul className="project-list" aria-label="My projects">
          {list.map((p) => (
            <li key={p.id}>
              <div className="project-info">
                <strong>{p.title}</strong>
                {p.id === currentId && <span className="tag">Open now</span>}
                <div className="small muted">Last saved {dateTime(p.updatedAt)}</div>
              </div>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn small"
                  aria-label={`Open ${p.title}`}
                  disabled={busyId === p.id || p.id === currentId}
                  onClick={() => {
                    setBusyId(p.id);
                    setError("");
                    openProject(p.id)
                      .catch((x) => setError(`${p.title} could not be opened. ${(x as Error).message}`))
                      .finally(() => setBusyId(""));
                  }}
                >
                  Open
                </button>
                <button type="button" className="btn small danger" aria-label={`Delete ${p.title}`} onClick={() => setConfirm({ id: p.id, title: p.title })}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <Modal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={`Delete ${confirm.title}?`}
          description="The project is removed from your list on the server. It is moved to the server's trash folder, which only the server administrator can reach."
          restoreFocus={() => headingRef.current}
        >
          <div className="row end">
            <button type="button" className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                deleteProjectById(c.id)
                  .then(() => useStore.setState({ status: `${c.title} was deleted.` }))
                  .catch((x) => setError(`${c.title} could not be deleted. ${(x as Error).message}`));
              }}
            >
              Delete project
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** "Close project" for server storage: saves, then returns to the list. */
export function CloseProjectButton() {
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => {
          setError("");
          closeProject().catch((x) => setError((x as Error).message));
        }}
      >
        Close project
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Templates page: browser library

/** Offers to move templates this browser still holds to the server. The browser copies are removed only when the user asks. */
export function BrowserLibraryPanel() {
  const serverReady = useTemplates((s) => s.ready);
  const [local, setLocal] = useState<StoredTemplate[] | null>(null);
  const [phase, setPhase] = useState<"idle" | "working" | "uploaded" | "removed">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [handled, setHandled] = useState<string[]>([]);

  useEffect(() => {
    readBrowserLibrary().then(setLocal, () => setLocal([]));
  }, []);

  if (!local || !serverReady) return null;
  if (local.length === 0 && phase !== "removed") return null;

  async function upload(items: StoredTemplate[]) {
    setPhase("working");
    setError("");
    setMessage("");
    let added = 0;
    let already = 0;
    const done: string[] = [];
    try {
      for (const t of items) {
        if (useTemplates.getState().items.some((x) => x.sha256 === t.sha256)) {
          already++;
        } else {
          await useTemplates.getState().add(t);
          added++;
        }
        done.push(t.id);
      }
      setHandled(done);
      setPhase("uploaded");
      setMessage(`${added} ${added === 1 ? "template was" : "templates were"} uploaded to the server${already ? `; ${already} ${already === 1 ? "was" : "were"} already there` : ""}. The copies in this browser are still here.`);
    } catch (e) {
      setHandled(done);
      setPhase("idle");
      setError(`The upload stopped. ${(e as Error).message}`);
    }
  }

  const pending = local.filter((t) => !handled.includes(t.id));
  return (
    <section className="card stack" aria-labelledby="browser-lib-h">
      <h2 id="browser-lib-h">Templates in this browser</h2>
      {phase === "removed" ? (
        <p role="status">{message}</p>
      ) : (
        <>
          {pending.length > 0 && (
            <p>
              This browser has {pending.length} {pending.length === 1 ? "template" : "templates"} that {pending.length === 1 ? "is" : "are"} not on the server yet. Upload {pending.length === 1 ? "it" : "them"} to use {pending.length === 1 ? "it" : "them"} from any computer.
            </p>
          )}
          {phase === "uploaded" && <p role="status">{message}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row wrap">
            {pending.length > 0 && (
              <button type="button" className="btn primary" disabled={phase === "working"} onClick={() => void upload(pending)}>
                {phase === "working" ? "Uploading…" : "Upload them"}
              </button>
            )}
            {handled.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  removeFromBrowserLibrary(handled)
                    .then(() => {
                      setLocal((l) => (l ?? []).filter((t) => !handled.includes(t.id)));
                      setHandled([]);
                      setPhase("removed");
                      setMessage("The copies in this browser were removed. The templates are on the server.");
                    })
                    .catch((e) => setError(`The browser copies could not be removed. ${(e as Error).message}`));
                }}
              >
                Remove the browser copies
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Sources page: files

function usePicker(onFile: (f: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  return {
    ref,
    open: () => ref.current?.click(),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) onFile(f);
    },
  };
}

function UploadState({ slot }: { slot: string }) {
  const up = useFiles((s) => s.uploads[slot]);
  const err = useFiles((s) => s.slotErrors[slot]);
  return (
    <>
      {up && (
        <p className="small" aria-live="polite">
          Uploading {up.name}… {Math.round(up.fraction * 100)}%
        </p>
      )}
      {err && (
        <p className="error small" role="alert">
          {err}
        </p>
      )}
    </>
  );
}

function RemoveFileDialog({ file, onClose, restoreFocus }: { file: FileMeta; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const [error, setError] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Remove ${file.fileName}?`} description="The file is removed from this project. It is moved to the server's trash folder, which only the server administrator can reach." restoreFocus={restoreFocus}>
      <div className="stack">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() =>
              useFiles
                .getState()
                .remove(file)
                .then(onClose)
                .catch((x) => setError(`The file could not be removed. ${(x as Error).message}`))
            }
          >
            Remove file
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The files attached to one document reference, with "Attach file". */
export function SourceFiles({ sourceId, label }: { sourceId: string; label: string }) {
  const all = useFiles((s) => s.files);
  const files = useMemo(() => all.filter((f) => f.sourceId === sourceId), [all, sourceId]);
  const busy = useFiles((s) => !!s.uploads[sourceId]);
  const [removing, setRemoving] = useState<FileMeta | null>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const picker = usePicker((f) => void useFiles.getState().upload(f, sourceId, sourceId));
  return (
    <div className="source-files stack">
      {files.length > 0 && (
        <ul className="file-list" aria-label={`Files attached to ${label}`}>
          {files.map((f) => (
            <li key={f.id}>
              <FileSummary f={f} />
              <span className="row wrap">
                <button type="button" className="btn small" aria-label={`Download ${f.fileName}`} onClick={() => void useFiles.getState().save(f)}>
                  Download
                </button>
                <button type="button" id={`remove-file-${f.id}`} className="btn small danger" aria-label={`Remove ${f.fileName}`} onClick={() => setRemoving(f)}>
                  Remove
                </button>
              </span>
              <FileError id={f.id} />
            </li>
          ))}
        </ul>
      )}
      <div>
        <input ref={picker.ref} type="file" className="visually-hidden" tabIndex={-1} aria-label={`File to attach to ${label}`} onChange={picker.onChange} />
        <button type="button" ref={attachRef} className="btn small" aria-label={`Attach file to ${label}`} disabled={busy} onClick={picker.open}>
          Attach file…
        </button>
      </div>
      <UploadState slot={sourceId} />
      {removing && <RemoveFileDialog file={removing} onClose={() => setRemoving(null)} restoreFocus={() => attachRef.current} />}
    </div>
  );
}

function FileError({ id }: { id: string }) {
  const err = useFiles((s) => s.slotErrors[id]);
  return err ? (
    <p className="error small" role="alert">
      {err}
    </p>
  ) : null;
}

function FileSummary({ f }: { f: FileMeta }) {
  return (
    <span className="file-summary">
      <strong>{f.fileName}</strong>
      <span className="small muted">
        {" "}
        {formatBytes(f.size)} · SHA-256 <code title={f.sha256}>{shortHash(f.sha256)}</code>
      </span>
    </span>
  );
}

/** The "Files" section of the Sources page: every file of the project. */
export function ProjectFilesSection() {
  const project = useStore((s) => s.project);
  const projectId = useSync((s) => s.projectId);
  const files = useFiles((s) => s.files);
  const state = useFiles((s) => s.state);
  const error = useFiles((s) => s.error);
  const notice = useFiles((s) => s.notice);
  const busy = useFiles((s) => !!s.uploads.project);
  const [removing, setRemoving] = useState<FileMeta | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const picker = usePicker((f) => void useFiles.getState().upload(f, "project"));

  useEffect(() => {
    void useFiles.getState().load();
  }, [projectId]);

  const where = (f: FileMeta): string => {
    if (!f.sourceId) return "The project (no source)";
    const s = project?.sources.find((x) => x.id === f.sourceId);
    return s ? sourceLabel(s) : "A source that was removed";
  };

  return (
    <section className="stack" aria-labelledby="files-h">
      <h2 id="files-h">Files ({files.length})</h2>
      <p className="muted">
        Files you attach to a document reference are kept on the server as real files, under your account, with their original names. The SHA-256 is worked out by the server when the file arrives.
      </p>
      <p className="small muted" role="status" aria-live="polite">
        {notice}
      </p>
      {state === "loading" && files.length === 0 && <p className="muted">Loading…</p>}
      {state === "error" && (
        <p className="error" role="alert">
          The files could not be listed. {error}{" "}
          <button type="button" className="link-btn" onClick={() => void useFiles.getState().load()}>
            Try again
          </button>
        </p>
      )}
      {state === "ready" && files.length === 0 && <p className="empty">No files are attached yet. Use “Attach file” on a document reference above, or add a file to the project here.</p>}
      {files.length > 0 && (
        <div className="table-scroll" role="region" aria-label="Project files table" tabIndex={0}>
          <table className="data files-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Attached to</th>
                <th scope="col">Size</th>
                <th scope="col">SHA-256</th>
                <th scope="col">Added</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <th scope="row">{f.fileName}</th>
                  <td>{where(f)}</td>
                  <td className="nowrap">{formatBytes(f.size)}</td>
                  <td>
                    <code title={f.sha256}>{shortHash(f.sha256)}</code>
                  </td>
                  <td className="small">{dateTime(f.uploadedAt)}</td>
                  <td>
                    <div className="row wrap">
                      <button type="button" className="btn small" aria-label={`Download ${f.fileName}`} onClick={() => void useFiles.getState().save(f)}>
                        Download
                      </button>
                      <button type="button" className="btn small danger" aria-label={`Remove ${f.fileName}`} onClick={() => setRemoving(f)}>
                        Remove
                      </button>
                    </div>
                    <FileError id={f.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <input ref={picker.ref} type="file" className="visually-hidden" tabIndex={-1} aria-label="File to add to the project" onChange={picker.onChange} />
        <button type="button" ref={addRef} className="btn" disabled={busy} onClick={picker.open}>
          Add a file to the project…
        </button>
      </div>
      <UploadState slot="project" />
      {removing && <RemoveFileDialog file={removing} onClose={() => setRemoving(null)} restoreFocus={() => addRef.current} />}
    </section>
  );
}
