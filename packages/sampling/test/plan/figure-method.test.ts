import { SAMPLE_ACCESS, type SampleAccess, type SamplingPlan, type SampleMethod } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { buildFigures, MIN_FONT_PT, sampleMethodView } from "../../src/index";
import { fixturePlan } from "./figure-fixture";

/**
 * How each sample is taken, drawn in the PPQ flow figures (both styles). The shapes match the batch record's Process view; nothing is
 * drawn or written for a sample whose method is not stated.
 */
const STYLES = ["time_scale", "step_cards"] as const;
type Style = (typeof STYLES)[number];

/** A plan whose samples SP-001..SP-00n (all on the first step, PPQ type) get the methods given, in order. */
function planWith(methods: (SampleMethod | undefined)[]): SamplingPlan {
  const plan = fixturePlan({ samples: methods.length });
  plan.points.forEach((p, i) => {
    p.type = "ppq_enhanced";
    p.flow = { stepId: "ST-01", at: "during" };
    const m = methods[i];
    if (m) p.method = m;
  });
  return plan;
}
const svgOf = (plan: SamplingPlan, style: Style) => buildFigures(plan, { style }).flatMap((f) => f.pages.map((p) => p.svg)).join("\n");
const mainFig = (plan: SamplingPlan, style: Style) => buildFigures(plan, { style }).find((f) => f.scopeId === "main")!;
/** The same plan with every `method` removed, to prove an unstated method changes nothing in the drawing. */
const withoutMethods = (plan: SamplingPlan): SamplingPlan => ({ ...plan, points: plan.points.map(({ method: _m, ...rest }) => rest) });

