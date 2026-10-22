/** Shapes of the JSON files in the data folder (see the M5.3 contract). */

export interface Plan {
  id: string;
  status: "active";
  since: string;
  /** Which parts of the product the account may use (ids such as "gap"). */
  modules: string[];
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  passwordHash: string;
  createdAt: string;
  disabled?: true;
  plan: Plan;
  /** Most data "My files" may hold for this account, in MB. Absent = no quota set (only the per-file limit applies). */
  filesQuotaMB?: number;
}

/** What the browser may see about a user (never the hash). */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  createdAt: string;
  plan: Plan;
}

export interface InviteRecord {
  codeHash: string;
  role: "admin" | "member";
  createdAt: string;
  expiresAt: string;
  /** Modules the new account gets. Older invites have none, which means ["gap"]. */
  modules?: string[];
  usedBy?: string;
  usedAt?: string;
  revoked?: true;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface FileMeta {
  id: string;
  fileName: string;
  safeName: string;
  size: number;
  sha256: string;
  contentType: string;
  uploadedAt: string;
  projectId?: string;
  sourceId?: string;
}

export const DEFAULT_PLAN_ID = "trial-free";
export const DEFAULT_MODULES: readonly string[] = ["gap"];
export const MODULE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** Turns "gap, other" into ["gap","other"]; returns null when an entry is not a valid module id or the list is empty. */
export function parseModuleList(text: string): string[] | null {
  const parts = text.split(",").map((p) => p.trim().toLowerCase());
  if (parts.length === 0 || parts.length > 20 || parts.some((p) => !MODULE_ID_RE.test(p))) return null;
  return [...new Set(parts)];
}
