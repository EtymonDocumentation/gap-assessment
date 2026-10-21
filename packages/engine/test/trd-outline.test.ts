import { describe, expect, it } from "vitest";
import { parseTrdSeed, type Project } from "@gap/process-model";
import { buildDemoProject, buildTrdOutline, buildTrdSeed, seedStatusText, seedValueText, trdSeedCounts, TRD_OUTLINE_TITLE, type DocModel } from "@gap/engine";
import { renderHtml, renderMarkdown } from "../../renderers/src/index";
import { content, kit } from "./helpers";
import { demos } from "../../../content/index";

const { base, v, ask, unk } = kit;
const AT = "2026-10-21T08:00:00.000Z";
const seed = (p: Project) => parseTrdSeed(JSON.stringify(buildTrdSeed(content, p, { exportedAt: AT, appVersion: "9.9.9" })));
const demo = () => buildDemoProject(content, demos["arx-217"]);
const text = (d: DocModel) => JSON.stringify(d.sections);
const titles = (d: DocModel) => d.sections.map((s) => s.title);

describe("buildTrdOutline", () => {
  it("has the required title, banner and the basis line", () => {
    const d = buildTrdOutline(seed(demo()));
    expect(d.title).toBe(TRD_OUTLINE_TITLE);
    expect(d.title).toBe("Technology transfer document — draft outline");
    expect(d.banner).toBe("Proof of concept. Not validated. Not for GMP use.");
    expect(d.status).toBe("DRAFT");
    const basis = d.sections[0]!.blocks.find((b) => b.type === "note");
    expect(basis).toEqual({ type: "note", text: expect.stringMatching(/^Draft outline seeded from gap assessment .+ \(no issued revision\)\. Not an approved TRD\.$/) });
  });

  it("has the required sections in order, with one section per unit operation", () => {
    const s = seed(demo());
    const d = buildTrdOutline(s);
    const t = titles(d);
    expect(t.slice(0, 4)).toEqual(["Purpose and scope", "Product and presentation", "Receiving site and line", "Process overview"]);
    const uoTitles = s.unitOperations.map((u) => u.label);
    expect(t.slice(4, 4 + uoTitles.length)).toEqual(uoTitles);
    expect(t.slice(4 + uoTitles.length)).toEqual(["Open items", "Source register", "Traceability to the gap assessment", "Versions"]);
    expect(d.sections.map((x) => x.number)).toEqual(d.sections.map((_, i) => String(i + 1)));
  });

  it("has tables for parameters, equipment, materials, IPCs, studies and procedures", () => {
    const d = buildTrdOutline(seed(demo()));
    const headings = d.sections.flatMap((s) => s.blocks.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text));
    for (const h of ["Process parameters", "Equipment", "Materials and components", "In-process controls and sampling", "Validation and supporting studies", "Procedures, systems and training"]) {
      expect(headings).toContain(h);
    }
  });

  it("leaves the Traceability section out when switched off, and with it every SU value", () => {
    const s = seed(demo());
    const on = buildTrdOutline(s, { traceability: true });
    const off = buildTrdOutline(s, { traceability: false });
    expect(titles(on)).toContain("Traceability to the gap assessment");
    expect(titles(off)).not.toContain("Traceability to the gap assessment");
    expect(titles(off).length).toBe(titles(on).length - 1);
    expect(off.meta).toContainEqual(["Traceability section", "Left out"]);
    // Traceability is on by default.
    expect(titles(buildTrdOutline(s))).toContain("Traceability to the gap assessment");
  });

  it("labels a provisional TBD value in words and shows an unknown value as not established", () => {
    let p = v(base(), "fill.pump", "source", "rotary_piston");
    p = ask(p, "fill.pump", "target", { kind: "tbd", bestGuess: "peristaltic", owner: "Process lead (fictional)" });
    const d = buildTrdOutline(seed(p));
    const t = text(d);
    expect(t).toContain("TBD best guess, provisional");
    expect(t).toContain("TBD best guess (provisional)");
    expect(t).toContain("Not established");
    expect(d.tbdCount).toBeGreaterThan(0);
    // A provisional value is never written as a plain established value.
    const f = seed(p).unitOperations.find((u) => u.key === "aseptic_filling")!.items.flatMap((i) => i.fields).find((x) => x.field === "operatingPrinciple")!;
    expect(seedValueText(f)).toMatch(/TBD best guess, provisional/);
    expect(seedStatusText(f)).toBe("TBD best guess (provisional)");
  });

  it("lists TBD and not established values under Open items", () => {
    const d = buildTrdOutline(seed(unk(base(), "fill.pump", "target")));
    const open = d.sections.find((s) => s.id === "open-items")!;
    const table = open.blocks.find((b) => b.type === "table") as { rows: string[][] };
    expect(table.rows.some((r) => r[1] === "Filling pump operating principle" || r[1]!.includes("pump"))).toBe(true);
    expect(table.rows.every((r) => /TBD|Not established/.test(r[2]!))).toBe(true);
  });

  it("states the built-in style only and never a filing category", () => {
    const d = buildTrdOutline(seed(demo()));
    expect(text(d)).toMatch(/built-in style only/i);
    expect(text(d)).not.toMatch(/filing category|CBE-30|prior approval/i);
  });

  it("is built from the seed alone: outlines of equal seeds are equal", () => {
    const s = seed(demo());
    expect(buildTrdOutline(s)).toEqual(buildTrdOutline(parseTrdSeed(JSON.stringify(s))));
  });

  it("counts established, TBD and not established values per unit operation", () => {
    const c = trdSeedCounts(seed(unk(base(), "fill.pump", "target")));
    const filling = c.rows.find((r) => r.key === "aseptic_filling")!;
    expect(filling.tbd).toBe(1);
    expect(filling.established + filling.tbd + filling.notEstablished + filling.notApplicable).toBe(filling.total);
    expect(c.total.total).toBeGreaterThan(filling.total);
  });

  it("renders to HTML and Markdown with the banner and the heading", () => {
    const d = buildTrdOutline(seed(demo()));
    expect(renderHtml(d)).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(renderHtml(d)).toContain("Technology transfer document");
    expect(renderMarkdown(d)).toContain("Process overview");
  });
});
