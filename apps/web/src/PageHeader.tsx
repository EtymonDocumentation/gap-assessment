import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { ArtFigure } from "./art";
import { chainStageOf } from "./chain";
import { DocChainStrip, ModuleLibraryLinks } from "./DocChain";
import { useDisclosure } from "./disclosure";
import { pageTrail, type TrailPart } from "./page-trail";
import { href, useRoute } from "./router";
import { GapStepBar, gapStepIndex } from "./steps";
import { useStore } from "./store";

/** A fact the page already computes (open items, record counts). The warning style is for things that still need a person. */
export interface PagePill {
  label: string;
  warning?: boolean;
  testId?: string;
}

/** One download in the Export menu: the same label and the same handler as the button in the page's Output area. */
export interface ExportItem {
  label: string;
  onSelect: () => void;
  testId?: string;
}

/** The page's explanation (what it is, how it fits the chain) and its picture. Shown only when the person asks for it. */
export interface PageAbout {
  /** The picture's key (see art.tsx). Decoration only. */
  art: string;
  children: ReactNode;
  testId?: string;
}

export interface PageHeaderProps {
  /** The page's h1. Leave it out where the page's own h1 is further down (the interview's h1 is the question). */
  title?: ReactNode;
  /** For a page that sends focus to its heading after a dialog closes: the heading's ref and id (it is then focusable by script). */
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
  /** One plain sentence saying what the page is for. Always visible. */
  purpose?: ReactNode;
  purposeTestId?: string;
  pills?: PagePill[];
  /** A line of facts the page already knows ("12 steps · last changed ..."). */
  meta?: ReactNode;
  about?: PageAbout;
  /** The page's own actions, secondary ones first. The Export menu (if any) always comes last, as the primary button. */
  actions?: ReactNode;
  exports?: ExportItem[];
  exportLabel?: string;
  /** The name of the record on screen (a TRD, a plan): it ends the breadcrumb, and the list it belongs to becomes a link. */
  crumb?: string;
  /** Extra class for the wrapper (the interview's grid needs the header to span both columns). */
  className?: string;
  testId?: string;
}

/**
 * The top of a module or library page, the same everywhere: breadcrumb, then the title row (h1, one purpose sentence, status pills,
 * "About this page", and on the right the page's actions with an Export menu), then the document chain strip and the gap steps (which used
 * to sit above the page's banner). A first-time person sees what the page is for, and can start working, without scrolling.
 *
 * Everything on it is something the page already knew: nothing here is a new status or a new action. The explanation ("What this is" and
 * the picture) is behind the "About this page" button, closed on every visit, so it never pushes the work down.
 */
