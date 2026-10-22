import type { AgencyRequest, SamplingPlan, SamplingPoint } from "@gap/process-model";
import { AGENCY_KIND_LABEL, AGENCY_STATUS_LABEL } from "./labels.js";

/**
 * Agency requests and which points answer them. The tool only records and links; it never says what a request means for a filing
 * or whether an answer is sufficient. "Requires regulatory affairs assessment" is the only wording about a filing, and it is
 * used by other parts of the tool, not here.
 */

export interface AgencyCoverage {
  request: AgencyRequest;
  /** Points that link this request, in plan order. */
  points: SamplingPoint[];
  /** "Answered by SP-005, SP-008" or "No sampling point linked yet". Text, so it is never colour alone. */
  text: string;
}

export const requestTitle = (r: Pick<AgencyRequest, "id" | "reference" | "agency">): string =>
  [r.id, r.reference?.trim() ? r.reference.trim() : "", r.agency.trim()].filter(Boolean).join(", ");

export function agencyCoverage(plan: SamplingPlan): AgencyCoverage[] {
  return plan.agencyRequests.map((request) => {
    const points = plan.points.filter((p) => p.agencyRequestIds?.includes(request.id));
    return { request, points, text: points.length ? `Linked to ${points.map((p) => p.id).join(", ")}` : "No sampling point linked yet" };
  });
}

/** Open items about the register: the question is unanswered, or a request that is still open has no point behind it. */
export function agencyOpenItems(plan: SamplingPlan): { ref: string; kind: "plan" | "agency"; text: string }[] {
  const items: { ref: string; kind: "plan" | "agency"; text: string }[] = [];
  if (plan.agencyRequests.length === 0 && plan.noAgencyRequests !== true) {
    items.push({ ref: "plan", kind: "plan", text: "Not yet stated whether agency requests or answers refer to PPQ samples or studies. Add them, or say there are none." });
  }
  for (const c of agencyCoverage(plan)) {
    const r = c.request;
    if (!r.agency.trim()) items.push({ ref: r.id, kind: "agency", text: `${r.id}: name the agency.` });
    if (!r.question.trim()) items.push({ ref: r.id, kind: "agency", text: `${r.id}: enter the question as received.` });
    if (!r.status) items.push({ ref: r.id, kind: "agency", text: `${r.id}: choose the status (open, answered or closed).` });
    if (r.status !== "closed" && c.points.length === 0) items.push({ ref: r.id, kind: "agency", text: `${r.id}: no sampling point is linked to this ${r.status === "answered" ? "answered" : "open"} request.` });
  }
  return items;
}

/** One line for a request, used in the CMO export and the reporting instructions. */
export function requestLine(r: AgencyRequest): string {
  const bits = [r.kind ? AGENCY_KIND_LABEL[r.kind] : "", r.reference?.trim() ? `reference ${r.reference.trim()}` : "", r.dateReceived ? `received ${r.dateReceived}` : "", r.status ? AGENCY_STATUS_LABEL[r.status].toLowerCase() : ""].filter(Boolean);
  return `${requestTitle(r)}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}
