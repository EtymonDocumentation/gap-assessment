import { useEffect } from "react";

/**
 * Ease-of-use pass (EOU-22): a plan is created on the plan list and opens at the same address with a plan parameter. The page does not
 * change, so the router's scroll to the top (which runs when the PATH changes) never fires, and the new plan used to open far down the
 * page, level with the old "Create" button, away from its heading and from the header Menu. This puts the person at the top of the page
 * and, when the control they pressed has gone, moves the cursor to the page itself so a keyboard or screen reader user starts at the top too.
 */
export function landAtTop(): void {
  window.scrollTo(0, 0);
  const main = document.getElementById("main");
  if (main && (!main.contains(document.activeElement) || document.activeElement === main)) main.focus({ preventScroll: true });
}

/** Lands at the top whenever `key` changes (the id of the document that has just opened), and once when the page first shows. */
export function useLandAtTop(key: string): void {
  useEffect(() => {
    landAtTop();
  }, [key]);
}