export function PageHeader(props: PageHeaderProps) {
  const { title, titleRef, titleId, purpose, purposeTestId, pills, meta, about, actions, exports, exportLabel = "Export", crumb, className, testId } = props;
  const route = useRoute();
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutId = useId();
  const toggleId = `${aboutId}-toggle`;
  const hasFacts = (pills && pills.length > 0) || !!meta || !!about;
  return (
    <div className={className ? `page-top ${className}` : "page-top"}>
      <header className="page-head" data-testid={testId ?? "page-head"} data-tour="page-head">
        <Crumbs path={route.path} crumb={crumb} />
        <div className="page-head-row">
          <div className="page-head-main">
            {title != null && (
              <h1 ref={titleRef} id={titleId} tabIndex={titleRef ? -1 : undefined}>
                {title}
              </h1>
            )}
            {purpose && (
              <p className="page-head-purpose" data-testid={purposeTestId ?? "page-purpose"}>
                {purpose}
              </p>
            )}
            {hasFacts && (
              <div className="page-head-facts">
                {pills && pills.length > 0 && (
                  <ul className="page-pills" aria-label="At a glance">
                    {pills.map((p) => (
                      <li key={p.label} className={p.warning ? "pill warn" : "pill"} data-testid={p.testId}>
                        {p.label}
                      </li>
                    ))}
                  </ul>
                )}
                {meta && <p className="page-head-meta">{meta}</p>}
                {about && (
                  <button type="button" id={toggleId} className="about-toggle" data-tour="page-about" aria-expanded={aboutOpen} aria-controls={aboutId} onClick={() => setAboutOpen((o) => !o)} data-testid="about-toggle">
                    About this page <span aria-hidden="true">{aboutOpen ? "▴" : "▾"}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          {((exports && exports.length > 0) || actions) && (
            <div className="page-head-actions no-print" data-tour={exports && exports.length > 0 ? "page-export" : undefined}>
              {actions}
              {exports && exports.length > 0 && <ExportMenu items={exports} label={exportLabel} />}
            </div>
          )}
        </div>
        {about && (
          <section id={aboutId} className="about-panel" aria-labelledby={toggleId} hidden={!aboutOpen} data-testid={about.testId ?? "about-panel"}>
            {aboutOpen && (
              <>
                <ArtFigure art={about.art} className="about-art" sizes="(min-width: 700px) 240px, 100vw" />
                <div className="about-text stack">{about.children}</div>
              </>
            )}
          </section>
        )}
      </header>
      <PageStrips />
    </div>
  );
}

/** "Project name > Area > Page": earlier parts link where a page exists, the last part is plain text. */
function Crumbs({ path, crumb }: { path: string; crumb?: string | undefined }) {
  const title = useStore((s) => s.project?.meta.title);
  const trail = pageTrail(path);
  if (!trail) return null;
  const parts: TrailPart[] = [...(trail.project && title ? [{ label: title, path: "/" }] : []), ...trail.parts];
  if (crumb) {
    const last = parts[parts.length - 1]!;
    parts[parts.length - 1] = { ...last, path: last.path ?? path };
    parts.push({ label: crumb });
  }
  return (
    <nav aria-label="Breadcrumb" className="page-crumbs no-print">
      <ol>
        {parts.map((p, i) => {
          const last = i === parts.length - 1;
          return (
            <li key={`${i}-${p.label}`} aria-current={last ? "page" : undefined}>
              {p.path && !last ? <a href={href(p.path)}>{p.label}</a> : p.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The document chain, the numbered gap steps and the module's library buttons, now under the title row instead of above the page. */
function PageStrips() {
  const route = useRoute();
  const project = useStore((s) => s.project);
  if (!project) return null;
  return (
    <>
      {/* The gap pages show only their own six step pills (EOU-06): two strips of six boxes made a first-time reader ask which one to use. The document
          chain stays on Home, on the other documents' pages and in the Documents menu. */}
      {chainStageOf(route.path) !== undefined && chainStageOf(route.path) !== "gap" && <DocChainStrip route={route} />}
      {gapStepIndex(route.path) >= 0 && <GapStepBar path={route.path} />}
      <ModuleLibraryLinks path={route.path} />
    </>
  );
}

/**
 * The primary "Export" button with the page's downloads under it. An ARIA menu: the arrow keys move between the items (Home and End jump),
 * Escape closes it and puts focus back on the button, and so does choosing an item. Opening it with the keyboard puts focus on the first
 * item. A click or tap outside closes it, and so does tabbing away. One item is not a menu, so a page with a single download gets a plain
 * button instead (see the pages).
 */
function ExportMenu({ items, label }: { items: ExportItem[]; label: string }) {
  const { open, setOpen, id, wrap, button, onKeyDown: onEscape, onBlur } = useDisclosure();
  const list = useRef<HTMLUListElement>(null);
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  const entries = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const all = entries();
    (focusOnOpen.current === "first" ? all[0] : all[all.length - 1])?.focus();
    focusOnOpen.current = null;
  }, [open]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    focusOnOpen.current = e.key === "ArrowDown" ? "first" : "last";
    if (open) {
      const all = entries();
      (focusOnOpen.current === "first" ? all[0] : all[all.length - 1])?.focus();
      focusOnOpen.current = null;
    } else setOpen(true);
  };

  const onMenuKey = (e: KeyboardEvent) => {
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

  return (
    <div className="export-menu" ref={wrap} onKeyDown={onEscape} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="btn primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onKeyDown={onButtonKey}
        onClick={(e) => {
          // A click made with the keyboard (Enter or Space) has no pointer position; it lands on the first item, as a menu button should.
          if (!open && e.detail === 0) focusOnOpen.current = "first";
          setOpen(!open);
        }}
        data-testid="export-menu-button"
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul ref={list} id={id} role="menu" aria-label={label} className="export-menu-list" onKeyDown={onMenuKey}>
          {items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="export-menu-item"
                data-testid={it.testId}
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                  it.onSelect();
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * For an Export menu item whose handler lives in a tab that is not on screen: after the page has switched to that tab, move focus to the
 * matching button (found by its data-testid) and bring it into view. The button appears a frame or two later, so this waits for it.
 */
export function focusWhenReady(testId: string): void {
  let tries = 0;
  const look = () => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus();
    } else if (++tries < 30) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
