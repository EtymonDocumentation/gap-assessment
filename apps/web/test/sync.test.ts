import { content } from "@gap/content";
import { emptyProject, type Project } from "@gap/process-model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The save layer (apps/web/src/server/sync.ts) with a pretend server and a pretend browser database. Each "tab" is a fresh copy of the module with
// its own sessionStorage, which is how two real tabs differ; the browser database and the server are shared. Fictional data only.

const h = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  server: new Map<string, { project: unknown; revision: number }>(),
  offline: false,
  made: 0,
}));

vi.mock("idb-keyval", () => ({
  get: async (k: string) => h.idb.get(k),
  set: async (k: string, v: unknown) => void h.idb.set(k, structuredClone(v)),
  del: async (k: string) => void h.idb.delete(k),
  keys: async () => [...h.idb.keys()],
}));

const apiError = (status: number, code = "", body: Record<string, unknown> = {}) => Object.assign(new Error(`The server answered ${status}`), { status, code, body });
vi.mock("../src/server/api", () => ({
  createProject: async (project: unknown) => {
    if (h.offline) throw apiError(0, "network");
    const id = `srv-${++h.made}`;
    h.server.set(id, { project: structuredClone(project), revision: 1 });
    return { id, revision: 1, updatedAt: "2026-01-01T00:00:00.000Z" };
  },
  putProject: async (id: string, project: unknown, baseRevision: number) => {
    if (h.offline) throw apiError(0, "network");
    const stored = h.server.get(id);
    if (!stored) throw apiError(404, "not-found");
    if (stored.revision !== baseRevision) throw apiError(409, "conflict", { revision: stored.revision, updatedAt: "2026-01-02T00:00:00.000Z" });
    stored.project = structuredClone(project);
    stored.revision++;
    return { revision: stored.revision, updatedAt: "2026-01-01T00:00:00.000Z" };
  },
  getProject: async (id: string) => {
    if (h.offline) throw apiError(0, "network");
    const stored = h.server.get(id);
    if (!stored) throw apiError(404, "not-found");
    return { id, revision: stored.revision, updatedAt: "2026-01-01T00:00:00.000Z", project: structuredClone(stored.project) };
  },
  deleteProject: async (id: string) => void h.server.delete(id),
  listProjects: async () => [],
}));
vi.mock("../src/server/session-store", () => ({
  currentUserId: () => "user-1",
  beforeSessionEnds: () => undefined,
  afterSessionEnds: () => undefined,
}));
// Making the start version compresses the project; the tests are about saving, so the project is passed through.
vi.mock("@gap/engine", async (importOriginal) => ({ ...(await importOriginal<typeof import("@gap/engine")>()), ensureStartVersion: async (p: unknown) => p }));

const blank = (title: string): Project => emptyProject({ title, actor: { name: "Tester", at: "2026-01-01T00:00:00.000Z" }, contentRefs: content.versions });
const renamed = (p: Project, title: string): Project => ({ ...p, meta: { ...p.meta, title } });
const slots = () => [...h.idb.keys()].filter((k) => k.includes(":p:") || k.includes(":new:"));

interface Tab {
  sync: typeof import("../src/server/sync");
  shown: { project: Project | null; status: string; failed: string[] };
  storage: Map<string, string>;
  id: string;
}

