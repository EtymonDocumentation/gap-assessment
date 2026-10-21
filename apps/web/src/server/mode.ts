/**
 * Server mode. True only in the build made with `npm run build:server` (vite --mode server), which the laptop
 * server serves. In the static build (GitHub Pages) this is the literal `false`, so every server code path is
 * removed by the bundler and the app makes no network calls.
 *
 * Always write the check as `SERVER_MODE && ...` so the bundler can fold it.
 */
export const SERVER_MODE: boolean = import.meta.env.VITE_SERVER_MODE === "1";
