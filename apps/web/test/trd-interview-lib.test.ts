import { applyTrdAnswer, createTrd, deriveTrdQuestions } from "@gap/engine";
import { content, trdInterviewWording, trdWriteups } from "@gap/content";
import { emptyProject } from "@gap/process-model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultInterviewShow, nextIndex, placeInterviewTab, readKept, readLast, sequencePosition, trdIsEmpty, writeKept, writeLast } from "../src/trd-interview-lib";

const who = { name: "Tester (fictional)", at: "2026-11-05T09:00:00.000Z" };
const blank = () => {
  const p = emptyProject({ title: "Test project", actor: who, contentRefs: content.versions });
  const steps = content.catalog.unitOperations.slice(0, 2).map((u) => ({ unitOp: u.key, label: u.label }));
  const r = createTrd(p, { title: "Blank (fictional)", start: { kind: "blank", steps }, library: trdWriteups }, who);
  return { project: r.project, trdId: r.trdId };
};

describe("tab placement and the default view", () => {
  it("puts the Interview tab first for an empty TRD and after the first tab otherwise", () => {
    expect(placeInterviewTab(["details", "process", "open"], "interview", true)).toEqual(["interview", "details", "process", "open"]);
    expect(placeInterviewTab(["details", "process", "open"], "interview", false)).toEqual(["details", "interview", "process", "open"]);
    expect(placeInterviewTab([], "interview", false)).toEqual(["interview"]);
  });

  it("calls a blank TRD empty (everything shown) and one with an answer not empty (only what is open)", () => {
    const { project, trdId } = blank();
    const d = project.trd.documents.find((x) => x.id === trdId)!;
    expect(trdIsEmpty(d)).toBe(true);
    expect(defaultInterviewShow(d)).toBe("all");
    const qs = deriveTrdQuestions(project, trdId, { content, wording: trdInterviewWording });
    const q = qs.find((x) => x.target.kind === "detail" && x.input === "text");
    expect(q).toBeDefined();
    const r = applyTrdAnswer(project, trdId, q!, { kind: "value", value: "Example" }, who, { content, library: trdWriteups });
    if (r.error) throw new Error(r.error);
    const d2 = r.project.trd.documents.find((x) => x.id === trdId)!;
    expect(trdIsEmpty(d2)).toBe(false);
    expect(defaultInterviewShow(d2)).toBe("open");
  });
});

describe("one question at a time", () => {
  const { project, trdId } = blank();
  const qs = deriveTrdQuestions(project, trdId, { content, wording: trdInterviewWording });

  it("counts a question inside its own step", () => {
    const p = sequencePosition(qs, 0)!;
    expect(p.n).toBe(1);
    expect(p.of).toBe(qs.filter((x) => x.stepKey === qs[0]!.stepKey).length);
    expect(sequencePosition(qs, qs.length + 3)).toBeUndefined();
  });

  it("moves forward and back past skipped questions and says -1 at either end", () => {
    expect(nextIndex(qs, 0, 1, new Set())).toBe(1);
    expect(nextIndex(qs, 0, 1, new Set([qs[1]!.key]))).toBe(2);
    expect(nextIndex(qs, 0, -1, new Set())).toBe(-1);
    expect(nextIndex(qs, qs.length - 1, 1, new Set())).toBe(-1);
  });
});

describe("browser storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the Keep marks and the last question per project and TRD", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } });
    writeKept("P1", "T1", new Set(["a", "b"]));
    expect([...readKept("P1", "T1")].sort()).toEqual(["a", "b"]);
    expect(readKept("P1", "T2").size).toBe(0);
    writeLast("P1", "T1", "detail:site");
    expect(readLast("P1", "T1")).toBe("detail:site");
    expect(readLast("P2", "T1")).toBeUndefined();
  });

  it("works without storage: nothing throws, nothing is remembered", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom } });
    expect(() => writeKept("P", "T", new Set(["a"]))).not.toThrow();
    expect(readKept("P", "T").size).toBe(0);
    expect(() => writeLast("P", "T", "x")).not.toThrow();
    expect(readLast("P", "T")).toBeUndefined();
  });
});
