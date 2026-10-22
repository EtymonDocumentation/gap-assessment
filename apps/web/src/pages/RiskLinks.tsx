import { pointRef, risksForGap, risksForSamplingPoint, type RiskRef } from "@gap/engine";
import { href } from "../router";
import { useRiskAllowed } from "../risk-module";
import { useStore } from "../store";

/*
 * "In risk assessment RA-###" links shown where a gap or a sampling point is, so traceability reads both ways: the item cites the
 * gap or the point, and the gap or the point shows which items cite it. The data lives on the risk items only (one place), so the two
 * directions can never disagree. Nothing shows without the risk module.
 */

function Links({ refs, prefix, testid }: { refs: RiskRef[]; prefix: string; testid: string }) {
  if (refs.length === 0) return null;
  return (
    <span className="small risk-links" data-testid={testid}>
      {prefix}{" "}
      {refs.map((r, i) => (
        <span key={`${r.assessmentId}-${r.itemId}`}>
          {i > 0 ? ", " : ""}
          <a href={href("/risk", { ra: r.assessmentId, tab: "items" })} aria-label={`Risk item ${r.itemId} in assessment ${r.assessmentId}`}>
            {r.itemId}
          </a>
        </span>
      ))}
    </span>
  );
}

/** For a gap by its display id (G-003). */
export function GapRiskLinks({ gapId }: { gapId: string }) {
  const allowed = useRiskAllowed();
  const project = useStore((s) => s.project)!;
  if (!allowed) return null;
  return <Links refs={risksForGap(project, gapId)} prefix="In risk assessment:" testid={`gap-risk-${gapId}`} />;
}

/** For a sampling point of a plan. */
export function PointRiskLinks({ planId, pointId }: { planId: string; pointId: string }) {
  const allowed = useRiskAllowed();
  const project = useStore((s) => s.project)!;
  if (!allowed) return null;
  return <Links refs={risksForSamplingPoint(project, planId, pointId)} prefix="Linked risk:" testid={`point-risk-${pointRef(planId, pointId)}`} />;
}
