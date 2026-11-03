import { PRODUCT_NAME, STORAGE_PHRASE_BROWSER, STORAGE_PHRASE_SERVER } from "@gap/engine";
import { useId, useState } from "react";
import { CascadeMark } from "./brand";
import { MainNav, type NavGroup } from "./nav";
import { GAP_STEPS } from "./next-step";
import { href } from "./router";
import { AccountMenu, ChangePasswordDialog, PhoneAccount, SaveProblem, SaveStatus, useIsRemote } from "./server/ServerUi";
import { SERVER_MODE } from "./server/mode";
import { useStore } from "./store";
import { ThemeMenu } from "./theme-menu";
import { PHONE_WIDTH, useNarrow } from "./viewport";

// ------------------------------------------------------------------ project button

/**
 * The open project at the right of the header bar. One line with an ellipsis, so a long title never pushes the menu onto more rows; the
 * full title is in the button's name and its tooltip. It opens Home, which is where a project is switched, started or closed.
 */
function ProjectLink({ title }: { title: string }) {
  return (
    <a className="header-project" href={href("/")} aria-label={`Project: ${title}. Open the project page`} title={title}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
      <span className="header-project-title" aria-hidden="true">
        {title}
      </span>
    </a>
  );
}

// ------------------------------------------------------------------ header

/**
 * The dark bar at the top of every page: the Cascade mark and name, the menus, then (right) the open project, the theme and, on the
 * server, the account. On a phone it is the mark, the name, the theme button and a 44 px Menu button; the open project, the account and
 * where the data is kept move into the Menu panel, and a failed save gets its own line under the bar.
 */
export function AppHeader({ routePath, groups }: { routePath: string; groups: NavGroup[] }) {
  const narrow = useNarrow(PHONE_WIDTH);
  const title = useStore((s) => s.project?.meta.title);
  const remote = SERVER_MODE && useIsRemote();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const main = (
    <MainNav
      routePath={routePath}
      home={{ path: "/", label: "Home" }}
      // "Gap assessment" always opens the Scope step, so the link goes to the same place every time. With no project open there is nothing to
      // open (it could only lead back to Home, where a project is started), so the link is left out rather than look dead. What to do next
      // is Home's job ("Next step"), not this link's.
      {...(title !== undefined ? { gap: { path: "/scope", label: "Gap assessment", covers: GAP_STEPS.map((s) => s.path) } } : {})}
      groups={groups}
      extra={SERVER_MODE ? [{ path: "/myfiles", label: "My files" }] : []}
      phoneExtra={(close) => (
        <>
          {title !== undefined && <PhoneProject title={title} onPick={close} />}
          {SERVER_MODE && (
            <PhoneAccount
              onChangePassword={() => {
                close();
                setPasswordOpen(true);
              }}
            />
          )}
          <p className="small muted nav-storage">{remote ? STORAGE_PHRASE_SERVER : STORAGE_PHRASE_BROWSER}</p>
        </>
      )}
    />
  );

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <CascadeMark />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </div>
        {narrow ? (
          <div className="header-tools">
            <ThemeMenu />
            {main}
          </div>
        ) : (
          <>
            {main}
            <div className="header-tools">
              {remote && <SaveStatus />}
              {title !== undefined && <ProjectLink title={title} />}
              <ThemeMenu />
              {SERVER_MODE && <AccountMenu onChangePassword={() => setPasswordOpen(true)} />}
            </div>
          </>
        )}
      </header>
      {narrow && remote && <SaveProblem />}
      {SERVER_MODE && passwordOpen && (
        <ChangePasswordDialog onClose={() => setPasswordOpen(false)} restoreFocus={() => document.querySelector<HTMLElement>(".account-btn, .nav-menu-btn")} />
      )}
    </>
  );
}

/** The open project inside the phone Menu panel: the full title (it may wrap) and a line saying where the link goes. */
function PhoneProject({ title, onPick }: { title: string; onPick: () => void }) {
  const descId = useId();
  return (
    <section>
      <p className="nav-panel-head">Project</p>
      <ul className="nav-panel-list">
        <li className="nav-entry">
          <a href={href("/")} className="nav-project" aria-describedby={descId} onClick={onPick}>
            {title}
          </a>
          <span id={descId} className="nav-desc">
            Open the project page, to switch, start or close a project.
          </span>
        </li>
      </ul>
    </section>
  );
}
