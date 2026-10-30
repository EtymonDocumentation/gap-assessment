import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { href } from "./router";

export interface NavItem {
  path: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** A second, smaller list under its own sub-heading (the module libraries). */
  sub?: { heading: string; items: NavItem[] };
}

/**
 * Whether a menu entry covers the current route. Sub-pages keep lighting the entry they belong to (the builder's old /model
 * address, a template's mapping page, each module's library page), as the flat menu did.
 */
export function isCurrentPath(itemPath: string, routePath: string): boolean {
  if (routePath === itemPath) return true;
  if (itemPath === "/builder") return routePath === "/model";
  if (itemPath === "/templates") return /^\/templates\/[^/]+\/mapping$/.test(routePath);
  if (itemPath === "/sampling") return routePath === "/sampling/tables" || routePath === "/sampling/subsections";
  if (itemPath === "/risk") return routePath === "/risk/methods";
  if (itemPath === "/mbr") return routePath === "/mbr/library" || routePath === "/mbr/view";
  if (itemPath === "/trd") return routePath === "/trd/writeups";
  return false;
}

const groupCurrent = (g: NavGroup, routePath: string) => [...g.items, ...(g.sub?.items ?? [])].some((i) => isCurrentPath(i.path, routePath));

/** True while the viewport is at most the given width; the menu collapses into one "Menu" button there. */
function useNarrow(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

function ItemLinks({ items, routePath, onPick }: { items: NavItem[]; routePath: string; onPick: () => void }) {
  return (
    <>
      {items.map((i) => (
        <li key={i.path}>
          <a href={href(i.path)} aria-current={isCurrentPath(i.path, routePath) ? "page" : undefined} onClick={onPick}>
            {i.label}
          </a>
        </li>
      ))}
    </>
  );
}

/** A drop-down made of a real button (aria-expanded / aria-controls) and a list of links. */
function Dropdown({ group, routePath }: { group: NavGroup; routePath: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const focusFirst = useRef(false);
  const current = groupCurrent(group, routePath);

  // Closing on navigation: the route changed, so the list is done with.
  useEffect(() => setOpen(false), [routePath]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const links = () => Array.from(wrap.current?.querySelectorAll<HTMLElement>(".nav-panel a") ?? []);

  useEffect(() => {
    if (open && focusFirst.current) links()[0]?.focus();
    focusFirst.current = false;
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (e.key === "ArrowDown" && !open && e.target === button.current) {
      e.preventDefault();
      focusFirst.current = true;
      setOpen(true);
      return;
    }
    if (!open) return;
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      all[Math.min(at + 1, all.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (at <= 0) button.current?.focus();
      else all[at - 1]?.focus();
    } else if (e.key === "Home" && at >= 0) {
      e.preventDefault();
      all[0]?.focus();
    } else if (e.key === "End" && at >= 0) {
      e.preventDefault();
      all[all.length - 1]?.focus();
    }
  };

  return (
    <li
      ref={wrap}
      className="nav-group"
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Tabbing out of the group closes it. A null target (some browsers do not focus a link on click) is left alone so the click lands.
        if (e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button ref={button} type="button" className={`nav-group-btn${current ? " is-current" : ""}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {group.label}
        <span aria-hidden="true" className="nav-caret">
          {open ? "▴" : "▾"}
        </span>
        {current && <span className="visually-hidden"> (current section)</span>}
      </button>
      <div id={id} className="nav-panel" hidden={!open}>
        {open && (
          <>
            <ul className="nav-panel-list">
              <ItemLinks items={group.items} routePath={routePath} onPick={() => setOpen(false)} />
            </ul>
            {group.sub && group.sub.items.length > 0 && (
              <>
                <p className="nav-panel-sub">{group.sub.heading}</p>
                <ul className="nav-panel-list">
                  <ItemLinks items={group.sub.items} routePath={routePath} onPick={() => setOpen(false)} />
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * The short top menu: Home, Gap assessment, two drop-downs and (on the server) My files. On a phone it folds into one "Menu" button
 * whose panel lists every group, so the page never scrolls sideways.
 */
export function MainNav({ routePath, home, gap, groups, extra }: { routePath: string; home: NavItem; gap: NavItem & { covers: string[] }; groups: NavGroup[]; extra: NavItem[] }) {
  const narrow = useNarrow(700);
  const [menuOpen, setMenuOpen] = useState(false);
  const panelId = useId();
  const menuRef = useRef<HTMLElement>(null);
  useEffect(() => setMenuOpen(false), [routePath]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);

  const gapCurrent = gap.covers.includes(routePath);
  const homeLink = (onPick: () => void) => (
    <li>
      <a href={href(home.path)} aria-current={routePath === home.path ? "page" : undefined} onClick={onPick}>
        {home.label}
      </a>
    </li>
  );
  const gapLink = (onPick: () => void) => (
    <li>
      <a href={href(gap.path)} aria-current={gapCurrent ? "page" : undefined} onClick={onPick}>
        {gap.label}
      </a>
    </li>
  );

  if (narrow) {
    const close = () => setMenuOpen(false);
    return (
      <nav
        aria-label="Main"
        className="nav-narrow"
        ref={menuRef}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !menuOpen) return;
          setMenuOpen(false);
          menuRef.current?.querySelector<HTMLElement>("button")?.focus();
        }}
      >
        <button type="button" className="btn nav-menu-btn" aria-expanded={menuOpen} aria-controls={panelId} onClick={() => setMenuOpen((o) => !o)}>
          Menu <span aria-hidden="true">{menuOpen ? "▴" : "▾"}</span>
        </button>
        <div id={panelId} className="nav-menu-panel" hidden={!menuOpen}>
          {menuOpen && (
            <>
              <ul className="nav-panel-list">
                {homeLink(close)}
                {gapLink(close)}
                <ItemLinks items={extra} routePath={routePath} onPick={close} />
              </ul>
              {groups.map((g) => (
                <section key={g.label}>
                  <p className="nav-panel-head">{g.label}</p>
                  <ul className="nav-panel-list">
                    <ItemLinks items={g.items} routePath={routePath} onPick={close} />
                  </ul>
                  {g.sub && g.sub.items.length > 0 && (
                    <>
                      <p className="nav-panel-sub">{g.sub.heading}</p>
                      <ul className="nav-panel-list">
                        <ItemLinks items={g.sub.items} routePath={routePath} onPick={close} />
                      </ul>
                    </>
                  )}
                </section>
              ))}
            </>
          )}
        </div>
      </nav>
    );
  }

  return (
    <nav aria-label="Main">
      <ul className="nav">
        {homeLink(() => undefined)}
        {gapLink(() => undefined)}
        {groups.map((g) => (
          <Dropdown key={g.label} group={g} routePath={routePath} />
        ))}
        <ItemLinks items={extra} routePath={routePath} onPick={() => undefined} />
      </ul>
    </nav>
  );
}
