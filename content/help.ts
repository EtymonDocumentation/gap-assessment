/**
 * The help content: the short tour of each page and the glossary. Plain data read from content/help/*.yaml and checked when it loads,
 * so a malformed file stops the build instead of showing a broken tour. The mechanical rules (3 to 5 steps, anchors that exist in the
 * page source, no private terms) are in test/help.test.ts.
 */

export interface TourStep {
  /** The data-tour="..." id of the element the step points at. */
  anchor: string;
  title: string;
  text: string;
}

export interface Tour {
  id: string;
  /** The route the tour belongs to (hash path, no query). */
  path: string;
  title: string;
  steps: TourStep[];
}

export interface GlossaryTerm {
  id: string;
  term: string;
  short: string;
  see: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(o: Record<string, unknown>, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`${where}: "${key}" must be a non-empty text`);
  return v.trim();
}

export function parseTours(raw: unknown): Tour[] {
  if (!isRecord(raw) || !Array.isArray(raw["tours"])) throw new Error("help/tours.yaml: expected a list called tours");
  const ids = new Set<string>();
  return raw["tours"].map((t, i) => {
    if (!isRecord(t)) throw new Error(`help/tours.yaml: tour ${i + 1} is not a mapping`);
    const id = str(t, "id", `help/tours.yaml tour ${i + 1}`);
    if (ids.has(id)) throw new Error(`help/tours.yaml: duplicate tour id "${id}"`);
    ids.add(id);
    const where = `help/tours.yaml tour "${id}"`;
    const steps = t["steps"];
    if (!Array.isArray(steps) || steps.length === 0) throw new Error(`${where}: needs steps`);
    return {
      id,
      path: str(t, "path", where),
      title: str(t, "title", where),
      steps: steps.map((s, n) => {
        if (!isRecord(s)) throw new Error(`${where}: step ${n + 1} is not a mapping`);
        const w = `${where} step ${n + 1}`;
        return { anchor: str(s, "anchor", w), title: str(s, "title", w), text: str(s, "text", w) };
      }),
    };
  });
}

export function parseGlossary(raw: unknown): GlossaryTerm[] {
  if (!isRecord(raw) || !Array.isArray(raw["terms"])) throw new Error("help/glossary.yaml: expected a list called terms");
  const ids = new Set<string>();
  const terms = raw["terms"].map((t, i) => {
    if (!isRecord(t)) throw new Error(`help/glossary.yaml: term ${i + 1} is not a mapping`);
    const id = str(t, "id", `help/glossary.yaml term ${i + 1}`);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`help/glossary.yaml: id "${id}" must be lower case letters, digits and hyphens`);
    if (ids.has(id)) throw new Error(`help/glossary.yaml: duplicate id "${id}"`);
    ids.add(id);
    const where = `help/glossary.yaml term "${id}"`;
    const see = t["see"] === undefined ? [] : t["see"];
    if (!Array.isArray(see) || see.some((s) => typeof s !== "string")) throw new Error(`${where}: "see" must be a list of term ids`);
    return { id, term: str(t, "term", where), short: str(t, "short", where), see: see as string[] };
  });
  for (const t of terms) for (const s of t.see) if (!ids.has(s)) throw new Error(`help/glossary.yaml: term "${t.id}" points at unknown term "${s}"`);
  // Alphabetical by the word people look for (case-insensitive), so the page needs no sorting of its own.
  return terms.sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));
}