describe("figure: how each sample is taken", () => {
  for (const style of STYLES) {
    describe(style, () => {
      it("draws one glyph per kind, and the legend lists the kinds present", () => {
        const kinds: SampleAccess[] = ["dedicated_port", "shared_port", "added_y_connector", "bag_sample_manifold", "aseptic_connector", "grab_open", "other"];
        const plan = planWith(kinds.map((access) => ({ access })));
        const fig = mainFig(plan, style);
        const svg = fig.pages.map((p) => p.svg).join("\n");
        for (const text of ["Dedicated sampling port", "Shared port (ring)", "Y-connector", "Bag sample manifold", "Aseptic connector", "Open grab sample", "Other way (see the card)"]) expect(svg).toContain(text);
        // Glyph lines come from the cards and from the legend swatches: far more than a figure with no method at all.
        const bare = svgOf(planWith(kinds.map(() => undefined)), style);
        expect((svg.match(/<polyline/g) ?? []).length).toBeGreaterThan((bare.match(/<polyline/g) ?? []).length + 15);
        for (const p of fig.pages) expect(p.minFontPt).toBeGreaterThanOrEqual(MIN_FONT_PT);
      });

      it("a legend has only the entries of glyphs that are present", () => {
        const svg = svgOf(planWith([{ access: "dedicated_port" }, undefined]), style);
        expect(svg).toContain("Dedicated sampling port");
        for (const text of ["Shared port (ring)", "Y-connector", "Bag sample manifold", "Aseptic connector", "Open grab sample", "Dashed part", "Flushed or discarded", "Thin line"]) expect(svg).not.toContain(text);
      });

      it("draws nothing extra when no sample states a method (no glyph, no legend entry, no note, no words)", () => {
        const plan = planWith([undefined, undefined, undefined]);
        const svg = svgOf(plan, style);
        for (const text of ["Dedicated sampling port", "Dashed part", "to waste", "How taken", "How samples are taken", "PPQ only", "study only", "data-share"]) expect(svg).not.toContain(text);
        expect(mainFig(plan, style).alt).not.toContain("How the sample is taken");
        expect(svg).toBe(svgOf(withoutMethods(plan), style));
      });

      it("an empty method object left by the editor is the same as none", () => {
        const plan = planWith([{}, undefined]);
        expect(svgOf(plan, style)).toBe(svgOf(withoutMethods(plan), style));
      });

      it("an added part is dashed and tagged 'PPQ only' for a PPQ point, 'study only' for another study type", () => {
        const plan = planWith([{ access: "dedicated_port", added: { forStudyOnly: true } }, { access: "added_y_connector" }, { access: "dedicated_port", added: { forStudyOnly: false } }]);
        plan.points[1]!.type = "hold_time";
        const svg = svgOf(plan, style);
        expect(svg).toContain("PPQ only");
        expect(svg).toContain("study only");
        // Two glyphs are dashed (the cue is a line style, not colour); the third port glyph is solid. The legend adds one dashed swatch.
        const dashed = (svg.match(/<polyline[^>]*stroke-dasharray="3 2"/g) ?? []).length;
        expect(dashed).toBeGreaterThanOrEqual(3);
        expect(svg).toContain("Dashed part: added only for the study");
        // A Y-connector is added unless the plan says otherwise; with forStudyOnly false it is neither tagged nor in the legend.
        const notAdded = svgOf(planWith([{ access: "added_y_connector", added: { forStudyOnly: false } }]), style);
        expect(notAdded).not.toContain("study only");
        expect(notAdded).not.toContain("Dashed part");
      });

      it("a stated flush is written 'N mL to waste' with its arrow, a first-draw discard too", () => {
        const plan = planWith([
          { access: "dedicated_port", flush: { practice: "flush_volume", volume: { value: 30, unit: "mL" }, discardTo: "waste" } },
          { access: "dedicated_port", flush: { practice: "first_draw_discard", volume: { value: 5, unit: "mL" } } },
          { access: "dedicated_port" },
        ]);
        const svg = svgOf(plan, style);
        expect(svg).toContain(">30 mL to waste<");
        expect(svg).toContain(">5 mL to waste<");
        expect(svg).toContain("Flushed or discarded to waste before the sample");
        expect((svg.match(/>\d+ mL to waste</g) ?? []).length).toBe(2);
      });

      it("no flush label when the volume is not stated, and none for 'no flush, with a reason'", () => {
        const svg = svgOf(planWith([{ access: "dedicated_port", flush: { practice: "flush_volume" } }, { access: "dedicated_port", flush: { practice: "none_stated_reason", reason: "closed single-use path" } }]), style);
        expect(svg).not.toMatch(/\d+ mL to waste/);
        expect(svg).not.toContain("Flushed or discarded");
      });

      it("samples that share a port are joined by a thin line, once per pair", () => {
        const plan = planWith([
          { access: "shared_port", shared: { pointIds: ["SP-002"], order: "A first" } },
          { access: "shared_port", shared: { pointIds: ["SP-001"] } },
        ]);
        const svg = svgOf(plan, style);
        expect((svg.match(/data-share="SP-001\+SP-002"/g) ?? []).length).toBe(1);
        expect(svg).toContain("Thin line: samples drawn from the same port");
      });

      it("no link line when the shared sample is not on the figure", () => {
        const svg = svgOf(planWith([{ access: "shared_port", shared: { pointIds: ["SP-099"] } }]), style);
        expect(svg).not.toContain("data-share");
        expect(svg).not.toContain("Thin line");
      });

      it("the alt text and the card carry the same facts in words, only for samples that state them", () => {
        const plan = planWith([{ access: "shared_port", flush: { practice: "flush_volume", volume: { value: 30, unit: "mL" } } }, undefined]);
        const fig = mainFig(plan, style);
        expect(sampleMethodView(plan.points[0])!.text).toBe("shared port, flush 30 mL");
        expect(fig.alt).toContain("How the sample is taken, as the plan states it: SP-001 shared port, flush 30 mL.");
        expect(fig.alt).not.toContain("SP-002 ");
        expect(fig.pages.map((p) => p.svg).join("")).toContain("How taken: shared port, flush 30 mL");
      });
    });
  }

  it("the legend of a page lists only the marks drawn on that page (the time line page has no cards, so no method entries)", () => {
    const plan = planWith([{ access: "dedicated_port", flush: { practice: "flush_volume", volume: { value: 5, unit: "mL" } } }]);
    const [first, ...rest] = mainFig(plan, "time_scale").pages;
    expect(first!.svg).not.toContain("Dedicated sampling port");
    expect(first!.svg).not.toContain("Flushed or discarded");
    expect(rest.map((p) => p.svg).join("")).toContain("Dedicated sampling port");
  });

  it("two samples of one port stay together on the page, so the line between them is drawn", () => {
    // 14 other samples on the same step push the pair towards a column end; the pair must still land side by side.
    const methods: (SampleMethod | undefined)[] = Array.from({ length: 16 }, () => undefined);
    methods[7] = { access: "shared_port", shared: { pointIds: ["SP-009"] } };
    methods[8] = { access: "shared_port", shared: { pointIds: ["SP-008"] } };
    for (const style of STYLES) expect(svgOf(planWith(methods), style)).toContain('data-share="SP-008+SP-009"');
  });

  it("the figure and the Process view use one function for the phrase", () => {
    expect(SAMPLE_ACCESS).toContain("grab_open");
    expect(sampleMethodView(undefined)).toBeUndefined();
    expect(sampleMethodView({ ...planWith([{}]).points[0]!, method: {} })).toBeUndefined();
  });
});
