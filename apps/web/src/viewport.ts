import { useEffect, useState } from "react";

/** The width (px) at which the layout switches to the phone form: the menu folds into one button, the notice strip shortens, the chain strip becomes one line. */
export const PHONE_WIDTH = 700;

/**
 * True while the viewport is at most the given width. It is a hook (not a CSS media query that hides a copy) so that only one form of
 * each control is ever in the page: a hidden duplicate would still be found by screen readers, tests and the browser's find-in-page.
 */
export function useNarrow(maxWidth: number = PHONE_WIDTH): boolean {
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
