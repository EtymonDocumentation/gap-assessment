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

describe("a block never shows a word cut in two", () => {
  // Bold texts: a block's inside lines are their own <text font-weight="700">, an outside label bolds its name in a <tspan>.
  const tspans = (svg: string) => [...svg.matchAll(/<text [^>]*font-weight="700"[^>]*>([^<]*)<\/text>|<tspan font-weight="700">([^<]*)<\/tspan>/g)].map((m) => (m[1] ?? m[2])!.replace(/&amp;/g, "&"));

  it("a block too narrow for a whole word gets its label outside; a wide enough block keeps it inside", () => {
    let inside = 0;
    let outside = 0;
    for (let hours = 1; hours <= 80; hours += 1) {
      const plan = fixturePlan({ samples: 0 });
      // A short detail ("9 h at CRT" fits one line) so that only the long name decides whether the text can sit inside the block.
      Object.assign(plan.holds!.find((h) => h.id === "HD-03")!, { durationHours: hours, durationText: "9 h" });
      const nameWords = [...plan.steps.map((s) => s.label), ...plan.holds!.map((h) => h.label)].flatMap((n) => n.split(" "));
      const wholeWords = new Set(nameWords);
      const [fig] = buildFigures(plan, { style: "time_scale" });
      for (const p of fig!.pages) {
        // A bold text is never a fragment of a name word (such as "filtratio" or "n"): it is a whole word or not a name word at all.
        for (const t of tspans(p.svg)) for (const w of t.split(" ")) if (w) expect(wholeWords.has(w) || !nameWords.some((n) => n.includes(w)), `cut word "${w}" at ${hours} h`).toBe(true);
        const labelBox = p.boxes.find((b) => b.kind === "hold" && b.id === "HD-03" && Math.abs(b.h - 11) < 0.01);
        if (labelBox) outside++; else if (p.boxes.some((b) => b.kind === "hold" && b.id === "HD-03")) inside++;
      }
    }
    expect(outside).toBeGreaterThan(0); // narrow blocks: label moved outside
    expect(inside).toBeGreaterThan(0); // wide blocks: label still inside
  });

  it("a 'Post-filtration hold' block narrower than the word 'Post-filtration' is labelled outside, whole", () => {
    const plan = fixturePlan({ samples: 0 });
    Object.assign(plan.holds!.find((h) => h.id === "HD-03")!, { durationHours: 60, durationText: "9 h" });
    const [fig] = buildFigures(plan, { style: "time_scale" });
    const svg = fig!.pages.map((p) => p.svg).join("");
    expect(svg).toContain("Post-filtration hold"); // whole name, written outside the block with a leader
    expect(svg).not.toMatch(/>Post-filtratio</);
    expect(svg).not.toMatch(/>n hold</);
    expect(svg).not.toMatch(/>Post-filtrati</);
  });
});

