import type { Category, Gap } from "@gap/engine";
import type { Severity } from "@gap/process-model";
import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { CATEGORY_SHORT, SEVERITY_TEXT } from "./lib";

/** Category marker. Colour is never the only cue: the label is always shown. */
export function CategoryChip({ category, compact }: { category: Category; compact?: boolean }) {
  return (
    <span className={`chip cat-${category}`} title={CATEGORY_SHORT[category]}>
      <span className="chip-dot" aria-hidden="true" />
      {compact && category === "equivalent" ? "Equal" : CATEGORY_SHORT[category]}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  if (severity === "none") return <span className="sev sev-none">—</span>;
  return <span className={`sev sev-${severity}`}>{SEVERITY_TEXT[severity]}</span>;
}

export function RegulatoryFlag({ gap }: { gap: Pick<Gap, "regulatoryNote"> }) {
  if (!gap.regulatoryNote) return null;
  return (
    <span className="reg" title={gap.regulatoryNote}>
      RA
      <span className="visually-hidden"> — {gap.regulatoryNote}</span>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={description ? "dialog-desc" : undefined}>
          <Dialog.Title className="dialog-title">{title}</Dialog.Title>
          {description && (
            <Dialog.Description id="dialog-desc" className="muted">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Asks for the responder's name and role. Free text; not a login and not attributable in a GMP sense. */
export function ResponderForm({
  initial,
  submitLabel,
  onSubmit,
  withTitle,
}: {
  initial?: { name: string; role?: string };
  submitLabel: string;
  onSubmit: (v: { name: string; role?: string; title?: string }) => void;
  withTitle?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [err, setErr] = useState("");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (withTitle && !title.trim()) return setErr("Enter a project title.");
        if (!name.trim()) return setErr("Enter the responder's name.");
        onSubmit({ name: name.trim(), ...(role.trim() ? { role: role.trim() } : {}), ...(withTitle ? { title: title.trim() } : {}) });
      }}
    >
      {withTitle && (
        <label className="field">
          <span>Project title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Program X transfer (fictional)" autoFocus />
        </label>
      )}
      <label className="field">
        <span>Responder name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!withTitle} autoComplete="name" />
      </label>
      <label className="field">
        <span>
          Role <span className="muted">(optional)</span>
        </span>
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. MSAT engineer" />
      </label>
      <p className="muted small">
        Recorded as free text on every answer. This proof of concept has no login, so answers are not attributable in a GMP sense.
      </p>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
      <div className="row end">
        <button type="submit" className="btn primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
