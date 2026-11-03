import { NOTICE_FOOTER, NOTICE_STRIP, NOTICE_STRIP_PHONE, PROVISIONAL_LABEL, type Category, type Gap } from "@gap/engine";
import type { Severity } from "@gap/process-model";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { categoryShort, SEVERITY_TEXT } from "./lib";
import { href } from "./router";
import { useStageWording } from "./store";
import { useNarrow } from "./viewport";

/** Category marker. Colour is never the only cue: the label is always shown. */
export function CategoryChip({ category, compact }: { category: Category; compact?: boolean }) {
  const text = categoryShort(useStageWording().sourceValidated)[category];
  return (
    <span className={`chip cat-${category}`} title={text}>
      <span className="chip-dot" aria-hidden="true" />
      {compact && category === "equivalent" ? "Equal" : text}
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

/**
 * "Provisional — based on a TBD value": shown wherever a result depends on a TBD best guess. Words, not colour, so it reads
 * the same in print and for screen readers.
 */
export function ProvisionalFlag({ item }: { item: { provisional?: boolean | undefined } }) {
  if (!item.provisional) return null;
  return <span className="tag tag-provisional">{PROVISIONAL_LABEL}</span>;
}

/**
 * The permanent notice strip at the top of every screen, the sign-in page included. The words come from one shared module (the same
 * wording is printed in every Markdown, HTML and Word document). On a phone the strip is the short form; where the data lives is then
 * said in the menu instead. Only one form is in the page at a time (see useNarrow).
 */
export function NoticeStrip({ storage }: { storage?: string }) {
  const phone = useNarrow();
  return (
    <div className="notice-strip" role="note" data-testid="notice-strip">
      {phone ? (
        NOTICE_STRIP_PHONE
      ) : (
        <>
          {NOTICE_STRIP}
          {storage && <span className="notice-storage"> · {storage}</span>}
        </>
      )}
    </div>
  );
}

/**
 * The foot of every screen: the strip wording in full (a phone only shows the short form at the top) and the filing-category statement, then
 * the link to the About and privacy page, which opens without signing in.
 */
export function NoticeFooter() {
  return (
    <footer className="app-footer" data-testid="notice-footer">
      <p className="app-footer-text">{NOTICE_FOOTER}</p>
      <p className="app-footer-links">
        <a href={href("/glossary")}>Glossary</a>
        {" · "}
        <a href={href("/about")}>About and privacy</a>
      </p>
    </footer>
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
  restoreFocus,
  wide,
  focusDialog,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Returns the element that should get focus when the dialog closes (default: the previously focused element). */
  restoreFocus?: () => HTMLElement | null;
  /** A wider dialog for lists and tables. */
  wide?: boolean;
  /**
   * Focus the dialog itself on open instead of its first control. Used where the first control is one of several answers: a focus
   * ring on it looks like a preselected answer, and the tool never preselects answers.
   */
  focusDialog?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={wide ? "dialog wide" : "dialog"}
          aria-describedby={description ? "dialog-desc" : undefined}
          onOpenAutoFocus={
            focusDialog
              ? (e) => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement | null)?.focus();
                }
              : undefined
          }
          onCloseAutoFocus={(e) => {
            const el = restoreFocus?.();
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
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
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. process engineer" />
      </label>
      <p className="muted small">
        Recorded as free text on every answer. This tool has no electronic signature, so answers are not attributable in a GMP sense.
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

/**
 * A name edited where it is shown: one text field with Save and Cancel (Enter saves, Escape cancels). `save` returns the problem to show
 * beside the field, or null once the name is saved. Used to rename a project in the "My projects" list and on the Home page.
 */
export function InlineRename({
  current,
  label,
  save,
  onClose,
}: {
  current: string;
  /** What is being renamed, for the field's hidden label. */
  label: string;
  save: (title: string) => string | null | Promise<string | null>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(current);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const problem = await save(value);
      if (problem) {
        setError(problem);
        input.current?.focus();
      } else {
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="rename-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <label className="visually-hidden" htmlFor={`${id}-name`}>
        New name for {label}
      </label>
      <input
        id={`${id}-name`}
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <button type="submit" className="btn small primary" disabled={busy}>
        Save
      </button>
      <button type="button" className="btn small" onClick={onClose}>
        Cancel
      </button>
      {error && (
        <p className="error rename-error" role="alert" id={`${id}-error`}>
          {error}
        </p>
      )}
    </form>
  );
}

const VERIF_ICON = { verified: "✓", withdrawn: "⚠", unverified: "○", partial: "◐" } as const;

/** Verification state as an icon plus words, so colour is never the only cue. */
export function VerificationBadge({ state, text }: { state: keyof typeof VERIF_ICON; text: string }) {
  return (
    <span className={`verif verif-${state}`}>
      <span className="verif-icon" aria-hidden="true">
        {VERIF_ICON[state]}
      </span>
      <span>{text}</span>
    </span>
  );
}

/**
 * Who is verifying. Free text, prefilled with the current responder. When the verifier recorded the entry,
 * an explicit confirmation is required (four-eyes), and the record then says so.
 */
export function VerifierFields({
  name,
  role,
  onName,
  onRole,
  selfNeeded,
  self,
  onSelf,
  selfLabel = "I am verifying my own entry",
}: {
  name: string;
  role: string;
  onName: (v: string) => void;
  onRole: (v: string) => void;
  selfNeeded: boolean;
  self: boolean;
  onSelf: (v: boolean) => void;
  selfLabel?: string;
}) {
  return (
    <>
      <label className="field">
        <span>Verifier name</span>
        <input value={name} onChange={(e) => onName(e.target.value)} autoComplete="name" autoFocus />
      </label>
      <label className="field">
        <span>
          Role <span className="muted">(optional)</span>
        </span>
        <input value={role} onChange={(e) => onRole(e.target.value)} placeholder="e.g. QA (quality assurance)" />
      </label>
      {selfNeeded && (
        <div className="na-box">
          <p className="small">The verifier recorded this entry. A second person should normally verify it.</p>
          <label className="check">
            <input type="checkbox" checked={self} onChange={(e) => onSelf(e.target.checked)} />
            <span>{selfLabel}</span>
          </label>
        </div>
      )}
      <p className="muted small">
        Recorded as free text. This tool has no electronic signature, so the verifier is not attributable in a GMP sense.
      </p>
    </>
  );
}
