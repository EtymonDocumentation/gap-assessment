import { projectScopeSteps } from "@gap/engine";
import { href } from "../router";
import { useContent, useStore } from "../store";

/*
 * Ease-of-use pass (EOU-20): the goal "a sampling plan from the TRD" had no visible path. The plan does not store which TRD it came from
 * (it is made from the project: its scope steps, and the established values the TRD also draws on), so this says that in plain words and
 * links to the project's technical requirements documents, on the create form and on the plan itself.
 * Nothing here is a choice and nothing is stored: a link is shown only to a document that exists.
 */
export function PlanSourceNote({ made }: { made: boolean }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const trds = project.trd.documents;
  const steps = made ? 0 : projectScopeSteps(content, project).length;
  return (
    <div className="stack small" data-testid="plan-source-note">
      {made ? (
        <p className="muted">Started from this project's scope and values, the same data the technical requirements document is made from. The plan keeps its own copy of the steps.</p>
      ) : (
        <p className="muted">
          A new plan starts from the {steps === 1 ? "1 step" : `${steps} steps`} in this project's scope, copied once. The technical requirements document is made from the same data, so the two start alike.
        </p>
      )}
      <p data-testid="plan-source-trd">
        {trds.length === 0 ? (
          <>
            This project has no technical requirements document yet. <a href={href("/trd")}>Start a technical requirements document</a> if you want one. The plan does not need it.
          </>
        ) : (
          <>
            {trds.length === 1 ? "Technical requirements document" : "Technical requirements documents"} in this project:{" "}
            {trds.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <a href={href("/trd", { trd: d.id })}>
                  {d.id}: {d.title}
                </a>
              </span>
            ))}
          </>
        )}
      </p>
    </div>
  );
}
