import { afterEach, describe, expect, it } from "vitest";
import { readGapView, unitFromHash, unitOfSide, writeGapView } from "../src/trd-interview-lib";

// The small helpers of the gap interview map (M14 job 3): the view kept per project in the browser, and the unit an area view follows.

type Store = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
const g = globalThis as unknown as { window?: { localStorage: Store } };

afterEach(() => {
  delete g.window;
});

const memory = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const blocked = (): Store => ({
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
});

describe("the remembered gap map view", () => {
  it("is kept per project and only for the two maps (the list is the default and is never stored)", () => {
    g.window = { localStorage: memory() };
    expect(readGapView("p1")).toBeUndefined();
    writeGapView("p1", "areas");
    writeGapView("p2", "process");
    expect(readGapView("p1")).toBe("areas");
    expect(readGapView("p2")).toBe("process");
    expect(readGapView("p3")).toBeUndefined();
  });

  it("ignores anything else a browser might hold under the key", () => {
    const s = memory();
    g.window = { localStorage: s };
    s.setItem("gap-interview-view:p1", "list");
    expect(readGapView("p1")).toBeUndefined();
    s.setItem("gap-interview-view:p1", "junk");
    expect(readGapView("p1")).toBeUndefined();
  });

  it("works without storage: nothing is read and nothing throws", () => {
    g.window = { localStorage: blocked() };
    expect(readGapView("p1")).toBeUndefined();
    expect(() => writeGapView("p1", "areas")).not.toThrow();
    delete g.window;
    expect(readGapView("p1")).toBeUndefined();
    expect(() => writeGapView("p1", "process")).not.toThrow();
  });
});

describe("the unit an area view follows", () => {
  it("a sending question belongs to the sending unit, a receiving one to the receiving unit, a shared one keeps the unit shown", () => {
    expect(unitOfSide("source", "ru")).toBe("su");
    expect(unitOfSide("target", "su")).toBe("ru");
    expect(unitOfSide("shared", "su")).toBe("su");
    expect(unitOfSide("shared", "ru")).toBe("ru");
    expect(unitOfSide(undefined, "su")).toBe("su");
  });

  it("is read from an address only when it names a unit", () => {
    expect(unitFromHash("#/interview?view=areas&unit=su")).toBe("su");
    expect(unitFromHash("#/trd?trd=TRD-1&unit=ru")).toBe("ru");
    expect(unitFromHash("#/interview?view=areas")).toBeUndefined();
    expect(unitFromHash("#/interview?unit=xx")).toBeUndefined();
    expect(unitFromHash("")).toBeUndefined();
  });
});
