import { pageTrail } from "../page-trail";
import { href } from "../router";
import { ProjectListCard, useIsRemote } from "../server/ServerUi";
import { SERVER_MODE } from "../server/mode";
import { StartChoices } from "./StartChoices";

/** The name a person knows the page by (the last part of its breadcrumb), for the sentence that says what was asked for. */
export function pageName(path: string): string {
  const parts = pageTrail(path)?.parts;
  return parts?.[parts.length - 1]?.label ?? "This page";
}

/**
 * Shown instead of a project page when no project is open. It used to show Home with a one-line notice, so a click on "Sources" or "Change
 * log" looked as if nothing had happened. Now the box names the page that was asked for and puts the ways to get a project right here; once
 * one is open the page that was asked for appears (the address does not change), so nobody has to find their way back to it.
 */
export function NeedsProject({ path }: { path: string }) {
  const remote = SERVER_MODE && useIsRemote();
  const name = pageName(path);
  return (
    <div className="stack-lg">
      <section className="card stack needs-project" aria-labelledby="needs-project-h" data-testid="needs-project">
        <h1 id="needs-project-h">{name} needs an open project</h1>
        <p className="lede" data-testid="needs-project-text">
          {/* The heading already names the page, so this line says what to do and what happens next. This browser keeps one project at a time and has no
              list of projects to open from; only the server keeps a list. */}
          This page works on one project&apos;s answers and documents. Open a demo, start a new project{remote ? ", or open one of your projects (below)" : ""}, and you will come
          straight back to {name}.
        </p>
        <StartChoices stay />
        <p className="small">
          <a href={href("/")}>Go to the Home page</a>
          {remote ? " to see all your projects." : "."}
        </p>
      </section>
      {remote && <ProjectListCard />}
    </div>
  );
}
