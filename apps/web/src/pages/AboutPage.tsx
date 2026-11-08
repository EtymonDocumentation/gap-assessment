import { FILING_CATEGORY_STATEMENT, NOTICE_DOCUMENT, PRODUCT_NAME } from "@gap/engine";
import type { ReactNode } from "react";
import { PageHeader } from "../PageHeader";
import { SERVER_MODE } from "../server/mode";
import { useSession } from "../server/session-store";

/**
 * Which kind of copy of the site this is. It decides what the page can truthfully say about where a person's data goes:
 *  - "browser": the static build (no sign-in, no server for data). Everything stays in this browser.
 *  - "server": a signed-in server whose storage mode is "server". Projects, libraries and files are kept on the server.
 *  - "account": a server whose storage mode is "client". The server holds only the account; projects stay in this browser.
 * Null while a server copy has not yet said which storage mode it uses.
 */
type Copy = "browser" | "server" | "account";

function useCopy(): Copy | null {
  const storage = useSession((s) => s.storage);
  if (!SERVER_MODE) return "browser";
  return storage === "server" ? "server" : storage === "client" ? "account" : null;
}

function Topic({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="card stack" aria-labelledby={`${id}-h`} data-testid={id}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

/** The libraries a person can save, named as the menu and the page titles name them. */
const LIBRARIES = "templates, saved answers, sampling tables, plan subsections, risk methods, process descriptions and step blocks";

/** The browser settings the page code keeps in local storage (gap-theme, gap-getting-started-hidden, gap-sampling-add-mode). */
const SETTINGS = "the colour theme, whether the getting-started tip is hidden, and how you add sampling rows";

/**
 * "About and privacy": the one public page that says what the tool is, who runs this copy, what is stored and where, which cookies are set,
 * that nothing is tracked, how to delete data and how to get access. It opens without signing in (the sign-in screen shows it too).
 *
 * Every statement here is true of the code, not of what a vendor would like to say: the account record (apps/server/src/types.ts), the one
 * cookie (apps/server/src/auth.ts), the audit log (apps/server/src/store.ts), the trash folder and the erased My files (apps/server/src/myfiles.ts),
 * the browser stores (idb-keyval and local storage in apps/web/src). When the code changes, this page has to change with it. The "site owner"
 * is a role; no name or address appears.
 */
export function AboutPage() {
  const copy = useCopy();
  return (
    <div className="stack-lg" data-testid="about-privacy">
      <PageHeader title="About and privacy" purpose={`What ${PRODUCT_NAME} is, who runs this copy, and what happens to what you enter.`} />
      {copy === null ? <p className="muted">Loading…</p> : <AboutBody copy={copy} />}
    </div>
  );
}

function AboutBody({ copy }: { copy: Copy }) {
  const onServer = copy === "server";
  const hasAccount = copy !== "browser";
  return (
    <>
      <Topic id="about-what" title={`What ${PRODUCT_NAME} is`}>
        <p>
          {PRODUCT_NAME} helps you draft GMP transfer documentation. It compares a sending and a receiving unit and lists the gaps, then drafts the documents that follow
          from them: a gap assessment, a technical requirements document (TRD), a sampling plan and a batch record.
        </p>
        <ul className="plain-list stack">
          <li>It is a drafting aid and it is not validated.</li>
          <li>Everything it writes is a draft. Review and approve every document in your own document control system.</li>
          <li>Enter fictional data only. The demo projects are fictional.</li>
          <li>{FILING_CATEGORY_STATEMENT}</li>
        </ul>
        <p className="small muted">Every Word, HTML and Markdown document it produces carries this notice: “{NOTICE_DOCUMENT}”</p>
      </Topic>

      <Topic id="about-who" title="Who runs this copy">
        {hasAccount ? (
          <p>
            This copy is run by the site owner: the person or team that gave you its address. It runs on the computer that hosts this copy, and the site owner can open the
            files stored there. Ask the site owner if you have a question about this page.
          </p>
        ) : (
          <p>
            This copy runs in your browser. {PRODUCT_NAME} does not send what you enter to any server, so there is no account and no one who holds your data. The address
            that serves the page delivers it to you, as any website does.
          </p>
        )}
      </Topic>

      <Topic id="about-stored" title="What is stored, and where">
        {hasAccount && (
          <p>
            <strong>Your account.</strong> The username and display name you chose, your password in scrambled form only (the password itself is never stored), the date the
            account was made, and which parts of {PRODUCT_NAME} it may use. {PRODUCT_NAME} does not ask for an email address.
          </p>
        )}
        {onServer && (
          <p>
            <strong>What you save.</strong> Your projects (saved automatically as you work), {LIBRARIES}, and the files you upload, including everything in My files. All of it is kept on
            the computer that hosts this copy, in folders for your account. Other accounts cannot see it.
          </p>
        )}
        {copy === "account" && (
          <p>
            <strong>What you save.</strong> Your projects and {LIBRARIES} stay in this browser. They are not sent to the server, and My files is not available on this copy.
          </p>
        )}
        {copy === "browser" && (
          <p>
            <strong>What you save.</strong> Your project and {LIBRARIES} are kept in this browser's own storage on this computer. They are not sent anywhere, and they are not
            there if you open {PRODUCT_NAME} in another browser or on another computer. Export project (JSON) on the Home page saves a copy of a project as a file you keep yourself.
          </p>
        )}
        <p>
          <strong>In this browser.</strong> {onServer ? "A copy of each project you have open (one for each tab), so unsaved changes survive a reload or a lost connection, and a few small settings: " : "A few small settings: "}
          {SETTINGS}.
        </p>
        {hasAccount && (
          <p>
            <strong>A security log on the server.</strong> It records when someone signs up, signs in (failed tries too), signs out or changes a password
            {onServer ? ", and when files or projects are uploaded or deleted" : ""}. Each line holds the time, what happened, the username or account number and the network (IP) address
            the request came from. It never holds passwords or invite codes.
            {onServer ? " My files also notes which browser a file was uploaded from, for example “Chrome on Windows”, and shows it in the From column." : ""}
          </p>
        )}
      </Topic>

      <Topic id="about-cookies" title="Cookies">
        {hasAccount ? (
          <p>
            {PRODUCT_NAME} sets one cookie, <code>gap_session</code>. It keeps you signed in. It is set when you sign in or create an account, lasts 14 days and is removed
            when you sign out. It holds a random code, not your password; page scripts cannot read it, and the browser sends it only to this site. {PRODUCT_NAME} sets no other
            cookies.
          </p>
        ) : (
          <p>None. This copy of {PRODUCT_NAME} sets no cookies.</p>
        )}
      </Topic>

      <Topic id="about-tracking" title="Analytics and tracking">
        <p>
          None. {PRODUCT_NAME} has no analytics, no advertising and no tracking, and its pages load no scripts, fonts or images from other websites.{" "}
          {onServer
            ? "The only place what you enter goes is the computer that hosts this copy."
            : copy === "account"
              ? "The only thing sent to the computer that hosts this copy is your account and sign-in details."
              : "What you enter does not leave this browser."}
        </p>
      </Topic>

      <Topic id="about-delete" title="Deleting your data">
        {onServer && (
          <ul className="plain-list stack">
            <li>
              <strong>A project:</strong> choose Delete next to it in My projects, on the Home page. It leaves your list and is moved to a trash folder on the server that only the site owner
              can open. After 30 days the server removes it for good.
            </li>
            <li>
              <strong>A file:</strong> choose Delete next to it in My files. The stored file is erased from the server. A file with an auto-delete date is erased soon after that date (the
              server checks every hour).
            </li>
            <li>
              <strong>A template, saved answers or another library item:</strong> choose Delete on its own page. It goes to the same trash folder as a project, and is removed for good after 30 days.
            </li>
            <li>
              <strong>Your whole account, or anything in the trash you want erased before the 30 days are up:</strong> ask the site owner.
            </li>
          </ul>
        )}
        {copy === "account" && (
          <p>
            Your projects and {LIBRARIES} live only in this browser: delete them in {PRODUCT_NAME}, or clear this site's data in your browser's settings. Your account on the server: ask
            the site owner.
          </p>
        )}
        {copy === "browser" && (
          <p>
            Close and delete on the Home page removes the open project from this browser. Clearing this site's data in your browser's settings removes everything {PRODUCT_NAME} keeps
            here.
          </p>
        )}
      </Topic>

      <Topic id="about-access" title="Getting access">
        {hasAccount ? (
          <p>
            Accounts are by invitation only. Ask the person who invited you for an invite code, then choose Create account on the sign-in page. You pick your own username and
            password.
          </p>
        ) : (
          <p>There is no account to ask for: open the page and start.</p>
        )}
      </Topic>
    </>
  );
}
