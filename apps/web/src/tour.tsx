import { tours, type Tour } from "@gap/content";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PHONE_WIDTH, useNarrow } from "./viewport";

/**
 * The short guided tour of a page. One small bubble at a time points at a real element of the page (found by its data-tour="..." id),
 * with Back, Next (Done on the last step) and Skip tour. The page behind it stays usable: nothing is covered by a full-screen layer and
 * focus is never trapped. The words live in content/help/tours.yaml.
 *
 * A tour starts by itself once, the first time a page is opened in a browser, and can be replayed from the Help (?) menu.
 */

/** Browser storage key prefix; one key per page tour, so seeing one page's tour never hides another's. */
const SEEN_PREFIX = "gap-tour-seen:";
/** A test (or a person with an automated browser) turns the automatic start on with this key; see autoStartAllowed. */
export const TOUR_FORCE_KEY = "gap-tour-force";
const START_EVENT = "gap-tour-start";

/** The tour that belongs to a page, if it has one. */
export const tourFor = (path: string): Tour | undefined => tours.find((t) => t.path === path);

const anchorOf = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
/** An anchor that is on screen: present and laid out (a hidden or collapsed element has no size). */
const anchorShown = (id: string): HTMLElement | null => {
  const el = anchorOf(id);
  return el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0) ? el : null;
};

/** True when the page has at least one step whose element is on screen now (the Help menu only offers the tour then). */
export const tourAvailable = (path: string): boolean => !!tourFor(path)?.steps.some((s) => anchorShown(s.anchor));

/** Opens the tour of the current page now (Help menu), whether or not it was seen before. */
export function startTour(): void {
  window.dispatchEvent(new CustomEvent(START_EVENT));
}

/** Storage that really works. If it does not (private window, blocked), nobody gets an automatic tour, so no one meets it on every visit. */
function storageWorks(): boolean {
  try {
    localStorage.setItem("gap-tour-probe", "1");
    localStorage.removeItem("gap-tour-probe");
    return true;
  } catch {
    return false;
  }
}

function hasSeen(id: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + id) !== null;
  } catch {
    return true;
  }
}

function markSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_PREFIX + id, "1");
  } catch {
    /* storage unavailable: the tour was only shown because the person asked for it */
  }
}

/**
 * Whether a tour may start by itself. Automated browsers (navigator.webdriver is true under Playwright) never get one unless the test
 * sets TOUR_FORCE_KEY: the many existing end-to-end checks open every page in a fresh browser and would otherwise meet a tour bubble on
 * each, and a real person's browser is never marked that way.
 */