describe("outside labels keep clear of dashed time-limit lines", () => {
  const GAP = 6; // LABEL_LINE_GAP; restated so a silent change of the constant is noticed
  /** x of every dashed vertical time-limit line in the svg. */
  const targetXs = (svg: string) =>
    [...svg.matchAll(/<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)" y2="[\d.]+" stroke="#374151" stroke-width="1.2" stroke-dasharray="4 3"\/>/g)]
      .filter((m) => m[1] === m[2])
      .map((m) => Number(m[1]));

  /** Every outside label box (height 11) must be clear of each line by GAP, or have the line inside it with GAP either side. */
  function check(plan: ReturnType<typeof fixturePlan>) {
    let outsideLabels = 0;
    let nearest = Infinity;
    const [fig] = buildFigures(plan, { style: "time_scale" });
    for (const p of fig!.pages) {
      const xs = targetXs(p.svg);
      for (const b of p.boxes.filter((k) => (k.kind === "step" || k.kind === "hold") && Math.abs(k.h - 11) < 0.01)) {
        outsideLabels++;
        for (const x of xs) {
          const gapOutside = Math.max(b.x - x, x - (b.x + b.w)); // > 0: line beside the box
          const gapInside = Math.min(x - b.x, b.x + b.w - x); // > 0: line inside the box
          // a line under the label's own leader (label starts at cx - 2 or ends at cx + 2) is covered by that leader, never by text
          const ownLeader = Math.abs(x - (b.x + 2)) <= 1.6 || Math.abs(x - (b.x + b.w - 2)) <= 1.6;
          const ok = ownLeader || gapOutside >= GAP - 0.05 || gapInside >= GAP - 0.05;
          if (!ok) nearest = Math.min(nearest, Math.abs(gapOutside > 0 ? gapOutside : gapInside));
          expect(ok, `${b.id}: line at ${x} vs label ${b.x}..${b.x + b.w} (${gapOutside > 0 ? "beside" : "inside"} by ${gapOutside > 0 ? gapOutside : gapInside})`).toBe(true);
        }
      }
    }
    return outsideLabels;
  }

  it("the clearance constant is the one the tests assume", async () => {
    const mod = await import("../../src/plan/figure/time-scale");
    expect(mod.LABEL_LINE_GAP).toBe(GAP);
  });

  it("sweeping step and hold lengths so target lines land 0-8 px from where label text ends or starts, on both sides", () => {
    let total = 0;
    for (let d = 0; d <= 40; d += 0.5) {
      for (const which of ["ST-02", "ST-03", "ST-05", "ST-06"]) {
        const plan = fixturePlan({ samples: 6 });
        const st = plan.steps.find((s) => s.id === which)!;
        st.durationHours = (st.durationHours ?? 1) + d;
        total += check(plan);
      }
      const plan = fixturePlan({ samples: 6, buffer: true });
      plan.holds![1]!.durationHours = 24 + d;
      total += check(plan);
    }
    expect(total).toBeGreaterThan(100); // the sweep really produced outside labels
  });

  it("both sides hit: the label picks the side that needs less widening and still keeps the gap", () => {
    // Two targets a few hours apart bracket a short step, so a label to either side meets a line.
    for (let near = 1; near <= 12; near++) {
      const plan = fixturePlan({ samples: 6 });
      plan.timeTargets = [
        { id: "TT-01", label: "Left limit", fromStepId: "ST-01", fromEdge: "end", toStepId: "ST-03", toEdge: "start", comparator: ">=", hours: 1 },
        { id: "TT-02", label: "Right limit", fromStepId: "ST-01", fromEdge: "end", toStepId: "ST-03", toEdge: "end", comparator: ">=", hours: 1 + near },
      ];
      check(plan);
    }
  });

  /** Each outside label with the leader that belongs to it (found by the leader's end y) and the text's anchor x and mode. */
  function labelsWithLeaders(svg: string, boxes: { kind: string; id: string; x: number; y: number; w: number; h: number }[]) {
    const leaders = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#[0-9a-f]+" stroke-width="0.8"\/>/g)]
      .map((m) => ({ x: Number(m[1]), y1: Number(m[2]), y2: Number(m[4]), vertical: m[1] === m[3] }))
      .filter((l) => l.vertical);
    const texts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="8.5"( text-anchor="end")? fill="#[0-9a-f]+"><tspan font-weight="700">/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), end: !!m[3] }));
    const out: { id: string; leader: number; x: number; end: boolean; block: { x: number; w: number } | undefined }[] = [];
    for (const b of boxes.filter((k) => (k.kind === "step" || k.kind === "hold") && Math.abs(k.h - 11) < 0.01)) {
      const ty = b.y + 8.5;
      const t = texts.find((c) => Math.abs(c.y - ty) < 0.01 && c.x >= b.x - 1 && c.x <= b.x + b.w + 1);
      const l = leaders.filter((c) => Math.abs(c.y2 - (ty + 2)) < 0.01 || Math.abs(c.y2 - (ty - 9)) < 0.01).sort((a, c) => Math.abs(a.x - (t?.x ?? 0)) - Math.abs(c.x - (t?.x ?? 0)))[0];
      expect(t, `${b.id} text`).toBeDefined();
      expect(l, `${b.id} leader`).toBeDefined();
      const blk = boxes.find((k) => k.kind === b.kind && k.id === b.id && Math.abs(k.h - 11) > 0.01 && k.h > 20);
      out.push({ id: b.id, leader: l!.x, x: t!.x, end: t!.end, block: blk });
    }
    return out;
  }
  const sweepPlans = () => {
    const plans: ReturnType<typeof fixturePlan>[] = [];
    for (let d = 0; d <= 40; d += 1) {
      for (const which of ["ST-02", "ST-03", "ST-05", "ST-06"]) {
        const plan = fixturePlan({ samples: 6 });
        const st = plan.steps.find((q) => q.id === which)!;
        st.durationHours = (st.durationHours ?? 1) + d;
        plans.push(plan);
      }
    }
    plans.push(fixturePlan({ samples: 12, buffer: true }), fixturePlan({ samples: 6 }));
    return plans;
  };

  it("the text stays flush with its leader: it starts at the leader, or ends exactly at it, however far the patch was widened", () => {
    let ends = 0, starts = 0;
    for (const plan of sweepPlans())
      for (const fig of buildFigures(plan, { style: "time_scale" }))
        for (const p of fig.pages)
          for (const l of labelsWithLeaders(p.svg, p.boxes)) {
            expect(Math.abs(l.x - l.leader), `${l.id} text anchor ${l.x} vs leader ${l.leader}`).toBeLessThanOrEqual(3);
            if (l.end) ends++; else starts++;
          }
    expect(ends).toBeGreaterThan(0);
    expect(starts).toBeGreaterThan(0);
  });

  it("a leader never runs beside a dashed time-limit line: at least the gap apart, unless its block has no spot that is", () => {
    let nudged = 0;
    for (const plan of sweepPlans())
      for (const fig of buildFigures(plan, { style: "time_scale" }))
        for (const p of fig.pages) {
          const xs = targetXs(p.svg);
          for (const l of labelsWithLeaders(p.svg, p.boxes)) {
            const dist = Math.min(...xs.map((x) => Math.abs(x - l.leader)));
            if (dist >= GAP - 0.05) continue;
            // The block rectangle is drawn 1.5 inside its span when wide enough; any point on it is a legal attach point.
            const b = l.block!;
            const g = b.w >= 3 * 1.5 + 8 ? 1.5 : 0;
            let best = 0;
            for (let x = b.x + g; x <= b.x + b.w - g + 0.001; x += 0.5) best = Math.max(best, Math.min(GAP, ...xs.map((t) => Math.abs(t - x))));
            expect(dist, `${l.id}: leader ${l.leader} is ${dist} from a line, best possible in block ${best}`).toBeGreaterThanOrEqual(best - 0.3);
            nudged++;
          }
        }
    expect(nudged).toBeGreaterThanOrEqual(0);
  });

  it("a leader that would sit beside a target line is moved along its block until the gap is kept", () => {
    // A short step with a limit line on one of its own edges: the centre is under the gap from the line, the far end is not.
    let moved = 0;
    for (const dur of [8, 9, 10])
      for (const toEdge of ["start", "end"] as const) {
        const plan = fixturePlan({ samples: 6 });
        plan.steps.find((q) => q.id === "ST-02")!.durationHours = dur;
        plan.timeTargets = [{ id: "TT-01", label: "Limit", fromStepId: "ST-01", fromEdge: "end", toStepId: "ST-02", toEdge, comparator: ">=", hours: 5 }];
        for (const fig of buildFigures(plan, { style: "time_scale" }))
          for (const p of fig.pages) {
            const xs = targetXs(p.svg);
            for (const l of labelsWithLeaders(p.svg, p.boxes)) {
              if (l.id !== "ST-02") continue;
              const mid = l.block!.x + l.block!.w / 2;
              if (Math.min(...xs.map((x) => Math.abs(x - mid))) < GAP) moved++;
              expect(Math.min(...xs.map((x) => Math.abs(x - l.leader))), `dur ${dur} ${toEdge}`).toBeGreaterThanOrEqual(GAP - 0.05);
            }
          }
      }
    expect(moved).toBeGreaterThan(0);
  });
});
