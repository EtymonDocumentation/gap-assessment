import { config } from "zod";
import { SERVER_MODE } from "./mode";

/**
 * The server sends a Content Security Policy without `unsafe-eval`. The schema library (zod) normally tests whether the
 * browser allows `new Function`; the test is caught, but the browser still reports it as a policy violation. Telling it
 * up front not to compile validators avoids the test (validation is the same, only a little slower).
 * Imported first in main.tsx so it runs before any schema is used. The static build does nothing here.
 */
if (SERVER_MODE) config({ jitless: true });
