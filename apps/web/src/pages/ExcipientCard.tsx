import type { ExcipientAnswer, ExcipientQuestion } from "@gap/engine";
import type { Source } from "@gap/process-model";
import { useState, type Ref } from "react";
import { questionStatus } from "../excipient-ui";
import { InterviewCardBase, type CardCtx, type CardDraft, type CardExitDraft, type CardKit } from "./InterviewCardBase";
import { SourcePicker, type Where } from "./TrdSourcePicker";

export interface ExcipientCardProps {
  q: ExcipientQuestion;
  large?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** The project's source register, for "Where is this written?". */
  sources: Source[];
  /** Writes one answer. Returns the engine's own message when it refuses, or null. */
  onSave: (q: ExcipientQuestion, a: ExcipientAnswer) => string | null;
  onDontKnow?: (q: ExcipientQuestion) => void;
  onSkip?: (q: ExcipientQuestion) => void;
  onFocusCard?: (q: ExcipientQuestion) => void;
}

/**
 * One question of the excipient assessment. The card is the shared one (InterviewCardBase, the same as the technical requirements document's);
 * this file says how an excipient answer is built from what was typed. Nothing is filled in: the boxes start empty and the lists start on
 * "Choose...". "Don't know yet" writes nothing. Messages that refuse an answer are the engine's own plain words, shown beside the question.
 */
export function ExcipientCard({ q, large, headingRef, sources, onSave, onDontKnow, onSkip, onFocusCard }: ExcipientCardProps) {
  // The documents cited for this answer. They belong to the card, not to the draft: a document is encouraged, never needed.
  const [cited, setCited] = useState<{ sourceIds: string[]; locations: Where }>({ sourceIds: [], locations: {} });
  const isClass = q.target.kind === "class";

  const kit: CardKit<ExcipientQuestion, ExcipientAnswer> = {
    status: (x) => questionStatus(x),
    // A typed answer is shown in its box to be edited; a choice starts on "Choose...".
    prefill: (x) => (x.state === "answered" && (x.input === "text" || x.input === "long_text") ? (x.current ?? "") : ""),
    nowText: (x) => (x.state === "answered" && x.current ? `Now in the assessment: ${x.current}` : undefined),
    naLabel: "Why is it not applicable here?",
    tbdGuess: false,
    build(x, d: CardDraft) {
      if (x.target.kind === "class") {
        if (d.value) return { kind: "class", classKey: d.value };
        if (d.ownWords.trim()) return { kind: "class", classLabel: d.ownWords.trim() };
        return "Choose a class or write your own words, or choose Don't know yet.";
      }
      const cite = cited.sourceIds.length ? { sourceIds: cited.sourceIds, locations: cited.locations } : {};
      if (x.input === "multi_choice") return { kind: "value", values: d.values, ...cite };
      if (x.input === "quantity") {
        const n = d.value.trim().replace(",", ".");
        if (!n || !Number.isFinite(Number(n))) return "Enter the amount as a number, for example 12.5.";
        return { kind: "value", amount: Number(n), unit: d.unit, ...cite };
      }
      return { kind: "value", value: d.value, ...cite };
    },
    exitAnswer(_x, kind, d: CardExitDraft) {
      if (kind === "na") return d.reason.trim() ? { kind: "not_applicable", reason: d.reason.trim() } : "Say why this is not applicable here, or choose Don't know yet.";
      return { kind: "tbd", ...(d.owner.trim() ? { owner: d.owner.trim() } : {}), ...(d.due ? { due: d.due } : {}) };
    },
    afterInput: (_x, ctx: CardCtx) =>
      isClass ? null : (
        <details className="small" data-testid="iv-source">
          <summary>Where is this written?{cited.sourceIds.length ? ` (${cited.sourceIds.length} cited)` : " (optional)"}</summary>
          <SourcePicker
            testId="iv-src"
            newKey="iv-src"
            label={q.prompt}
            sources={sources}
            selected={cited.sourceIds}
            locations={cited.locations}
            onChange={(n) => {
              setCited(n);
              ctx.touch();
            }}
          />
        </details>
      ),
    extraExit: { label: "Same as the sending site", testId: "iv-same", applies: (x) => x.canSameAsSending, answer: () => ({ kind: "same_as_sending" }) },
  };

  return (
    <InterviewCardBase
      q={q}
      kit={kit}
      {...(large !== undefined ? { large } : {})}
      {...(headingRef ? { headingRef } : {})}
      onSave={onSave}
      {...(onDontKnow ? { onDontKnow } : {})}
      {...(onSkip ? { onSkip } : {})}
      {...(onFocusCard ? { onFocusCard } : {})}
      errorLabel={q.lineName}
    />
  );
}
