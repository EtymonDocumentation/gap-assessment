import { HEADING_WRITING_PROMPT, type HeadingGroup, type HeadingWriting, type TrdUnitInfo } from "@gap/engine";
import { useState, type Ref } from "react";
import { href } from "../router";
import type { HeadingFollow } from "../trd-heading-follow";
import { InterviewCardBase, type CardCtx, type CardKit, type CardQuestion } from "./InterviewCardBase";

/*
 * The parts of the TRD interview that exist only when it follows the headings of the user's own Word template (M15, job 3A): the writing box
 * of a heading Cascade has nothing for, the notices that say why the interview is in Cascade's own order, the "Not in your template" list
 * and the jump list. They are plain, one-purpose components; the interview page holds the state and does the saving.
 */

// ------------------------------------------------------------------ the writing box

/** The card's view of a writing box: the shared card needs a question, so the box is one (a long text, open until something is written). */
export interface WritingQuestion extends CardQuestion {
  heading: HeadingWriting;
  text: string;
}

export function writingQuestion(w: HeadingWriting): WritingQuestion {
  return {
    key: w.key,
    prompt: HEADING_WRITING_PROMPT,
    why: "Your template has this heading and Cascade has nothing for it. What you write is printed as you write it under this heading in the Word file. Cascade never writes it for you.",
    glossary: [],
    input: "long_text",
    units: [],
    choices: [],
    state: w.text.trim() ? "answered" : "open",
    canTbd: false,
    canNotApplicable: false,
    heading: w,
    text: w.text,
  };
}

/**
 * The card of a heading with no Cascade content: one multi-line box, saved like every other card (on Save, and when focus leaves a finished
 * box), with the same status words and icons. An empty box is open and counts as open. Taking written text away is a confirmed, logged removal
 * (the "Remove this text" button), never a silent save of an empty box.
 */
export function HeadingWritingCard({ w, landsUnder, large, headingRef, onSave, onRemove, onFocusCard, onDontKnow, onSkip }: {
  w: HeadingWriting;
  landsUnder: string;
  large?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Writes the text. Returns the engine's own message when it refuses, or null. */
  onSave: (w: HeadingWriting, text: string) => string | null;
  /** Opens the "why are you removing it" question. */
  onRemove: (w: HeadingWriting) => void;
  onFocusCard?: (key: string) => void;
  onDontKnow?: () => void;
  onSkip?: (key: string) => void;
}) {
  const q = writingQuestion(w);
  const kit: CardKit<WritingQuestion, { text: string }> = {
    status: (x) => (x.state === "answered" ? { icon: "✓", text: "Answered", tone: "done" } : { icon: "○", text: "Open", tone: "open" }),
    prefill: (x) => x.text,
    build: (x, dr) => (dr.value.trim() ? { text: dr.value } : x.text ? "The box is empty. To take the text away, use Remove this text." : "Write the text for this heading, or leave it for later."),
    exitAnswer: () => "This card has no other way to answer.",
    naLabel: "",
    tbdGuess: false,
    afterInput: (x: WritingQuestion, _ctx: CardCtx) =>
      x.text ? (
        <p>
          <button type="button" className="btn small danger" data-testid="iv-remove-text" aria-label={`Remove this text: ${w.headingText}`} onClick={() => onRemove(w)}>
            Remove this text
          </button>
        </p>
      ) : null,
    asideExtra: () => (
      <p className="small iv-lands" data-testid="iv-lands">
        <span className="muted">{landsUnder}</span>
      </p>
    ),
  };
  return (
    <InterviewCardBase<WritingQuestion, { text: string }>
      q={q}
      kit={kit}
      {...(large !== undefined ? { large } : {})}
      {...(headingRef ? { headingRef } : {})}
      onSave={(x, a) => onSave(x.heading, a.text)}
      {...(onDontKnow ? { onDontKnow } : {})}
      {...(onSkip ? { onSkip: (x: WritingQuestion) => onSkip(x.key) } : {})}
      {...(onFocusCard ? { onFocusCard: (x: WritingQuestion) => onFocusCard(x.key) } : {})}
      errorLabel={w.headingText}
    />
  );
}

// ------------------------------------------------------------------ the notices

/** What the interview says when it is not following the template's headings (or only part of them), and the way to fix it. */
export function HeadingNotices({ follow, trdId, needMatching }: { follow: HeadingFollow; trdId: string; needMatching: number }) {
  const matchHref = (templateId: string) => href(`/templates/${templateId}/trd-match`, { trd: trdId });
  if (follow.status === "missing") {
    return (
      <p className="notice" role="status" data-testid="iv-heading-missing">
        The template chosen for this TRD, "{follow.templateName}", is not in the library any more, so the questions are in Cascade's own order. Your answers are kept.{" "}
        <a href={href("/trd", { trd: trdId, tab: "output" })}>Choose a template on the Document tab</a>.
      </p>
    );
  }
  if (follow.status === "no_match") {
    return (
      <div className="notice stack" role="status" data-testid="iv-heading-no-match">
        <p>Match your template's headings and the questions will follow them.</p>
        <p>
          <a className="btn small" href={matchHref(follow.template.id)} data-testid="iv-heading-match-button">
            Match your headings
          </a>
        </p>
      </div>
    );
  }
  if (follow.status === "headings") {
    return (
      <>
        <p className="small" data-testid="iv-heading-follow">
          <span aria-hidden="true">{"✓"}</span> The questions follow the headings of {follow.template.name}.
        </p>
        {needMatching > 0 && (
          <div className="notice stack" role="status" data-testid="iv-heading-again">
            <p>
              {needMatching} {needMatching === 1 ? "heading needs" : "headings need"} matching again, because your template changed. The questions follow what still fits.
            </p>
            <p>
              <a className="btn small" href={matchHref(follow.template.id)} data-testid="iv-heading-match-button">
                Match your headings
              </a>
            </p>
          </div>
        )}
      </>
    );
  }
  return null;
}

