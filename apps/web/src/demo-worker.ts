import { buildDemo, type DemoId } from "./demo-build";

/**
 * Web Worker entry: builds one demo project away from the page. On the page itself the build froze every button for 3 to 6 seconds (the longest
 * task in the whole app); here the page keeps painting and answering while the worker works. The worker is a plain function call wrapped in a
 * message, so a browser that cannot start it gets the same project from demo-run.ts on the page's own thread.
 */
const scope = self as unknown as { onmessage: ((e: MessageEvent<{ id: DemoId }>) => void) | null; postMessage(message: unknown): void };

scope.onmessage = (e) => {
  try {
    scope.postMessage({ ok: true, project: buildDemo(e.data.id) });
  } catch (err) {
    scope.postMessage({ ok: false, error: (err as Error).message, stack: (err as Error).stack?.slice(0, 1200) });
  }
};
