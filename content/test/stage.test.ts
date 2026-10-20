// Milestone 5.1: program stage per side (site.programStage) and the stage-aware wording.
import {
  assess,
  buildDemoProject,
  buildDocument,
  buildValidationPlan,
  CATEGORIES,
  categoryLabel,
  fieldLabel,
  gapsToCsv,
  PROGRAM_STAGES,
  STAGE_BINDS,
  STAGE_LABEL,
  STAGE_NOT_ESTABLISHED,
  STAGE_QUESTION_ID,
  stagedContent,
  stagedFor,
  validationPlanToCsv,
  type ProgramStage,
} from "@gap/engine";
import { resolveEntry, type Project } from "@gap/process-model";
import { renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";

type Stage = ProgramStage | undefined;
const GENERATED = "2026-10-02T00:00:00.000Z";
const STAGES: ProgramStage[] = ["commercial", "clinical", "development"];
const PAIRS = STAGES.flatMap((s) => STAGES.map((t) => [s, t] as const));

/** The demo with both stages set as given; an undefined stage leaves that side unanswered. */
function demoWith(source: Stage, target: Stage): Project {
  const raw = demos["arx-217"] as { answers: { q: string; side: string; value?: unknown; docs?: string[] }[] };
  const answers = raw.answers.flatMap((x) => {
    if (x.q !== STAGE_QUESTION_ID) return [x];
    const value = x.side === "source" ? source : target;
    return value ? [{ ...x, value }] : [];
  });
  return buildDemoProject(content, { ...raw, answers });
}

function build(source: Stage, target: Stage) {
  const project = demoWith(source, target);
  const a = assess(content, project);
  const doc = buildDocument(content, project, a, GENERATED);
  return { project, a, doc, md: renderMarkdown(doc) };
}

const plain = (s: string) => s.replace(/\s+/g, " ");
const section = (doc: ReturnType<typeof build>["doc"], id: string) => doc.sections.find((s) => s.id === id)!;
const meta = (doc: ReturnType<typeof build>["doc"], label: string) => doc.meta.find(([k]) => k === label)?.[1];

/** Statements that are allowed to contain "validated" in a document for a source that is not commercial. */
const ALLOWED = [
  /Proof of concept\. Not validated\. Not for GMP use\./g, // the permanent banner
  /Commercial \(process validated\)/g, // a stage label (a commercial target)
  /Clinical \(GMP, not process validated\)/g, // a stage label
  /not process validated/gi, // the same wording in running text
  /not yet validated/gi,
  /(?:full )?process validation \(PPQ\) is not expected/gi, // target expectations
  /full process validation/gi,
  /(?:The )?RU (?:process )?(?:is|must be) validated/gi,
  /own validated specification/gi, // a target-side statement
  /not validated[^.]*until bacterial retention is demonstrated/gi, // a target-side statement
  /(?:cleaning|computerized system|method) validation/gi,
  /validated and qualified together with its equipment/gi,
  /how the check was validated/gi,
  /Has the RU CCI test method been validated/gi, // a question about the target
];

function sourceValidatedClaims(md: string): string[] {
  let text = plain(md);
  for (const re of ALLOWED) text = text.replace(re, " ");
  return [...text.matchAll(/[^.]{0,60}\bvalidated\b[^.]{0,40}/gi)].map((m) => m[0].trim());
}

describe("program stage question", () => {
  it("is a paired site question right after the line, bound to site.programStage, with no default", () => {
    const ids = content.questions.map((q) => q.id);
    expect(ids.indexOf(STAGE_QUESTION_ID)).toBe(ids.indexOf("site.line") + 1);
    const q = content.questionById.get(STAGE_QUESTION_ID)!;
    expect(q.sides).toBe("paired");
    expect(q.sameAsSource).toBe(false);
    expect(q.binds).toBe(STAGE_BINDS);
    expect(q.input).toEqual({ type: "choice", optionsFrom: "programStage" });
    expect(q.showWhen).toBeUndefined(); // asked for a scale change too
  });

  it("has exactly three options, labelled as the engine labels them", () => {
    const opts = content.catalog.optionSets.programStage!;
    expect(opts.map((o) => o.value)).toEqual([...PROGRAM_STAGES]);
    for (const o of opts) expect(o.label).toBe(STAGE_LABEL[o.value as ProgramStage]);
    expect(STAGE_LABEL).toEqual({
      commercial: "Commercial (process validated)",
      clinical: "Clinical (GMP, not process validated)",
      development: "Development / engineering runs",
    });
  });

  it("does not turn a stage difference into a gap row", () => {
    const same = build("commercial", "commercial").a.gaps.length;
    for (const [s, t] of PAIRS) expect(build(s, t).a.gaps.length, `${s} to ${t}`).toBe(same);
  }, 60_000);
});

describe.each(PAIRS)("source %s, target %s", (source, target) => {
  const { project, a, doc, md } = build(source, target);
  const validated = source === "commercial";
  const word = validated ? "validated" : "SU";

  it("stores the stage per side", () => {
    const s = resolveEntry(project, "source.site.programStage");
    const t = resolveEntry(project, "target.site.programStage");
    expect(s.status === "established" && s.value).toBe(source);
    expect(t.status === "established" && t.value).toBe(target);
  });

  it("labels the two range categories by the source stage", () => {
    const staged = stagedFor(content, project);
    expect(categoryLabel(staged, "within_validated_range")).toBe(`Within ${word} range`);
    expect(categoryLabel(staged, "outside_validated_range")).toBe(`Outside ${word} range`);
    const table = section(doc, "difference-summary") ?? section(doc, "gap-table");
    expect(JSON.stringify(table)).toContain(`${validated ? "Within validated" : "Within SU"} range`);
  });

  it("words the compare details and the field label by the source stage", () => {
    const ranged = a.gaps.filter((g) => g.category === "within_validated_range" || g.category === "outside_validated_range");
    expect(ranged.length).toBeGreaterThan(0);
    const details = ranged.map((g) => `${g.detail} ${g.rationale}`).join(" ");
    if (validated) expect(details).toMatch(/validated/);
    else expect(details).not.toMatch(/source validated/);
    expect(details).not.toContain("{{");
    expect(fieldLabel(stagedFor(content, project), "validatedRange")).toBe(validated ? "Validated range" : "Demonstrated range (actually run)");
  });

  it("titles the source summary and its column by the source stage", () => {
    const sum = section(doc, "source-summary");
    expect(sum.title).toBe(validated ? "Sending unit program summary (validated state)" : "Sending unit program summary (current state)");
    expect(JSON.stringify(sum)).toContain(validated ? "Validated state" : "Current state");
  });

  it("opens the validation plan with the stage basis", () => {
    const plan = section(doc, "validation-plan");
    const first = plan.blocks[0]!;
    expect(first.type === "paragraph" && first.text).toBe(`Stage basis. Sending unit (SU) program stage: ${STAGE_LABEL[source]}. Receiving unit (RU) program stage: ${STAGE_LABEL[target]}.`);
    const text = plain(JSON.stringify(plan.blocks.slice(0, 3)));
    if (source === "commercial") expect(text).toContain("The SU process is validated");
    else if (source === "clinical") expect(text).toContain("no SU PPQ or process validation evidence to leverage");
    else expect(text).toContain("no process validation and no GMP evidence to leverage");
    if (target === "commercial") expect(text).toContain("A commercial RU is expected to need PPQ at the RU");
    if (target === "clinical") expect(text).toContain("phase-appropriate expectations");
    if (target === "development") expect(text).toContain("They are not for GMP supply");
    expect(text).toContain("expectations to confirm with QA");
  });

  it("shows both stages on the cover and in the meta lines", () => {
    expect(doc.cover.sourceStage).toBe(STAGE_LABEL[source]);
    expect(doc.cover.targetStage).toBe(STAGE_LABEL[target]);
    expect(meta(doc, "SU program stage")).toBe(STAGE_LABEL[source]);
    expect(meta(doc, "RU program stage")).toBe(STAGE_LABEL[target]);
    const labels = doc.meta.map(([k]) => k);
    expect(labels.indexOf("Revision")).toBe(labels.indexOf("Generated") + 1);
    expect(plain(md)).toContain(`Program stage: sending unit ${STAGE_LABEL[source]}; receiving unit ${STAGE_LABEL[target]}.`);
  });

  it("keeps every non-equivalent outcome with an activity, and the generic rules last", () => {
    for (const g of a.gaps.filter((x) => !["equivalent", "within_validated_range", "information_required"].includes(x.category))) {
      expect(g.activities.length, g.key).toBeGreaterThan(0);
    }
    expect(content.rules.slice(-3).map((r) => r.id)).toEqual(["R-GEN-EQUIP-PRINCIPLE", "R-GEN-MAT-PRESENCE", "R-GEN-IPC-DESCRIPTION"]);
  });

  it("leaves category keys alone in the CSV and the stored data", () => {
    const csv = gapsToCsv(content, a.gaps, project);
    expect(csv).not.toMatch(/within_validated_range|outside_validated_range/);
    expect(JSON.stringify(project)).not.toContain("{{");
    expect(new Set(a.gaps.map((g) => g.category))).toEqual(new Set(CATEGORIES));
    expect(csv).toContain(`"Within ${word} range"`);
    expect(csv).toContain(`"Outside ${word} range"`);
    const pcsv = validationPlanToCsv(buildValidationPlan(content, project, a));
    expect(pcsv).not.toContain("{{");
  });

  it("makes no claim that the source is validated unless it is commercial", () => {
    expect(md).not.toContain("{{");
    expect(md).not.toMatch(/undefined|NaN|\[object Object\]/);
    if (!validated) expect(sourceValidatedClaims(md)).toEqual([]);
    else expect(md).toMatch(/validated/);
  });

  it("uses only the regulatory affairs wording for filings", () => {
    expect(md).toContain("Requires regulatory affairs assessment");
    expect(md).not.toMatch(/\b(major|minor) (variation|change)\b|prior[- ]approval|\bCBE-?\d*\b|\bType I[AB]\b|filing category (is|will be)|must be filed|is a (major|minor)/i);
  });
});

describe("stage not established", () => {
  const { project, a, doc, md } = build(undefined, undefined);

  it("resolves as not established, with no default", () => {
    expect(resolveEntry(project, "source.site.programStage").status).toBe("not_established");
    expect(resolveEntry(project, "target.site.programStage").status).toBe("not_established");
  });

  it("prints [not established] on the cover, in the meta lines and in the text", () => {
    expect(STAGE_NOT_ESTABLISHED).toBe("[not established]");
    expect(doc.cover.sourceStage).toBe("[not established]");
    expect(doc.cover.targetStage).toBe("[not established]");
    expect(meta(doc, "SU program stage")).toBe("[not established]");
    expect(meta(doc, "RU program stage")).toBe("[not established]");
    expect(plain(md)).toContain("Program stage: sending unit [not established]; receiving unit [not established].");
  });

  it("uses the non-validated wording and makes no source validation claim", () => {
    expect(categoryLabel(stagedFor(content, project), "within_validated_range")).toBe("Within SU range");
    expect(section(doc, "source-summary").title).toBe("Sending unit program summary (current state)");
    expect(sourceValidatedClaims(md)).toEqual([]);
  });

  it("lists both stage questions as open information items", () => {
    const refs = a.openItems.map((o) => o.ref);
    expect(refs).toContain("source.site.programStage");
    expect(refs).toContain("target.site.programStage");
    const open = JSON.stringify(section(doc, "open-items"));
    expect(open).toContain("Program stage at this site");
  });

  it("says in the plan that the stage must be answered", () => {
    expect(plain(JSON.stringify(section(doc, "validation-plan").blocks.slice(0, 3)))).toContain("Answer the program stage question");
  });

  it("answers both stages once they are given, closing the open items", () => {
    const answered = build("commercial", "clinical").a.openItems.map((o) => o.ref);
    expect(answered).not.toContain("source.site.programStage");
    expect(answered).not.toContain("target.site.programStage");
  });
});

describe("a project that has no stage at all (a migrated 1.3.0 file)", () => {
  it("reads as not established on both sides", () => {
    const project = demoWith(undefined, undefined);
    expect(project.processes.source.site.fields.programStage).toBeUndefined();
    expect(project.processes.target.site.fields.programStage).toBeUndefined();
  });
});

describe("stage wording in the bundle", () => {
  it("leaves no variant marker in either staged bundle", () => {
    for (const validated of [true, false]) {
      const staged = stagedContent(content, validated);
      expect(JSON.stringify({ c: staged.catalog, q: staged.questions, r: staged.rules, t: staged.templates }), String(validated)).not.toContain("{{");
    }
  });

  it("uses the validated wording only for the validated bundle", () => {
    const v = stagedContent(content, true);
    const n = stagedContent(content, false);
    expect(categoryLabel(v, "within_validated_range")).toBe("Within validated range");
    expect(categoryLabel(n, "within_validated_range")).toBe("Within SU range");
    expect(categoryLabel(v, "outside_validated_range")).toBe("Outside validated range");
    expect(categoryLabel(n, "outside_validated_range")).toBe("Outside SU range");
  });

  it("is memoised and idempotent", () => {
    expect(stagedContent(content, false)).toBe(stagedContent(content, false));
    expect(stagedContent(stagedContent(content, false), false)).toBe(stagedContent(content, false));
    expect(stagedContent(stagedContent(content, false), true)).toBe(stagedContent(content, true));
  });

  it("keeps the same category keys in both bundles", () => {
    expect(stagedContent(content, true).catalog.categories.map((c) => c.key)).toEqual(stagedContent(content, false).catalog.categories.map((c) => c.key));
  });

  it("keeps the stage wording out of question prompts and labels", () => {
    for (const q of content.questions) expect(`${q.prompt} ${q.label ?? ""}`, q.id).not.toContain("{{");
  });
});
