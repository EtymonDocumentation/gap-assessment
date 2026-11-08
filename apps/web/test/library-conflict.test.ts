import type { SavedAnswerSet } from "@gap/process-model";
import { beforeEach, describe, expect, it, vi } from "vitest";

// CR-10 on the web side: a library save carries the stamp the browser last saw, and a refusal from the server (409 "conflict") shows the newer
// version instead of leaving the person's out-of-date copy on screen. Saved answer sets stand for all four libraries, which share the pattern.
// Fictional data only.

const h = vi.hoisted(() => ({ put: [] as unknown[][], list: [] as unknown[], rejectPut: null as Error | null }));

vi.mock("idb-keyval", () => ({ createStore: () => ({}), del: async () => undefined, set: async () => undefined, values: async () => [] }));
vi.mock("../src/server/mode", () => ({ SERVER_MODE: true }));
vi.mock("../src/server/session-store", () => ({ afterSessionEnds: () => undefined, remoteStorage: () => true }));
vi.mock("../src/server/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/api")>()),
  listSavedAnswers: async () => structuredClone(h.list),
  putSavedAnswers: async (...args: unknown[]) => {
    h.put.push(args);
    if (h.rejectPut) throw h.rejectPut;
    return { set: args[1] };
  },
  createSavedAnswers: async () => ({ id: "new-id" }),
}));

const stored = (name: string, updatedAt: string): SavedAnswerSet =>
  ({
    format: "gap-saved-answers",
    formatVersion: 1,
    id: "set-1",
    name,
    savedAt: "2026-11-01T09:00:00.000Z",
    sourceProject: "Demo project (fictional)",
    sides: "source",
    answers: [],
    updatedAt,
  }) as SavedAnswerSet;

beforeEach(() => {
  h.put = [];
  h.rejectPut = null;
  h.list = [stored("First (fictional)", "2026-11-01T10:00:00.000Z")];
  vi.resetModules();
});

async function openStore() {
  const { useSavedAnswers } = await import("../src/saved-answers-store");
  await useSavedAnswers.getState().load();
  return useSavedAnswers;
}
const stampIn = (s: unknown) => (s as { updatedAt?: string }).updatedAt;

describe("saved answer sets: saving from an out-of-date copy (CR-10)", () => {
  it("sends the stamp it last saw with a change, and stamps the new copy", async () => {
    const store = await openStore();
    await store.getState().rename("set-1", "Renamed (fictional)");
    expect(h.put).toHaveLength(1);
    const [id, sent, base] = h.put[0]!;
    expect(id).toBe("set-1");
    expect(base).toBe("2026-11-01T10:00:00.000Z");
    expect(stampIn(sent)).not.toBe(base);
    // The copy kept in the list carries the new stamp, so the next change is compared with what the server now holds.
    expect(stampIn(store.getState().items[0])).toBe(stampIn(sent));
  });

  it("shows the newer version and says so when the server refuses the save", async () => {
    const store = await openStore();
    const { ApiError } = await import("../src/server/api");
    // Another computer saved first: the server now holds a newer set, and refuses this change.
    h.list = [stored("Changed on the other computer (fictional)", "2026-11-01T10:05:00.000Z")];
    h.rejectPut = new ApiError(409, "conflict", "This saved answer set was changed somewhere else, so your change was not saved.");
    await expect(store.getState().rename("set-1", "My change (fictional)")).rejects.toThrow();
    const s = store.getState();
    expect(s.items.map((x) => x.name)).toEqual(["Changed on the other computer (fictional)"]);
    expect(s.error).toMatch(/changed on another computer, so your change was not saved/);
    expect(s.error).toMatch(/Make your change again/);
    expect(s.error).not.toMatch(/must|error|required|validate/i);
  });

  it("keeps the ordinary message for any other failure", async () => {
    const store = await openStore();
    const { ApiError } = await import("../src/server/api");
    h.rejectPut = new ApiError(0, "network", "The server cannot be reached.");
    await expect(store.getState().rename("set-1", "Renamed (fictional)")).rejects.toThrow();
    expect(store.getState().error).toMatch(/could not be saved on the server/);
    expect(store.getState().items[0]!.name).toBe("First (fictional)");
  });
});
