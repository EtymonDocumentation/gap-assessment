import type { ImportSession } from "@gap/engine";
import { useSyncExternalStore } from "react";

/**
 * The file that was just read for "Upload a TRD", held in memory between the button and the review screen. It is never written to
 * storage: closing the tab forgets it, and in browser mode it is never sent anywhere.
 */
export interface HeldImport {
  session: ImportSession;
  /** The file itself, kept only so "Keep a copy in My files" can send it (server mode, when the person ticks it). */
  file: File;
}

let held: HeldImport | null = null;
const listeners = new Set<() => void>();

export function holdImport(next: HeldImport | null): void {
  held = next;
  listeners.forEach((l) => l());
}

export function useHeldImport(): HeldImport | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => held,
  );
}
