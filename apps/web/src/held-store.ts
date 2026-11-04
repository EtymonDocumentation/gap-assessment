import { useSyncExternalStore } from "react";

/**
 * A small in-memory holder for "the file that was just read", between the upload button and its review screen. One holder per kind of
 * upload. Nothing is written to storage: closing the tab forgets it, and in browser mode it is never sent anywhere.
 */
export function createHeldStore<T>() {
  let held: T | null = null;
  const listeners = new Set<() => void>();
  return {
    hold(next: T | null): void {
      held = next;
      listeners.forEach((l) => l());
    },
    useHeld(): T | null {
      return useSyncExternalStore(
        (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        () => held,
      );
    },
  };
}
