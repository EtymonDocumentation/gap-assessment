import type { ImportSession } from "@gap/engine";
import { createHeldStore } from "./held-store";

/**
 * The file that was just read for "Upload a TRD", held in memory between the button and the review screen. It is never written to
 * storage: closing the tab forgets it, and in browser mode it is never sent anywhere.
 */
export interface HeldImport {
  session: ImportSession;
  /** The file itself, kept only so "Keep a copy in My files" can send it (server mode, when the person ticks it). */
  file: File;
}

const store = createHeldStore<HeldImport>();
export const holdImport = store.hold;
export const useHeldImport = store.useHeld;