// Web Locks, shared by the pretend tabs: a lock belongs to the tab that was showing when it was asked for, is let go when that tab is closed
// (closeTab), and is handed on to the next request in the line.
const locks = {
  current: "",
  tabs: 0,
  held: new Map<string, { tab: string; free: () => void }>(),
  waiting: new Map<string, { tab: string; run: () => void }[]>(),
};
function fakeLockManager() {
  return {
    request: (name: string, a: unknown, b?: unknown) => {
      const options = typeof a === "function" ? {} : (a as { ifAvailable?: boolean; signal?: AbortSignal });
      const ifAvailable = !!options.ifAvailable;
      const callback = (typeof a === "function" ? a : b) as (lock: { name: string } | null) => unknown;
      const tab = locks.current;
      return new Promise<unknown>((resolve, reject) => {
        const run = () => {
          const entry = {
            tab,
            free: () => {
              if (locks.held.get(name) !== entry) return;
              locks.held.delete(name);
              locks.waiting.get(name)?.shift()?.run();
            },
          };
          locks.held.set(name, entry);
          Promise.resolve(callback({ name })).then(resolve, reject).finally(entry.free);
        };
        if (!locks.held.has(name)) run();
        else if (ifAvailable) Promise.resolve(callback(null)).then(resolve, reject);
        else {
          const place = { tab, run };
          locks.waiting.set(name, [...(locks.waiting.get(name) ?? []), place]);
          options.signal?.addEventListener("abort", () => {
            locks.waiting.set(name, (locks.waiting.get(name) ?? []).filter((w) => w !== place));
            reject(Object.assign(new Error("The request was cancelled."), { name: "AbortError" }));
          });
        }
      });
    },
  };
}
/** The tab is closed (or reloaded): the browser lets go of its locks and drops what it was waiting for. */
function closeTab(t: Tab): void {
  for (const [name, list] of locks.waiting) locks.waiting.set(name, list.filter((w) => w.tab !== t.id));
  for (const entry of [...locks.held.values()]) if (entry.tab === t.id) entry.free();
}

/** Makes the given sessionStorage the one the browser is showing (it is a global, so only one tab at a time can use it). */
const showStorage = (storage: Map<string, string>) =>
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
const focus = (t: Tab) => {
  showStorage(t.storage);
  locks.current = t.id;
};
/** Lets the work a call started without waiting for (tidying up old copies) finish. */
const letItFinish = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

/** A browser tab: a fresh copy of the save layer. `storage` is that tab's sessionStorage (pass the same one to "reload" the tab). */
async function openTab(storage = new Map<string, string>()): Promise<Tab> {
  vi.resetModules();
  showStorage(storage);
  const id = `tab-${++locks.tabs}`;
  locks.current = id;
  const sync = await import("../src/server/sync");
  const shown: Tab["shown"] = { project: null, status: "", failed: [] };
  sync.connect({
    getProject: () => shown.project,
    replace: (p, status) => {
      shown.project = p;
      shown.status = status;
    },
    fail: (m) => void shown.failed.push(m),
  });
  return { sync, shown, storage, id };
}
/** What the person does: types into the open project. */
async function edit(t: Tab, title: string): Promise<void> {
  focus(t);
  t.shown.project = renamed(t.shown.project!, title);
  await t.sync.onLocalChange(t.shown.project);
}
const seed = (title: string): string => {
  const id = `srv-${++h.made}`;
  h.server.set(id, { project: blank(title), revision: 1 });
  return id;
};

