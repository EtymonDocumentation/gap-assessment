import { samplingSuggestions } from "@gap/content";
import { emptyExpectedListDoc, withExpectedList, type EffectiveSuggestions, type ExpectedListDoc } from "@gap/engine";
import { createStore, get, set } from "idb-keyval";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage, useSession } from "./server/session-store";

/**
 * The account's "Expected studies" list (which catalog entries the design review's D2 treats as expected), with its versions and
 * history. Library data like the sampling tables: not part of a project file. Static build: this browser's IndexedDB. Server build: one
 * file per account on the laptop server (module "sampling"). Until the account saves a version, the shipped `expected: true` marks apply.
 */

const db = createStore("gap-expected-studies", "doc");
const KEY = "list";
const onServer = () => SERVER_MODE && remoteStorage();

interface State {
  doc: ExpectedListDoc;
  ready: boolean;
  error: string | null;
  load(): Promise<void>;
  /** Stores the whole document (a new version, a reset or a removal). Keeps the page's copy only if storing worked. */
  commit(next: ExpectedListDoc): Promise<void>;
}

export const useExpectedStudies = /* @__PURE__ */ create<State>((setState, getState) => ({
  doc: emptyExpectedListDoc(),
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    // An account without the sampling module has no such list (and the server would refuse): the shipped marks stay.
    if (SERVER_MODE && !(remoteStorage() && useSession.getState().user?.plan.modules.includes("sampling"))) return;
    try {
      const raw = (onServer() ? await api.getExpectedStudies() : await get<ExpectedListDoc>(KEY, db)) as Partial<ExpectedListDoc> | null | undefined;
      setState({ doc: { versions: raw?.versions ?? [], removed: raw?.removed ?? [] }, ready: true, error: null });
    } catch (e) {
      // The shipped marks stay in force (the check still runs); the page says why the account's list could not be read.
      setState({ ready: true, error: `The expected studies list could not be read ${onServer() ? "from the server" : "from this browser"}: ${(e as Error).message}` });
    }
  },

  async commit(next) {
    try {
      if (onServer()) await api.putExpectedStudies(next);
      else await set(KEY, next, db);
      setState({ doc: next, error: null });
    } catch (e) {
      setState({ error: `The expected studies list could not be saved ${onServer() ? "on the server" : "in this browser"}: ${(e as Error).message}.` });
      throw e;
    }
  },
}));

/** The catalog with the account's expected list applied. Not a hook: for code that runs outside a component (the chain status). */
export const effectiveSuggestions = (doc: ExpectedListDoc = useExpectedStudies.getState().doc): EffectiveSuggestions => withExpectedList(samplingSuggestions, doc);

/**
 * The same, for components. Loads the list once, so every screen that runs D2 (design review, Overview count, chain, document, Process
 * view) sees the account's list as soon as it is read, and again whenever it is saved.
 */
export function useEffectiveSuggestions(): EffectiveSuggestions {
  const doc = useExpectedStudies((s) => s.doc);
  const load = useExpectedStudies((s) => s.load);
  useEffect(() => void load(), [load]);
  return useMemo(() => effectiveSuggestions(doc), [doc]);
}

if (SERVER_MODE) afterSessionEnds(() => useExpectedStudies.setState({ doc: emptyExpectedListDoc(), ready: false, error: null }));
