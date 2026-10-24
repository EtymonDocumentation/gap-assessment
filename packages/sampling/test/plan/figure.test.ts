import { describe, expect, it } from "vitest";
import { buildFigures, clusterPins, figureCaption, FIGURE_STYLES, MIN_FONT_PT, type Figure } from "../../src/index";
import { fixturePlan, fpoint } from "./figure-fixture";

const STYLES = ["time_scale", "step_cards"] as const;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function allPages(figs: Figure[]) {
  return figs.flatMap((f) => f.pages.map((p) => ({ f, p })));
}

describe("figure layout", () => {
  for (const style of STYLES) {
    for (const samples of [0, 12, 24, 40]) {
      it(`${style} with ${samples} samples: nothing overlaps, text at least ${MIN_FONT_PT} pt, legend on each page`, () => {
        const figs = buildFigures(fixturePlan({ samples, buffer: true }), { style });
        expect(figs.length).toBe(2);
        for (const { p } of allPages(figs)) {
          const labelled = p.boxes.filter((b) => b.kind === "pins" || b.kind === "target" || b.kind === "card" || b.kind === "hold" || b.kind === "step");
          for (let i = 0; i < labelled.length; i++)
            for (let j = i + 1; j < labelled.length; j++) {
              const a = labelled[i]!, b = labelled[j]!;
              // A step and the hold or target drawn on top of it may touch by design; labels and sample boxes may not.
              if ((a.kind === "pins" || a.kind === "card") && (b.kind === "pins" || b.kind === "card")) expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false);
              if (a.kind === "target" && b.kind === "target") expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false);
            }
          expect(p.minFontPt).toBeGreaterThanOrEqual(MIN_FONT_PT);
          expect(p.svg).toContain("Process step");
          expect(p.svg).toContain("PPQ sample");
          expect(p.overflow).toBe(false);
        }
      });
    }
  }

  it("every sample on a step is drawn exactly where the sample table can find it (SP ids match)", () => {
    const plan = fixturePlan({ samples: 24 });
    for (const style of STYLES) {
      const [fig] = buildFigures(plan, { style });
      const drawn = new Set(allPages([fig!]).flatMap(({ p }) => p.samples));
      for (const sp of plan.points) expect(drawn.has(sp.id), `${style} ${sp.id}`).toBe(true);
    }
  });

  it("splits a crowded plan over pages with 'Continued on next page' and a legend on each", () => {
    const [fig] = buildFigures(fixturePlan({ samples: 40 }), { style: "step_cards" });
    expect(fig!.pages.length).toBeGreaterThan(1);
    fig!.pages.slice(0, -1).forEach((p) => expect(p.svg).toContain("Continued on next page"));
    expect(fig!.pages.at(-1)!.svg).not.toContain("Continued on next page");
    fig!.pages.forEach((p) => expect(p.svg).toContain("Process step"));
    expect(figureCaption(fig!, 1)).toMatch(/^Figure 1 \(page 2 of \d+\): /);
  });

  it("a one-page figure has a plain caption", () => {
    const [fig] = buildFigures(fixturePlan({ samples: 0, steps: 3 }), { style: "time_scale" });
    expect(fig!.pages).toHaveLength(1);
    expect(figureCaption(fig!, 0)).toMatch(/^Figure 1: /);
  });

  it("routine samples are one short line per step; PPQ samples get a card", () => {
    const plan = fixturePlan({ samples: 0 });
    plan.points = [
      fpoint(1, { type: "ipc", flow: { stepId: "ST-02", at: "after" }, takenAtHour: 40 }),
      fpoint(2, { type: "release", attribute: "Another test", flow: { stepId: "ST-02", at: "after" }, takenAtHour: 42 }),
      fpoint(3, { flow: { stepId: "ST-02", at: "after" }, takenAtHour: 44 }),
    ];
    const [fig] = buildFigures(plan, { style: "step_cards" });
    const svg = fig!.pages.map((p) => p.svg).join("");
    expect(svg.match(/Routine:/g)).toHaveLength(1);
    expect(svg).toContain("(SP-001,");
    expect(svg).toContain("SP-002)");
    expect(fig!.pages[0]!.boxes.filter((b) => b.kind === "card" && b.id === "SP-003")).toHaveLength(1);
    expect(fig!.pages[0]!.boxes.filter((b) => b.kind === "card" && (b.id === "SP-001" || b.id === "SP-002"))).toHaveLength(0);
  });

  it("missing hours: narrow blocks, listed plainly, no failure", () => {
    const [fig] = buildFigures(fixturePlan({ samples: 6, noHours: true }), { style: "time_scale" });
    expect(fig!.hoursNotGiven.length).toBeGreaterThan(5);
    expect(fig!.pages.map((p) => p.svg).join("")).toContain("Hours not given");
    expect(fig!.pages[0]!.svg + (fig!.pages[1]?.svg ?? "")).toContain("Not pinned (hour not given)");
  });

  it("no steps or style none: no figures", () => {
    const empty = fixturePlan({ steps: 0, samples: 0 });
    expect(buildFigures(empty, { style: "time_scale" })).toEqual([]);
    expect(buildFigures(fixturePlan(), { style: "none" })).toEqual([]);
    expect(FIGURE_STYLES).toContain("none");
  });

  it("steps without samples are drawn, and a point not on a step is listed as not on the diagram", () => {
    const plan = fixturePlan({ samples: 0, steps: 5 });
    plan.points = [fpoint(1)];
    const [fig] = buildFigures(plan, { style: "step_cards" });
    expect(fig!.pages[0]!.svg).toContain("No samples at this step");
    expect(fig!.pages[0]!.svg).toContain("Not on the diagram");
  });

  it("the buffer sub-process is its own figure, first, saying what it feeds and its processing-time target", () => {
    const figs = buildFigures(fixturePlan({ samples: 6, buffer: true }), { style: "time_scale" });
    expect(figs.map((f) => f.scopeId)).toEqual(["SB-01", "main"]);
    expect(figs[0]!.feeds).toEqual({ stepLabel: "Dilution and mixing", figureNumber: 2 });
    expect(figs[0]!.pages[0]!.svg).toContain("Feeds Dilution and mixing in Figure 2");
    expect(figs[0]!.pages[0]!.svg).toContain("Processing time ≤ 12 h");
    expect(figs[1]!.pages.map((p) => p.svg).join("")).not.toContain("Buffer preparation");
  });

  it("pins within 10 h share one box; pins further apart do not", () => {
    const c = clusterPins([{ id: "a", hour: 1 }, { id: "b", hour: 9 }, { id: "c", hour: 20 }, { id: "d", hour: 21 }].map((x) => ({ ...x, routine: false })) as never);
    expect(c.map((g) => g.samples.length)).toEqual([2, 2]);
  });

  it("interactive mode adds focus hooks; export mode does not", () => {
    const plan = fixturePlan({ samples: 4 });
    const live = buildFigures(plan, { style: "time_scale", interactive: true })[0]!.pages[0]!.svg;
    const out = buildFigures(plan, { style: "time_scale" })[0]!.pages[0]!.svg;
    expect(live).toContain('data-sp="SP-001"');
    expect(live).toContain('tabindex="0"');
    expect(out).not.toContain("data-sp");
    expect(out).toContain('role="img"');
  });

  it("is pure: the same plan gives the same drawing", () => {
    const plan = fixturePlan({ samples: 15, buffer: true });
    expect(buildFigures(plan)).toEqual(buildFigures(plan));
  });
});

