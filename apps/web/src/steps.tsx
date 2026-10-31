import { useMemo } from "react";
import { HelpTip } from "./HelpTip";
import { WhatThisIs } from "./WhatThisIs";
import { GAP_STEPS, stepDone } from "./next-step";
import { href } from "./router";
import { useAssessment, useStore } from "./store";

/** The index of the step a route belongs to, or -1 when the route is not one of the six. */
export function gapStepIndex(path: string): number {
  return GAP_STEPS.findIndex((s) => s.path === path);
}

/**
 * The numbered bar at the top of the six gap assessment pages. A tick appears only where the project data proves the step is done
 * (see stepDone); otherwise there is nothing, so a missing tick never means "not done", only "cannot tell".
 */
export function GapStepBar({ path }: { path: string }) {
  const project = useStore((s) => s.project);
  const a = useAssessment();
  const done = useMemo(() => (project && a ? stepDone(project, a) : {}), [project, a]);
  const at = gapStepIndex(path);
  if (at < 0) return null;
  return (
    <>
    <nav aria-label="Gap assessment steps" className="gap-step-bar">
      <p className="gap-step-compact">
        Step {at + 1} of {GAP_STEPS.length}: <strong>{GAP_STEPS[at]!.label}</strong>
      </p>
      <ol className="gap-step-list">
        {GAP_STEPS.map((s, i) => (
          <li key={s.id}>
            <a href={href(s.path)} aria-current={i === at ? "step" : undefined} data-testid={`step-${s.id}`}>
              <span className="gap-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>{s.label}</span>
              {done[s.id] && (
                <>
                  <span aria-hidden="true" className="gap-step-tick">
                    ✓
                  </span>
                  <span className="visually-hidden"> (done)</span>
                </>
              )}
            </a>
          </li>
        ))}
      </ol>
      <p className="small muted gap-step-help">
        What this step is for
        <HelpTip label={`step ${at + 1}, ${GAP_STEPS[at]!.label}`} text={STEP_HELP[GAP_STEPS[at]!.id]} />
      </p>
    </nav>
      {/* Only on Scope, where the gap assessment starts: on the Interview the form must stay near the top of the
          screen, and the card is remembered per browser, so returning users don't see it again. */}
      {at === 0 && (
        <WhatThisIs id="gap">
          <p>
            A gap assessment compares how a product is made and tested at the sending unit with the receiving unit, question by question, and lists every difference with its source. Nothing is assumed: an unanswered question stays visible.
          </p>
          <p>Next in the chain: the TRD, the sampling plan and the batch record can start from this project. Every stage is optional.</p>
        </WhatThisIs>
      )}
    </>
  );
}

const STEP_HELP: Record<(typeof GAP_STEPS)[number]["id"], string> = {
  scope: "Untick the steps and sections that do not apply to this transfer, so you are not asked about them. Do this first; you can change it later.",
  interview: "Answer the questions for each side, with a source for every answer. Unknown answers stay visible as open items. Use it until the questions that matter are answered.",
  compare: "Shows both sides next to each other, with the kind of difference named for each row. Use it to read the answers as a whole before you rely on the gap register.",
  register: "Lists every difference as a gap you can filter, sort and export. Use it to decide which gaps need action.",
  validation: "Turns the gaps into a validation plan and equipment qualification list. Use it once the register is reviewed.",
  document: "Builds the gap assessment document in Word, HTML, Markdown or PDF. Open TBD items are counted before you download.",
};

/** Back / Next at the foot of each of the six pages. */
export function GapStepFooter({ path }: { path: string }) {
  const at = gapStepIndex(path);
  if (at < 0) return null;
  const prev = GAP_STEPS[at - 1];
  const next = GAP_STEPS[at + 1];
  return (
    <nav aria-label="Previous and next step" className="gap-step-footer no-print">
      {prev ? (
        <a className="btn" href={href(prev.path)} data-testid="step-back">
          ◀ Back: {prev.label}
        </a>
      ) : (
        <span />
      )}
      {next && (
        <a className="btn primary" href={href(next.path)} data-testid="step-next">
          Next: {next.label} ▶
        </a>
      )}
    </nav>
  );
}
