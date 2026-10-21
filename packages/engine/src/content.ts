import { isCustomKey, isValidContentPath, pathMatches, unitDef, type CollectionKind, type LabelResolver } from "@gap/process-model";
import {
  catalogSchema,
  questionFileSchema,
  rulesFileSchema,
  templateSchema,
  type Catalog,
  type Condition,
  type Option,
  type ParameterField,
  type Question,
  type Rule,
  type Section,
  type Templates,
} from "./content-schema";
import { adaptText } from "./stage";

export interface ContentBundle {
  catalog: Catalog;
  sections: Section[];
  questions: Question[];
  rules: Rule[];
  templates: Templates;
  versions: { catalog: string; questions: string; rules: string; templates: string };
  questionById: Map<string, Question>;
  sectionById: Map<string, Section>;
  /** Set only on bundles made by effectiveContent(): the loaded bundle they were derived from. */
  effectiveOf?: ContentBundle;
  /** Set only on bundles made by stagedContent(): which wording its {{a|b}} variants were resolved to (true = validated source). */
  sourceValidated?: boolean;
  /** Set only on bundles made by stagedContent(): the bundle with the variants unresolved. */
  stagedOf?: ContentBundle;
}

export class ContentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Content validation failed:\n- ${problems.join("\n- ")}`);
  }
}

function zodProblems(file: string, err: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return err.issues.map((i) => `${file}: ${i.path.map(String).join(".")}: ${i.message}`);
}

export interface RawContent {
  catalog: unknown;
  questionFiles: Record<string, unknown>;
  ruleFiles: Record<string, unknown>;
  templates: unknown;
}

const DEFAULT_SOURCE_FIELDS: ParameterField[] = ["classification", "setPoint", "nor", "par", "rangeBasis"];
const DEFAULT_TARGET_FIELDS: ParameterField[] = ["setPoint", "nor"];

export function parameterFields(q: Question, side: "source" | "target"): ParameterField[] {
  if (q.input.type !== "parameter") return [];
  return side === "source"
    ? (q.input.sourceFields ?? DEFAULT_SOURCE_FIELDS)
    : (q.input.targetFields ?? DEFAULT_TARGET_FIELDS);
}

/** Entry paths (side-less) a question writes on the given side. */
export function boundPaths(q: Question, side: "source" | "target" | "shared"): string[] {
  if (q.input.type === "parameter") {
    if (side === "shared") return [];
    return parameterFields(q, side).map((f) => `${q.binds}.${f}`);
  }
  return [q.binds];
}

export function sameAsSourceAllowed(q: Question): boolean {
  return q.sides === "paired" && q.sameAsSource !== false;
}

/** Parses and cross-checks every content file. Throws ContentError listing all problems. */
export function buildContent(raw: RawContent): ContentBundle {
  const problems: string[] = [];

  const cat = catalogSchema.safeParse(raw.catalog);
  if (!cat.success) problems.push(...zodProblems("catalog", cat.error));
  const tpl = templateSchema.safeParse(raw.templates);
  if (!tpl.success) problems.push(...zodProblems("templates", tpl.error));

  const sections: Section[] = [];
  const questions: Question[] = [];
  let questionsVersion = "";
  for (const [file, data] of Object.entries(raw.questionFiles)) {
    const r = questionFileSchema.safeParse(data);
    if (!r.success) {
      problems.push(...zodProblems(file, r.error));
      continue;
    }
    if (r.data.bank) {
      if (questionsVersion) problems.push(`${file}: only one question file may declare the bank header`);
      questionsVersion = r.data.bank.version;
    }
    sections.push(...r.data.sections);
    questions.push(...r.data.questions);
  }
  if (!questionsVersion) problems.push("questions: no file declares the bank header (bank.id, bank.version)");

  const rules: Rule[] = [];
  let rulesVersion = "";
  for (const [file, data] of Object.entries(raw.ruleFiles)) {
    const r = rulesFileSchema.safeParse(data);
    if (!r.success) {
      problems.push(...zodProblems(file, r.error));
      continue;
    }
    if (r.data.ruleset) {
      if (rulesVersion) problems.push(`${file}: only one rules file may declare the ruleset header`);
      rulesVersion = r.data.ruleset.version;
    }
    rules.push(...r.data.rules);
  }
  if (!rulesVersion) problems.push("rules: no file declares the ruleset header (ruleset.id, ruleset.version)");

  if (problems.length || !cat.success || !tpl.success) throw new ContentError(problems);
  const catalog = cat.data;
  const templates = tpl.data;

  sections.sort((a, b) => a.order - b.order);
  const bundle: ContentBundle = {
    catalog,
    sections,
    questions,
    rules,
    templates,
    versions: {
      catalog: catalog.catalog.version,
      questions: questionsVersion,
      rules: rulesVersion,
      templates: templates.templates.version,
    },
    questionById: new Map(questions.map((q) => [q.id, q])),
    sectionById: new Map(sections.map((s) => [s.id, s])),
  };
  problems.push(...crossCheck(bundle));
  if (problems.length) throw new ContentError(problems);
  return bundle;
}

function conditionRefs(c: Condition, out: { refs: string[]; paths: string[]; uos: string[] }): void {
  if ("all" in c) c.all.forEach((x) => conditionRefs(x, out));
  else if ("any" in c) c.any.forEach((x) => conditionRefs(x, out));
  else if ("not" in c) conditionRefs(c.not, out);
  else if ("eq" in c) out.refs.push(c.eq[0]);
  else if ("in" in c) out.refs.push(c.in[0]);
  else if ("includes" in c) out.refs.push(c.includes[0]);
  else if ("answered" in c) out.refs.push(c.answered);
  else if ("isTbd" in c) out.refs.push(c.isTbd);
  else if ("isTrue" in c) out.refs.push(c.isTrue);
  else if ("uoPresent" in c) out.uos.push(c.uoPresent);
  else if ("changed" in c) out.paths.push(c.changed);
  else if ("increased" in c) out.paths.push(c.increased);
  else if ("decreased" in c) out.paths.push(c.decreased);
  else if ("ratioAbove" in c) out.paths.push(c.ratioAbove[0]);
  else {
    const pair = "gt" in c ? c.gt : "gte" in c ? c.gte : "lt" in c ? c.lt : c.lte;
    out.refs.push(pair[0]);
    if (typeof pair[1] === "string") out.refs.push(pair[1]);
  }
}

const COLLECTION_KEYS = new Set(["param", "equip", "mat", "ipc", "study", "doc"]);

function isValidFullRef(ref: string): boolean {
  // "uo.<...>" and "site.<...>" mean the question's own side (see conditions.ts).
  if (ref.startsWith("scope.") || ref.startsWith("uo.") || ref.startsWith("site.")) return isValidContentPath(ref);
  const [side, ...rest] = ref.split(".");
  return (side === "source" || side === "target") && isValidContentPath(rest.join("."));
}

function crossCheck(b: ContentBundle): string[] {
  const p: string[] = [];
  const uoKeys = new Set(b.catalog.unitOperations.map((u) => u.key));
  const activityKeys = new Set(b.catalog.activities.map((a) => a.key));

  const studyKeys = new Set(b.catalog.unitOperations.flatMap((u) => u.items.filter((i) => i.coll === "study").map((i) => i.key)));
  for (const a of b.catalog.activities) {
    for (const s of a.studies ?? []) {
      if (!studyKeys.has(s)) p.push(`activity ${a.key}: unknown study "${s}" (it must be a study item of a unit operation)`);
    }
  }

  const seenIds = new Set<string>();
  const seenBinds = new Map<string, string>();
  for (const s of b.sections) {
    if (s.kind === "uo" && (!s.uo || !uoKeys.has(s.uo))) p.push(`section ${s.id}: unknown unit operation "${s.uo}"`);
  }
  for (const q of b.questions) {
    const where = `question ${q.id}`;
    if (seenIds.has(q.id)) p.push(`${where}: duplicate id`);
    seenIds.add(q.id);
    const sec = b.sectionById.get(q.section);
    if (!sec) p.push(`${where}: unknown section "${q.section}"`);
    if (q.parent) {
      const parent = b.questionById.get(q.parent);
      if (!parent) p.push(`${where}: unknown parent "${q.parent}"`);
      else if (parent.section !== q.section) p.push(`${where}: parent is in a different section`);
    }
    const isScope = q.binds.startsWith("scope.");
    if (isScope !== (q.sides === "shared")) p.push(`${where}: scope paths must use sides: shared, and only scope paths may`);
    if (q.input.type === "parameter") {
      if (!/^uo\.[a-z0-9_]+\.param\.[a-z0-9_]+$/.test(q.binds)) p.push(`${where}: parameter questions bind to uo.<uo>.param.<key>`);
    } else if (!isValidContentPath(q.binds)) {
      p.push(`${where}: invalid binds path "${q.binds}"`);
    }
    if (sec?.kind === "uo" && !q.binds.startsWith(`uo.${sec.uo}.`)) p.push(`${where}: binds outside its unit operation`);
    const sides = q.sides === "shared" ? ["shared"] : q.sides === "paired" ? ["source", "target"] : [q.sides];
    for (const side of sides) {
      for (const path of boundPaths(q, side as "source" | "target" | "shared")) {
        const k = `${side}:${path}`;
        const other = seenBinds.get(k);
        if (other) p.push(`${where}: ${k} is already bound by ${other}`);
        seenBinds.set(k, q.id);
      }
    }
    const t = q.input.type;
    if (t === "choice" || t === "multi_choice") {
      if (!q.input.options && !q.input.optionsFrom) p.push(`${where}: choice input needs options or optionsFrom`);
      if (q.input.optionsFrom && !b.catalog.optionSets[q.input.optionsFrom]) {
        p.push(`${where}: unknown option set "${q.input.optionsFrom}"`);
      }
    }
    if (t === "quantity" || t === "range" || t === "parameter") {
      if (!q.input.units?.length) p.push(`${where}: numeric input needs units`);
      const dims = new Set<string>();
      for (const u of q.input.units ?? []) {
        const d = unitDef(u);
        if (!d) p.push(`${where}: unknown unit "${u}"`);
        else dims.add(d.dimension);
      }
      if (dims.size > 1) p.push(`${where}: units span more than one dimension`);
    }
    if (q.showWhen) {
      const refs = { refs: [] as string[], paths: [] as string[], uos: [] as string[] };
      conditionRefs(q.showWhen, refs);
      for (const r of refs.refs) if (!isValidFullRef(r)) p.push(`${where}: invalid condition reference "${r}"`);
      for (const r of refs.paths) if (!isValidContentPath(r)) p.push(`${where}: invalid condition path "${r}"`);
      for (const u of refs.uos) if (!uoKeys.has(u)) p.push(`${where}: unknown unit operation "${u}" in condition`);
    }
    if (q.sides !== "shared" && !q.binds.startsWith("scope.") && !findRule(b.rules, q.binds)) {
      p.push(`${where}: no comparison rule matches "${q.binds}"`);
    }
  }

  const ruleIds = new Set<string>();
  for (const r of b.rules) {
    if (ruleIds.has(r.id)) p.push(`rule ${r.id}: duplicate id`);
    ruleIds.add(r.id);
    const acts = [...r.activities, ...Object.values(r.outcomes).flatMap((o) => o?.activities ?? [])];
    for (const a of acts) if (!activityKeys.has(a)) p.push(`rule ${r.id}: unknown activity "${a}"`);
    if (r.comparator === "evidence" && !r.config.map) p.push(`rule ${r.id}: evidence comparator needs config.map`);
    if (r.comparator === "transition" && !r.config.transitions?.length) p.push(`rule ${r.id}: transition comparator needs config.transitions`);
    if (r.comparator === "transition") {
      // Every answer named in a transition must be an option of each question the rule applies to.
      for (const q of b.questions) {
        if (q.sides === "shared" || findRule(b.rules, q.binds) !== r) continue;
        const values = new Set(optionsFor(b, q).map((o) => o.value));
        for (const tr of r.config.transitions ?? []) {
          for (const v of [...(tr.from ?? []), ...(tr.to ?? [])]) if (!values.has(v)) p.push(`rule ${r.id}: transition answer "${v}" is not an option of question ${q.id}`);
        }
      }
    }
    if (r.comparator === "coverage" && (!r.config.against || !r.config.coverageSide)) {
      p.push(`rule ${r.id}: coverage comparator needs config.against and config.coverageSide`);
    }
    const againstPath = r.config.against?.path;
    const parameterRoot = againstPath !== undefined && /^uo\.[a-z0-9_]+\.param\.[a-z0-9_]+$/.test(againstPath);
    if (r.config.against && !parameterRoot && !isValidContentPath(r.config.against.path)) {
      p.push(`rule ${r.id}: invalid config.against.path "${r.config.against.path}"`);
    }
  }
  for (const u of b.catalog.unitOperations) {
    if (u.applicableWhen) {
      const refs = { refs: [] as string[], paths: [] as string[], uos: [] as string[] };
      conditionRefs(u.applicableWhen, refs);
      for (const r of refs.refs) if (!r.startsWith("scope.")) p.push(`unit operation ${u.key}: applicableWhen may only use scope.* references`);
    }
    if (u.hiddenWhen) {
      const refs = { refs: [] as string[], paths: [] as string[], uos: [] as string[] };
      conditionRefs(u.hiddenWhen, refs);
      for (const r of refs.refs) if (!r.startsWith("site.")) p.push(`unit operation ${u.key}: hiddenWhen may only use site.* references`);
      if (refs.paths.length || refs.uos.length) p.push(`unit operation ${u.key}: hiddenWhen may only compare site.* answers`);
    }
    // Tailoring topics: explicit topics must not shadow an item collection key, and once a unit operation declares topics
    // every question except the presence question must name one, otherwise a question could not be switched off with its topic.
    const topicKeys = new Set((u.topics ?? []).map((t) => t.key));
    if (topicKeys.size !== (u.topics ?? []).length) p.push(`unit operation ${u.key}: duplicate topic key`);
    for (const k of topicKeys) if (COLLECTION_KEYS.has(k)) p.push(`unit operation ${u.key}: topic "${k}" collides with an item collection name`);
    for (const q of b.questions) {
      const sec = b.sectionById.get(q.section);
      if (sec?.kind !== "uo" || sec.uo !== u.key) continue;
      if (q.topic && !topicKeys.has(q.topic)) p.push(`question ${q.id}: unknown topic "${q.topic}" for ${u.key}`);
      if (topicKeys.size && !q.topic && q.binds !== `uo.${u.key}.presence` && !q.parent) {
        p.push(`question ${q.id}: ${u.key} declares topics, so the question needs a topic`);
      }
    }
  }
  return p;
}

export function findRule(rules: Rule[], path: string): Rule | undefined {
  return rules.find((r) => r.match.some((g) => pathMatches(g, path)));
}

export function optionsFor(content: ContentBundle, q: Question): Option[] {
  if (q.input.type === "yes_no") {
    return [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
  }
  if (q.input.optionsFrom) return content.catalog.optionSets[q.input.optionsFrom] ?? [];
  return q.input.options ?? [];
}

export function optionLabel(content: ContentBundle, q: Question | undefined, value: string): string {
  if (!q) return value;
  return optionsFor(content, q).find((o) => o.value === value)?.label ?? value;
}

export function labelResolver(content: ContentBundle): LabelResolver {
  const uos = new Map(content.catalog.unitOperations.map((u) => [u.key, u]));
  return {
    uoLabel: (uo) => uos.get(uo)?.label ?? uo,
    uoSequence: (uo) => uos.get(uo)?.sequence ?? 999,
    itemLabel: (uo: string, coll: CollectionKind, item: string) =>
      uos.get(uo)?.items.find((i) => i.coll === coll && i.key === item)?.label ?? item.replace(/_/g, " "),
    uoCustom: (uo) => isCustomKey(uo),
    itemCustom: (_uo, _coll, item) => isCustomKey(item),
  };
}

// The three label helpers resolve stage variants too, so a bundle that was never staged cannot leak "{{a|b}}" into output.
// An unstaged bundle reads as a non-validated source; the engine and the web app always stage first.
export function fieldLabel(content: ContentBundle, field: string): string {
  return adaptText(content.catalog.fieldLabels[field] ?? field, content.sourceValidated === true);
}

export function activityLabel(content: ContentBundle, key: string): string {
  return adaptText(content.catalog.activities.find((a) => a.key === key)?.label ?? key, content.sourceValidated === true);
}

export function categoryLabel(content: ContentBundle, key: string): string {
  return adaptText(content.catalog.categories.find((c) => c.key === key)?.label ?? key, content.sourceValidated === true);
}
