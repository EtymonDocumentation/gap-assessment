import type { Actor, GapOverlay, GapStatus, Project, Severity } from "@gap/process-model";

export class OverlayError extends Error {}

export interface OverlayPatch {
  owner?: string;
  status?: GapStatus;
  notes?: string;
  /** Set to null to remove an override. A new override requires a non-empty justification. */
  severityOverride?: { value: Severity; justification: string } | null;
}

/** Records user decisions on a derived gap. Severity overrides require a justification. */
export function setGapOverlay(project: Project, gapKey: string, patch: OverlayPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const existing = next.gapOverlays.find((o) => o.gapKey === gapKey);
  const o: GapOverlay = existing ?? { gapKey, status: "open" };
  const before = structuredClone(o);
  if (patch.owner !== undefined) {
    if (patch.owner.trim()) o.owner = patch.owner.trim();
    else delete o.owner;
  }
  if (patch.status) o.status = patch.status;
  if (patch.notes !== undefined) {
    if (patch.notes.trim()) o.notes = patch.notes.trim();
    else delete o.notes;
  }
  if (patch.severityOverride === null) delete o.severityOverride;
  else if (patch.severityOverride) {
    if (!patch.severityOverride.justification.trim()) {
      throw new OverlayError("A severity change requires a justification");
    }
    o.severityOverride = {
      value: patch.severityOverride.value,
      justification: patch.severityOverride.justification.trim(),
      by: actor.name,
      at: actor.at,
    };
  }
  o.updatedBy = actor.name;
  o.updatedAt = actor.at;
  if (!existing) next.gapOverlays.push(o);
  next.changeLog.push({ at: actor.at, by: actor.name, action: "gap_update", path: gapKey, before, after: structuredClone(o) });
  return next;
}
