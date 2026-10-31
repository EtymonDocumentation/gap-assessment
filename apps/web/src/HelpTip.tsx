import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * A small "?" button that opens a short explanation. It works by tap, click, Enter or Space (never hover alone, so it works on a
 * phone and with a keyboard); Escape or a tap outside closes it. The button names what it explains ("Help: <label>") and carries
 * aria-expanded and aria-controls. The popover is fixed-positioned and clamped to the viewport, so it stays on screen at 390 px
 * whatever the button's neighbours do. Put it next to a label or button, never inside a <label> (a tap there would toggle the field).
 */
export function HelpTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = `help-${useId().replace(/:/g, "")}`;

  const place = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(320, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const h = pop.current?.offsetHeight ?? 0;
    // Below the button when it fits, else above it.
    const top = r.bottom + 6 + h > vh && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6;
    setPos({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);
  // Second pass once the width is known, so the height used for "above or below" is the real one.
  useLayoutEffect(() => {
    if (open && pos) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos?.width]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  return (
    <span className="help-tip">
      <button ref={btn} type="button" className="help-tip-btn" aria-label={`Help: ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <div ref={pop} id={id} role="note" className="help-tip-pop" style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: "hidden" }} data-testid="help-tip-pop">
          {text}
        </div>
      )}
    </span>
  );
}
