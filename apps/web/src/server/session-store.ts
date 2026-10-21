import { create } from "zustand";
import * as api from "./api";
import type { UserInfo } from "./api";

/** Who is signed in, and where this server keeps projects. Used only in server mode. */

export type Phase = "loading" | "unreachable" | "signed-out" | "ready";
export type Storage = "server" | "client";

interface SessionState {
  phase: Phase;
  /** Where projects, templates and files live: "server" (on the server) or "client" (in this browser). Known after the health check. */
  storage: Storage | null;
  user: UserInfo | null;
  /** A message for the sign-in page ("Your session has ended..."). */
  notice: string;
  /** Why the server could not be reached. */
  problem: string;
  start(): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  signUp(v: { inviteCode: string; username: string; displayName: string; password: string }): Promise<void>;
  signOut(): Promise<void>;
  /** The session is over (401 or sign out). Other stores clear their in-memory state; browser caches are kept. */
  endSession(notice: string): void;
}

const beforeSignOut: (() => Promise<void>)[] = [];
const afterSessionEnd: (() => void)[] = [];

/** Work to finish before the session is closed (for example saving the open project). */
export function beforeSessionEnds(fn: () => Promise<void>): void {
  beforeSignOut.push(fn);
}
/** Work to do when the session has ended (clear in-memory data). */
export function afterSessionEnds(fn: () => void): void {
  afterSessionEnd.push(fn);
}

export const useSession = /* @__PURE__ */ create<SessionState>((set, get) => ({
  phase: "loading",
  storage: null,
  user: null,
  notice: "",
  problem: "",

  async start() {
    set({ phase: "loading", problem: "" });
    api.onUnauthorized(() => get().endSession("Your session has ended. Sign in again to continue. Your unsaved work is kept in this browser."));
    try {
      const h = await api.health();
      set({ storage: h.storage });
    } catch (e) {
      set({ phase: "unreachable", problem: (e as Error).message });
      return;
    }
    try {
      const { user } = await api.me();
      set({ phase: "ready", user, notice: "" });
    } catch (e) {
      const err = e as api.ApiError;
      if (err.status === 401) set({ phase: "signed-out", user: null });
      else set({ phase: "unreachable", problem: err.message });
    }
  },

  async signIn(username, password) {
    const { user } = await api.login(username, password);
    set({ phase: "ready", user, notice: "" });
  },

  async signUp(v) {
    const { user } = await api.signup(v);
    set({ phase: "ready", user, notice: "" });
  },

  async signOut() {
    for (const fn of beforeSignOut) {
      try {
        await fn();
      } catch {
        /* the work stays in the browser cache */
      }
    }
    try {
      await api.logout();
    } catch {
      /* the cookie is cleared by the server on success; on failure we still leave this screen */
    }
    get().endSession("You have signed out.");
  },

  endSession(notice) {
    if (get().phase !== "ready") return;
    set({ phase: "signed-out", user: null, notice });
    for (const fn of afterSessionEnd) fn();
  },
}));

/** True when projects, templates and files are kept on the server for the signed-in user. */
export function remoteStorage(): boolean {
  const s = useSession.getState();
  return s.phase === "ready" && s.storage === "server";
}

export function currentUserId(): string | null {
  return useSession.getState().user?.id ?? null;
}
