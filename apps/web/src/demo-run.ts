import type { Project } from "@gap/process-model";
import { buildDemo, type DemoId } from "./demo-build";

type WorkerReply = { ok: true; project: Project } | { ok: false; error: string; stack?: string };

/**
 * Lets the page paint before heavy work starts. A requestAnimationFrame callback runs just before the next paint, so the timeout inside it
 * runs after that paint: the "Building the demo" line is on screen before anything blocks. (A hidden tab never paints and may pause
 * requestAnimationFrame, so a timeout is the backstop.)
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 100);
  });
}

/**
 * Builds a demo project in a Web Worker so the page stays responsive. If the worker cannot start or fails (a locked-down browser, an old one),
 * the same function runs on the page's own thread instead: slower for the user, never different in result.
 */
export function buildDemoAway(id: DemoId): Promise<Project> {
  if (typeof Worker === "undefined") return Promise.resolve(buildDemo(id));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./demo-worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(buildDemo(id));
      return;
    }
    const onPage = () => {
      worker.terminate();
      try {
        resolve(buildDemo(id));
      } catch (e) {
        reject(e);
      }
    };
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.project);
      else {
        console.error(e.data.stack);
        reject(new Error(e.data.error));
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      onPage();
    };
    worker.postMessage({ id });
  });
}
