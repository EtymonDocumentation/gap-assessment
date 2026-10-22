import type { UserInfo } from "./api";

/** Plain-word names for the plan ids the server uses. An id not listed here is shown as it is. */
const PLAN_LABELS: Record<string, string> = { "trial-free": "Trial (free)" };

/** Plain-word names for the module ids an account can hold. An id not listed here is shown as it is. */
const MODULE_LABELS: Record<string, string> = { gap: "Gap assessment", sampling: "Sampling plan" };

export function moduleLabel(id: string): string {
  return MODULE_LABELS[id] ?? id;
}

/** "Gap assessment" or "Gap assessment, Reports"; "none" when the account has no module. */
export function modulesText(modules: readonly string[] | undefined): string {
  return modules && modules.length > 0 ? modules.map(moduleLabel).join(", ") : "none";
}

/** "Trial (free)" for the plan the server calls trial-free. */
export function planText(user: Pick<UserInfo, "plan">): string {
  const name = PLAN_LABELS[user.plan.id] ?? user.plan.id;
  return user.plan.status === "active" ? name : `${name}, ${user.plan.status}`;
}

/** The line in the signed-in header: "Plan: Trial (free) · Modules: Gap assessment". */
export function planLine(user: Pick<UserInfo, "plan">): string {
  return `Plan: ${planText(user)} · Modules: ${modulesText(user.plan.modules)}`;
}
