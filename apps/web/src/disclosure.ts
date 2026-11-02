import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

/**
 * What a small pop-over opened by a button needs (the theme menu and the account menu in the header): the open state, an id for
 * aria-controls, and the three ways out. A click or tap outside closes it; Escape closes it and puts focus back on the button; tabbing
 * away from it closes it. The panel is a plain disclosure (a button with aria-expanded and a region it controls), not an ARIA "menu",
 * because it holds ordinary controls (radio buttons, buttons) that a menu role would hide from a screen reader.
 */
export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    setOpen(false);
    button.current?.focus();
  };

  // A null related target (some browsers do not focus a clicked control) is left alone, so the click that caused the blur still lands.
  const onBlur = (e: FocusEvent) => {
    if (e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
  };

  return { open, setOpen, id, wrap, button, onKeyDown, onBlur };
}
