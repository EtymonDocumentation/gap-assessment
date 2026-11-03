import { useEffect, useRef, type KeyboardEvent } from "react";
import { useDisclosure } from "./disclosure";
import { href } from "./router";
import { startTour, tourAvailable } from "./tour";

/**
 * The Help (?) button's three entries, shared by the header menu (wide screens) and the end of the phone Menu panel, so both say the same
 * thing. Each entry is offered only where it works: the tour on a page that has one with elements on screen, "About this page" on a page
 * that has that section. An absent entry is better than a dead one.
 *
 * Read from the page at the moment the menu is drawn (a menu draws when it opens), so the answer is never stale.
 */
function useHelpEntries(routePath: string, open: boolean) {
  const tour = open && tourAvailable(routePath);
  const about = open && !!document.querySelector('[data-tour="page-about"]');
  return { tour, about };
}

/** Opens the page header's "About this page" section, scrolls to it and puts focus on its button. */
export function openAboutThisPage(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-tour="page-about"]');
  if (!toggle) return;
  if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
  const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
  // Scrolling after the click lets the section draw first; reduced-motion users get a jump rather than a slide.
  window.setTimeout(() => {
    (panel ?? toggle).scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    toggle.focus({ preventScroll: true });
  }, 0);
}

/** The "?" icon. Decorative: the button's name is "Help". */
function HelpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.6-2.4 2-2.4 3.6" />
      <path d="M12 17.3h.01" />
    </svg>
  );
}

/**
 * The Help (?) button in the dark header, left of the theme button. An ARIA menu button like the Export menu: Enter, Space or the
 * arrow keys open it onto the first entry, the arrows move (Home and End jump), Escape closes it and returns focus to the button, and
 * choosing an entry closes it.
 */
export function HelpMenu({ routePath }: { routePath: string }) {
  const { open, setOpen, id, wrap, button, onKeyDown: onEscape, onBlur } = useDisclosure();
  const list = useRef<HTMLUListElement>(null);
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  const entries = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const have = useHelpEntries(routePath, open);

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
    const at = all.indexOf(document.activeElement as HTMLElement);
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
    // The menu is gone before the tour or the section is drawn, so neither is measured with the menu on top of it.
    window.setTimeout(action, 0);
  };

  return (
    <div className="header-menu" ref={wrap} onKeyDown={onEscape} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="icon-btn"
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onKeyDown={onButtonKey}
        onClick={(e) => {
          // A click made with the keyboard (Enter or Space) has no pointer position; it lands on the first entry, as a menu button should.
          if (!open && e.detail === 0) focusOnOpen.current = "first";
          setOpen(!open);
        }}
        data-testid="help-menu-button"
      >
        <HelpIcon />
      </button>
      <div id={id} className="header-popover help-popover" hidden={!open}>
        {open && (
          <ul ref={list} role="menu" aria-label="Help" className="help-menu-list" onKeyDown={onMenuKey}>
            {have.tour && (
              <li role="none">
                <button type="button" role="menuitem" className="help-menu-item" onClick={choose(startTour)} data-testid="help-tour">
                  Tour of this page
                </button>
              </li>
            )}
            <li role="none">
              <a role="menuitem" className="help-menu-item" href={href("/glossary")} onClick={() => setOpen(false)} data-testid="help-glossary">
                Glossary
              </a>
            </li>
            {have.about && (
              <li role="none">
                <button type="button" role="menuitem" className="help-menu-item" onClick={choose(openAboutThisPage)} data-testid="help-about">
                  About this page
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The same three entries at the end of the phone Menu panel (a separate bar icon would crowd the 390 px bar, which already holds the mark,
 * the name, the theme button and Menu). `onPick` closes the panel.
 */
export function PhoneHelp({ routePath, onPick }: { routePath: string; onPick: () => void }) {
  const have = useHelpEntries(routePath, true);
  const choose = (action: () => void) => () => {
    onPick();
    window.setTimeout(action, 0);
  };
  return (
    <section>
      <p className="nav-panel-head">Help</p>
      <ul className="nav-panel-list">
        {have.tour && (
          <li>
            <button type="button" className="nav-action" onClick={choose(startTour)} data-testid="help-tour">
              Tour of this page
            </button>
          </li>
        )}
        <li>
          <a href={href("/glossary")} onClick={onPick} data-testid="help-glossary">
            Glossary
          </a>
        </li>
        {have.about && (
          <li>
            <button type="button" className="nav-action" onClick={choose(openAboutThisPage)} data-testid="help-about">
              About this page
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
