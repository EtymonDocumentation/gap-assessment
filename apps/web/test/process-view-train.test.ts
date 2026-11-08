// The drawing of the Process view (the equipment train), checked for a hand-made record: two buffer preparations that feed one step are
// drawn one above the other (they used to share one place and overlap), and the drawing ends where its last row ends (it used to keep
// the height of a full row, which left empty space under the diagram). The drawing is rendered to markup and read back; all data are fictional.
/// <reference types="node" />
import { buildDemoProject, buildProcessView } from "@gap/engine";
import { mbrRecordSchema, type MbrRecord } from "@gap/process-model";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";
import { Train } from "../src/pages/MbrProcessView";

vi.setConfig({ testTimeout: 60000 });

const NOW = "2026-01-01T00:00:00Z";
const block = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, steps: [], params: [], samples: [], timeLimits: [], cmoFields: [], ...over });
const step = (n: number, text: string) => ({ id: `ST-${String(n).padStart(4, "0")}`, text });
const section = (n: number, unitOp: string, title: string, text: string) => ({ id: `SC-0${n}`, unitOp, title, blocks: [block(`BL-00${n}`, title, { steps: [step(n, text)] })] });
const rec = (sections: unknown[]): MbrRecord => mbrRecordSchema.parse({ id: "MBR-009", title: "Hand-made record (fictional)", status: "draft", sections, createdAt: NOW, updatedAt: NOW });

const demo = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const drawn = (r: MbrRecord, at = 0) => renderToStaticMarkup(createElement(Train, { view: buildProcessView({ ...demo, mbr: { records: [r] } }, r), at }));
const SHOTS = join(tmpdir(), "leftovers");

/** The place (top-left corner) of every cell of the drawing, branch or main line, read back from the markup. */
function cells(svg: string) {
  return [...svg.matchAll(/translate\((\d+) (\d+)\)" data-testid="pv-eq-([^"]+)" data-state="[^"]+"( data-branch="true")?/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), id: m[3]!, branch: m[4] !== undefined }));
}
const heightOf = (svg: string) => Number(/<svg [^>]*height="(\d+)"/.exec(svg)![1]);

describe("the train of the Process view", () => {
  const two = rec([
    section(1, "ds_receipt_thaw", "Receipt and thaw", "Thaw the bottles."),
    section(2, "buffer_prep", "Buffer A preparation", "Weigh the salts."),
    section(3, "buffer_prep", "Buffer B preparation", "Weigh the acid."),
    section(4, "compounding", "Compounding and dilution", "Add buffer A and buffer B."),
    section(5, "bbr_filtration", "BBR filtration", "Filter."),
  ]);

  it("draws two buffer preparations that feed one step one above the other, both left of that step, and the main line below them", () => {
    const svg = drawn(two);
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, "train-two-branches.svg"), svg);
    const all = cells(svg);
    const branches = all.filter((c) => c.branch);
    const main = all.filter((c) => !c.branch);
    expect(branches.map((b) => b.id).sort()).toEqual(["EQ-SC-02", "EQ-SC-03"]);
    expect(main.map((m) => m.id)).toEqual(["EQ-SC-01", "EQ-SC-04", "EQ-SC-05"]);
    // Same column (the cell just left of the step they feed), different rows, a whole band row apart, so no part of one is under the other.
    expect(new Set(branches.map((b) => b.x)).size).toBe(1);
    expect(branches[0]!.x).toBe(main.find((m) => m.id === "EQ-SC-04")!.x - 190);
    const [upper, lower] = [...branches].sort((a, b) => a.y - b.y);
    expect(lower!.y - upper!.y).toBeGreaterThanOrEqual(232);
    // The main line starts below the lower branch's band row.
    expect(Math.min(...main.map((m) => m.y))).toBeGreaterThanOrEqual(lower!.y + 232);
  });

  it("draws a branch of a later step above a branch of an earlier step, so an arrow never crosses a branch under it", () => {
    const r = rec([
      section(1, "ds_receipt_thaw", "Receipt and thaw", "Thaw."),
      section(2, "buffer_prep", "Buffer A preparation", "Weigh."),
      section(3, "compounding", "First compounding", "Add buffer A."),
      section(4, "buffer_prep", "Buffer B preparation", "Weigh."),
      section(5, "compounding", "Second compounding", "Add buffer B."),
    ]);
    const svg = drawn(r);
    const branches = cells(svg).filter((c) => c.branch).sort((a, b) => a.y - b.y);
    // Buffer B feeds step 5 (further right), buffer A feeds step 3: the later step's branch is the upper one.
    expect(branches.map((b) => b.id)).toEqual(["EQ-SC-04", "EQ-SC-02"]);
    expect(branches[0]!.x).toBeGreaterThan(branches[1]!.x);
  });

  it("ends the drawing at the bottom of its last row, with the same 10 px margin it has at the top and no empty space", () => {
    const svg = drawn(two);
    const lastRowTop = Math.max(...cells(svg).filter((c) => !c.branch).map((c) => c.y));
    // A cell with no sample markers is 168 px of drawing plus a 6 px margin.
    expect(heightOf(svg)).toBe(lastRowTop + 168 + 6 + 10);
  });

  it("gives each row its own height: a first row with no markers keeps the usual row, the last row is only as tall as its content", () => {
    const eight = rec(Array.from({ length: 8 }, (_, i) => section(i + 1, "ds_receipt_thaw", `Step ${i + 1}`, `Do step ${i + 1}.`)));
    const svg = drawn(eight);
    const ys = [...new Set(cells(svg).map((c) => c.y))];
    expect(ys).toHaveLength(2);
    expect(ys[1]! - ys[0]!).toBe(270);
    expect(heightOf(svg)).toBe(ys[1]! + 168 + 6 + 10);
  });

  it("still draws the syringe demo with its one buffer branch", () => {
    const r = demo.mbr.records[0]!;
    const svg = drawn(r);
    expect(cells(svg).filter((c) => c.branch)).toHaveLength(1);
  });
});