beforeEach(() => {
  h.idb.clear();
  h.server.clear();
  h.offline = false;
  h.made = 0;
  locks.tabs = 0;
  locks.held.clear();
  locks.waiting.clear();
  vi.stubGlobal("navigator", { locks: fakeLockManager() });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("starting something new while the open project is not saved (CR-04)", () => {
  it("does nothing when no project is open", async () => {
    const t = await openTab();
    expect(await t.sync.refuseNew()).toBeNull();
  });

  it("saves the open project first, then lets the new one start", async () => {
    const id = seed("Alpha");
    const t = await openTab();
    await t.sync.openProject(id);
    await edit(t, "Alpha edited");
    expect(await t.sync.refuseNew()).toBeNull();
    expect((h.server.get(id)!.project as Project).meta.title).toBe("Alpha edited");
  });

  it("refuses while the save has failed, and keeps the edits in the project and in the browser copy", async () => {
    const id = seed("Alpha");
    const t = await openTab();
    await t.sync.openProject(id);
    h.offline = true;
    await edit(t, "Alpha, typed while offline");
    const why = await t.sync.refuseNew();
    expect(why).toMatch(/could not be saved yet, so no other project can be started yet/);
    expect(why).not.toMatch(/must|error|required|validate/i);
    // The edits are where they were: on screen, and in the browser copy marked as not yet on the server.
    expect(t.shown.project!.meta.title).toBe("Alpha, typed while offline");
    const copy = h.idb.get([...h.idb.keys()].find((k) => k.endsWith(`:p:${id}`))!) as { dirty: boolean; project: Project };
    expect(copy.dirty).toBe(true);
    expect(copy.project.meta.title).toBe("Alpha, typed while offline");
    // Once the server answers again, the same call saves the edits and lets the new project start.
    h.offline = false;
    expect(await t.sync.refuseNew()).toBeNull();
    expect((h.server.get(id)!.project as Project).meta.title).toBe("Alpha, typed while offline");
  });

  it("refuses while the open project has a conflict with a newer version", async () => {
    const id = seed("Alpha");
    const t = await openTab();
    await t.sync.openProject(id);
    // Another computer saves first.
    h.server.get(id)!.revision = 2;
    await edit(t, "Alpha, my edit");
    const why = await t.sync.refuseNew();
    expect(why).toMatch(/changed on another computer/);
    expect(t.shown.project!.meta.title).toBe("Alpha, my edit");
  });
});

describe("one browser copy per project, not one per account (CR-09 a)", () => {
  it("keeps two tabs with two projects apart, also after each tab is reloaded", async () => {
    const a = seed("Project A");
    const b = seed("Project B");
    const tabA = await openTab();
    await tabA.sync.openProject(a);
    const tabB = await openTab();
    await tabB.sync.openProject(b);
    h.offline = true;
    await edit(tabA, "Project A, edited");
    await edit(tabB, "Project B, edited");
    expect(slots()).toHaveLength(2);

    // Reload tab A (same sessionStorage, fresh module): it finds its own project, not the one tab B wrote last.
    closeTab(tabA);
    const reloadedA = await openTab(tabA.storage);
    await reloadedA.sync.restore();
    expect(reloadedA.shown.project!.meta.title).toBe("Project A, edited");
    closeTab(tabB);
    const reloadedB = await openTab(tabB.storage);
    await reloadedB.sync.restore();
    expect(reloadedB.shown.project!.meta.title).toBe("Project B, edited");
  });

  it("reopens the project last worked on in a tab that is opened fresh", async () => {
    const a = seed("Project A");
    const b = seed("Project B");
    const tabA = await openTab();
    await tabA.sync.openProject(a);
    const tabB = await openTab();
    await tabB.sync.openProject(b);
    h.offline = true;
    await edit(tabA, "Project A, edited");
    await edit(tabB, "Project B, edited last");
    // The browser was closed with both tabs open, and is opened again.
    closeTab(tabA);
    closeTab(tabB);
    const fresh = await openTab();
    await fresh.sync.restore();
    expect(fresh.shown.project!.meta.title).toBe("Project B, edited last");
  });

  it("gives a project that was never saved its own slot, and drops that slot once the project has a server copy", async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    h.offline = true;
    tabA.shown.project = blank("New in A");
    tabB.shown.project = blank("New in B");
    await edit(tabA, "New in A, typed");
    await edit(tabB, "New in B, typed");
    expect(slots().filter((k) => k.includes(":new:"))).toHaveLength(2);

    h.offline = false;
    focus(tabA);
    await tabA.sync.flush();
    // A has a server copy now: its copy sits in a slot named after the server id, and B's unsaved copy is untouched.
    expect(slots().filter((k) => k.includes(":p:"))).toHaveLength(1);
    expect(slots().filter((k) => k.includes(":new:"))).toHaveLength(1);
    const reloadedB = await openTab(tabB.storage);
    h.offline = true;
    await reloadedB.sync.restore();
    expect(reloadedB.shown.project!.meta.title).toBe("New in B, typed");
  });

  it("opening another project, closing one and deleting one remove the copies that are no longer needed", async () => {
    const a = seed("Project A");
    const b = seed("Project B");
    const t = await openTab();
    await t.sync.openProject(a);
    expect(slots()).toHaveLength(1);
    await t.sync.openProject(b);
    expect(slots().map((k) => k.split(":p:")[1])).toEqual([b]);
    await t.sync.closeProject();
    expect(slots()).toHaveLength(0);
    expect([...h.idb.keys()].filter((k) => k.endsWith(":last"))).toHaveLength(0);
    // A copy of a project that is deleted without being open is removed too.
    await t.sync.openProject(a);
    await t.sync.closeProject();
    h.idb.set(`gap-assessment:server-cache:user-1:p:${a}`, { projectId: a, revision: 1, dirty: false, project: blank("Project A") });
    await t.sync.deleteProjectById(a);
    expect(slots()).toHaveLength(0);
  });

  it("still reopens a copy written by the version that had one slot per account, and replaces it", async () => {
    const id = seed("Old slot");
    h.idb.set("gap-assessment:server-cache:user-1", { projectId: id, revision: 1, dirty: true, project: blank("Old slot, typed") });
    const t = await openTab();
    await t.sync.restore();
    expect(t.shown.project!.meta.title).toBe("Old slot, typed");
    await edit(t, "Old slot, typed again");
    expect(h.idb.has("gap-assessment:server-cache:user-1")).toBe(false);
    expect(slots()).toHaveLength(1);
  });

  it("never removes a copy that has unsaved changes when it tidies up old ones", async () => {
    const a = seed("Project A");
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
    h.idb.set("gap-assessment:server-cache:user-1:p:gone-clean", { projectId: "gone-clean", revision: 1, dirty: false, project: blank("Clean"), at: old });
    h.idb.set("gap-assessment:server-cache:user-1:p:gone-dirty", { projectId: "gone-dirty", revision: 1, dirty: true, project: blank("Dirty"), at: old });
    h.idb.set("gap-assessment:server-cache:user-1:p:young-clean", { projectId: "young-clean", revision: 1, dirty: false, project: blank("Young"), at: Date.now() });
    const t = await openTab();
    await t.sync.openProject(a);
    const reload = await openTab(t.storage);
    await reload.sync.restore();
    await letItFinish();
    const left = slots().map((k) => k.split(":p:")[1] ?? k);
    expect(left).toContain("gone-dirty");
    expect(left).toContain("young-clean");
    expect(left).not.toContain("gone-clean");
  });
});

describe("two tabs of one account never save each other's project (CR-09 c)", () => {
  /** Tab A has Project A open with an edit typed while the server could not be reached, so its browser copy has changes the server lacks. */
  async function tabWithUnsavedEdit(): Promise<{ id: string; tabA: Tab }> {
    const id = seed("Project A");
    const tabA = await openTab();
    await tabA.sync.openProject(id);
    h.offline = true;
    await edit(tabA, "Project A, typed offline");
    h.offline = false;
    return { id, tabA };
  }

  it("a tab opened fresh leaves alone the project another tab is working in, so that tab saves without a false conflict", async () => {
    const { id, tabA } = await tabWithUnsavedEdit();
    const fresh = await openTab();
    await fresh.sync.restore();
    expect(fresh.shown.project).toBeNull();
    await fresh.sync.flush();
    await letItFinish();
    expect(h.server.get(id)!.revision).toBe(1);
    expect(fresh.sync.useSync.getState().projectId).toBeNull();

    // Tab A's save is based on the revision it knows, which nobody has changed.
    focus(tabA);
    await tabA.sync.flush();
    expect(tabA.sync.useSync.getState().phase).toBe("saved");
    expect((h.server.get(id)!.project as Project).meta.title).toBe("Project A, typed offline");
    expect(h.server.get(id)!.revision).toBe(2);
  });

  it("the fresh tab can start its own project meanwhile, and neither tab touches the other's copy", async () => {
    const { id, tabA } = await tabWithUnsavedEdit();
    const tabB = await openTab();
    await tabB.sync.restore();
    tabB.shown.project = blank("Project B");
    await tabB.sync.onLocalChange(tabB.shown.project);
    await tabB.sync.flush();
    const keys = slots();
    expect(keys.some((k) => k.endsWith(`:p:${id}`))).toBe(true);
    expect(keys).toHaveLength(2);

    focus(tabA);
    await tabA.sync.flush();
    expect(tabA.sync.useSync.getState().phase).toBe("saved");
    expect(h.server.get(id)!.revision).toBe(2);
  });

  it("once the other tab is closed, a tab opened fresh takes over its unsaved changes, as before", async () => {
    const { id, tabA } = await tabWithUnsavedEdit();
    closeTab(tabA);
    const fresh = await openTab();
    await fresh.sync.restore();
    expect(fresh.shown.project!.meta.title).toBe("Project A, typed offline");
    await fresh.sync.flush();
    expect((h.server.get(id)!.project as Project).meta.title).toBe("Project A, typed offline");
  });

  it("a tab that is reloaded finds its own project even while the page it replaces still holds the lock", async () => {
    const { id, tabA } = await tabWithUnsavedEdit();
    const reloaded = await openTab(tabA.storage);
    await reloaded.sync.restore();
    expect(reloaded.shown.project!.meta.title).toBe("Project A, typed offline");
    expect(reloaded.sync.useSync.getState().projectId).toBe(id);
  });

  it("a tab that leaves a project keeps the browser copy of it while another tab has the same project open", async () => {
    const a = seed("Project A");
    const b = seed("Project B");
    const tabA = await openTab();
    await tabA.sync.openProject(a);
    const tab2 = await openTab();
    await tab2.sync.openProject(a);
    await tab2.sync.openProject(b);
    expect(slots().map((k) => k.split(":p:")[1]).sort()).toEqual([a, b].sort());
    // When the last tab with it leaves, the copy goes as usual.
    focus(tabA);
    await tabA.sync.openProject(b);
    expect(slots().map((k) => k.split(":p:")[1])).toEqual([b]);
  });

  it("without the Web Locks API a tab opened fresh reopens the last project, as it always did", async () => {
    vi.stubGlobal("navigator", {});
    const { tabA } = await tabWithUnsavedEdit();
    expect(tabA.sync.useSync.getState().projectId).not.toBeNull();
    const fresh = await openTab();
    await fresh.sync.restore();
    expect(fresh.shown.project!.meta.title).toBe("Project A, typed offline");
  });
});

describe("a project deleted on another computer while it is open (CR-09 b)", () => {
  it("is saved again as a new project, and the person is told", async () => {
    const id = seed("Alpha");
    const t = await openTab();
    await t.sync.openProject(id);
    h.server.delete(id);
    await edit(t, "Alpha, edited after it was deleted");
    await t.sync.flush();
    expect(t.shown.failed.join(" ")).toMatch(/removed from the server/);
    expect(t.sync.useSync.getState().phase).not.toBe("error");
    // The next save (the debounce timer) makes the new project from the copy on screen.
    await t.sync.flush();
    const copies = [...h.server.entries()];
    expect(copies).toHaveLength(1);
    expect(copies[0]![0]).not.toBe(id);
    expect((copies[0]![1].project as Project).meta.title).toBe("Alpha, edited after it was deleted");
    expect(t.sync.useSync.getState().projectId).toBe(copies[0]![0]);
    expect(t.sync.useSync.getState().phase).toBe("saved");
    // The browser copy follows the project to its new id, and nothing is left under the old one.
    expect(slots().map((k) => k.split(":p:")[1])).toEqual([copies[0]![0]]);
  });
});
