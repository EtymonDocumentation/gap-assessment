import { useMemo } from "react";
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
    </nav>
  );
}

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
