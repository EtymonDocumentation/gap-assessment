// M13 job 1: the excipient content (classes, wording, guidance, glossary, failure modes) and the derived interview. Engine and data only
// (no screens). Fictional data only.
import { describe, expect, it } from "vitest";
import {
  EXCIPIENT_FACTS,
  ANIMAL_FACT_KEYS,
  emptyProject,
  putEntry,
  type Actor,
  type Entry,
  type EntryValue,
  type Project,
} from "@gap/process-model";
import {
  EXCIPIENT_MARKERS,
  ExcipientError,
  addExcipientLine,
  answerExcipientQuestion,
  createExcipientAssessment,
  deriveExcipientQuestions,
  excipientInterviewProgress,
  excipientMarkerExplanation,
  filterExcipientQuestions,
  oftenComparedPrompts,
  parseExcipientClasses,
  parseExcipientWording,
  parseFailureModes,
  parseGuidance,
  setExcipientFact,
  addSpecRow,
  STAGE_MARKER_OPEN,
  PROGRAM_STAGES,
  type ExcipientQuestion,
} from "@gap/engine";
import { expectNoPrivateTerms } from "../../test-support/private-terms";
import { content, excipientClasses, excipientWording, failureModes, glossary, guidance } from "../index";

const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: "2026-11-09T09:00:00.000Z" };
const opts = { wording: excipientWording, classes: excipientClasses };

const withEntry = (p: Project, ref: string, value: EntryValue): Project => {
  const next = structuredClone(p);
  const entry: Entry = { id: `ent-test-${ref}`, path: ref, status: "established", value, sourceIds: ["src-test"], recordedBy: ACTOR.name, recordedAt: ACTOR.at, revision: 1 };
  putEntry(next, entry);
  return next;
};
const fresh = (): Project => emptyProject({ title: "Excipient content test (fictional)", actor: ACTOR, contentRefs: content.versions });
function start(classKey?: string): Project {
  let p = createExcipientAssessment(fresh(), { title: "Buffer excipients (fictional)" }, ACTOR).project;
  p = addExcipientLine(p, "EXA-001", { name: "Polysorbate 80 (fictional grade)", ...(classKey ? { classKey } : {}) }, ACTOR).project;
  return p;
}
const questions = (p: Project) => deriveExcipientQuestions(p, "EXA-001", opts);
const byKey = (qs: ExcipientQuestion[], key: string) => qs.find((q) => q.key === key)!;

