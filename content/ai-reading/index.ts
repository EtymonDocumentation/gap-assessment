import { parseAiReading, parseAiSamplingReading } from "@gap/engine";
import exampleTrdRaw from "./example-trd.yaml";
import exampleSamplingRaw from "./example-sampling-plan.yaml";

/**
 * The recorded AI readings of the example finished TRD and the example finished sampling plan. This file is NOT part of content/index.ts:
 * the web app loads it with a dynamic import when someone presses "Try the AI reading on an example ...", so the main script does not
 * carry it.
 */
export const exampleTrdReading = parseAiReading(exampleTrdRaw);
export const exampleSamplingReading = parseAiSamplingReading(exampleSamplingRaw);