// ------------------------------------------------------------------ not in your template

/**
 * The pieces of the TRD that no heading holds and that were not added at the end: they are not asked, and will not be in the Word file. Same
 * place and look as the left-out process steps list ("iv-left-out"). Each can be added at the end of the Word file here, or placed under a
 * heading on the match screen. Nothing is deleted: the answers stay on the TRD. An empty list shows no box at all.
 */
export function NotInTemplate({ units, questionCount, trdId, templateId, onAdd }: {
  units: readonly TrdUnitInfo[];
  /** How many questions each piece has (answers already given are kept). */
  questionCount: ReadonlyMap<string, number>;
  trdId: string;
  templateId: string;
  onAdd: (u: TrdUnitInfo) => void;
}) {
  if (units.length === 0) return null;
  return (
    <div className="iv-left-out" data-testid="iv-not-in-template">
      <p data-testid="iv-not-in-template-count">
        <strong>Not in your template:</strong> {units.length} {units.length === 1 ? "section" : "sections"} of the TRD. They are not asked here and will not be in the Word file unless you add them at the end or place them under a heading.
      </p>
      <ul className="tm-left-list">
        {units.map((u) => {
          const n = questionCount.get(u.id) ?? 0;
          return (
            <li key={u.id} className="tm-left-item iv-nit-item" data-testid={`iv-not-in-template-${u.id}`}>
              <span className="tm-left-name">
                <strong>{u.title}</strong>
                {n > 0 && <span className="muted small"> {n} {n === 1 ? "question" : "questions"} kept, not asked.</span>}
              </span>
              <span className="row wrap">
                <button type="button" className="btn small" data-testid="iv-nit-add" aria-label={`Add at the end: ${u.title}`} onClick={() => onAdd(u)}>
                  Add
                </button>
                <a className="small" href={href(`/templates/${templateId}/trd-match`, { trd: trdId })} aria-label={`Place it under a heading: ${u.title}`}>
                  Place it under a heading
                </a>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Answers you already gave for these are kept.</p>
    </div>
  );
}

/** The pieces added at the end of the Word file, listed inside the "Additional content" group, each with a confirmed, logged "Remove". */
export function AddedBackList({ units, onRemove }: { units: readonly TrdUnitInfo[]; onRemove: (u: TrdUnitInfo) => void }) {
  return (
    <ul className="tm-left-list" aria-label="Added at the end of the Word file" data-testid="iv-added-back">
      {units.map((u) => (
        <li key={u.id} className="tm-left-item iv-nit-item" data-testid={`iv-added-${u.id}`}>
          <span className="tm-left-name">
            <strong>{u.title}</strong>
          </span>
          <span>
            <button type="button" className="btn small danger" data-testid="iv-added-remove" aria-label={`Remove from the end: ${u.title}`} onClick={() => onRemove(u)}>
              Remove
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ the jump list

/**
 * The list of the groups on this page in order, each a button that scrolls to the group and puts the cursor on its heading. Buttons rather than
 * "#" links, because the app's own address holds everything after the hash. Each entry says how many of its questions are answered, in words.
 */
export function JumpList({ items, onJump }: { items: readonly { id: string; title: string; text: string }[]; onJump: (id: string) => void }) {
  // Open on a wide screen, closed on a phone where the list would push the questions out of view.
  const [open, setOpen] = useState(() => (typeof window === "undefined" || !window.matchMedia ? true : window.matchMedia("(min-width: 700px)").matches));
  if (items.length < 2) return null;
  return (
    <details className="iv-jump" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="iv-jump">
      <summary>Jump to a heading ({items.length})</summary>
      <ol className="iv-jump-list">
        {items.map((g) => (
          <li key={g.id}>
            <button type="button" className="linklike" data-testid={`iv-jump-${g.id}`} onClick={() => onJump(g.id)}>
              {g.title}
            </button>{" "}
            <span className="muted small">{g.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** The one-line count of a group for the jump list and its heading. */
export function groupCountText(c: { total: number; answered: number }, group: Pick<HeadingGroup, "state">): string {
  if (c.total === 0 && group.state === "nothing") return "nothing to answer";
  if (c.total === 0 && group.state === "kept_text") return "your template's text stays";
  return `${c.answered} of ${c.total} answered`;
}
