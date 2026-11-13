import { z } from "zod";

/*
 * Readers for the two content files of the interview maps: content/interview-map/wording.yaml (the words of the maps: view names, status
 * words, empty states, run messages) and content/interview-map/example-layout.yaml (an example list of rooms with the steps often done in
 * each). WORDS AND OPTIONS ONLY: no grade, no answer, nothing is applied until the person presses "Use this example".
 */

const changelog = z.array(z.object({ version: z.string(), note: z.string() }).passthrough()).optional();
const text = z.string().min(1);

/** Placeholders each template may hold, in {braces}. A test checks that every template holds exactly the ones it needs. */
export const MAP_WORDING_PLACEHOLDERS = {
  "status.allAnswered": ["total"],
  "status.someOpen": ["answered", "total", "open"],
  "status.tbdPart": ["tbd"],
  "status.toConfirmPart": ["toConfirm"],
  "status.leftOutWithReason": ["reason"],
  "areas.alsoDoneIn": ["areas"],
  "areas.inside": ["area"],
  "run.showingAll": ["label"],
  "run.showingOpen": ["label"],
  "run.showingConfirm": ["label"],
  "run.showingTbd": ["label"],
  "editor.saved": ["name"],
  "editor.added": ["name"],
  "editor.removed": ["name"],
  "editor.removeAsk": ["name"],
  "editor.stepsIn": ["name"],
  "steps.moreDetail": ["n"],
  "run.backOnMap": ["label", "status"],
  "run.endOfNode": ["label", "open"],
} as const;

export const interviewMapWordingSchema = z
  .object({
    version: z.string().min(1),
    changelog,
    views: z
      .object({
        groupLabel: text,
        list: text,
        process: text,
        areas: text,
        listHint: text,
        processHint: text,
        areasHint: text,
        processHeadings: text,
        processHeadingsHint: text,
        seeMap: text,
        seeMapHint: text,
      })
      .strict(),
    legend: z
      .object({
        title: text,
        allAnswered: text,
        someOpen: text,
        tbd: text,
        none: text,
        notPlaced: text,
      })
      .strict(),
    status: z
      .object({
        allAnswered: text,
        someOpen: text,
        tbdPart: text,
        toConfirmPart: text,
        nothingToAsk: text,
        leftOut: text,
        leftOutWithReason: text,
        notPlaced: text,
        changeInScope: text,
        notPlacedHint: text,
      })
      .strict(),
    nodes: z.object({ wholeAreas: text, wholeGap: text, wholeTrd: text }).strict(),
    steps: z.object({ moreDetail: text }).strict(),
    areas: z
      .object({
        noStepsHere: text,
        alsoDoneIn: text,
        fromExample: text,
        gradeNotStated: text,
        unitSwitchLabel: text,
        inside: text,
        stepsHere: text,
      })
      .strict(),
    run: z
      .object({
        nextOpen: text,
        backToMap: text,
        nextStepWithOpen: text,
        backOnMap: text,
        endOfNode: text,
        answerHere: text,
        showingAll: text,
        showingOpen: text,
        showingConfirm: text,
        showingTbd: text,
        finishStep: text,
        searchNote: text,
        detailOff: text,
        noneOpen: text,
      })
      .strict(),
    /** Longer sentences (at most 260 characters); every other text is at most 140. */
    explain: z.object({ emptyAreas: text, addFirst: text, startExample: text, useExample: text, exampleNote: text, listIsDefault: text }).strict(),
    /** The words of the "Your areas" page (M14 job 3). */
    editor: z
      .object({
        title: text,
        purpose: text,
        open: text,
        edit: text,
        back: text,
        addTitle: text,
        nameLabel: text,
        addButton: text,
        nameMissing: text,
        gradeLabel: text,
        gradeChoose: text,
        insideLabel: text,
        insideNone: text,
        stepsHint: text,
        stepsIn: text,
        noteLabel: text,
        save: text,
        saved: text,
        added: text,
        removeButton: text,
        removeAsk: text,
        reasonLabel: text,
        reasonMissing: text,
        removeConfirm: text,
        keep: text,
        removed: text,
        looksRight: text,
        exampleTitle: text,
        exampleIntro: text,
        exampleClose: text,
        exampleUsed: text,
        exampleOnlyEmpty: text,
        noAreas: text,
        otherUnitHint: text,
        unitLabel: text,
        help: text,
      })
      .strict(),
  })
  .strict();
export type InterviewMapWording = z.infer<typeof interviewMapWordingSchema>;

/** Reads content/interview-map/wording.yaml. Throws with the first problem named. */
export function parseInterviewMapWording(raw: unknown): InterviewMapWording {
  const r = interviewMapWordingSchema.safeParse(raw);
  if (!r.success) throw new Error(`interview-map/wording.yaml: ${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`);
  const w = r.data as unknown as Record<string, Record<string, string>>;
  for (const [path, allowed] of Object.entries(MAP_WORDING_PLACEHOLDERS)) {
    const [group, key] = path.split(".") as [string, string];
    const found = [...(w[group]![key] ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    const bad = found.find((p) => !(allowed as readonly string[]).includes(p));
    if (bad) throw new Error(`interview-map/wording.yaml: ${path} holds {${bad}}, which is not one of ${allowed.map((a) => `{${a}}`).join(", ")}`);
    const missing = (allowed as readonly string[]).find((p) => !found.includes(p));
    if (missing) throw new Error(`interview-map/wording.yaml: ${path} is missing {${missing}}`);
  }
  return r.data;
}

const exampleAreaSchema = z
  .object({
    name: z.string().trim().min(1),
    /** The name of the example area this one sits inside. */
    inside: z.string().trim().min(1).optional(),
    steps: z.array(z.string().min(1)),
  })
  .strict();

export const exampleLayoutSchema = z.object({ version: z.string().min(1), changelog, note: text, areas: z.array(exampleAreaSchema).min(1) }).strict();
export type ExampleLayout = z.infer<typeof exampleLayoutSchema>;

/**
 * Reads content/interview-map/example-layout.yaml and checks it against the catalog's unit operation keys. An example NEVER states a grade
 * (the schema refuses the key), names are unique, a parent is listed before its child's use and nothing sits inside itself.
 */
export function parseExampleLayout(raw: unknown, stepKeys: readonly string[]): ExampleLayout {
  const r = exampleLayoutSchema.safeParse(raw);
  if (!r.success) throw new Error(`interview-map/example-layout.yaml: ${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`);
  const names = r.data.areas.map((a) => a.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`interview-map/example-layout.yaml: area "${dup}" appears twice`);
  for (const a of r.data.areas) {
    if (a.inside !== undefined && (a.inside === a.name || !names.includes(a.inside))) throw new Error(`interview-map/example-layout.yaml: "${a.name}" sits inside "${a.inside}", which is not another area of the example`);
    const bad = a.steps.find((s) => !stepKeys.includes(s));
    if (bad) throw new Error(`interview-map/example-layout.yaml: "${a.name}" names unknown unit operation "${bad}"`);
    if (new Set(a.steps).size !== a.steps.length) throw new Error(`interview-map/example-layout.yaml: "${a.name}" lists a step twice`);
  }
  return r.data;
}
