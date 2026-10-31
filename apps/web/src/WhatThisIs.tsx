import { useState, type ReactNode } from "react";

const key = (id: string) => `gap-whatis-${id}`;
function read(id: string): boolean {
  try {
    return localStorage.getItem(key(id)) !== "closed";
  } catch {
    return true;
  }
}

/**
 * The "What this is" card at the top of an editor page: what the document is, what it needs from earlier in the chain and what
 * comes next. Open the first time; the collapsed or open choice is remembered in this browser only (per document kind), so repeat
 * users are not nagged. Storage can be blocked, so every access is wrapped and the card works without it.
 */
export function WhatThisIs({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => read(id));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(key(id), next ? "open" : "closed");
    } catch {
      /* the choice just is not remembered */
    }
  };
  const bodyId = `whatis-${id}`;
  return (
    <section className="card whatis stack no-print" aria-labelledby={`${bodyId}-h`} data-testid={`whatis-${id}`}>
      <div className="row between wrap">
        <h2 id={`${bodyId}-h`}>What this is</h2>
        <button type="button" className="btn small" aria-expanded={open} aria-controls={bodyId} onClick={toggle} data-testid={`whatis-${id}-toggle`}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <div id={bodyId} className="stack small">
          {children}
        </div>
      )}
    </section>
  );
}
