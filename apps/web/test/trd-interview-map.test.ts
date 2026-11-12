import { afterEach, describe, expect, it } from "vitest";
import { interviewHash, nextNodeWithOpen, nodeIsOpenable, nodeOfQuestion, nodeRunKeys, parseInterviewView, readOne, readView, runStartIndex, writeOne, writeView } from "../src/trd-interview-lib";

// The small pure helpers of the TRD interview maps (M14 job 2): the view, the address, what a node's run holds and the choice kept in the browser.

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

describe("the view", () => {
  it("knows the three views and takes anything else as no view named", () => {
    expect(parseInterviewView("process")).toBe("process");
    expect(parseInterviewView("areas")).toBe("areas");
    expect(parseInterviewView("list")).toBe("list");
    expect(parseInterviewView("map")).toBeUndefined();
    expect(parseInterviewView(null)).toBeUndefined();
    expect(parseInterviewView(undefined)).toBeUndefined();
  });

  it("writes the view and the node into the address and keeps every other parameter", () => {
    expect(interviewHash("#/trd?trd=TRD-001&tab=interview&show=open", "process")).toBe("#/trd?trd=TRD-001&tab=interview&show=open&view=process");
    expect(interviewHash("#/trd?trd=TRD-001&tab=interview", "areas", "area:AR-01")).toBe("#/trd?trd=TRD-001&tab=interview&view=areas&node=area%3AAR-01");
  });

  it("replaces an old view and node, and the list is the plain address", () => {
    expect(interviewHash("#/trd?trd=T&view=process&node=step%3Aa", "areas")).toBe("#/trd?trd=T&view=areas");
    expect(interviewHash("#/trd?trd=T&view=process&node=step%3Aa", "list", "step:a")).toBe("#/trd?trd=T");
  });

  it("sets the parameters it is asked to keep, so a link from a view that lost them still opens the Interview tab", () => {
    expect(interviewHash("#/trd", "process", undefined, { trd: "TRD-002", tab: "interview" })).toBe("#/trd?trd=TRD-002&tab=interview&view=process");
  });
});

describe("the choice kept in the browser, per project and TRD", () => {
  it("remembers the view and the one-at-a-time choice, apart for each TRD", () => {
    g.window = { localStorage: memory() };
    expect(readView("P", "T1")).toBeUndefined();
    expect(readOne("P", "T1")).toBe(false);
    writeView("P", "T1", "areas");
    writeOne("P", "T1", true);
    expect(readView("P", "T1")).toBe("areas");
    expect(readOne("P", "T1")).toBe(true);
    expect(readView("P", "T2")).toBeUndefined();
    expect(readOne("P", "T2")).toBe(false);
    writeOne("P", "T1", false);
    expect(readOne("P", "T1")).toBe(false);
  });

  it("ignores a stored word that is not a view", () => {
    const s = memory();
    s.setItem("gap-trd-interview-view:P:T1", "something else");
    g.window = { localStorage: s };
    expect(readView("P", "T1")).toBeUndefined();
  });

  it("works with the browser storage blocked: nothing is read, nothing is thrown", () => {
    g.window = { localStorage: blocked() };
    expect(readView("P", "T1")).toBeUndefined();
    expect(readOne("P", "T1")).toBe(false);
    expect(() => writeView("P", "T1", "process")).not.toThrow();
    expect(() => writeOne("P", "T1", true)).not.toThrow();
  });

  it("works with no browser storage object at all", () => {
    expect(readView("P", "T1")).toBeUndefined();
    expect(() => writeOne("P", "T1", true)).not.toThrow();
  });
});

describe("a node's run", () => {
  const node = (id: string, keys: string[], open: number, status = "open") => ({ id, questionKeys: keys, counts: { open }, status });

  it("holds the visible questions that belong to the node, in list order", () => {
    expect(nodeRunKeys(["a", "b", "c", "d"], ["d", "b", "x"])).toEqual(["b", "d"]);
    expect(nodeRunKeys([], ["a"])).toEqual([]);
  });

  it("starts at the first open question of the run, or at the first when all are answered", () => {
    expect(runStartIndex(["a", "b", "c"], new Set(["c", "b"]))).toBe(1);
    expect(runStartIndex(["a", "b"], new Set())).toBe(0);
    expect(runStartIndex([], new Set(["a"]))).toBe(0);
  });

  it("finds the node of a question and the next node that still has open questions, going round to the start", () => {
    const nodes = [node("whole", ["w"], 0, "all_answered"), node("step:a", ["a1", "a2"], 2), node("step:b", ["b1"], 0, "all_answered"), node("step:c", ["c1"], 1), node("step:d", [], 0, "left_out")];
    expect(nodeOfQuestion(nodes, "c1")?.id).toBe("step:c");
    expect(nodeOfQuestion(nodes, "zzz")).toBeUndefined();
    expect(nextNodeWithOpen(nodes, "step:a")?.id).toBe("step:c");
    expect(nextNodeWithOpen(nodes, "step:c")?.id).toBe("step:a");
    expect(nextNodeWithOpen(nodes, "whole")?.id).toBe("step:a");
    expect(nextNodeWithOpen([node("x", ["q"], 1)], "x")?.id).toBeUndefined();
    expect(nextNodeWithOpen([node("step:a", ["a"], 0, "all_answered"), node("step:b", ["b"], 0, "all_answered")], "step:a")).toBeUndefined();
  });

  it("opens a node into a run only when it has questions in view and is not left out", () => {
    expect(nodeIsOpenable(node("a", ["q"], 1))).toBe(true);
    expect(nodeIsOpenable(node("a", [], 0, "nothing_to_ask"))).toBe(false);
    expect(nodeIsOpenable(node("a", [], 0, "left_out"))).toBe(false);
  });
});
