import { copyProject, PRODUCT_NAME, ProjectNameError, renameProject, sourceLabel } from "@gap/engine";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PageBanner } from "../art";
import { CascadeMark, ProductEyebrow } from "../brand";
import { InlineRename, Modal, NoticeFooter, NoticeStrip } from "../components";
import { useDisclosure } from "../disclosure";
import { dateTime, shortHash, slug, today, download } from "../lib";
import { AboutPage } from "../pages/AboutPage";
import { href, useRoute } from "../router";
import { actorOf, useStore } from "../store";
import { readBrowserLibrary, removeFromBrowserLibrary, useTemplates, type StoredTemplate } from "../templates-store";
import { ThemeMenu } from "../theme-menu";
import type { ApiError, FileMeta, ProjectSummary } from "./api";
import * as api from "./api";
import { formatBytes, useFiles } from "./files";
import { planLine } from "./plan";
import { useSession } from "./session-store";
import { closeProject, copyStoredProject, deleteProjectById, editStoredProject, flush, keepMine, loadList, loadNewerVersion, openProject, useSync } from "./sync";

/** Everything the server mode adds to the screen. Imported only behind `SERVER_MODE`, so the static build leaves it out. */

/** True when the signed-in account keeps projects, templates and files on the server. */
export function useIsRemote(): boolean {
  return useSession((s) => s.phase === "ready" && s.storage === "server");
}

// ------------------------------------------------------------------ sign-in page

/** Shows the sign-in page until the person is signed in, then the app. Checks the server on first load. */
export function ServerGate({ children }: { children: ReactNode }) {
  const phase = useSession((s) => s.phase);
  const route = useRoute();
  useEffect(() => {
    void useSession.getState().start();
  }, []);
  // Moving between the sign-in form and the About and privacy page puts focus on the new page, as the signed-in app does. Not on the first
  // render: a person arriving at the sign-in page lands where the browser puts them.
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [route.path]);
  if (phase === "ready") return <>{children}</>;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <NoticeStrip />
      <header className="app-header">
        <div className="brand">
          <CascadeMark />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </div>
        {/* The same light / dark button as the signed-in header, so a person can set the colours before signing in. */}
        <div className="header-tools">
          <ThemeMenu />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {phase === "loading" ? (
          <p className="muted">Loading…</p>
        ) : phase === "unreachable" ? (
          <Unreachable />
        ) : route.path === "/about" ? (
          <SignedOutAbout />
        ) : (
          <SignInPage />
        )}
      </main>
      <NoticeFooter />
    </>
  );
}

