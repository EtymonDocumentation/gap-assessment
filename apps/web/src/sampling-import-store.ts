import type { SamplingImportSession } from "@gap/engine";
import { createHeldStore } from "./held-store";

/** The file just read for "Upload a sampling plan", held in memory between the button and the review screen (never stored). */
export interface HeldSamplingImport {
  session: SamplingImportSession;
  file: File;
}

const store = createHeldStore<HeldSamplingImport>();
export const holdSamplingImport = store.hold;
export const useHeldSamplingImport = store.useHeld;