function autoStartAllowed(): boolean {
  if (!storageWorks()) return false;
  if (navigator.webdriver) {
    try {
      return localStorage.getItem(TOUR_FORCE_KEY) === "1";
    } catch {
      return false;
    }
  }
  return true;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Mounted once in the app shell. Renders nothing unless a tour is running. */
export function TourHost({ routePath }: { routePath: string }) {
  const [run, setRun] = useState<{ tour: Tour; index: number } | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const runRef = useRef(run);
  runRef.current = run;

  const close = useCallback(() => {
    setRun(null);
    const back = returnTo.current;
    returnTo.current = null;
    // Focus goes back to where it was, unless that element is gone (the page changed under the tour).
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }, []);

  // The first step whose element is on screen, searching from `from` in direction `dir`; -1 when none is left.
  const nextShown = useCallback((tour: Tour, from: number, dir: 1 | -1): number => {
    for (let i = from; i >= 0 && i < tour.steps.length; i += dir) if (anchorShown(tour.steps[i]!.anchor)) return i;
    return -1;
  }, []);

  const begin = useCallback(
    (tour: Tour): boolean => {
      const first = nextShown(tour, 0, 1);
      if (first < 0) return false;
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      markSeen(tour.id);
      setRun({ tour, index: first });
      return true;
    },
    [nextShown],
  );

  // A tour belongs to its page: leaving the page ends it.
  useEffect(() => {
    setRun(null);
    returnTo.current = null;
  }, [routePath]);

  // The first visit: start by itself once the page has drawn its elements (a page may still be loading, so look for a moment).
  useEffect(() => {
    const tour = tourFor(routePath);
    if (!tour || hasSeen(tour.id) || !autoStartAllowed()) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (begin(tour) || tries >= 12) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [routePath, begin]);

  // The Help menu's "Tour of this page".
  useEffect(() => {
    const on = () => {
      const tour = tourFor(routePath);
      if (tour) begin(tour);
    };
    window.addEventListener(START_EVENT, on);
    return () => window.removeEventListener(START_EVENT, on);
  }, [routePath, begin]);

  // Escape skips the tour (unless something else already used the key, such as an open "?" note).
  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [run, close]);

  if (!run) return null;
  return <Bubble tour={run.tour} index={run.index} nextShown={nextShown} onIndex={(i) => setRun({ tour: run.tour, index: i })} onClose={close} />;
}

function Bubble({
  tour,
  index,
  nextShown,
  onIndex,
  onClose,
}: {
  tour: Tour;
  index: number;
  nextShown: (tour: Tour, from: number, dir: 1 | -1) => number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const phone = useNarrow(PHONE_WIDTH);
  const step = tour.steps[index]!;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const prev = nextShown(tour, index - 1, -1);
  const next = nextShown(tour, index + 1, 1);
  const last = next < 0;
  // "Step N of M" counts only the steps that are on screen, so a skipped step never leaves a gap in the numbering.
  const shown = tour.steps.map((s, i) => (anchorShown(s.anchor) ? i : -1)).filter((i) => i >= 0);
  const at = shown.indexOf(index) + 1;

  // Outline the element and bring it into view. Smooth scrolling only when the person has not asked for less motion.
  useEffect(() => {
    const el = anchorShown(step.anchor);
    if (!el) return;
    el.classList.add("tour-target");
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.5;
    el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    return () => el.classList.remove("tour-target");
  }, [step.anchor]);

  // Focus moves into the bubble when the tour opens (not on each step, so a keyboard user stays on Next).
  // Not before the bubble is placed: it is hidden until then, and a hidden element cannot take focus.
  const focused = useRef(false);
  const placed = phone || pos !== null;
  useEffect(() => {
    if (!placed || focused.current) return;
    focused.current = true;
    box.current?.focus({ preventScroll: true });
  }, [placed]);

  // Place the bubble next to its element, clamped to the viewport as HelpTip does. On a phone the CSS docks it to the bottom instead.
  const place = useCallback(() => {
    const el = anchorShown(step.anchor);
    const b = box.current;
    if (!el || !b || phone) return;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(360, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const h = b.offsetHeight;
    let top: number;
    if (r.bottom + 12 + h <= vh) top = r.bottom + 12;
    else if (r.top - 12 - h >= 0) top = r.top - 12 - h;
    // A very tall element leaves no room beside it: dock the bubble at the bottom edge instead of covering the element's start.
    else top = Math.max(8, vh - h - 16);
    setPos({ left, top, width });
  }, [step.anchor, phone]);

  useLayoutEffect(() => {
    place();
  }, [place, index]);
  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-title"
      aria-describedby="tour-text"
      tabIndex={-1}
      className={phone ? "tour-bubble tour-docked" : "tour-bubble"}
      style={!phone && pos ? { left: pos.left, top: pos.top, width: pos.width } : !phone ? { visibility: "hidden" } : undefined}
      data-testid="tour-bubble"
    >
      <p className="tour-count small muted" data-testid="tour-count">
        Step {at} of {shown.length}
      </p>
      <h2 id="tour-title" className="tour-title">
        {step.title}
      </h2>
      <p id="tour-text" className="tour-text">
        {step.text}
      </p>
      <div className="tour-actions">
        {prev >= 0 && (
          <button type="button" className="btn" onClick={() => onIndex(prev)}>
            Back
          </button>
        )}
        <button type="button" className="btn primary" onClick={() => (last ? onClose() : onIndex(next))}>
          {last ? "Done" : "Next"}
        </button>
        {!last && (
          <button type="button" className="btn ghost" onClick={onClose}>
            Skip tour
          </button>
        )}
      </div>
    </div>
  );
}