/** The About and privacy page for a person who has not signed in, with the way back to the sign-in form. */
function SignedOutAbout() {
  return (
    <div className="stack-lg">
      <p>
        <a href={href("/")}>Back to sign in</a>
      </p>
      <AboutPage />
    </div>
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
      {/* The slim banner: the form is the point of this page, so it starts near the top of the screen. */}
      <PageBanner art="page-signin" size="slim">
        <ProductEyebrow />
        <h1 ref={headingRef} tabIndex={-1}>
          Sign in
        </h1>
      </PageBanner>
      <div>
        <p className="muted">
          This copy of {PRODUCT_NAME} needs an account. Accounts are by invitation only. Ask the person who invited you for an invite code.{" "}
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
      <p className="small">
        <a href={href("/about")}>About and privacy</a>
      </p>
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

// ------------------------------------------------------------------ signed-in account

/** Two capital letters for the avatar: the first letters of the first two words that start with a letter ("Alex Example (fictional)" gives "AE"). */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((w) => w.match(/^\p{L}/u)?.[0])
    .filter((c): c is string => !!c)
    .slice(0, 2);
  return letters.length > 0 ? letters.join("").toUpperCase() : "?";
}

/**
 * Who is signed in, the plan, and the two account actions (Change password, Sign out). The avatar menu on a wide screen and the Menu
 * panel on a phone both show this one block.
 */
function AccountDetails({ onChangePassword }: { onChangePassword: () => void }) {
  const user = useSession((s) => s.user);
  const storage = useSession((s) => s.storage);
  if (!user) return null;
  return (
    <div className="account-details">
      <p className="account-who">
        Signed in as <strong>{user.displayName}</strong>
        <span className="muted"> · {planLine(user)}</span>
      </p>
      {storage !== "server" && <p className="small muted account-note">Your projects and documents stay in this browser; the server holds only your account.</p>}
      <div className="row wrap account-actions">
        <button type="button" className="btn small" onClick={onChangePassword}>
          Change password
        </button>
        <button type="button" className="btn small" onClick={() => void useSession.getState().signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/**
 * The initials circle at the right of the header bar (wide screens). It opens the account details. "Change password" asks the header
 * to open its dialog, which lives outside this menu so it stays open after the menu closes.
 */
export function AccountMenu({ onChangePassword }: { onChangePassword: () => void }) {
  const user = useSession((s) => s.user);
  const d = useDisclosure();
  if (!user) return null;
  const initials = initialsOf(user.displayName);
  return (
    <div className="header-menu" ref={d.wrap} onKeyDown={d.onKeyDown} onBlur={d.onBlur}>
      {/* WCAG 2.5.3 (label in name): the name starts with the initials the circle shows, so a person who says what they see can use it. */}
      <button ref={d.button} type="button" className="avatar-btn account-btn" aria-expanded={d.open} aria-controls={d.id} aria-label={`${initials}, account: ${user.displayName}`} onClick={() => d.setOpen((o) => !o)}>
        <span aria-hidden="true">{initials}</span>
      </button>
      <div id={d.id} className="header-popover header-popover-wide" hidden={!d.open}>
        {d.open && (
          <AccountDetails
            onChangePassword={() => {
              d.setOpen(false);
              onChangePassword();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The account block and the save status inside the phone Menu panel. */
export function PhoneAccount({ onChangePassword }: { onChangePassword: () => void }) {
  const storage = useSession((s) => s.storage);
  return (
    <section>
      <p className="nav-panel-head">Account</p>
      <AccountDetails onChangePassword={onChangePassword} />
      {storage === "server" && <SaveStatus />}
    </section>
  );
}

/**
 * On a phone the save status is in the Menu panel, so a failed save or a save conflict also gets its own line under the header: it
 * must not wait behind a closed menu.
 */
export function SaveProblem() {
  const phase = useSync((s) => s.phase);
  const hasProject = useStore((s) => !!s.project);
  if (!hasProject || (phase !== "error" && phase !== "conflict")) return null;
  return (
    <div className="save-problem">
      <SaveStatus />
    </div>
  );
}

/** "Saved to server", "Saving…" or the problem, for the open project. */
export function SaveStatus() {
  const phase = useSync((s) => s.phase);
  const error = useSync((s) => s.error);
  const hasProject = useStore((s) => !!s.project);
  let text = "";
  if (hasProject) {
    if (phase === "saved") text = "Saved to server";
    else if (phase === "saving" || phase === "dirty") text = "Saving…";
    else if (phase === "conflict") text = "Not saved: this project was changed on another computer";
  }
  // With nothing to say the block is kept (a live region has to exist before its text changes, or the change is not announced) but takes no room.
  const quiet = !text && !(hasProject && phase === "error" && error);
  return (
    <div className={`save-status small${quiet ? " is-empty" : ""}`}>
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

export function ChangePasswordDialog({ onClose, restoreFocus }: { onClose: () => void; restoreFocus: () => HTMLElement | null }) {
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

/** How many projects the list shows before "Show all". */
const PROJECTS_SHOWN = 5;

/**
 * The "..." button of a project row, with Rename, Copy and Delete under it, so a row is one Open button and one small button instead of
 * four. An ARIA menu like the Export menu on the module pages: arrow keys move, Escape closes and puts focus back on the button, choosing an
 * item closes it. Each item's name carries the project's title, so a screen reader list of controls says which project it acts on.
 */
function ProjectRowMenu({
  id,
  title,
  busy,
  renaming,
  onRename,
  onCopy,
  onDelete,
}: {
  id: string;
  title: string;
  busy: boolean;
  renaming: boolean;
  onRename: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { open, setOpen, id: menuId, wrap, button, onKeyDown: onEscape, onBlur } = useDisclosure();
  const list = useRef<HTMLUListElement>(null);
  const focusOnOpen = useRef(false);
  const entries = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (open && focusOnOpen.current) entries()[0]?.focus();
    focusOnOpen.current = false;
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % all.length;
    else if (e.key === "ArrowUp") next = (at - 1 + all.length) % all.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = all.length - 1;
    if (next < 0) return;
    e.preventDefault();
    all[next]?.focus();
  };

  const choose = (action: () => void) => () => {
    setOpen(false);
    button.current?.focus();
    action();
  };

  return (
    <div className="row-menu" ref={wrap} onKeyDown={onEscape} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        id={`more-${id}`}
        className="btn small row-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`More actions for ${title}`}
        disabled={renaming}
        data-testid={`project-more-${id}`}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          focusOnOpen.current = true;
          if (open) entries()[0]?.focus();
          else setOpen(true);
        }}
        onClick={(e) => {
          // A click made with the keyboard (Enter or Space) has no pointer position; it lands on the first item, as a menu button should.
          if (!open && e.detail === 0) focusOnOpen.current = true;
          setOpen(!open);
        }}
      >
        <span aria-hidden="true">...</span>
      </button>
      {open && (
        <ul ref={list} id={menuId} role="menu" aria-label={`Actions for ${title}`} className="row-menu-list" onKeyDown={onMenuKey}>
          <li role="none">
            <button type="button" role="menuitem" tabIndex={-1} className="export-menu-item" aria-label={`Rename ${title}`} onClick={choose(onRename)}>
              Rename
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" tabIndex={-1} className="export-menu-item" aria-label={`Copy ${title}`} disabled={busy} onClick={choose(onCopy)}>
              Copy
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" tabIndex={-1} className="export-menu-item row-menu-danger" aria-label={`Delete ${title}`} onClick={choose(onDelete)}>
              Delete
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export function ProjectListCard() {
  const list = useSync((s) => s.list);
  const state = useSync((s) => s.listState);
  const listError = useSync((s) => s.listError);
  const currentId = useSync((s) => s.projectId);
  const openTitle = useStore((s) => s.project?.meta.title);
  const note = useStore((s) => s.listNote);
  const [confirm, setConfirm] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [renaming, setRenaming] = useState("");
  const [showAll, setShowAll] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    void loadList();
  }, []);

  // A project that was just copied or imported: bring its row into view, because the button that made it may be far from the list.
  useEffect(() => {
    if (!note?.newId) return;
    listRef.current?.querySelector(`[data-project-id="${note.newId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [note?.newId, list.length]);

  // The open project's name comes from the project itself, so a rename shows at once instead of after the next save.
  const titleOf = (p: ProjectSummary) => (p.id === currentId && openTitle ? openTitle : p.title);
  const say = (text: string, newId?: string) => useStore.setState({ listNote: text ? { text, ...(newId ? { newId } : {}) } : null });

  /** Saves a new name. Returns the problem to show beside the field, or null when it was saved. */
  const rename = async (p: ProjectSummary, title: string): Promise<string | null> => {
    const wanted = title.trim();
    const others = list.filter((x) => x.id !== p.id).map((x) => x.title);
    const was = titleOf(p);
    try {
      if (p.id === currentId) {
        // The open project is changed through the store, so its unsaved edits are kept and the usual autosave writes it.
        const problem = useStore.getState().update((pr, actor) => renameProject(pr, wanted, actor, { taken: others }), `Renamed: ${wanted}`);
        if (problem) return problem;
      } else {
        await editStoredProject(p.id, (pr) => renameProject(pr, wanted, actorOf(pr), { taken: others }));
      }
    } catch (e) {
      return e instanceof ProjectNameError ? e.message : `${was} could not be renamed. ${(e as Error).message}`;
    }
    say(wanted === was ? `The name was not changed: ${was}` : `Renamed: ${was} is now called ${wanted}.`);
    return null;
  };

  const copy = (p: ProjectSummary) => {
    const was = titleOf(p);
    setBusyId(p.id);
    setError("");
    say("");
    const listed = list.map((x) => x.title);
    copyStoredProject(p.id, (source) => copyProject(source, actorOf(source), listed))
      .then((c) => say(`Copied: ${was}. The copy is called ${c.title}.`, c.id))
      .catch((x) => setError(`${was} could not be copied. ${(x as Error).message}`))
      .finally(() => setBusyId(""));
  };

  // The open project and a project just copied or imported are always listed, wherever they sit in a long list: the person is looking for them.
  const shown = showAll ? list : list.filter((p, i) => i < PROJECTS_SHOWN || p.id === currentId || p.id === note?.newId);

  return (
    <section className="card stack project-card" aria-labelledby="mine-h">
      <h2 id="mine-h" ref={headingRef} tabIndex={-1}>
        My projects
      </h2>
      <p className="muted small">Saved on the server under your account, so you can open them from any computer.</p>
      {/* Always on the page, so a screen reader announces the line when it appears. */}
      <div role="status" data-testid="projects-note">
        {note && <p className="notice">{note.text}</p>}
      </div>
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
      {state === "ready" && list.length === 0 && <p className="empty">You have no saved projects yet. Start a new project or open a demo.</p>}
      {list.length > 0 && (
        <ul className="project-list" aria-label="My projects" ref={listRef}>
          {shown.map((p) => {
            const title = titleOf(p);
            const isNew = note?.newId === p.id;
            return (
              <li key={p.id} data-project-id={p.id} className={isNew ? "is-new" : undefined}>
                <div className="project-info">
                  {renaming === p.id ? (
                    <InlineRename
                      current={title}
                      label={title}
                      save={(t) => rename(p, t)}
                      onClose={() => {
                        setRenaming("");
                        // The form was in place of the title, so focus goes back to the "..." button that led to it.
                        window.setTimeout(() => document.getElementById(`more-${p.id}`)?.focus(), 0);
                      }}
                    />
                  ) : (
                    <>
                      {/* One line with an ellipsis so a long name never makes the row tall; the full name is in the tooltip and in the buttons' names. */}
                      <strong className="project-name" title={title}>
                        {title}
                      </strong>
                      {(p.id === currentId || isNew) && (
                        <div className="project-tags">
                          {p.id === currentId && <span className="tag">Open now</span>}
                          {/* The tinted row is not the only cue: the tag says it too. */}
                          {isNew && <span className="tag">New</span>}
                        </div>
                      )}
                    </>
                  )}
                  <div className="small muted">Last saved {dateTime(p.updatedAt)}</div>
                </div>
                <div className="project-row-actions">
                  {/* The open project has the "Open now" tag, so a greyed Open button beside it only looked broken; the menu stays. */}
                  {p.id !== currentId && (
                    <button
                      type="button"
                      className="btn small"
                      aria-label={`Open ${title}`}
                      disabled={busyId === p.id}
                      onClick={() => {
                        setBusyId(p.id);
                        setError("");
                        say("");
                        openProject(p.id)
                          .catch((x) => setError(`${title} could not be opened. ${(x as Error).message}`))
                          .finally(() => setBusyId(""));
                      }}
                    >
                      Open
                    </button>
                  )}
                  <ProjectRowMenu
                    id={p.id}
                    title={title}
                    busy={busyId === p.id}
                    renaming={renaming === p.id}
                    onRename={() => {
                      setError("");
                      say("");
                      setRenaming(p.id);
                    }}
                    onCopy={() => copy(p)}
                    onDelete={() => setConfirm({ id: p.id, title })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* Only the newest few are listed at first, so a long list does not push the rest of the page down. */}
      {list.length > PROJECTS_SHOWN && (
        <button type="button" className="btn small" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} data-testid="projects-show-all">
          {showAll ? "Show fewer" : `Show all ${list.length} projects`}
        </button>
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