describe("figure legibility (M10 review)", () => {
  it("time scale: labels carry a halo so dashed target lines never run through letters, and step blocks keep a gap", () => {
    const [fig] = buildFigures(fixturePlan({ samples: 6, buffer: true }), { style: "time_scale" });
    const svg = fig!.pages[0]!.svg;
    expect(svg).toContain('stroke-linejoin="round" aria-hidden="true"');
    // The step blocks are drawn inside their span, so two neighbours never share an edge.
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*stroke="#5b52a8"/g)].map((m) => [Number(m[1]), Number(m[1]) + Number(m[2])] as const);
    rects.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < rects.length; i++) expect(rects[i]![0] - rects[i - 1]![1]).toBeGreaterThanOrEqual(1);
  });

  it("a number and its unit never wrap apart (no-break space), in both styles", () => {
    for (const style of STYLES) {
      const text = buildFigures(fixturePlan({ samples: 6, buffer: true }), { style }).flatMap((f) => f.pages.map((p) => p.svg)).join("");
      expect(text).toMatch(/\d\u00a0h/);
      expect(text).not.toMatch(/\d h</);
    }
  });

  it("step cards: 'No samples at this step.' is a line of its own", () => {
    const plan = fixturePlan({ samples: 0, steps: 3 });
    const [fig] = buildFigures(plan, { style: "step_cards" });
    expect(fig!.pages[0]!.svg).toMatch(/>No samples at this step\.<\/text>/);
  });
});
