import { glossary } from "@gap/content";
import { useEffect, useId, useState } from "react";
import { PageHeader } from "../PageHeader";
import { href } from "../router";

const byId = new Map(glossary.map((t) => [t.id, t]));

/** The element id of a term, so a link can land on it (the page address already uses #, so the anchor is a query: #/glossary?term=nor). */
const termId = (id: string) => `term-${id}`;

/**
 * The glossary: the words of the app in plain language, alphabetical, with a box that narrows the list as you type (a plain text match
 * on the word and its definition; there is no search engine). Open it from the Help (?) menu or the footer. It needs no project.
 * A link such as #/glossary?term=nor scrolls to that term and marks it, so other pages can point at a word.
 */
export function GlossaryPage({ params }: { params: URLSearchParams }) {
  const [filter, setFilter] = useState("");
  const inputId = useId();
  const target = params.get("term") ?? "";
  const q = filter.trim().toLowerCase();
  const shown = q ? glossary.filter((t) => t.term.toLowerCase().includes(q) || t.short.toLowerCase().includes(q)) : glossary;

  // Arriving at a term: show every term (a filter could hide it), then scroll to it and give it focus so a keyboard or screen reader
  // user lands there too. The wait lets the app shell finish its own scroll-to-top on a page change first.
  useEffect(() => {
    if (!target || !byId.has(target)) return;
    setFilter("");
    const timer = window.setTimeout(() => {
      const el = document.getElementById(termId(target));
      if (!el) return;
      el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      el.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [target]);

  return (
    <div className="stack-lg" data-testid="glossary">
      <PageHeader title="Glossary" purpose="The words used in the app and the documents, in plain language." />
      <section className="card stack">
        <div className="field">
          <label htmlFor={inputId}>Filter the terms</label>
          <input id={inputId} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" placeholder="Type a word, for example PAR" data-testid="glossary-filter" />
        </div>
        <p className="small muted" role="status" data-testid="glossary-count">
          {q ? `${shown.length} of ${glossary.length} terms` : `${glossary.length} terms`}
        </p>
        {shown.length === 0 ? (
          <p className="empty">No term matches “{filter.trim()}”. Clear the box to see all terms.</p>
        ) : (
          <dl className="glossary-list">
            {shown.map((t) => (
              <div key={t.id} className={t.id === target ? "glossary-term is-target" : "glossary-term"}>
                <dt id={termId(t.id)} tabIndex={-1} data-testid={`term-${t.id}`}>
                  {t.term}
                </dt>
                <dd>
                  <p>{t.short}</p>
                  {t.see.length > 0 && (
                    <p className="small muted">
                      See also:{" "}
                      {t.see.map((s, i) => (
                        <span key={s}>
                          {i > 0 && ", "}
                          <a href={href("/glossary", { term: s })}>{byId.get(s)!.term}</a>
                        </span>
                      ))}
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
