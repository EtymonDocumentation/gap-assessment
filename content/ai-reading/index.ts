import { parseAiReading } from "@gap/engine";
import exampleTrdRaw from "./example-trd.yaml";

/**
 * The recorded AI reading of the example finished TRD. This file is NOT part of content/index.ts: the web app loads it with a dynamic
 * import when someone presses "Try the AI reading on an example TRD", so the main script does not carry it.
 */
export const exampleTrdReading = parseAiReading(exampleTrdRaw);
