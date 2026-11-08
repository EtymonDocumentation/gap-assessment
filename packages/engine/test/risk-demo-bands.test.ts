import { describe, expect, it, vi } from "vitest";
import { buildDemoProject } from "@gap/engine";
import { scoreItem } from "@gap/risk";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../../../content/index";

vi.setConfig({ testTimeout: 60000 });

// The demo risk method carries the fictional team's own bands, so no scored demo item reads "(no band)". The tool still invents nothing:
// the bands are entries of the demo data, and an item left unscored on purpose stays unscored.
describe.each(["arx-217", "syr-305"] as const)("risk demo bands (%s)", (id) => {
  const project = buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const a = project.risk.assessments[0]!;

  it("leaves the shared load-out without bands (the demo bands are its own copy)", () => {
    for (const l of riskLoadouts.loadouts) expect((l.config as { bands?: unknown[] }).bands ?? [], l.id).toHaveLength(0);
  });

  it("defines bands that cover every whole score exactly once", () => {
    const config = a.config as { bands?: { label: string; minRpn: number; maxRpn: number }[] };
    expect(config.bands?.length).toBeGreaterThan(1);
    for (let rpn = 1; rpn <= 1000; rpn++) expect(config.bands!.filter((b) => b.minRpn <= rpn && rpn <= b.maxRpn), `score ${rpn}`).toHaveLength(1);
  });

  it("gives every scored item a band, initial and residual alike, with no problem about bands", () => {
    const scored = a.items.filter((i) => Object.keys(i.initial.values).length > 0);
    expect(scored.length).toBeGreaterThan(3);
    for (const item of scored) {
      for (const score of [item.initial, item.residual].filter((x) => x && Object.keys(x.values).length > 0)) {
        const res = scoreItem(a.config!, score!);
        expect(res.scored, item.id).toBe(true);
        expect(res.label, `${item.id} has a band`).toBeTruthy();
        expect(res.problems.filter((p) => /band/i.test(p)), item.id).toEqual([]);
      }
    }
  });
});
