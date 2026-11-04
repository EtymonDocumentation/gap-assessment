import type { GapImportSession } from "@gap/engine";
import { createHeldStore } from "./held-store";

/** The file just read for "Upload a gap assessment", held in memory between the button and the review screen (never stored). */
export interface HeldGapImport {
  session: GapImportSession;
  file: File;
}

const store = createHeldStore<HeldGapImport>();
export const holdGapImport = store.hold;
export const useHeldGapImport = store.useHeld;