describe("content/excipient/classes.yaml", () => {
  it("is versioned, has unique keys and an 'other' class, and every class has a label and a sentence", () => {
    expect(excipientClasses.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(excipientClasses.changelog?.map((c) => c.version)).toContain(excipientClasses.version);
    const keys = excipientClasses.classes.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("other");
    for (const c of excipientClasses.classes) {
      expect(c.label.length, c.key).toBeGreaterThan(2);
      expect(c.summary.length, c.key).toBeGreaterThan(20);
    }
  });

  it("covers the classes the spec names", () => {
    const labels = excipientClasses.classes.map((c) => c.label.toLowerCase()).join(" | ");
    for (const w of ["buffer salt", "ph adjustment", "amino acid", "sugar", "surfactant", "tonicity", "chelator", "preservative", "bulking"]) expect(labels, w).toContain(w);
  });

  it("a surfactant is offered peroxides, fatty acids, residual ethylene oxide or dioxane and water content; a sugar reducing substances", () => {
    const tests = (k: string) => excipientClasses.classes.find((c) => c.key === k)!.oftenCompared.map((t) => t.test.toLowerCase()).join(" | ");
    for (const w of ["peroxide", "fatty acid", "ethylene oxide", "dioxane", "water"]) expect(tests("surfactant"), w).toContain(w);
    expect(tests("sugar")).toContain("reducing substances");
    for (const k of ["buffer_salt", "amino_acid", "sugar"]) for (const w of ["endotoxin", "elemental"]) expect(tests(k), `${k} ${w}`).toContain(w);
  });

  it("holds options only: no limit, no number, no verdict and no word that tells a team what to do", () => {
    const all = JSON.stringify(excipientClasses.classes);
    expect(all).not.toMatch(/\d/);
    expect(all).not.toMatch(/\b(wizard|validate|validated|required|requires|must|error|non-?compliant|acceptable|safe|unsafe)\b/i);
    expectNoPrivateTerms(all);
  });

  it("the tests of a class have unique keys, and the reader refuses a duplicate class, a duplicate test and an unknown field", () => {
    const c = excipientClasses.classes[0]!;
    expect(() => parseExcipientClasses({ ...excipientClasses, classes: [c, c] })).toThrow(/appears twice/);
    expect(() => parseExcipientClasses({ ...excipientClasses, classes: [{ ...c, oftenCompared: [c.oftenCompared[0]!, c.oftenCompared[0]!] }] })).toThrow(/twice/);
    expect(() => parseExcipientClasses({ ...excipientClasses, classes: [{ ...c, limit: 5 }] })).toThrow(/classes\.yaml/);
    expect(() => parseExcipientClasses({ ...excipientClasses, classes: [{ ...c, key: "Bad Key" }] })).toThrow(/classes\.yaml/);
  });
});

describe("content/excipient/wording.yaml", () => {
  const entries = Object.entries(excipientWording.questions);
  const universe = new Set(["line:class", ...EXCIPIENT_FACTS.map((f) => `fact:${f.key}`)]);

  it("is versioned with its change note", () => {
    expect(excipientWording.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(excipientWording.changelog?.map((c) => c.version)).toContain(excipientWording.version);
  });

  it("has its own wording for every question the engine derives, and none left over", () => {
    for (const k of universe) expect(excipientWording.questions[k], k).toBeDefined();
    expect(entries.map(([k]) => k).filter((k) => !universe.has(k))).toEqual([]);
  });

  it("derives no question that falls back to a generated sentence", () => {
    let p = start("amino_acid");
    // Make every conditional fact apply, so every key is derived at least once.
    for (const side of ["sending", "receiving"] as const) p = setExcipientFact(p, "EXA-001", "EXL-001", "origin", side, { kind: "value", value: "animal" }, ACTOR);
    for (const topic of ["nitrosamine", "elemental"]) p = setExcipientFact(p, "EXA-001", "EXL-001", topic, undefined, { kind: "value", value: "evaluated" }, ACTOR);
    const qs = questions(p);
    expect(qs.filter((q) => !q.wordingWritten).map((q) => q.key)).toEqual([]);
    expect(new Set(qs.filter((q) => q.target.kind === "fact").map((q) => (q.target as { factKey: string }).factKey))).toEqual(new Set(EXCIPIENT_FACTS.map((f) => f.key)));
  });

  it("keeps a prompt to 140 characters and a reason to 220, and a prompt that is asked for each site names the site", () => {
    for (const [k, w] of entries) {
      expect(w.prompt.length, `${k} prompt`).toBeLessThanOrEqual(140);
      expect(w.why.length, `${k} why`).toBeLessThanOrEqual(220);
      expect(w.prompt.trim().endsWith("?"), `${k} is a question`).toBe(true);
    }
    for (const f of EXCIPIENT_FACTS) {
      const w = excipientWording.questions[`fact:${f.key}`]!;
      expect(w.prompt.includes("{site}"), `${f.key} prompt`).toBe(f.perSide && f.key !== "origin" ? true : w.prompt.includes("{site}"));
      if (f.perSide) expect(w.prompt, f.key).toContain("{site}");
      else expect(`${w.prompt} ${w.why} ${w.hint ?? ""}`, f.key).not.toContain("{site}");
    }
  });

  it("gives words for exactly the option values of every choice, and for no other fact", () => {
    for (const f of EXCIPIENT_FACTS) {
      const w = excipientWording.questions[`fact:${f.key}`]!;
      if (f.options) expect(Object.keys(w.choices ?? {}).sort(), f.key).toEqual([...f.options].sort());
      else expect(w.choices, f.key).toBeUndefined();
    }
  });

  it("uses none of the banned words, names no filing category and keeps the sentence to the markers", () => {
    const banned = /\b(wizard|validate|validates|validated|required|requires|error|errors|must|non-?compliant)\b/i;
    const filing = /\b(minor|major|moderate|prior[- ]approval|annual report|CBE-?30|changes being effected|notification|variation)\b/i;
    const texts = [...entries.flatMap(([k, w]) => [`${k}: ${w.prompt}`, w.why, w.hint ?? "", ...Object.values(w.choices ?? {})]), ...Object.values(excipientWording.markers).map((m) => m.explanation)];
    for (const t of texts) {
      expect(t).not.toMatch(banned);
      expect(t).not.toMatch(filing);
    }
  });

  it("links only to glossary entries that exist", () => {
    const ids = new Set(glossary.map((g) => g.id));
    for (const [k, w] of entries) for (const g of w.glossary ?? []) expect(ids.has(g), `${k} -> ${g}`).toBe(true);
  });

  it("has an explanation for every marker and none for an unknown one; every stage marker parses and every stage resolves it", () => {
    expect(Object.keys(excipientWording.markers).sort()).toEqual(EXCIPIENT_MARKERS.map((m) => m.key).sort());
    const p = start();
    for (const stage of [...PROGRAM_STAGES, undefined]) {
      const q = stage ? withEntry(p, "target.site.programStage", stage) : p;
      for (const m of EXCIPIENT_MARKERS) {
        const text = excipientMarkerExplanation(q, excipientWording, m.key);
        expect(text.length, `${m.key} at ${stage}`).toBeGreaterThan(20);
        expect(text, `${m.key} at ${stage}`).not.toContain("{{");
        expect(text).not.toContain(STAGE_MARKER_OPEN);
      }
    }
  });

  it("adapts the explanation to the stage: record it now in engineering and clinical, change control at PPQ and commercial; no marker is hidden", () => {
    const at = (stage: string) => withEntry(start(), "target.site.programStage", stage);
    expect(excipientMarkerExplanation(at("development"), excipientWording, "different_supplier")).toContain("Record it now so the later change assessment starts from known facts");
    expect(excipientMarkerExplanation(at("ppq"), excipientWording, "different_supplier")).toContain("At PPQ and commercial a change of supplier usually goes through change control");
    expect(excipientMarkerExplanation(at("commercial"), excipientWording, "different_supplier")).toContain("change control");
    expect(excipientMarkerExplanation(start(), excipientWording, "different_supplier")).not.toBe("");
    expect(excipientMarkerExplanation(start(), excipientWording, "no_such_marker")).toBe("");
  });

  it("carries no client names, codes or supplier brands, and the reader refuses an unknown field", () => {
    expectNoPrivateTerms(JSON.stringify(excipientWording) + JSON.stringify(excipientClasses));
    expect(() => parseExcipientWording({ version: "1.0.0", questions: { a: { prompt: "p", why: "w", surprise: true } }, markers: {} })).toThrow(/wording\.yaml/);
    expect(parseExcipientWording(JSON.parse(JSON.stringify(excipientWording)))).toEqual(excipientWording);
  });
});

describe("guidance, glossary and failure modes added for the excipient assessment", () => {
  it("adds the six official entries, each with a link on an official host", () => {
    const ids = ["ich-q3c-r8", "ich-q3d-r2", "ich-m7-r2", "ich-q6b", "eu-tse-minimising-risk", "eu-excipient-gmp-risk"];
    for (const id of ids) {
      const g = guidance.items.find((i) => i.id === id);
      expect(g, id).toBeDefined();
      expect(g!.url.startsWith("https://"), id).toBe(true);
    }
    expect(guidance.items.find((i) => i.id === "eu-excipient-gmp-risk")!.verified).toBe("blocked-but-official");
    expect(() => parseGuidance(JSON.parse(JSON.stringify(guidance)))).not.toThrow();
  });

  it("defines the excipient words in the glossary", () => {
    const text = glossary.map((t) => `${t.term} ${t.id}`).join(" | ").toLowerCase();
    for (const w of ["excipient", "compendial", "monograph", "specification", "coa", "tse", "nitrosamine", "elemental impurity", "supplier qualification"]) expect(text, w).toContain(w);
  });

  it("offers five new failure-mode suggestions for buffer preparation and compounding, with no score, and bumps the catalog", () => {
    const ex = failureModes.suggestions.filter((s) => s.key.startsWith("excipient_"));
    expect(ex.map((s) => s.key).sort()).toEqual(["excipient_animal_origin_unknown", "excipient_elemental_not_assessed", "excipient_grade_differs", "excipient_nitrite_amine_unknown", "excipient_supplier_change_not_notified"]);
    for (const s of ex) {
      expect(["buffer_prep", "compounding"]).toContain(s.unitOp);
      expect(s.rationale.length).toBeGreaterThan(20);
    }
    expect(failureModes.catalog.version).toBe("1.1.0");
    expect(() => parseFailureModes(JSON.parse(JSON.stringify(failureModes)))).not.toThrow();
    expectNoPrivateTerms(JSON.stringify(ex));
  });
});

describe("the derived interview", () => {
  it("is empty for an assessment with no line, and for an assessment that does not exist", () => {
    const p = createExcipientAssessment(fresh(), { title: "T" }, ACTOR).project;
    expect(questions(p)).toEqual([]);
    expect(deriveExcipientQuestions(p, "EXA-009", opts)).toEqual([]);
  });

  it("asks the role first, then the facts in order, grouped by the excipient's name, with both sites of a two-sided fact", () => {
    const qs = questions(start());
    expect(qs[0]).toMatchObject({ key: "EXL-001/line:class", state: "open", input: "choice", allowOwnWords: true });
    expect(qs.every((q) => q.lineName === "Polysorbate 80 (fictional grade)")).toBe(true);
    const keys = qs.map((q) => q.key);
    expect(keys.indexOf("EXL-001/fact:whereAdded")).toBeLessThan(keys.indexOf("EXL-001/fact:grade.sending"));
    expect(keys.indexOf("EXL-001/fact:grade.sending")).toBeLessThan(keys.indexOf("EXL-001/fact:grade.receiving"));
    expect(keys).toContain("EXL-001/fact:nitrosamine");
    expect(keys).not.toContain("EXL-001/fact:nitrosamineRef");
    for (const k of ANIMAL_FACT_KEYS) expect(keys.some((x) => x.includes(`fact:${k}`)), k).toBe(false);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names the site in a two-sided prompt and offers 'same as the sending site' only for the receiving site", () => {
    const qs = questions(start());
    expect(byKey(qs, "EXL-001/fact:supplier.sending").prompt).toContain("the sending site");
    expect(byKey(qs, "EXL-001/fact:supplier.receiving").prompt).toContain("the receiving site");
    expect(byKey(qs, "EXL-001/fact:supplier.receiving").canSameAsSending).toBe(true);
    expect(byKey(qs, "EXL-001/fact:supplier.sending").canSameAsSending).toBe(false);
    expect(byKey(qs, "EXL-001/fact:nitrosamine").canSameAsSending).toBe(false);
    for (const q of qs.filter((x) => x.target.kind === "fact")) expect(q.prompt, q.key).not.toContain("{site}");
  });

  it("carries no default: a new line has every question open, none answered", () => {
    const qs = questions(start());
    expect(qs.filter((q) => q.state !== "open").map((q) => q.key)).toEqual([]);
    expect(qs.every((q) => q.current === undefined)).toBe(true);
  });

  it("offers the buffer-step places only when the program dilutes with a buffer, and keeps one that was already chosen", () => {
    const where = (p: Project) => byKey(questions(p), "EXL-001/fact:whereAdded").choices.map((c) => c.value);
    expect(where(start())).toEqual(["drug_substance", "other"]);
    expect(where(withEntry(start(), "scope.dilution", "yes"))).toEqual(["drug_substance", "buffer_prep", "compounding", "other"]);
    const chosen = setExcipientFact(start(), "EXA-001", "EXL-001", "whereAdded", undefined, { kind: "value", value: ["buffer_prep"] }, ACTOR);
    expect(where(chosen)).toEqual(["drug_substance", "buffer_prep", "other"]);
  });

  it("adds what teams often look at from the line's class to the origin, nitrosamine and elemental questions only", () => {
    const qs = questions(start("amino_acid"));
    expect(byKey(qs, "EXL-001/fact:nitrosamine").hint).toContain("Teams often look at: Amino acids carry amine groups");
    expect(byKey(qs, "EXL-001/fact:origin.sending").hint).toContain("Teams often look at:");
    expect(byKey(qs, "EXL-001/fact:supplier.sending").hint ?? "").not.toContain("Teams often look at");
    expect(byKey(questions(start("tonicity_salt")), "EXL-001/fact:nitrosamine").hint ?? "").not.toContain("Teams often look at");
  });

  it("shows the answer in words, with a choice read through its label, a not-known origin visible and a TBD as to be decided", () => {
    let p = start();
    p = setExcipientFact(p, "EXA-001", "EXL-001", "origin", "sending", { kind: "value", value: "not_known" }, ACTOR);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "supplier", "sending", { kind: "tbd" }, ACTOR);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "storage", "sending", { kind: "not_applicable", justification: "Held by the supplier" }, ACTOR);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "supplier", "receiving", { kind: "same_as_sending" }, ACTOR);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "amount", undefined, { kind: "value", value: { value: 0.02, unit: "%" } }, ACTOR);
    const qs = questions(p);
    expect(byKey(qs, "EXL-001/fact:origin.sending")).toMatchObject({ state: "answered", current: "Not known" });
    expect(byKey(qs, "EXL-001/fact:supplier.sending")).toMatchObject({ state: "tbd", current: "To be decided (TBD)" });
    expect(byKey(qs, "EXL-001/fact:storage.sending")).toMatchObject({ state: "not_applicable", reason: "Held by the supplier" });
    expect(byKey(qs, "EXL-001/fact:supplier.receiving")).toMatchObject({ state: "same_as_sending" });
    expect(byKey(qs, "EXL-001/fact:amount").current).toBe("0.02 %");
  });

  it("counts progress and filters: not applicable and 'same as the sending site' count as answered, TBD does not", () => {
    let p = start("sugar");
    p = setExcipientFact(p, "EXA-001", "EXL-001", "supplier", "sending", { kind: "value", value: "A" }, ACTOR);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "supplier", "receiving", { kind: "same_as_sending" }, ACTOR);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "storage", "sending", { kind: "not_applicable", justification: "Held by the supplier" }, ACTOR);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "storage", "receiving", { kind: "tbd" }, ACTOR);
    const qs = questions(p);
    const prog = excipientInterviewProgress(qs);
    expect(prog.overall).toEqual({ total: qs.length, answered: 4, open: qs.length - 4, tbd: 1 }); // the class, two suppliers, one storage
    expect(prog.lines).toEqual([{ lineId: "EXL-001", lineName: "Polysorbate 80 (fictional grade)", ...prog.overall }]);
    expect(filterExcipientQuestions(qs, "all")).toHaveLength(qs.length);
    const open = filterExcipientQuestions(qs, "open");
    expect(open).toHaveLength(qs.length - 4);
    expect(open.some((q) => q.state === "tbd")).toBe(true);
  });

  it("derives again from the record: nothing is stored, and a second line gets its own group", () => {
    let p = start();
    const before = JSON.stringify(p);
    questions(p);
    expect(JSON.stringify(p)).toBe(before);
    p = addExcipientLine(p, "EXA-001", { name: "Sucrose (fictional)", classLabel: "stabiliser" }, ACTOR).project;
    const qs = questions(p);
    expect(new Set(qs.map((q) => q.lineName))).toEqual(new Set(["Polysorbate 80 (fictional grade)", "Sucrose (fictional)"]));
    expect(byKey(qs, "EXL-002/line:class")).toMatchObject({ state: "answered", current: "stabiliser" });
    expect(excipientInterviewProgress(qs).lines.map((l) => l.lineId)).toEqual(["EXL-001", "EXL-002"]);
  });
});

