import { buildDemoProject } from "@gap/engine";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "@gap/content";
import type { Project } from "@gap/process-model";

/** The three fictional demos (SYR-305 comes twice: finished, and part-way through the transfer): the script in content/demo and the one name every button, message and heading uses. */
export type DemoId = keyof typeof demos;
export const DEMO_NAMES: Record<DemoId, string> = {
  "arx-217": "ARX-217 vials",
  "syr-305": "SYR-305 syringe",
  "syr-305-mid": "SYR-305 mid-transfer",
};

/** The title the demo project carries in My projects (the button name above is not the project title). */
export function demoProjectTitle(id: DemoId): string {
  return (demos[id] as { demo: { title: string } }).demo.title;
}

/**
 * Builds a whole demo project (gap assessment, TRD, sampling plan, batch record, risk assessment). This takes several seconds, which is why the page
 * asks for it through demo-run.ts: the same function runs in a Web Worker there, so the page stays alive while it works.
 */
export function buildDemo(id: DemoId): Project {
  return buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
}