describe("answering through the interview", () => {
  const ask = (p: Project, key: string) => byKey(questions(p), key);

  it("writes a typed value through the module's own function, one change-log event, and the same answer again changes nothing", () => {
    const p0 = start();
    const q = ask(p0, "EXL-001/fact:supplier.sending");
    const p1 = answerExcipientQuestion(p0, q, { kind: "value", value: "Supplier One (fictional)" }, ACTOR, opts);
    expect(p1.changeLog.length).toBe(p0.changeLog.length + 1);
    expect(p1.changeLog.at(-1)).toMatchObject({ action: "excipient_fact_set", path: "excipient.EXA-001.EXL-001.supplier.sending" });
    expect(ask(p1, "EXL-001/fact:supplier.sending")).toMatchObject({ state: "answered", current: "Supplier One (fictional)" });
    expect(answerExcipientQuestion(p1, ask(p1, "EXL-001/fact:supplier.sending"), { kind: "value", value: "Supplier One (fictional)" }, ACTOR, opts)).toBe(p1);
  });

  it("writes a multi-choice, a quantity, and a document reference with its place", () => {
    let p = start();
    p = answerExcipientQuestion(p, ask(p, "EXL-001/fact:grade.sending"), { kind: "value", values: ["usp_nf", "ph_eur"] }, ACTOR, opts);
    expect(ask(p, "EXL-001/fact:grade.sending").current).toBe("Ph. Eur., USP-NF");
    p = answerExcipientQuestion(p, ask(p, "EXL-001/fact:amount"), { kind: "value", amount: 0.5, unit: "mg/mL" }, ACTOR, opts);
    expect(ask(p, "EXL-001/fact:amount").current).toBe("0.5 mg/mL");
    expect(() => answerExcipientQuestion(p, ask(p, "EXL-001/fact:amount"), { kind: "value", unit: "mg/mL" }, ACTOR, opts)).toThrow(ExcipientError);
  });

  it("the exits: not applicable with a reason, to be decided, and 'same as the sending site' on the receiving side only", () => {
    let p = start();
    p = answerExcipientQuestion(p, ask(p, "EXL-001/fact:storage.sending"), { kind: "not_applicable", reason: "Held by the supplier" }, ACTOR, opts);
    expect(ask(p, "EXL-001/fact:storage.sending").state).toBe("not_applicable");
    expect(() => answerExcipientQuestion(p, ask(p, "EXL-001/fact:storage.receiving"), { kind: "not_applicable", reason: " " }, ACTOR, opts)).toThrow(/why/);
    p = answerExcipientQuestion(p, ask(p, "EXL-001/fact:storage.receiving"), { kind: "tbd", owner: "QA", due: "2026-12-01" }, ACTOR, opts);
    expect(ask(p, "EXL-001/fact:storage.receiving").state).toBe("tbd");
    expect(() => answerExcipientQuestion(p, ask(p, "EXL-001/fact:supplier.sending"), { kind: "same_as_sending" }, ACTOR, opts)).toThrow(/receiving site/);
    p = answerExcipientQuestion(p, ask(p, "EXL-001/fact:supplier.receiving"), { kind: "same_as_sending" }, ACTOR, opts);
    expect(ask(p, "EXL-001/fact:supplier.receiving").state).toBe("same_as_sending");
  });

  it("answers the role with a listed class or the person's own words, never both, and refuses nothing chosen", () => {
    let p = start();
    const q = ask(p, "EXL-001/line:class");
    expect(() => answerExcipientQuestion(p, q, { kind: "class" }, ACTOR, opts)).toThrow(/Choose a class/);
    expect(() => answerExcipientQuestion(p, q, { kind: "class", classKey: "not_a_class" }, ACTOR, opts)).toThrow(/class list/);
    expect(() => answerExcipientQuestion(p, q, { kind: "value", value: "x" }, ACTOR, opts)).toThrow(/Choose a class/);
    p = answerExcipientQuestion(p, q, { kind: "class", classKey: "surfactant" }, ACTOR, opts);
    expect(ask(p, "EXL-001/line:class")).toMatchObject({ state: "answered", current: "Surfactant" });
    p = answerExcipientQuestion(p, ask(p, "EXL-001/line:class"), { kind: "class", classLabel: "Antifoam (own words)" }, ACTOR, opts);
    expect(ask(p, "EXL-001/line:class").current).toBe("Antifoam (own words)");
    expect(p.excipients!.assessments[0]!.lines[0]!.classKey).toBeUndefined();
  });

  it("a class opens the 'often compared' prompts, and a prompt already used as a row is not offered again", () => {
    let p = start("surfactant");
    const line0 = () => p.excipients!.assessments[0]!.lines[0]!;
    const offered = oftenComparedPrompts(line0(), excipientClasses).map((t) => t.key);
    expect(offered).toContain("peroxides");
    p = addSpecRow(p, "EXA-001", "EXL-001", { test: "Peroxide value", promptKey: "peroxides" }, ACTOR).project;
    expect(oftenComparedPrompts(line0(), excipientClasses).map((t) => t.key)).not.toContain("peroxides");
    expect(oftenComparedPrompts(line0(), excipientClasses).length).toBe(offered.length - 1);
    // No class, no prompt: nothing is offered for a line without one, and "other" offers none.
    expect(oftenComparedPrompts(start().excipients!.assessments[0]!.lines[0]!, excipientClasses)).toEqual([]);
    expect(oftenComparedPrompts(start("other").excipients!.assessments[0]!.lines[0]!, excipientClasses)).toEqual([]);
  });
});
